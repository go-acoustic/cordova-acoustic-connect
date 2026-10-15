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

/// The bridge logic of the Capacitor plugin: one method per plugin method, each taking the options
/// object of the call and answering through a `Reply`. The TypeScript API (src/api.ts) validates first; the
/// checks here keep the native side safe on its own and use the same error codes.
@MainActor
final class AcousticConnect {
    private let sdk: ConnectSdk
    private let config: NativeConfig
    private let readyTimeout: TimeInterval
    private let pollInterval: TimeInterval
    private let log: (String) -> Void
    private(set) var pushMode: PushMode = .automatic
    /// What the SDK was started with, to say what a later `enable()` could not change.
    private var started: (appKey: String, postURL: String, group: String?)?
    private(set) var logLevel = Constants.logLevelDefault

    init(sdk: ConnectSdk, config: NativeConfig = NativeConfig(), readyTimeout: TimeInterval = 5, pollInterval: TimeInterval = 0.1,
         log: @escaping (String) -> Void = { NSLog("[AcousticConnect] %@", $0) }) {
        self.sdk = sdk
        self.log = log
        self.config = config
        self.readyTimeout = readyTimeout
        self.pollInterval = pollInterval
    }

    // MARK: Core

    func enable(_ options: [String: Any], reply: Reply) async {
        if beginEnable(options, reply: reply) { await waitUntilReady(reply) }
    }

    /// Starts the SDK from the config when the plugin loads. Does nothing unless both keys are set
    /// and `autoEnable` is not off; a later `enable()` from JavaScript then resolves at once.
    func autoEnable(reply: Reply) async {
        if beginAutoEnable(reply: reply) { await waitUntilReady(reply) }
    }

    /// The synchronous part of `autoEnable`. The plugin calls it while the view controller loads, so the
    /// SDK is up before the first screen appears and can capture it; the wait for readiness follows.
    /// True when the SDK was started and the caller should call `waitUntilReady`.
    func beginAutoEnable(reply: Reply) -> Bool {
        guard config.autoEnable, let appKey = config.appKey, let postURL = config.postMessageUrl else { return false }
        return beginEnable(["appKey": appKey, "postURL": postURL], reply: reply)
    }

    /// Validates, applies the config and starts the SDK, all without suspending. True when the caller
    /// should now wait for readiness; false when it rejected, or the SDK was already enabled and the
    /// call is resolved.
    private func beginEnable(_ options: [String: Any], reply: Reply) -> Bool {
        let appKey = text(options, "appKey")
        let postURL = text(options, "postURL")
        if appKey.isEmpty { reply.reject(code: Constants.codeInvalidArgs, message: "enable: appKey is empty"); return false }
        if postURL.isEmpty { reply.reject(code: Constants.codeInvalidArgs, message: "enable: postURL is empty"); return false }
        let rawMode = text(options, "pushMode")
        let defaultMode = config.pushMode ?? .automatic
        let requested = rawMode.isEmpty ? defaultMode : PushMode(rawValue: rawMode)
        guard let requestedMode = requested, requestedMode != .off else {
            reply.reject(code: Constants.codeInvalidArgs, message: "enable: pushMode must be 'automatic' or 'manual'")
            return false
        }
        // Push is opt-in: while it is off the mode a call or the config names has no effect.
        let mode: PushMode = config.pushEnabled ? requestedMode : .off
        let group = text(options, "iosAppGroupIdentifier")
        let appGroup = group.isEmpty ? config.appGroupIdentifier : group
        // A second enable (the config already started the SDK) must not set it up again. It still waits for the SDK to be
        // ready: `isEnabled` turns true at once, and an answer before the session starts lets the next call be refused.
        if sdk.isEnabled {
            noteWhatEnableCannotChange(appKey: appKey, postURL: postURL, mode: mode, group: appGroup)
            if sdk.isReadyForLogging() { reply.resolve(); return false }
            return true
        }
        pushMode = mode
        started = (appKey, postURL, appGroup)
        applyConfigBeforeEnable()
        sdk.enable(appKey: appKey, postURL: postURL, pushMode: mode, appGroupIdentifier: appGroup)
        applyConfigAfterEnable()
        return true
    }

    /// Once the SDK runs, a call to `enable()` changes nothing. Say so when it asked for something else, so a developer who
    /// expected the call to win is told where the setting comes from.
    private func noteWhatEnableCannotChange(appKey: String, postURL: String, mode: PushMode, group: String?) {
        guard let started else { return }
        var ignored: [String] = []
        if appKey != started.appKey { ignored.append("appKey") }
        if postURL != started.postURL { ignored.append("postURL") }
        if mode != pushMode { ignored.append("pushMode") }
        if group != started.group { ignored.append("iosAppGroupIdentifier") }
        guard !ignored.isEmpty else { return }
        log("enable: the SDK is already running, so \(ignored.joined(separator: ", ")) from this call is ignored and the " +
            "plugin config stays in effect; set autoEnable to false to start the SDK from JavaScript with your own values")
    }

    /// Settings the SDK reads inside `enable`, so they have to be in first. The kill switch is set
    /// either way: the SDK's bundled default is on.
    private func applyConfigBeforeEnable() {
        sdk.setKillSwitch(enabled: config.killSwitchEnabled, url: config.killSwitchUrl)
        if let location = config.locationLoggingEnabled { setting("LogLocationEnabled", location) }
    }

    /// Screen-capture settings only count when applied after `enable`: before it, the SDK reloads its
    /// bundled layout defaults and the setting is lost.
    private func applyConfigAfterEnable() {
        // Each section the app supplied is merged over the one the SDK has in effect, so a partial block
        // cannot drop the SDK's other rules (a replacing partial block was seen to stop screen views).
        for key in NativeConfig.layoutKeys {
            guard let override = config.layout?[key] as? [String: Any] else { continue }
            let effective = sdk.configItem(key: key) as? [String: Any] ?? [:]
            setting(key, NativeConfig.deepMerging(effective, override))
        }
        // Only an explicit false acts: it switches layout capture off while screen views keep flowing.
        if config.screenCaptureEnabled == false {
            var autoLayout = sdk.configItem(key: "AutoLayout") as? [String: Any] ?? [:]
            var global = autoLayout["GlobalScreenSettings"] as? [String: Any] ?? [:]
            global["CaptureLayoutOn"] = 0
            autoLayout["GlobalScreenSettings"] = global
            setting("AutoLayout", autoLayout)
        }
    }

    /// A setting the SDK refuses leaves its default in place; it never fails the call.
    private func setting(_ key: String, _ value: Any) {
        if !sdk.setConfigItem(key: key, value: value) {
            log("\(key) was not applied: the SDK rejected it")
        }
    }

    /// Polls until the SDK is ready to log, not just enabled: `isEnabled` turns true at once, but the
    /// kill-switch check and the session start finish later, and an identity logged in between is dropped.
    /// If readiness does not come in time (a network error can leave the kill-switch check pending
    /// for good), an enabled SDK is good enough; only an SDK that never enabled is an error.
    func waitUntilReady(_ reply: Reply) async {
        let deadline = Date().addingTimeInterval(readyTimeout)
        while Date() < deadline {
            if sdk.isReadyForLogging() { return reply.resolve() }
            try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
        }
        if sdk.isEnabled {
            log("enable: not ready within \(readyTimeout) s but enabled — the kill-switch check may be pending")
            reply.resolve()
        } else {
            reply.reject(code: Constants.codeInternalError, message: "enable: SDK did not become ready within \(Int(readyTimeout)) s")
        }
    }

    func disable(reply: Reply) {
        sdk.disable()
        reply.resolve()
    }

    func setLogLevel(_ options: [String: Any], reply: Reply) {
        let level = text(options, "level")
        guard Constants.validLogLevels.contains(level) else {
            return reply.reject(code: Constants.codeInvalidArgs,
                                message: "setLogLevel: level must be one of \(Constants.validLogLevels.sorted())")
        }
        logLevel = level
        reply.resolve()
    }

    func isSdkEnabled(reply: Reply) { reply.resolve(["value": sdk.isEnabled]) }

    func getSdkVersion(reply: Reply) { reply.resolve(["value": sdk.frameworkVersion]) }

    func flushQueues(reply: Reply) {
        sdk.flush()
        reply.resolve()
    }

    func setCurrentScreenName(_ options: [String: Any], reply: Reply) {
        let name = text(options, "name")
        if name.isEmpty { return reply.reject(code: Constants.codeInvalidArgs, message: "setCurrentScreenName: name is required") }
        finish(sdk.setCurrentScreen(name), "setCurrentScreenName", reply)
    }

    // MARK: Identity and events

    func logIdentity(_ options: [String: Any], reply: Reply) {
        let name = text(options, "identifierName")
        let value = text(options, "identifierValue")
        if name.isEmpty || value.isEmpty {
            return reply.reject(code: Constants.codeInvalidArgs, message: "logIdentity: identifierName and identifierValue are required")
        }
        guard sdk.isReadyForLogging() else {
            return reply.reject(code: Constants.codeInternalError, message: "logIdentity: SDK is not ready — call enable() first")
        }
        let signalType = text(options, "signalType")
        let parameters = (options["additionalParameters"] as? [String: Any] ?? [:]).mapValues(identityText)
        if sdk.logIdentity(name: name, value: value, signalType: signalType.isEmpty ? "loggedIn" : signalType, additionalParameters: parameters) {
            // Post now, so the server sees the identity without waiting for the next batch.
            sdk.flush()
            reply.resolve()
        } else {
            reply.reject(code: Constants.codeInternalError, message: "logIdentity returned false — SDK may not be enabled")
        }
    }

    func logCustomEvent(_ options: [String: Any], reply: Reply) {
        let name = text(options, "eventName")
        if name.isEmpty { return reply.reject(code: Constants.codeInvalidArgs, message: "logCustomEvent: eventName is required") }
        let values = options["values"] as? [String: Any] ?? [:]
        finish(sdk.logCustomEvent(name, values: values, level: level(options)), "logCustomEvent", reply)
    }

    func logSignal(_ options: [String: Any], reply: Reply) {
        guard let values = options["values"] as? [String: Any] else {
            return reply.reject(code: Constants.codeInvalidArgs, message: "logSignal: values must be a JSON object")
        }
        finish(sdk.logSignal(values, level: level(options)), "logSignal", reply)
    }

    func logExceptionEvent(_ options: [String: Any], reply: Reply) {
        let message = text(options, "message")
        if message.isEmpty { return reply.reject(code: Constants.codeInvalidArgs, message: "logExceptionEvent: message is required") }
        let stackInfo = options["stackInfo"] as? String ?? ""
        let unhandled = options["unhandled"] as? Bool ?? false
        finish(sdk.logException(name: "Capacitor Plugin", reason: message, stackInfo: stackInfo, unhandled: unhandled), "logExceptionEvent", reply)
    }

    func logScreenViewContextLoad(_ options: [String: Any], reply: Reply) {
        screenViewContext(options, reply, .load, "logScreenViewContextLoad")
    }

    func logScreenViewContextUnload(_ options: [String: Any], reply: Reply) {
        screenViewContext(options, reply, .unload, "logScreenViewContextUnload")
    }

    private func screenViewContext(_ options: [String: Any], _ reply: Reply, _ kind: ScreenViewKind, _ label: String) {
        let page = text(options, "logicalPageName")
        if page.isEmpty { return reply.reject(code: Constants.codeInvalidArgs, message: "\(label): logicalPageName is required") }
        let referrer = text(options, "referrer")
        finish(sdk.logScreenView(pageName: page, className: "Capacitor_\(page)", kind: kind, referrer: referrer.isEmpty ? nil : referrer), label, reply)
    }

    /// Captures the layout of the screen on display, as the Cordova plugin's `logScreenLayout` does.
    func logScreenLayout(_ options: [String: Any], reply: Reply) {
        let name = text(options, "name")
        if name.isEmpty { return reply.reject(code: Constants.codeInvalidArgs, message: "logScreenLayout: name is required") }
        var delayMs: Int?
        if let raw = options["delayMs"], !(raw is NSNull) {
            guard let number = raw as? NSNumber, number.doubleValue >= 0, number.doubleValue == number.doubleValue.rounded() else {
                return reply.reject(code: Constants.codeInvalidArgs, message: "logScreenLayout: delayMs must be a non-negative integer")
            }
            delayMs = number.intValue
        }
        finish(sdk.logScreenLayout(name: name, delayMs: delayMs), "logScreenLayout", reply)
    }

    // MARK: Config items

    /// iOS has a single config store, so `moduleName` is only validated.
    func setConfigItem(_ options: [String: Any], reply: Reply) {
        let key = text(options, "key")
        let module = text(options, "moduleName")
        guard !key.isEmpty, !module.isEmpty, let value = configValue(options["value"]) else {
            return reply.reject(code: Constants.codeInvalidArgs,
                                message: "setConfigItem: key and moduleName must be non-empty strings and value a boolean, string or number")
        }
        finish(sdk.setConfigItem(key: key, value: value), "setConfigItem", reply)
    }

    /// Resolves the item as text, or no value when it is not set; the TypeScript layer types it.
    func getConfigItem(_ options: [String: Any], reply: Reply) {
        let key = text(options, "key")
        let module = text(options, "moduleName")
        if key.isEmpty || module.isEmpty {
            return reply.reject(code: Constants.codeInvalidArgs, message: "getConfigItem: key and moduleName must be non-empty strings")
        }
        if let value = configText(sdk.configItem(key: key)) {
            reply.resolve(["value": value])
        } else {
            reply.resolve([:])
        }
    }

    /// A JSON boolean reaches Swift as an NSNumber; tell it from a number by its Core Foundation type.
    private func configValue(_ argument: Any?) -> Any? {
        if let number = argument as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
            return number.doubleValue.isFinite ? number.doubleValue : nil
        }
        return argument as? String
    }

    /// The text of an identity parameter, the same as Android's `optString`: `true`, `null`, `2`, `1.5`, and the JSON text of
    /// a nested value (not Swift's description of it).
    private func identityText(_ value: Any) -> String {
        if let text = value as? String { return text }
        if value is NSNull { return "null" }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
            return configText(number) ?? "\(number)"
        }
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           let json = String(data: data, encoding: .utf8) {
            return json
        }
        return "\(value)"
    }

    private func configText(_ raw: Any?) -> String? {
        if let number = raw as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
            let d = number.doubleValue
            return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : String(d)
        }
        return raw as? String
    }

    // MARK: Push

    /// Never rejects: a refusal or a failure is part of the result.
    func pushRequestPermission(reply: Reply) async {
        do {
            let auth = try await sdk.requestPushAuthorization()
            var payload: [String: Any] = ["granted": auth.granted]
            if let error = auth.error { payload["error"] = error }
            reply.resolve(payload)
        } catch {
            reply.resolve(["granted": false, "error": error.localizedDescription])
        }
    }

    /// `true` granted, `false` denied, `null` not determined. Never rejects.
    func pushGetPermissionState(reply: Reply) async {
        let state = try? await sdk.currentPushAuthorization()
        reply.resolve(["value": state.map { $0 as Any } ?? NSNull()])
    }

    func pushDidReceiveAuthorization(_ options: [String: Any], reply: Reply) async {
        // An undetermined answer has no SDK equivalent: skip the call.
        guard let granted = options["granted"] as? Bool else { return reply.resolve(["value": false]) }
        do {
            try sdk.didReceivePushAuthorization(granted: granted, error: options["error"] as? String)
            reply.resolve(["value": true])
        } catch {
            reply.resolve(["value": false])
        }
    }

    func pushDidReceiveNotification(_ options: [String: Any], reply: Reply) {
        guard requireManualMode(reply) else { return }
        guard let userInfo = options["userInfo"] as? [String: Any] else {
            return reply.reject(code: Constants.codeInvalidArgs, message: "pushDidReceiveNotification: userInfo must be an object")
        }
        forward(reply) { try self.sdk.didReceivePushNotification(userInfo: userInfo) }
    }

    func pushDidReceiveResponse(_ options: [String: Any], reply: Reply) {
        guard requireManualMode(reply) else { return }
        let actionIdentifier = text(options, "actionIdentifier")
        if actionIdentifier.isEmpty {
            return reply.reject(code: Constants.codeInvalidArgs, message: "pushDidReceiveResponse: actionIdentifier is required")
        }
        guard let userInfo = options["userInfo"] as? [String: Any] else {
            return reply.reject(code: Constants.codeInvalidArgs, message: "pushDidReceiveResponse: userInfo must be an object")
        }
        forward(reply) { try self.sdk.didReceivePushResponse(actionIdentifier: actionIdentifier, userInfo: userInfo) }
    }

    func pushDidRegisterWithToken(_ options: [String: Any], reply: Reply) {
        guard requireManualMode(reply) else { return }
        guard let token = Self.bytes(ofHex: options["token"] as? String) else {
            return reply.reject(code: Constants.codeInvalidArgs,
                                message: "pushDidRegisterWithToken: token must be the device token as an even number of hex digits")
        }
        forward(reply) { try self.sdk.didRegisterPushToken(token) }
    }

    func pushDidFailToRegister(_ options: [String: Any], reply: Reply) {
        guard requireManualMode(reply) else { return }
        let error = options["error"]
        guard error == nil || error is NSNull || error is String else {
            return reply.reject(code: Constants.codeInvalidArgs, message: "pushDidFailToRegister: error must be a string or null")
        }
        let text = error as? String
        forward(reply) { try self.sdk.didFailPushRegistration(error: text) }
    }

    /// The bytes of a token written as hex digits: pairs of them, so no half byte; nil for anything else.
    private static func bytes(ofHex text: String?) -> Data? {
        guard let text, !text.isEmpty, text.utf8.count % 2 == 0 else { return nil }
        var data = Data(capacity: text.utf8.count / 2)
        var index = text.startIndex
        while index < text.endIndex {
            let next = text.index(index, offsetBy: 2)
            guard let byte = UInt8(text[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        return data
    }

    /// `true` when the SDK took it, `false` when it refused (push not enabled, not in manual mode): the app is not failed for that.
    private func forward(_ reply: Reply, _ call: () throws -> Void) {
        do {
            try call()
            reply.resolve(["value": true])
        } catch {
            log("push: the SDK did not take the forwarded event: \(error.localizedDescription)")
            reply.resolve(["value": false])
        }
    }

    private func requireManualMode(_ reply: Reply) -> Bool {
        guard pushMode == .manual else {
            reply.reject(code: Constants.codePushModeNotManual,
                         message: "method requires pushMode 'manual', current='\(pushMode.rawValue)'")
            return false
        }
        return true
    }

    // MARK: Helpers

    private func finish(_ ok: Bool, _ label: String, _ reply: Reply) {
        if ok { reply.resolve() } else { reply.reject(code: Constants.codeInternalError, message: "\(label) returned false") }
    }

    /// A string option, trimmed; a missing key and a JSON null are both empty.
    private func text(_ options: [String: Any], _ key: String) -> String {
        (options[key] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func level(_ options: [String: Any]) -> MonitoringLevel {
        switch options["level"] as? Int ?? 3 {
        case 0: return .ignore
        case 1: return .cellularAndWiFi
        default: return .wifi
        }
    }

    private enum Constants {
        static let logLevelDefault = "error"
        static let validLogLevels: Set<String> = ["silent", "error", "warn", "info", "verbose"]
        static let codeInvalidArgs = "ACOUSTIC_INVALID_ARGS"
        static let codeInternalError = "ACOUSTIC_INTERNAL_ERROR"
        static let codePushModeNotManual = "ACOUSTIC_PUSH_MODE_NOT_MANUAL"
    }
}
