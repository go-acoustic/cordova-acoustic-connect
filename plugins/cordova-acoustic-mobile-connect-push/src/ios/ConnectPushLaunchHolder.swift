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
import UserNotifications

/// Holds the notification tap that launched the app until the Connect SDK is enabled.
///
/// In automatic push mode the SDK answers notification taps from a
/// `UNUserNotificationCenterDelegate` it installs inside `ConnectSDK.shared.enable(...)`. A
/// Cordova app calls `enable` from JavaScript, after `deviceready`, which is well after the app
/// finished launching. When the app was killed and the user taps a notification, iOS delivers
/// that tap to the delegate right at launch; with no delegate yet, the tap is dropped and the
/// `OPEN_URL` / `OPEN_DIALER` action never runs.
///
/// `enable` stays the consent point, so the SDK is not enabled at launch. Instead this class
/// stands in as the notification-center delegate from launch until `enable` runs:
///
///   1. `ConnectPushLaunchHook.m` calls `installIfNeeded()` when the app finishes launching.
///   2. A tap that arrives meanwhile is kept (only the most recent one).
///   3. `ConnectPlugin.enable` calls `handOver(replay:)`, which releases the delegate slot
///      (the SDK asserts it is empty) and returns the held tap, and replays it into the
///      delegate the SDK has just installed.
///
/// A held tap older than `maxHoldSeconds` is dropped rather than replayed. The hold is for the
/// launch, not for an app that waits on something else (a consent dialog, a login) before it calls
/// `enable`: replaying a minutes-old tap from that point would open a link the user no longer
/// expects.
///
/// The center calls the delegate methods from its own queue, so the held tap is behind a lock
/// instead of the main actor. Installing and handing over touch the notification center and run on
/// the main actor.
@objc(ACConnectPushLaunchHolder)
public final class ConnectPushLaunchHolder: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {

    @MainActor static let shared = ConnectPushLaunchHolder()

    /// How long a held tap stays valid. `enable` is normally called from the page's `deviceready`
    /// handler, a second or two after launch (the SDK started about 1.1 s after the process on the
    /// demo app, on an iOS 26.4 simulator), so 30 s covers a slow cold start with room to spare
    /// while staying short enough that a tap is never replayed out of context.
    static let maxHoldSeconds: TimeInterval = 30

    private let lock = NSLock()
    private var heldResponse: UNNotificationResponse?
    private var heldAt: Date?

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    // MARK: - Install / hand over

    /// Called from `ConnectPushLaunchHook.m` as the app finishes launching.
    ///
    /// Installs the holder only when the bundled config asks for push in automatic mode (the mode
    /// that needs the SDK's delegate) and nobody else owns the notification center yet.
    @MainActor
    @objc public static func installIfNeeded() {
        shared.install()
    }

    @MainActor
    private func install() {
        guard Self.launchConfigWantsAutomaticPush() else { return }
        let center = UNUserNotificationCenter.current()
        // The app or another plugin already set a delegate: leave it alone.
        guard center.delegate == nil else { return }
        center.delegate = self
    }

    /// Releases the notification center to the SDK and returns the tap to replay, if any.
    ///
    /// Call right before `ConnectSDK.shared.enable(...)`. Always uninstalls the holder, because the
    /// SDK asserts the delegate slot is empty when it installs its own. Returns the held tap only
    /// when `replay` is true (push on, automatic mode) and the tap is still within
    /// `maxHoldSeconds`; otherwise the tap is discarded.
    @MainActor
    func handOver(replay: Bool) -> UNNotificationResponse? {
        let center = UNUserNotificationCenter.current()
        if center.delegate === self {
            center.delegate = nil
        }
        let held = takeHeldTap()
        return replay ? held : nil
    }

    /// The held tap, if it is still within `maxHoldSeconds`; either way nothing is held afterwards.
    private func takeHeldTap() -> UNNotificationResponse? {
        locked {
            defer {
                heldResponse = nil
                heldAt = nil
            }
            guard let response = heldResponse, let heldAt,
                  Date().timeIntervalSince(heldAt) <= Self.maxHoldSeconds
            else { return nil }
            return response
        }
    }

    private func hold(_ response: UNNotificationResponse) {
        locked {
            heldResponse = response
            heldAt = Date()
        }
    }

    /// True when the bundled native config leaves push on in automatic mode. Both keys default to
    /// those values, the same defaults `ConnectPlugin` applies when the config is silent.
    private static func launchConfigWantsAutomaticPush() -> Bool {
        guard let url = Bundle.main.url(forResource: "AcousticConnectNativeConfig",
                                         withExtension: "json",
                                         subdirectory: "www"),
              let data = try? Data(contentsOf: url),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            NSLog("[AcousticConnect] AcousticConnectNativeConfig.json missing or unreadable at launch — holding the notification tap as if push were on in automatic mode")
            return true
        }
        let pushEnabled = config["pushEnabled"] as? Bool ?? true
        let pushMode = config["iosPushMode"] as? String ?? "automatic"
        return pushEnabled && pushMode == "automatic"
    }

    // MARK: - UNUserNotificationCenterDelegate

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // The holder only goes into an empty slot, and with no delegate iOS shows nothing while the
        // app is in the foreground. Keep it that way until `enable` hands the center to the SDK.
        completionHandler([])
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // A dismissal is not an action; the SDK ignores it too, so it must not displace a real tap.
        if response.actionIdentifier != UNNotificationDismissActionIdentifier {
            hold(response)
        }
        completionHandler()
    }
}
