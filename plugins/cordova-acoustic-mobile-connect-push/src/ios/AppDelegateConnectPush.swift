import UIKit
import Connect

// MARK: – APNs token forwarding
//
// ConnectSDK in `.automatic` mode installs ConnectDelegateProxy (isa-swizzle) to
// intercept these callbacks. Adding them explicitly here mirrors the RN bare-workflow
// pattern and guarantees delivery even if the swizzle installs after iOS fires the
// callback. ConnectPush.didRegisterWithToken is idempotent — duplicate calls with
// the same token are safe.
//
// `open override func` is required — CDVAppDelegate adopts UIApplicationDelegate via
// ObjC protocol, so Swift treats these as overridable slots even when CDVAppDelegate
// does not provide a body.
extension AppDelegate {
    open override func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            try? ConnectSDK.shared.push.didRegisterWithToken(deviceToken)
        }
    }

    open override func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            try? ConnectSDK.shared.push.didFailToRegisterWithError(error)
        }
    }
}
