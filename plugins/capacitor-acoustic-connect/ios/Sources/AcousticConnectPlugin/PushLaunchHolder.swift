/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any intellectual or
 * industrial property rights of Acoustic, L.P. except as may be provided in an agreement with
 * Acoustic, L.P. Any unauthorized copying or distribution of content from this file is
 * prohibited.
 */

import Capacitor
import Foundation
import UserNotifications

/// What `AcousticConnect.beginEnable` needs from whatever keeps the notification tap that launched the app: a seam, so the
/// bridge logic is tested with a fake and the real holder (which needs a running app) is checked on a device.
@MainActor
protocol PushLaunchHold: AnyObject {
    /// Releases the notification center just before the SDK is enabled. `sdkInstallsDelegate` is true when the SDK is about
    /// to install its own delegate (push on, automatic mode); false hands the center back to what held it before. Returns what
    /// to run once the SDK is up: replaying the held tap. nil when there is nothing to replay.
    func handOver(sdkInstallsDelegate: Bool) -> (@MainActor () -> Void)?
}

/// Keeps the notification tap that launched the app until the Connect SDK is enabled.
///
/// In automatic push mode the SDK answers notification taps from a `UNUserNotificationCenterDelegate` that it installs inside
/// `ConnectSDK.shared.enable(...)`. When the app was killed and the user taps a notification, iOS delivers that tap to whatever
/// delegate is there right after launch. If the SDK is not enabled yet (`autoEnable` is off, or the keys are not in the config
/// and `enable()` is called from JavaScript once the page has loaded), the tap goes to Capacitor's own router, which has no
/// handler of ours: the tap is dropped and its action (open URL, open dialer) never runs.
///
/// `enable()` stays the consent point, so the SDK is not enabled at launch. Instead this object stands in front of Capacitor's
/// notification router from the moment the plugin loads, which is before iOS delivers the launch tap:
///
///   1. `installIfWanted` puts it in front of the router (or into an empty slot). It passes everything on to the router, so
///      `@capacitor/push-notifications` and the local-notification plugin see the same calls as without it.
///   2. A tap that arrives meanwhile is also kept (only the most recent one; a dismissal is not a tap).
///   3. `enable()` calls `handOver`, which empties the slot (the SDK asserts that it is empty) and returns a closure that replays
///      the held tap into the delegate the SDK has just installed.
///
/// A held tap older than `maxHoldSeconds` is dropped rather than replayed. The hold is for the launch, not for an app that waits
/// on something else (a consent dialog, a login) before it calls `enable`: replaying a minutes-old tap from there would open a link
/// the user no longer expects.
///
/// The center calls the delegate methods from its own queue, so the state is behind a lock instead of the main actor.
final class PushLaunchHolder: NSObject, UNUserNotificationCenterDelegate, PushLaunchHold, @unchecked Sendable {
    @MainActor static let shared = PushLaunchHolder()

    /// How long a held tap stays valid. `enable()` runs a second or so after launch, once the page has loaded, so 30 s covers a slow
    /// cold start with room to spare while staying short enough that a tap is never replayed out of context.
    static let maxHoldSeconds: TimeInterval = 30

    private let lock = NSLock()
    /// What was the notification center's delegate before this object. Weak, like the center's own reference: Capacitor's bridge
    /// owns its router.
    private weak var previousDelegate: UNUserNotificationCenterDelegate?
    private var heldResponse: UNNotificationResponse?
    private var heldAt: Date?

    private var previous: UNUserNotificationCenterDelegate? {
        get { locked { previousDelegate } }
        set { locked { previousDelegate = newValue } }
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    /// Holding only helps when the SDK will install its delegate itself: push on, automatic mode. In manual mode the app forwards
    /// the taps (`pushDidReceiveResponse`) and with push off nothing handles them.
    static func wantsHold(pushEnabled: Bool, mode: PushMode?) -> Bool {
        pushEnabled && (mode ?? .automatic) == .automatic
    }

    /// Installs the holder when the config asks for push in automatic mode and the slot is Capacitor's router or empty; nil when it
    /// is not installed. Another delegate (the app's own, or another plugin's) is left alone: it owns the taps, and this object does
    /// not know the rest of its interface.
    @MainActor
    static func installIfWanted(config: NativeConfig) -> PushLaunchHolder? {
        guard wantsHold(pushEnabled: config.pushEnabled, mode: config.pushMode) else { return nil }
        return shared.install() ? shared : nil
    }

    @MainActor
    private func install() -> Bool {
        let center = UNUserNotificationCenter.current()
        let current = center.delegate
        if current === self { return true }
        guard current == nil || current is NotificationRouter else { return false }
        previous = current
        center.delegate = self
        return true
    }

    // MARK: PushLaunchHold

    @MainActor
    func handOver(sdkInstallsDelegate: Bool) -> (@MainActor () -> Void)? {
        let center = UNUserNotificationCenter.current()
        let held = takeHeldTap()
        // Not ours any more (the app replaced it) or never installed: nothing to release or replay.
        guard center.delegate === self else { return nil }
        // The SDK asserts the slot is empty when it installs its own delegate; without it the router comes back.
        center.delegate = sdkInstallsDelegate ? nil : previous
        guard sdkInstallsDelegate, let held else { return nil }
        return { Self.replay(held) }
    }

    /// The held tap, if it is still recent; either way nothing is held afterwards.
    private func takeHeldTap() -> UNNotificationResponse? {
        locked {
            defer {
                heldResponse = nil
                heldAt = nil
            }
            guard let response = heldResponse, let heldAt, Date().timeIntervalSince(heldAt) <= Self.maxHoldSeconds else { return nil }
            return response
        }
    }

    private func hold(_ response: UNNotificationResponse) {
        locked {
            heldResponse = response
            heldAt = Date()
        }
    }

    /// Runs the tap through the delegate the SDK installed in `enable`, exactly as if iOS had delivered it there. The SDK's
    /// `push.didReceive(_:)` is no option in automatic mode (it refuses), and the delegate is the one place where the built-in
    /// OPEN_URL / OPEN_DIALER action and the `pushAction` event both happen.
    @MainActor
    private static func replay(_ response: UNNotificationResponse) {
        let center = UNUserNotificationCenter.current()
        guard let delegate = center.delegate else {
            NSLog("[AcousticConnect] enable: the SDK installed no notification delegate, so the notification tap that launched the app is dropped")
            return
        }
        delegate.userNotificationCenter?(center, didReceive: response, withCompletionHandler: {})
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void) {
        // Passed on as it is. With no router in the slot nothing was presenting before either, so nothing is shown.
        if previous?.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler) == nil {
            completionHandler([])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping @Sendable () -> Void) {
        // A dismissal is not an action, the SDK ignores it too, so it must not displace a real tap.
        if response.actionIdentifier != UNNotificationDismissActionIdentifier { hold(response) }
        if previous?.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler) == nil {
            completionHandler()
        }
    }
}
