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

// The Connect SDK is linked by the app (CocoaPods `AcousticConnect` / `AcousticConnectDebug`), so the
// plugin only compiles this adapter when the module is there.
#if canImport(Connect)
import Connect

/// The SDK itself.
@MainActor
final class ConnectSdkImpl: ConnectSdk {
    var isEnabled: Bool { ConnectSDK.shared.isEnabled }
    var frameworkVersion: String { ConnectSDK.shared.frameworkVersion }

    func isReadyForLogging() -> Bool {
        ConnectApplicationHelper.sharedInstance()._connectIsReadyForLogging()
    }

    func enable(appKey: String, postURL: String, pushMode: PushMode, appGroupIdentifier: String?) {
        let push: ConnectPushConfig
        switch pushMode {
        case .off:
            push = .off
        case .manual:
            push = ConnectPushConfig(mode: .manual, appGroupIdentifier: appGroupIdentifier)
        case .automatic:
            push = ConnectPushConfig(mode: .automatic, appGroupIdentifier: appGroupIdentifier)
        }
        ConnectSDK.shared.enable(appKey: appKey, postURL: postURL, push: push)
    }

    func disable() { ConnectSDK.shared.disable() }
    func flush() { ConnectSDK.shared.flush() }
    func setCurrentScreen(_ name: String) -> Bool { ConnectSDK.shared.setCurrentScreen(pageName: name) }

    func logIdentity(name: String, value: String, signalType: String, additionalParameters: [String: String]) -> Bool {
        ConnectSDK.shared.identity.log(
            identifierName: name,
            identifierValue: value,
            signalType: signalType,
            additionalParameters: additionalParameters
        )
    }

    func logCustomEvent(_ name: String, values: [String: Any], level: MonitoringLevel) -> Bool {
        ConnectCustomEvent().logEvent(name, values: values, level: Self.map(level))
    }

    func logSignal(_ values: [String: Any], level: MonitoringLevel) -> Bool {
        ConnectCustomEvent().logSignal(values, level: Self.map(level))
    }

    func logException(name: String, reason: String, stackInfo: String, unhandled: Bool) -> Bool {
        // The SDK reads the message from the NSException; the stack travels as additional data.
        let exception = NSException(name: NSExceptionName(name), reason: reason, userInfo: nil)
        return ConnectCustomEvent().logNSExceptionEvent(exception, dataDictionary: ["stacktrace": stackInfo], isUnhandled: unhandled)
    }

    func logScreenView(pageName: String, className: String, kind: ScreenViewKind, referrer: String?) -> Bool {
        ConnectCustomEvent().logScreenViewContext(
            pageName,
            withClass: className,
            applicationContext: kind == .load ? ConnectScreenViewType.load : ConnectScreenViewType.unload,
            referrer: referrer
        )
    }

    func setConfigItem(key: String, value: Any) -> Bool {
        ConnectApplicationHelper.sharedInstance().setConfigurableItem(key, value: value)
    }

    func configItem(key: String) -> Any? {
        ConnectApplicationHelper.sharedInstance().value(forConfigurableItem: key)
    }

    func setKillSwitch(enabled: Bool, url: String?) {
        ConnectSDK.shared.setConfigurableItem("KillSwitchEnabled", value: enabled)
        if enabled, let url, !url.isEmpty { ConnectSDK.shared.setKillSwitchURL(url) }
    }

    func requestPushAuthorization() async throws -> (granted: Bool, error: String?) {
        let auth = try await ConnectSDK.shared.push.requestAuthorization()
        return (auth.granted, auth.error?.localizedDescription)
    }

    func currentPushAuthorization() async throws -> Bool? {
        try await ConnectSDK.shared.push.getCurrentAuthorization()
    }

    func didReceivePushAuthorization(granted: Bool, error: String?) throws {
        let nsError = error.map { NSError(domain: "ConnectCapacitorBridge", code: -1, userInfo: [NSLocalizedDescriptionKey: $0]) }
        try ConnectSDK.shared.push.didReceiveAuthorization(granted: granted, error: nsError)
    }

    func didReceivePushNotification(userInfo: [String: Any]) throws {
        try ConnectSDK.shared.push.didReceiveNotification(ForwardedNotification(userInfo: Self.hashable(userInfo)))
    }

    func didReceivePushResponse(actionIdentifier: String, userInfo: [String: Any]) throws {
        try ConnectSDK.shared.push.didReceive(ForwardedResponse(actionIdentifier: actionIdentifier, userInfo: Self.hashable(userInfo)))
    }

    func didRegisterPushToken(_ token: Data) throws {
        try ConnectSDK.shared.push.didRegisterWithToken(token)
    }

    func didFailPushRegistration(error: String?) throws {
        let reason = error ?? "registration for remote notifications failed"
        try ConnectSDK.shared.push.didFailToRegisterWithError(
            NSError(domain: "ConnectCapacitorBridge", code: -1, userInfo: [NSLocalizedDescriptionKey: reason]))
    }

    private static func hashable(_ userInfo: [String: Any]) -> [AnyHashable: Any] {
        Dictionary(uniqueKeysWithValues: userInfo.map { (AnyHashable($0.key), $0.value) })
    }

    private static func map(_ level: MonitoringLevel) -> kConnectMonitoringLevelType {
        switch level {
        case .ignore: return .connectMonitoringLevelIgnore
        case .cellularAndWiFi: return .connectMonitoringLevelCellularAndWiFi
        case .wifi: return .connectMonitoringLevelWiFi
        }
    }
}

/// What the app handed over, in the shape the SDK takes (`UNNotification` and `UNNotificationResponse` cannot be built by hand).
private struct ForwardedNotification: ConnectNotification {
    let userInfo: [AnyHashable: Any]
}

private struct ForwardedResponse: ConnectNotificationResponse {
    let actionIdentifier: String
    let userInfo: [AnyHashable: Any]
}
#endif
