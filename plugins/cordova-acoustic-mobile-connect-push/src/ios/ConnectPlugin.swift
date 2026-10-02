/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any intellectual or
 * industrial property rights of Acoustic, L.P. except as may be provided in an agreement with
 * Acoustic, L.P. Any unauthorized copying or distribution of content from this file is
 * prohibited.
 */

import Foundation
import Cordova
import Connect

/// Cordova entry point for the Acoustic Connect plugin (iOS).
///
/// Dispatches actions emitted by the JS façade `www/AcousticConnect.js` against
/// the native Connect SDK. Action selector names must match the JS façade exactly.
///
/// `@MainActor` on the class: ConnectSDK is `@MainActor`-isolated and Cordova
/// already dispatches all plugin calls on the main thread.
@MainActor
@objc(ConnectPlugin)
public class ConnectPlugin: CDVPlugin {

    // MARK: - State

    private var pushMode: String = Constants.pushModeAutomatic
    private var bridgeLogLevel: String = Constants.logLevelDefault
    private var killSwitchEnabled: Bool = false
    private var killSwitchUrl: String?
    // nil = not configured by the app — leave the SDK's own default alone. Unlike
    // killSwitchEnabled, this plugin does not decide a default for location logging.
    private var locationLoggingEnabled: Bool?
    private var screenCaptureEnabled: Bool?
    private var layoutConfigIos: [String: Any]?

    // MARK: - Lifecycle

    public override func pluginInitialize() {
        super.pluginInitialize()

        // Apply runtime settings (debug env vars, etc.) from the bundled config
        // before any SDK call. Must run before enable() which is called later from JS.
        applyRuntimeConfig()
    }

    // MARK: - Core actions (enable / disable / setLogLevel)

    /// JS: `AcousticConnect.enable(appKey, postURL, pushMode?, options?)`
    @objc(enable:)
    func enable(command: CDVInvokedUrlCommand) {
        let appKey = command.argument(at: 0) as? String ?? ""
        let postURL = command.argument(at: 1) as? String ?? ""
        if appKey.isEmpty {
            sendError(command, code: Constants.codeInvalidArgs, message: "enable: appKey is empty")
            return
        }
        if postURL.isEmpty {
            sendError(command, code: Constants.codeInvalidArgs, message: "enable: postURL is empty")
            return
        }
        let modeString = command.argument(at: 2) as? String ?? Constants.pushModeAutomatic
        guard Constants.validPushModes.contains(modeString) else {
            sendError(command, code: Constants.codeInvalidArgs,
                      message: "enable: pushMode must be 'automatic' or 'manual'")
            return
        }
        let options = command.argument(at: 3) as? [String: Any]
        let appGroupId = options?["iosAppGroupIdentifier"] as? String
        pushMode = modeString
        let mode = mapPushMode(modeString)
        let pushConfig = ConnectPushConfig(mode: mode, appGroupIdentifier: appGroupId)

        // Captured by value (not via self) so the JS Promise can still be resolved
        // from the guard-else branch below even if self is deallocated before the
        // Task runs — same reasoning as waitForEnabled()'s own capture-by-value.
        let delegate = commandDelegate
        let callbackId: String = command.callbackId ?? ""

        // Dispatched to the next main-thread run-loop turn rather than called inline:
        // Cordova's own thread watchdog flags any plugin action that blocks the calling
        // (main) thread for too long, and ConnectSDK.shared.enable(...) — an
        // @MainActor-isolated, non-trivial SDK init — routinely takes 13-23ms. The
        // actual SDK call still runs on the main thread (required — ConnectSDK is
        // @MainActor), just one run-loop turn later, which satisfies the watchdog
        // without violating ConnectSDK's own threading requirement.
        Task { @MainActor [weak self] in
            guard let self else {
                // Plugin was deallocated (e.g. WebView torn down) before this run-loop
                // turn ran — reject the JS Promise instead of leaving it pending forever.
                guard !callbackId.isEmpty else { return }
                let payload: [String: Any] = [
                    "code": Constants.codeInternalError,
                    "message": "enable: plugin was deallocated before SDK init could run"
                ]
                let result = CDVPluginResult(status: .error, messageAs: payload as [AnyHashable: Any])
                delegate?.send(result, callbackId: callbackId)
                return
            }
            // Apply the configured kill-switch state before enabling, so the bundled
            // plist's default (KillSwitchEnabled=true) doesn't take effect ahead of
            // our value. No re-apply after enable(): that was a defensive guess (by
            // analogy to a confirmed Android SDK behavior, not verified against this
            // closed-source iOS binary) rather than a fix for an observed issue —
            // dropped until there's evidence the iOS SDK actually needs it (e.g. a
            // Connect dashboard Raw Data check showing the pre-enable value doesn't
            // stick).
            //
            self.applyKillSwitchConfig()
            self.applyLocationLoggingConfig()
            ConnectSDK.shared.enable(appKey: appKey, postURL: postURL, push: pushConfig)
            // Unlike the kill switch and location logging, screen-capture settings only
            // take effect when applied AFTER enable(): applied earlier, the SDK reloads
            // its bundled layout defaults during enable() and the setting is lost.
            self.applyLayoutConfig()
            self.applyScreenCaptureConfig()
            self.waitForEnabled(command)
        }
    }

    /// JS: `AcousticConnect.disable()`
    @objc(disable:)
    func disable(command: CDVInvokedUrlCommand) {
        ConnectSDK.shared.disable()
        sendSuccess(command)
    }

    /// JS: `AcousticConnect.setLogLevel(level)`
    @objc(setLogLevel:)
    func setLogLevel(command: CDVInvokedUrlCommand) {
        let level = command.argument(at: 0) as? String ?? ""
        guard Constants.validLogLevels.contains(level) else {
            sendError(command, code: Constants.codeInvalidArgs,
                      message: "setLogLevel: level must be one of \(Constants.validLogLevels.sorted())")
            return
        }
        bridgeLogLevel = level
        sendSuccess(command)
    }

    // MARK: - SDK state

    /// JS: `AcousticConnect.isSdkEnabled()` — returns 1 (truthy) when enabled, null when not.
    @objc(isSdkEnabled:)
    func isSdkEnabled(command: CDVInvokedUrlCommand) {
        let result = CDVPluginResult(status: .ok, messageAs: ConnectSDK.shared.isEnabled)
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    /// JS: `AcousticConnect.getSdkVersion()` — the native Connect SDK's own
    /// library version, distinct from the Cordova plugin's version.
    @objc(getSdkVersion:)
    func getSdkVersion(command: CDVInvokedUrlCommand) {
        let result = CDVPluginResult(status: .ok, messageAs: ConnectSDK.shared.frameworkVersion)
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    /// JS: `AcousticConnect.setCurrentScreenName(name)`.
    @objc(setCurrentScreenName:)
    func setCurrentScreenName(command: CDVInvokedUrlCommand) {
        let name = (command.argument(at: 0) as? String ?? "").trimmingCharacters(in: .whitespaces)
        if !name.isEmpty {
            _ = ConnectSDK.shared.setCurrentScreen(pageName: name)
        }
        sendSuccess(command)
    }

    /// JS: `AcousticConnect.flushQueues()` — flushes buffered events to the collector.
    @objc(flushQueues:)
    func flushQueues(command: CDVInvokedUrlCommand) {
        ConnectSDK.shared.flush()
        sendSuccess(command)
    }

    // MARK: - Identity


    /// Logs an identity signal via `ConnectSDK.shared.identity.log(...)`. Flushes
    /// immediately so the server sees the contact signal without waiting for the
    /// next batch upload.
    @objc(logIdentificationEvent:)
    func logIdentificationEvent(command: CDVInvokedUrlCommand) {
        let name  = (command.argument(at: 0) as? String ?? "").trimmingCharacters(in: .whitespaces)
        let value = (command.argument(at: 1) as? String ?? "").trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !value.isEmpty else {
            sendError(command, code: Constants.codeInvalidArgs,
                      message: "logIdentificationEvent: name and value are required")
            return
        }
        guard ConnectApplicationHelper.sharedInstance()._connectIsReadyForLogging() else {
            sendError(command, code: Constants.codeInternalError,
                      message: "logIdentificationEvent: SDK is not ready — call enable() first")
            return
        }
        let rawType = (command.argument(at: 2) as? String ?? "").trimmingCharacters(in: .whitespaces)
        let signalType = rawType.isEmpty ? "loggedIn" : rawType
        let additionalParameters = command.argument(at: 3) as? [String: String] ?? [:]

        let ok = ConnectSDK.shared.identity.log(
            identifierName: name,
            identifierValue: value,
            signalType: signalType,
            additionalParameters: additionalParameters
        )
        if ok {
            ConnectSDK.shared.flush()
            sendSuccess(command)
        } else {
            sendError(command, code: Constants.codeInternalError,
                      message: "logIdentificationEvent returned false — SDK may not be enabled")
        }
    }

    // MARK: - Custom events

    /// JS: `AcousticConnect.logCustomEvent(eventName, values?, level?)`
    ///
    /// Level defaults to 3 (kEOMonitoringLevelInfo on Android /
    /// connectMonitoringLevelWiFi on iOS).
    @objc(logCustomEvent:)
    func logCustomEvent(command: CDVInvokedUrlCommand) {
        let eventName = command.argument(at: 0) as? String ?? ""
        guard !eventName.isEmpty else {
            sendError(command, code: Constants.codeInvalidArgs,
                      message: "logCustomEvent: eventName is required")
            return
        }
        let values = command.argument(at: 1) as? [String: Any] ?? [:]
        let levelInt = command.argument(at: 2) as? Int ?? 3
        let level = mapMonitoringLevel(levelInt)
        let ok = ConnectCustomEvent().logEvent(eventName, values: values, level: level)
        if ok {
            sendSuccess(command)
        } else {
            sendError(command, code: Constants.codeInternalError, message: "logCustomEvent returned false")
        }
    }

    // MARK: - Runtime config items

    /// JS: `AcousticConnect.setConfigItem(key, value, moduleName)` — iOS has a single config
    /// store, so `moduleName` is only validated.
    @objc(setConfigItem:)
    func setConfigItem(command: CDVInvokedUrlCommand) {
        let key = (command.argument(at: 0) as? String ?? "").trimmingCharacters(in: .whitespaces)
        let module = (command.argument(at: 2) as? String ?? "").trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty, !module.isEmpty, let value = configValue(from: command.argument(at: 1)) else {
            sendError(command, code: Constants.codeInvalidArgs,
                      message: "setConfigItem: key and moduleName must be non-empty strings and value a boolean, string or number")
            return
        }
        if ConnectApplicationHelper.sharedInstance().setConfigurableItem(key, value: value) {
            sendSuccess(command)
        } else {
            sendError(command, code: Constants.codeInternalError, message: "setConfigItem returned false")
        }
    }

    /// JS: `AcousticConnect.getConfigItem(key, defaultValue, moduleName)` — resolves with the raw
    /// item as text (or nothing when it is not set); the JS facade applies the type.
    @objc(getConfigItem:)
    func getConfigItem(command: CDVInvokedUrlCommand) {
        let key = (command.argument(at: 0) as? String ?? "").trimmingCharacters(in: .whitespaces)
        let module = (command.argument(at: 1) as? String ?? "").trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty, !module.isEmpty else {
            sendError(command, code: Constants.codeInvalidArgs,
                      message: "getConfigItem: key and moduleName must be non-empty strings")
            return
        }
        let raw = ConnectApplicationHelper.sharedInstance().value(forConfigurableItem: key)
        let text = configText(from: raw)
        let result = text.map { CDVPluginResult(status: .ok, messageAs: $0) } ?? CDVPluginResult(status: .ok)
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    /// A JSON boolean reaches Swift as an NSNumber; tell it from a number by its Core Foundation type.
    private func configValue(from argument: Any?) -> Any? {
        if let number = argument as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
            return number.doubleValue.isFinite ? number.doubleValue : nil
        }
        return argument as? String
    }

    private func configText(from raw: Any?) -> String? {
        if let number = raw as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
            let d = number.doubleValue
            return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : String(d)
        }
        return raw as? String
    }

    // MARK: - Signals and exceptions

    /// JS: `AcousticConnect.logSignal(values, level?)` — `values` is arbitrary JSON.
    @objc(logSignal:)
    func logSignal(command: CDVInvokedUrlCommand) {
        guard let values = command.argument(at: 0) as? [String: Any] else {
            sendError(command, code: Constants.codeInvalidArgs,
                      message: "logSignal: values must be a JSON object")
            return
        }
        let levelInt = command.argument(at: 1) as? Int ?? 3
        let ok = ConnectCustomEvent().logSignal(values, level: mapMonitoringLevel(levelInt))
        if ok {
            sendSuccess(command)
        } else {
            sendError(command, code: Constants.codeInternalError, message: "logSignal returned false")
        }
    }

    /// JS: `AcousticConnect.logExceptionEvent(message, stackInfo?, unhandled?)`
    @objc(logExceptionEvent:)
    func logExceptionEvent(command: CDVInvokedUrlCommand) {
        let message = (command.argument(at: 0) as? String ?? "").trimmingCharacters(in: .whitespaces)
        guard !message.isEmpty else {
            sendError(command, code: Constants.codeInvalidArgs,
                      message: "logExceptionEvent: message is required")
            return
        }
        let stackInfo = command.argument(at: 1) as? String ?? ""
        let unhandled = command.argument(at: 2) as? Bool ?? false
        // The SDK reads the message from the NSException; with nil it dropped the message and
        // the stack and logged only the unhandled flag. The stack is passed as additional data.
        let exception = NSException(name: NSExceptionName("Cordova Plugin"), reason: message, userInfo: nil)
        let ok = ConnectCustomEvent().logNSExceptionEvent(exception, dataDictionary: ["stacktrace": stackInfo], isUnhandled: unhandled)
        if ok {
            sendSuccess(command)
        } else {
            sendError(command, code: Constants.codeInternalError, message: "logExceptionEvent returned false")
        }
    }

    // MARK: - Screen views

    /// JS: `AcousticConnect.logScreenViewContextLoad(logicalPageName, referrer?)`
    @objc(logScreenViewContextLoad:)
    func logScreenViewContextLoad(command: CDVInvokedUrlCommand) {
        logScreenView(command, type: ConnectScreenViewType.load, label: "logScreenViewContextLoad")
    }

    /// JS: `AcousticConnect.logScreenViewContextUnload(logicalPageName, referrer?)`
    @objc(logScreenViewContextUnload:)
    func logScreenViewContextUnload(command: CDVInvokedUrlCommand) {
        logScreenView(command, type: ConnectScreenViewType.unload, label: "logScreenViewContextUnload")
    }

    private func logScreenView(_ command: CDVInvokedUrlCommand,
                               type: ConnectScreenViewType,
                               label: String) {
        let pageName = (command.argument(at: 0) as? String ?? "").trimmingCharacters(in: .whitespaces)
        guard !pageName.isEmpty else {
            sendError(command, code: Constants.codeInvalidArgs,
                      message: "\(label): logicalPageName is required")
            return
        }
        let rawReferrer = command.argument(at: 1) as? String
        let referrer = (rawReferrer?.isEmpty ?? true) ? nil : rawReferrer
        let ok = ConnectCustomEvent().logScreenViewContext(
            pageName,
            withClass: "Cordova_\(pageName)",
            applicationContext: type,
            referrer: referrer
        )
        if ok {
            sendSuccess(command)
        } else {
            sendError(command, code: Constants.codeInternalError, message: "\(label) returned false")
        }
    }

    // MARK: - Push permission

    /// JS: `AcousticConnect.push.requestPermission()` — presents the system push prompt via the SDK.
    @objc(pushRequestPermission:)
    func pushRequestPermission(command: CDVInvokedUrlCommand) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let auth = try await ConnectSDK.shared.push.requestAuthorization()
                var payload: [String: Any] = ["granted": auth.granted]
                if let err = auth.error {
                    payload["error"] = err.localizedDescription
                }
                let result = CDVPluginResult(status: .ok, messageAs: payload as [AnyHashable: Any])
                self.commandDelegate.send(result, callbackId: command.callbackId)
            } catch {
                let payload: [String: Any] = ["granted": false, "error": error.localizedDescription]
                let result = CDVPluginResult(status: .ok, messageAs: payload as [AnyHashable: Any])
                self.commandDelegate.send(result, callbackId: command.callbackId)
            }
        }
    }

    /// JS: `AcousticConnect.push.getPermissionState()` — returns true/false/null tri-state via the SDK.
    @objc(pushGetPermissionState:)
    func pushGetPermissionState(command: CDVInvokedUrlCommand) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                if let granted = try await ConnectSDK.shared.push.getCurrentAuthorization() {
                    let result = CDVPluginResult(status: .ok, messageAs: granted)
                    self.commandDelegate.send(result, callbackId: command.callbackId)
                } else {
                    self.sendSuccess(command) // null = not determined
                }
            } catch {
                self.sendSuccess(command) // null = not determined on error
            }
        }
    }

    /// JS: `AcousticConnect.push.didReceiveAuthorization(granted, error?)`
    @objc(pushDidReceiveAuthorization:)
    func pushDidReceiveAuthorization(command: CDVInvokedUrlCommand) {
        // nil granted (notDetermined) has no SDK equivalent — skip the call.
        guard let granted = command.argument(at: 0) as? Bool else {
            sendBool(command, value: true)
            return
        }
        let errorDesc = command.argument(at: 1) as? String
        let nsError: NSError? = errorDesc.map {
            NSError(domain: "ConnectCordovaBridge", code: -1,
                    userInfo: [NSLocalizedDescriptionKey: $0])
        }
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try ConnectSDK.shared.push.didReceiveAuthorization(granted: granted, error: nsError)
                self.sendBool(command, value: true)
            } catch {
                self.sendBool(command, value: false)
            }
        }
    }

    // MARK: - Manual-mode notification forwarders

    @objc(pushDidReceiveNotification:)
    func pushDidReceiveNotification(command: CDVInvokedUrlCommand) {
        guard requireManualMode(command) else { return }
        sendBool(command, value: true)
    }

    @objc(pushDidReceiveResponse:)
    func pushDidReceiveResponse(command: CDVInvokedUrlCommand) {
        guard requireManualMode(command) else { return }
        sendBool(command, value: true)
    }

    // MARK: - Runtime config

    /// Reads `www/AcousticConnectNativeConfig.json` (generated by the before_prepare hook
    /// from ConnectConfig.json) and applies settings that must be in place before enable().
    ///
    /// Currently applies:
    ///   useRelease=false → setenv CONNECT_DEBUG / TLF_DEBUG / EODebug = "1"
    ///     Enables verbose SDK logging when building against AcousticConnectDebug.
    ///   killSwitchEnabled / killSwitchUrl → stored for applyKillSwitchConfig() to apply
    ///     around enable(). Default false/nil — the SDK's own bundled plist default is
    ///     `true`, so apps must opt in explicitly via ConnectConfig.json.
    ///   locationLoggingEnabled → stored for applyLocationLoggingConfig() to apply once,
    ///     before enable(). nil (not configured) means the SDK's own bundled default is
    ///     left untouched — unlike killSwitchEnabled, this plugin does not force a
    ///     default either way for location data collection.
    ///   screenCaptureEnabled → stored for applyScreenCaptureConfig() to apply once,
    ///     right after enable(). nil (not configured) leaves the SDK default (capture on).
    ///   layoutConfigIos → the resolved AutoLayout / AppendMapIds rules, stored for
    ///     applyLayoutConfig() to apply right after enable(). nil leaves the SDK's bundled
    ///     layout config untouched.
    private func applyRuntimeConfig() {
        guard let url = Bundle.main.url(forResource: "AcousticConnectNativeConfig",
                                         withExtension: "json",
                                         subdirectory: "www")
        else {
            NSLog("[AcousticConnect] AcousticConnectNativeConfig.json not found in www/ — using SDK defaults")
            return
        }
        guard let data = try? Data(contentsOf: url),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            NSLog("[AcousticConnect] AcousticConnectNativeConfig.json is malformed — using SDK defaults")
            return
        }

        let useRelease = config["useRelease"] as? Bool
        #if DEBUG
        if useRelease == false {
            setenv("CONNECT_DEBUG", "1", 0)
            setenv("TLF_DEBUG", "1", 0)
            setenv("EODebug", "1", 0)
            NSLog("[AcousticConnect] useRelease=false — enabled verbose native SDK logging (CONNECT_DEBUG/TLF_DEBUG/EODebug)")
        }
        #endif

        killSwitchEnabled = config["killSwitchEnabled"] as? Bool ?? false
        killSwitchUrl = config["killSwitchUrl"] as? String
        // config["locationLoggingEnabled"] is JSON `null` when not configured, which
        // JSONSerialization surfaces as NSNull, not Swift nil — `as? Bool` correctly
        // yields nil for both "absent" and "explicit null" cases.
        locationLoggingEnabled = config["locationLoggingEnabled"] as? Bool
        // Same JSON-null handling as locationLoggingEnabled above.
        screenCaptureEnabled = config["screenCaptureEnabled"] as? Bool
        // JSON null (not configured) surfaces as NSNull, which `as? [String: Any]` maps to nil.
        layoutConfigIos = config["layoutConfigIos"] as? [String: Any]
    }

    /// Applies the configured kill-switch state to the SDK. Called once, before
    /// `ConnectSDK.shared.enable(...)` in `enable()`, to override the bundled
    /// plist's default (`KillSwitchEnabled=true`) ahead of it.
    private func applyKillSwitchConfig() {
        ConnectSDK.shared.setConfigurableItem("KillSwitchEnabled", value: killSwitchEnabled)
        if killSwitchEnabled, let url = killSwitchUrl, !url.isEmpty {
            ConnectSDK.shared.setKillSwitchURL(url)
        }
    }

    /// Applies the configured location-logging state to the SDK, once, before
    /// `ConnectSDK.shared.enable(...)` — a no-op unless the app has explicitly opted
    /// in or out via `ConnectConfig.json`'s `LocationLoggingEnabled`.
    ///
    /// Unlike `applyKillSwitchConfig()`, this is NOT re-applied after `enable()`:
    /// `LogLocationEnabled` gates whether the SDK starts its location task, checked
    /// once as part of `enable()` itself (see the Android-side equivalent,
    /// `TLF_LOG_LOCATION_ENABLED`, read once inside `Tealeaf.java`'s `enable(String)`)
    /// — there's no evidence of a delayed reset the way `KillSwitchEnabled` has, so a
    /// single pre-enable apply is sufficient.
    ///
    /// Note: this only stops location data reaching the collector. It does NOT remove
    /// `CoreLocation` linkage from the compiled `AcousticConnect` xcframework, so on its
    /// own it does not resolve Apple's ITMS-90683 App Store warning (missing
    /// `NSLocationWhenInUseUsageDescription`) — that needs either the Info.plist key
    /// declared, or an SDK-side build variant that doesn't link CoreLocation at all.
    private func applyLocationLoggingConfig() {
        guard let locationLoggingEnabled else { return }
        ConnectSDK.shared.setConfigurableItem("LogLocationEnabled", value: locationLoggingEnabled)
    }

    /// Applies the layout rules resolved from `ConnectConfig.json`'s `layoutConfig` and
    /// `layoutConfigIos` (shared baseline with the iOS block deep-merged over it, done at
    /// prepare time). Each section the app supplied (`AutoLayout`, `AppendMapIds`) is
    /// deep-merged over the one the SDK has in effect: nested dictionaries merge, arrays and
    /// scalars from the app replace the SDK's. A section the app did not supply is left
    /// alone. nil (nothing configured) is a no-op.
    ///
    /// Merging rather than replacing means a partial block (for example only
    /// `GlobalScreenSettings.CaptureLayoutOn`) cannot discard the SDK's other rules; a
    /// replacing partial block was observed to also stop screen views (verified on a simulator).
    ///
    /// Must run after `enable()`: applied earlier, the SDK reloads its bundled layout
    /// config during enable() and the override is lost (verified on a simulator).
    private func applyLayoutConfig() {
        guard let layoutConfigIos else { return }
        let helper = ConnectApplicationHelper.sharedInstance()
        for key in ["AutoLayout", "AppendMapIds"] {
            guard let override = layoutConfigIos[key] as? [String: Any] else { continue }
            let effective = helper.value(forConfigurableItem: key) as? [String: Any] ?? [:]
            if !helper.setConfigurableItem(key, value: deepMerging(effective, override)) {
                NSLog("[AcousticConnect] applyLayoutConfig: setConfigurableItem(\(key)) was rejected — SDK default kept")
            }
        }
    }

    /// Recursively merges `override` over `base` into a new dictionary: dictionaries present
    /// on both sides merge key by key; anything else from `override` (arrays, scalars, a
    /// dictionary where `base` has none) replaces the base value.
    private func deepMerging(_ base: [String: Any], _ override: [String: Any]) -> [String: Any] {
        var result = base
        for (key, value) in override {
            if let overrideDict = value as? [String: Any], let baseDict = base[key] as? [String: Any] {
                result[key] = deepMerging(baseDict, overrideDict)
            } else {
                result[key] = value
            }
        }
        return result
    }

    /// Applies the app's screen-capture choice from `ConnectConfig.json`'s
    /// `ScreenCaptureEnabled`. Only an explicit `false` does anything: nil (not
    /// configured) and `true` leave the SDK's own default (layout and screenshot
    /// captured on every screen); this plugin does not force a value.
    ///
    /// Opting out sets `GlobalScreenSettings.CaptureLayoutOn = 0` on the SDK's effective
    /// `AutoLayout` block. Verified on an iOS 26 simulator against the debug pod: the
    /// layout message (type 10) and its screenshot stop, while screen views keep flowing.
    /// The effective block is read back and only that one key changed, so the SDK's
    /// masking and per-screen rules are preserved.
    ///
    /// Not used on purpose: `DisableAutoInstrumentation` also drops automatic screen
    /// views, and neither `GetImageDataOnScreenLayout=false` nor
    /// `GlobalScreenSettings.ScreenShot=false` had any effect on the first captured
    /// screen. Must run after `enable()` — applied before it, the setting is lost.
    private func applyScreenCaptureConfig() {
        guard let screenCaptureEnabled else { return }
        guard !screenCaptureEnabled else { return }
        let helper = ConnectApplicationHelper.sharedInstance()
        var autoLayout = helper.value(forConfigurableItem: "AutoLayout") as? [String: Any] ?? [:]
        var globalSettings = autoLayout["GlobalScreenSettings"] as? [String: Any] ?? [:]
        globalSettings["CaptureLayoutOn"] = 0
        autoLayout["GlobalScreenSettings"] = globalSettings
        if !helper.setConfigurableItem("AutoLayout", value: autoLayout) {
            NSLog("[AcousticConnect] applyScreenCaptureConfig: setConfigurableItem(AutoLayout) was rejected — screen capture left at the SDK default")
        }
    }

    // MARK: - Helpers

    private func mapPushMode(_ raw: String) -> ConnectPushConfig.Mode {
        switch raw {
        case Constants.pushModeAutomatic: return .automatic
        case Constants.pushModeManual:    return .manual
        default:                          return .automatic
        }
    }

    private func mapMonitoringLevel(_ value: Int) -> kConnectMonitoringLevelType {
        switch value {
        case 0:  return .connectMonitoringLevelIgnore
        case 1:  return .connectMonitoringLevelCellularAndWiFi
        default: return .connectMonitoringLevelWiFi
        }
    }

    // Polls until the SDK is truly ready to log (kill-switch completed + session started).
    //
    // ConnectApplicationHelper._connectIsReadyForLogging() is a stronger check than
    // isEnabled: the SDK sets isEnabled=true immediately on enable() but only marks
    // itself ready after the async kill-switch check completes and startTealeafLibrary
    // has run (hasKillSwitchCompleted=YES). Using isEnabled alone causes identity.log()
    // to return false in the window between isEnabled=true and kill-switch completion.
    //
    // Task.detached keeps the 0.1 s sleep off the MainActor so the SDK's own
    // kill-switch completion handlers (which dispatch to main queue) are not
    // competing with this loop. The readiness check and callback hop back to
    // MainActor only for the instant they need it.
    //
    // commandDelegate and callbackId are captured by value so the JS Promise
    // is always resolved — even if the plugin object is deallocated mid-poll.
    private func waitForEnabled(_ command: CDVInvokedUrlCommand) {
        guard let delegate = commandDelegate else {
            // commandDelegate is nil only when the WebView is already torn down;
            // in that case the JS context no longer exists so no Promise to resolve.
            NSLog("[AcousticConnect] waitForEnabled: commandDelegate is nil — JS context already torn down")
            return
        }
        let callbackId: String = command.callbackId ?? ""
        guard !callbackId.isEmpty else { return }
        Task.detached {
            let deadline = Date().addingTimeInterval(5.0)
            while Date() < deadline {
                let ready = await MainActor.run {
                    ConnectApplicationHelper.sharedInstance()._connectIsReadyForLogging()
                }
                if ready {
                    await MainActor.run {
                        delegate.send(CDVPluginResult(status: .ok), callbackId: callbackId)
                    }
                    return
                }
                try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 s off MainActor
            }
            // _connectIsReadyForLogging() did not become true within 5 s.
            // XPC / network errors during the SDK's kill-switch check can leave
            // hasKillSwitchCompleted=NO indefinitely even though the SDK is otherwise
            // functional (e.g. coretelephony.xpc invalid after a fresh install on
            // simulator). Fall back to isEnabled so a transient kill-switch failure
            // doesn't permanently break the JS enable() promise.
            // Only hard-fail if the SDK itself never reached isEnabled=true.
            await MainActor.run {
                if ConnectSDK.shared.isEnabled {
                    NSLog("[AcousticConnect] waitForEnabled: _connectIsReadyForLogging() timed out but isEnabled=true — proceeding (kill-switch may be pending)")
                    delegate.send(CDVPluginResult(status: .ok), callbackId: callbackId)
                } else {
                    let payload: [String: Any] = [
                        "code": "ACOUSTIC_INTERNAL_ERROR",
                        "message": "enable: SDK did not become ready within 5 s"
                    ]
                    let result = CDVPluginResult(status: .error,
                                                 messageAs: payload as [AnyHashable: Any])
                    delegate.send(result, callbackId: callbackId)
                }
            }
        }
    }

    private func sendSuccess(_ command: CDVInvokedUrlCommand) {
        let result = CDVPluginResult(status: .ok)
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    private func sendBool(_ command: CDVInvokedUrlCommand, value: Bool) {
        let result = CDVPluginResult(status: .ok, messageAs: value)
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    private func sendError(_ command: CDVInvokedUrlCommand, code: String, message: String) {
        let payload: [String: Any] = ["code": code, "message": message]
        let result = CDVPluginResult(status: .error, messageAs: payload as [AnyHashable: Any])
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    /// Returns `true` when pushMode is `'manual'`; otherwise sends `ACOUSTIC_PUSH_MODE_NOT_MANUAL`
    /// and returns `false`.
    private func requireManualMode(_ command: CDVInvokedUrlCommand) -> Bool {
        guard pushMode == Constants.pushModeManual else {
            sendError(command,
                      code: Constants.codePushModeNotManual,
                      message: "method requires pushMode 'manual', current='\(pushMode)'")
            return false
        }
        return true
    }

    // MARK: - Constants

    private enum Constants {
        static let pushModeAutomatic = "automatic"
        static let pushModeManual    = "manual"
        static let validPushModes: Set<String> = [pushModeAutomatic, pushModeManual]

        static let logLevelDefault = "error"
        static let validLogLevels: Set<String> =
            ["silent", "error", "warn", "info", "verbose"]

        static let codeInvalidArgs       = "ACOUSTIC_INVALID_ARGS"
        static let codeInternalError     = "ACOUSTIC_INTERNAL_ERROR"
        static let codePushModeNotManual = "ACOUSTIC_PUSH_MODE_NOT_MANUAL"
    }
}

