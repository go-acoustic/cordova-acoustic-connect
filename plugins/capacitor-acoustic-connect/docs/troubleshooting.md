# Troubleshooting

Each entry is a symptom, why it happens, and what to do. Most of them come from how the Connect SDK behaves inside
a Capacitor WebView; the plugin already works around the ones marked *handled*.

## Android

**Nothing reaches the collector; the log has `PostTask Could not send message`.** *Handled.* Capacitor installs
its own cookie handler as the process default, and it refuses to hand out its cookie store, which the SDK's HTTP
client asks for. The plugin puts a handler in front of it before the SDK starts. If your app replaces the default
`CookieHandler` after that, the failure comes back: keep the plugin's.

**The page goes blank or ends on `chrome-error://`; the console says `tlBridge is not defined`.** *Handled.* The
SDK's own page injection replaces Capacitor's WebView client. The plugin turns it off (`GoogleWebViewEnabled=false`).

**Only the first screen reaches the collector; later events are queued but never sent.** *Handled.* On Connect
Android before 11.1.10 the layout of a WebView screen never completes and holds back every message queued after it.
The plugin turns layout capture off on those versions unless the app sets `screenCaptureEnabled`. Do not set it to
`true` on an SDK older than 11.1.10.

**`Killswitch has disabled Tealeaf` and nothing is captured.** *Handled.* Setting the kill switch off after
`Connect.enable(appKey, url)` makes the SDK disable itself. The plugin sets it before enabling, through the
no-argument `enable()`.

**`Could not find io.github.go-acoustic:connect`.** The Connect betas are in a Maven tree that Capacitor's template
does not list. Add it to `allprojects.repositories` in the app's `android/build.gradle` (see the README).

**`uses-sdk:minSdkVersion 24 cannot be smaller than version 26`.** Set `minSdkVersion = 26` in
`android/variables.gradle`.

**`connectSdkVersion '…' is outside the supported Connect Android range`.** The build accepts `[11.0.21, 12.0.0)` and
a real version number, not `+` or `latest`. Set `-PconnectSdkVersion=x.y.z`, or leave it out.

**`useRelease is true but the Connect Android SDK version '…' is a beta`.** `useRelease` rejects every `-beta`
version; the plugin's default is a release, so this comes from a beta you pinned. Pin a release version, leave
`androidVersion` out, or set `useRelease` to `false`.

**Push does not start; the log says `pushEnabled is true but the push transport … is not in the app`.** The Android
build reads `pushEnabled` when it builds. Run `npx cap sync` and rebuild. The build also warns when
`android/app/google-services.json` is missing.

**The registration says `acceptPush: false` on Android.** The notification permission (Android 13 and later) has not been granted: the plugin asks
once after the SDK has started. Ask with `AcousticConnect.push.requestPermission()`, or grant it in the app's settings; `getPermissionState()`
tells which it is.

**On iOS the registration goes out with an empty token and no notification arrives.** The app has no `aps-environment` entitlement (the
Push Notifications capability) or no `remote-notification` background mode, or the app's identifier lacks the capability in the developer account.
`npx acoustic-connect setup-ios-push` adds the first two; see [push notifications](push.md). A second registration with a token follows once
the system has handed it over; one that stays empty means the system did not.

**The `layoutConfigAndroid` rules have no effect.** The build warns when the app has its own
`android/app/src/main/assets/ConnectLayoutConfig.json`: Android gives it priority. Keep one or the other. Also check
the layout is captured at all (see the SDK version note above).

## iOS

**With Swift Package Manager only part of the data arrives: screen views and custom events, but no client state,
signals, exceptions or layout.** The SDK reads its default settings from `ConnectResources.bundle` in the root of the
app, and the Swift package ships it only inside `Connect.framework`. Add the Run Script build phase from the README
(iOS section), which copies it to the app root. CocoaPods apps do not need it.

**Every call rejects with `The Acoustic Connect iOS SDK is not linked`.** The plugin was built without the SDK: the
app's Swift package graph or its Pods do not include it. Reinstall (`npx cap sync`, then resolve packages or
`pod install`).

**`pod install` says the specs "required a higher minimum deployment target".** The CocoaPods route needs iOS 15.1;
Capacitor's template targets 15.0. Raise `platform :ios` in the Podfile and the project's deployment target to `15.1`.

## Both platforms

**The first screen's screen view or layout is missing.** Start the SDK from `capacitor.config` (`appKey` and
`postMessageUrl`) instead of calling `enable()` from JavaScript: `enable()` from the page runs after the first
screen has already appeared.

**`enable()` with different values does nothing.** Once the config has started the SDK, `enable()` waits until the SDK is ready
and returns: the key, URL, `pushMode`, App Group and icon of the call are ignored, and the plugin logs which ones differed. Set
`autoEnable: false` to start only from JavaScript.

**`getSdkVersion`, `getConfigItem` or a `push.*` call rejects with `UNAVAILABLE`.** You are in a
browser. The web stub only records the calls that need no SDK; these need it.
