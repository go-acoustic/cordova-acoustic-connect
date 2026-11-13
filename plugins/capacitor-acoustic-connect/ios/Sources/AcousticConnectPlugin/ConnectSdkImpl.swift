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
import UIKit

// The Connect SDK is linked by the app (CocoaPods `AcousticConnect` / `AcousticConnectDebug`), so the
// plugin only compiles this adapter when the module is there.
#if canImport(Connect)
import Connect
// The functions that log taps and gestures on page elements, for Acoustic's plugins only, in SDK 2.2.35 and later. The podspec
// and Package.swift define CONNECT_WEB_CAPTURE only when the SDK they link is at least that version.
#if CONNECT_WEB_CAPTURE
@_spi(ConnectPlugins) import Connect
#endif

/// The SDK itself.
@MainActor
final class ConnectSdkImpl: ConnectSdk {
    /// The view controller whose screen a layout capture describes: the web view's (the Capacitor bridge's).
    private let viewController: @MainActor () -> UIViewController?

    init(viewController: @escaping @MainActor () -> UIViewController? = { nil }) {
        self.viewController = viewController
    }

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

    func logScreenLayout(name: String, delayMs: Int?) -> Bool {
        guard let controller = viewController() else { return false }
        // The delay crosses the bridge in milliseconds; the SDK's `andDelay:` takes seconds. Without a delay the SDK captures
        // synchronously, which is fine: plugin calls run on the main actor.
        if let delayMs, delayMs > 0 {
            return ConnectCustomEvent().logScreenLayout(with: controller, andDelay: Double(delayMs) / 1000.0, andName: name)
        }
        return ConnectCustomEvent().logScreenLayout(with: controller, andName: name)
    }

    func logLocation() -> Bool {
        ConnectCustomEvent().logLocation(nil)
    }

    func logLocationUpdate(latitude: Double, longitude: Double, level: MonitoringLevel) -> Bool {
        ConnectCustomEvent().logLocationUpdate(withLatitude: latitude, longitude: longitude, level: Self.map(level))
    }

    #if CONNECT_WEB_CAPTURE
    func logWebEvent(in webView: UIView, event: [String: Any]) -> Bool {
        guard let target = (event["target"] as? [String: Any]).flatMap(Self.webTarget),
              let touches = Self.webTouches(event["touches"]) else {
            return false
        }
        let kind = event["kind"] as? String ?? ""
        let viewportWidth = Self.webNumber(event["viewportWidth"]) ?? 0
        let touchedAt = Self.webNumber(event["touchedAt"]).map { Date(timeIntervalSince1970: $0 / 1_000) } ?? Date()
        if kind == "click" {
            return ConnectSDK.shared.logWebClick(in: webView, viewportWidth: viewportWidth, target: target,
                                                 at: touches[0][0], touchedAt: touchedAt)
        }
        return ConnectSDK.shared.logWebGesture(in: webView, viewportWidth: viewportWidth, tlEvent: kind, target: target,
                                               touches: touches, direction: event["direction"] as? String,
                                               velocity: Self.webPoint(event["velocity"]), touchedAt: touchedAt)
    }

    private static func webTarget(_ json: [String: Any]) -> ConnectWebTarget? {
        guard let bounds = json["bounds"] as? [String: Any] else { return nil }
        let box = CGRect(x: webNumber(bounds["x"]) ?? .nan, y: webNumber(bounds["y"]) ?? .nan,
                         width: webNumber(bounds["width"]) ?? .nan, height: webNumber(bounds["height"]) ?? .nan)
        return ConnectWebTarget(id: json["id"] as? String ?? "", isDomId: json["isDomId"] as? Bool ?? false,
                                type: json["type"] as? String ?? "", tlType: json["tlType"] as? String ?? "",
                                bounds: box)
    }

    /// Each finger's points, or nil when there is no point at all.
    private static func webTouches(_ json: Any?) -> [[CGPoint]]? {
        guard let fingers = json as? [Any] else { return nil }
        let touches = fingers.map { ($0 as? [Any] ?? []).compactMap(webPoint) }
        return touches.isEmpty || touches.contains(where: \.isEmpty) ? nil : touches
    }

    private static func webPoint(_ json: Any?) -> CGPoint? {
        guard let point = json as? [String: Any] else { return nil }
        return CGPoint(x: webNumber(point["x"]) ?? .nan, y: webNumber(point["y"]) ?? .nan)
    }

    private static func webNumber(_ json: Any?) -> Double? {
        (json as? NSNumber)?.doubleValue
    }
    #else
    func logWebEvent(in webView: UIView, event: [String: Any]) -> Bool {
        false
    }
    #endif

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
