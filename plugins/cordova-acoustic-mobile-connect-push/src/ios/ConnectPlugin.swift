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
        // Disable kill switch before enabling so the bundled plist's KillSwitchEnabled=true
        ConnectSDK.shared.setConfigurableItem("KillSwitchEnabled", value: false)
        ConnectSDK.shared.enable(appKey: appKey, postURL: postURL, push: pushConfig)
        // Re-apply after enable() in case the SDK re-loaded bundle defaults internally.
        ConnectSDK.shared.setConfigurableItem("KillSwitchEnabled", value: false)
        waitForEnabled(command)
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

