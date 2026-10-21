# Push notifications

Push is opt-in: with `pushEnabled` off (the default) the plugin builds without Firebase on Android and runs the SDK without push on iOS.
The SDK registers the device and shows the notifications itself; what the app has to provide is below.

## Android

1. In the plugin block of `capacitor.config`: `pushEnabled: true`. Then `npx cap sync` and rebuild: the build takes the FCM push artifact of
   the Connect SDK and Firebase Messaging (`firebaseBomVersion` sets the Firebase BOM). The setting is read when Gradle builds, so
   a change needs a rebuild.
2. Put the `google-services.json` of your Firebase project in `android/app/`. It has to contain a client for the app's package, the
   `applicationId` in `android/app/build.gradle`; without it Firebase stays uninitialised and push does not start (the build warns, and the log
   has a line).
3. The small icon of a notification must be white on transparent; a launcher icon crashes when the notification is shown, so it is never used.
   The plugin ships a default `ic_notification`. A drawable of that name in your app replaces it, and
   `androidNotificationIconResName` (or the `androidIconResName` option of `enable()`) names another.
4. Android 13 and later ask for the `POST_NOTIFICATIONS` permission. The plugin asks once after the SDK has started; the app can ask itself with
   `AcousticConnect.push.requestPermission()` and read the answer with `AcousticConnect.push.getPermissionState()` (`true`, `false`, or
   `null` when not asked yet). Until it is granted the registration says `acceptPush: false`.

Android has only the automatic mode, so `pushMode: 'manual'` is refused, and `push.didReceiveNotification`, `didReceiveResponse`,
`didRegisterWithToken` and `didFailToRegister` reject with `ACOUSTIC_PUSH_MODE_NOT_MANUAL`.

## iOS

The app needs the Push Notifications capability: the `aps-environment` entitlement, and the `remote-notification` background mode in
`Info.plist`. In the Apple developer account the app's identifier needs the capability too, and the push key has to be known to Acoustic.
`npx acoustic-connect setup-ios-push` adds the entitlement and the background mode together with the rich-push extensions (below); in Xcode
the same is the capability in the target's Signing & Capabilities.

`iosPushMode` (or the `pushMode` argument of `enable()`) chooses who handles the system's push callbacks:

- `automatic` (default): the SDK does. It puts its own object in the place of the notification center's delegate, which takes the place of
  Capacitor's own notification router, and registers for remote notifications; the app forwards nothing. While the SDK handles push this
  way, Capacitor's push and local-notification events (the `pushNotificationActionPerformed` of `@capacitor/push-notifications`) do not
  reach the app; use `manual` to keep them.
- `manual`: the app hands over what it gets, with `AcousticConnect.push.didRegisterWithToken(token)` (the APNs token as hex digits),
  `didFailToRegister(message)`, `didReceiveNotification(userInfo)` and `didReceiveResponse(actionIdentifier, userInfo)`. They reject with
  `ACOUSTIC_PUSH_MODE_NOT_MANUAL` in any other mode.

### A tap that launches the app

When the app was not running and the user taps a notification, iOS hands the tap to the notification center's delegate as the app launches.
With `autoEnable` on and both keys in the plugin config, the SDK is started while the plugin loads, in time to take it. When the SDK is started
later, by `enable()` from the page (`autoEnable: false`, or no keys in the config), the plugin keeps the tap from launch and replays it into the
SDK once `enable()` has run, if that is within 30 seconds of the tap: the notification's action (open URL, open dialer) then runs and the
`pushAction` event is sent, as for any other tap. A tap older than that is dropped, and nothing is kept in `manual` mode or with push off. Until
`enable()` runs, Capacitor's own notification handling still gets every notification call, as it does without the plugin.

In `manual` mode the tap reaches only Capacitor's own handling, which passes it to `@capacitor/push-notifications` if the app uses that plugin;
the app passes it on with `AcousticConnect.push.didReceiveResponse`.

Rich push (images, expanded notifications) needs the two extensions that `npx acoustic-connect setup-ios-push` adds: see "Rich push on iOS" in the
README.

On the iOS simulator a registration has a device token once the app has the `aps-environment` entitlement; without it the registration
goes out with an empty token. The simulator does not show rich media.

## What has not been checked

- A notification arriving and being tapped, with a real push on a real device (the SDK handles both; on the wire they are the message types 23 and 25 next to the
  registration, type 22). The registration is checked by the wire run on the emulator and the simulator.
- The tap that launches the app, with a real push on a real device. It is checked on the iOS simulator, with a push sent by `xcrun simctl push`
  and tapped on the banner, not through APNs.
- Rich push on a device. (The extensions of an app that uses CocoaPods are added by `setup-ios-push` as well; that route is built, not run on a device.)
- `didRegisterWithToken` and the other manual-mode calls against a real push, and with the token of `@capacitor/push-notifications`.
