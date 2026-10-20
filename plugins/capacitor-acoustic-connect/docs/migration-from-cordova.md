# Moving from the Cordova plugin

The call API is the same: the same method names, positional arguments, `push.*` group, error codes
(`ACOUSTIC_INVALID_ARGS`, `ACOUSTIC_INTERNAL_ERROR`, `ACOUSTIC_PUSH_MODE_NOT_MANUAL`) and `{ code, message }` errors.
What changes is how the plugin is installed and configured.

## Code

```ts
// Cordova: a global
AcousticConnect.logCustomEvent('purchase', { total: 24.99 });

// Capacitor: an import
import { AcousticConnect } from 'capacitor-acoustic-connect';
await AcousticConnect.logCustomEvent('purchase', { total: 24.99 });
```

There is no `deviceready`: Capacitor plugins are ready when the page runs.

## Configuration

`ConnectConfig.json` and the Cordova hooks that turned it into native files are gone. The settings move into the
plugin block of `capacitor.config.ts` (see [configuration.md](configuration.md)), which `npx cap sync` copies into the
native projects.

| `ConnectConfig.json` (`Connect`) | `plugins.AcousticConnect` |
| --- | --- |
| `AppKey`, `PostMessageUrl` | `appKey`, `postMessageUrl` |
| `KillSwitchEnabled`, `KillSwitchUrl` | `killSwitchEnabled`, `killSwitchUrl` |
| `useRelease` | `useRelease` |
| `LocationLoggingEnabled`, `ScreenCaptureEnabled` | `locationLoggingEnabled`, `screenCaptureEnabled` |
| `layoutConfig`, `layoutConfigIos`, `layoutConfigAndroid` | the same names |
| `AndroidNotificationIconResName` | `androidNotificationIconResName` |
| `iOSPushMode`, `iOSAppGroupIdentifier` | `iosPushMode`, `iosAppGroupIdentifier` |
| `iOSDevelopmentTeam` | `iosDevelopmentTeam` (read by `setup-ios-push`) |
| `AndroidVersion` | `androidVersion` (the Gradle property `connectSdkVersion` wins over it) |
| `iOSVersion` | `iosVersion` (CocoaPods apps; a Swift Package Manager app uses the plugin's pin) |
| (none) | `pushEnabled`, `autoEnable` |

## What behaves differently

- **Push is opt-in.** `pushEnabled` defaults to `false`; without it Android builds with the analytics-only Connect
  artifact and needs no Firebase. Set it to `true` to get push, and add your `google-services.json`.
- **`enable()` does not wait for push.** It resolves once the SDK is running; a failure to start push is logged and
  does not fail the call.
- **The SDK starts when the app launches** if the config has `appKey` and `postMessageUrl`; `enable()` from the page is
  then optional and resolves without repeating the start.
- **iOS** links the SDK through Swift Package Manager (with one build phase, see the README) or through CocoaPods
  (iOS 15.1).
- **Android layout capture is off before Connect Android 11.1.10** unless `screenCaptureEnabled` says otherwise, and
  the Android SDK version is checked against `[11.0.21, 12.0.0)`.
- **A browser is not an error.** In `ionic serve` the calls that only record something do nothing, and the ones that
  need the SDK reject with `UNAVAILABLE`.

## Not carried over

- The Cordova hooks and the generated files (`connect-config.js`, `AcousticConnectNativeConfig.json`).
- The hook that added the iOS Notification Service and Content extensions to the Xcode project: Capacitor has no hooks, so run
  `npx acoustic-connect setup-ios-push` once (see "Rich push on iOS" in the README). It covers Swift Package Manager and CocoaPods apps;
  with CocoaPods, run `pod install` after it.
- The Cordova WebView engine setting: Capacitor has its own WebView, and the plugin keeps the SDK's page injection off.
