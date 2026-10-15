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

enum PushMode: String {
    case automatic
    case manual
    /// Push is not set up. Not a mode a call can ask for: it is what `pushEnabled: false` means.
    case off
}

enum MonitoringLevel: Equatable {
    case ignore
    case cellularAndWiFi
    case wifi
}

enum ScreenViewKind {
    case load
    case unload
}

/// What the bridge needs from the Connect iOS SDK. The bridge logic talks to this, so it can be
/// tested without the SDK; `ConnectSdkImpl` is the only implementation that touches it. The SDK
/// is main-actor isolated, so everything here is too.
@MainActor
protocol ConnectSdk: AnyObject {
    var isEnabled: Bool { get }
    var frameworkVersion: String { get }

    /// Stronger than `isEnabled`: true once the kill-switch check has completed and the session started.
    func isReadyForLogging() -> Bool
    func enable(appKey: String, postURL: String, pushMode: PushMode, appGroupIdentifier: String?)
    func disable()
    func flush()
    func setCurrentScreen(_ name: String) -> Bool
    func logIdentity(name: String, value: String, signalType: String, additionalParameters: [String: String]) -> Bool
    func logCustomEvent(_ name: String, values: [String: Any], level: MonitoringLevel) -> Bool
    func logSignal(_ values: [String: Any], level: MonitoringLevel) -> Bool
    func logException(name: String, reason: String, stackInfo: String, unhandled: Bool) -> Bool
    func logScreenView(pageName: String, className: String, kind: ScreenViewKind, referrer: String?) -> Bool

    /// Captures the layout of the screen on display; `delayMs` nil or 0 captures now. `false` when there is no screen to capture.
    func logScreenLayout(name: String, delayMs: Int?) -> Bool
    func setConfigItem(key: String, value: Any) -> Bool
    func configItem(key: String) -> Any?
    func setKillSwitch(enabled: Bool, url: String?)
    func requestPushAuthorization() async throws -> (granted: Bool, error: String?)

    /// `true` granted, `false` denied, `nil` not determined.
    func currentPushAuthorization() async throws -> Bool?
    func didReceivePushAuthorization(granted: Bool, error: String?) throws

    /// Manual mode: the app hands over a notification that arrived, and what the user did with one. Throws when
    /// push is not enabled or not in manual mode.
    func didReceivePushNotification(userInfo: [String: Any]) throws
    func didReceivePushResponse(actionIdentifier: String, userInfo: [String: Any]) throws

    /// Manual mode: the app hands over the APNs device token it got from the system, or the error of the registration.
    /// Both throw when push is not enabled, like the forwarders above.
    func didRegisterPushToken(_ token: Data) throws
    func didFailPushRegistration(error: String?) throws
}
