# Configuration

Set the plugin in `capacitor.config.ts`; `npx cap sync` copies the block into the native projects and
the plugin reads it when it loads. No other file is generated.

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.app',
  appName: 'Example',
  webDir: 'dist',
  plugins: {
    AcousticConnect: {
      appKey: 'YOUR_APP_KEY',
      postMessageUrl: 'https://collector.example.com/collector/collectorPost',
      useRelease: false,
    },
  },
};

export default config;
```

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `appKey`, `postMessageUrl` | string | none | With both set the SDK starts when the plugin loads, so the first screen is captured. `enable()` from JavaScript then resolves without starting it again. |
| `autoEnable` | boolean | `true` | `false` starts the SDK only from `enable()`, even with both keys set. |
| `useRelease` | boolean | `false` | `true` is for production builds: the native SDK's own logging is off, and on Android the build takes Connect from Maven Central only and rejects every `-beta` version. The plugin's pinned SDK is a beta, so set a release version first (`-PconnectSdkVersion=x.y.z`); otherwise the build stops with a message saying so. Needs a `cap sync` and a rebuild. `-PacousticUseRelease=true\|false` overrides it. |
| `androidVersion` | string | none | Pins another Connect Android SDK than the plugin's default (`11.1.10-beta`), as `x.y.z` or `x.y.z-beta`: the Cordova plugin's `AndroidVersion`. The Gradle property `connectSdkVersion` wins over it. It has to be in the supported range (11.0.21 up to, not including, 12) and not a beta under `useRelease`; a wrong value stops the build. Read when Android builds. |
| `iosVersion` | string | none | Pins another Connect iOS SDK, as `x.y.z`, not below the plugin's own pin (`2.1.15`): the Cordova plugin's `iOSVersion`. It is read when `pod install` runs, so it applies to an app that uses CocoaPods; with Swift Package Manager the plugin's `Package.swift` fixes the version and the setting has no effect (`npx acoustic-connect doctor` says so). A wrong value stops `pod install`. |
| `killSwitchEnabled`, `killSwitchUrl` | boolean, string | `false` | The SDK's remote kill switch. Off unless you opt in; the SDKs ship with it on. The URL applies only when it is on. |
| `locationLoggingEnabled` | boolean or `null` | `null` | `null` keeps the SDK default; a value turns location data on or off. |
| `screenCaptureEnabled` | boolean or `null` | `null` | `false` turns automatic layout and screenshot capture off (screen views keep flowing). |
| `pushEnabled` | boolean | `false` | Push is opt-in. Off, the Android build uses the analytics-only Connect artifact and pulls in no Firebase, and iOS runs the SDK without push. On, Android builds with the FCM push artifact (the app needs its `google-services.json`) and iOS uses `iosPushMode`. Android reads it at build time: after changing it run `npx cap sync` and rebuild. `-PacousticPushEnabled=true\|false` overrides it. |
| `androidNotificationIconResName` | string | `ic_notification` | Drawable name of the push small icon, used when push is on. The plugin ships a default `ic_notification`; a drawable of that name in your app replaces it. A launcher icon is never used: it crashes at delivery. A call to `enable()` overrides the name only when that call starts the SDK (see below). |
| `iosPushMode`, `iosAppGroupIdentifier` | `'automatic' \| 'manual'`, string | `automatic`, none | iOS push mode and the App Group of the notification extensions, used when push is on. A call to `enable()` overrides them only when that call starts the SDK (see below). |
| `iosDevelopmentTeam` | string | none | The Team ID of your Apple developer account (ten capital letters and digits). Only `npx acoustic-connect setup-ios-push` reads it, to set the team on the app and the extensions, like the Cordova plugin's `iOSDevelopmentTeam`; `--team` wins over it. |
| `layoutConfig`, `layoutConfigIos`, `layoutConfigAndroid` | object | none | Screen-capture rules (`AutoLayout`, `AppendMapIds`). `layoutConfig` is shared; `layoutConfigIos` and `layoutConfigAndroid` are merged over it (objects merge key by key, arrays and values replace). iOS merges the result over the SDK's own rules at start-up. On Android the build writes it to the `ConnectLayoutConfig.json` asset, which replaces the SDK's file as a whole: give a complete block, with `AutoLayout.GlobalScreenSettings`. Needs a `cap sync` and a rebuild. Does nothing while layout capture is off (see below). |

A key of the wrong type is ignored with a log warning; the app still starts.

**`enable()` after the config started the SDK.** With both keys in the config the SDK starts when the plugin loads, and a
later `enable()` only waits until it is ready: the key, URL, `pushMode`, App Group and icon of that call are ignored and the config
stays in effect (the plugin logs which ones differed). To choose them from JavaScript, set `autoEnable: false`.

On Android, a layout rule file the app keeps at `android/app/src/main/assets/ConnectLayoutConfig.json` takes
priority over the generated one, and the build warns about it. With push on and no `android/app/google-services.json`
the build warns too.

With push on, a failure to start it (no `google-services.json`, no Firebase) is logged and never fails
`enable()`: the SDK keeps capturing. If `pushEnabled` is true but the build lacks the push artifact, the
log says so; run `npx cap sync` and rebuild.

## Not covered yet

- Choosing the iOS SDK version in a Swift Package Manager app: the plugin pins it (`Connect-SP` 2.1.15 in `Package.swift`). `iosVersion` works for CocoaPods apps.
- iOS push extensions for an app that uses CocoaPods: `npx acoustic-connect setup-ios-push` covers Swift Package Manager apps (README, "Rich push on iOS"); with CocoaPods it stops and the extensions are added by hand.
