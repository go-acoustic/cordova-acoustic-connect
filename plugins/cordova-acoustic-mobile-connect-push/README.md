# cordova-acoustic-connect

Cordova plugin for [Acoustic Connect](https://acoustic.com/connect/) (CDP + engagement). Wraps the native iOS and Android Connect SDKs and exposes a single Promise-based JavaScript API, `AcousticConnect`, to your Cordova app.

## Requirements

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| Cordova CLI | `npm install -g cordova` |
| iOS deployment target | 15.1+ |
| Xcode | 15+ |
| CocoaPods | `sudo gem install cocoapods` |
| Android `minSdk` | 26 |
| Android Studio + SDK | 34+ |

## Installation

```sh
npx cordova plugin add cordova-acoustic-connect
```

## Configuration

Create `ConnectConfig.json` at your Cordova project root (gitignored — never commit real credentials):

```json
{
  "Connect": {
    "AppKey": "<your-app-key>",
    "PostMessageUrl": "<your-collector-url>",
    "useRelease": false,
    "iOSAppGroupIdentifier": "group.<your-bundle-id>",
    "iOSDevelopmentTeam": "<your-apple-team-id>",
    "AndroidVersion": "<optional-connect-android-sdk-version-override>",
    "iOSVersion": "<optional-connect-ios-sdk-version-override>",
    "iOSPushMode": "automatic",
    "AndroidNotificationIconResName": "<optional-drawable-name>",
    "KillSwitchEnabled": false,
    "KillSwitchUrl": "<optional-kill-switch-url>"
  }
}
```

| Field | Description |
|---|---|
| `AppKey` | Required. Connect application key. |
| `PostMessageUrl` | Required. Connect collector endpoint. |
| `iOSAppGroupIdentifier` | Shared App Group ID between the app and its iOS NSE/NCE extensions. |
| `iOSDevelopmentTeam` | Apple Team ID. Sets the Xcode signing team automatically, skipping the manual Signing & Capabilities step below. |
| `AndroidVersion` | Pins a specific Connect Android SDK version (`x.y.z`) instead of the plugin's default (currently `11.0.13`). Invalid values are ignored with a build warning. |
| `iOSVersion` | Pins a specific Connect iOS SDK pod version (`x.y.z`) instead of the plugin's default (`2.1.15` release / `2.1.13` debug). Values below `2.1.13` — the floor that fixes a podspec/duplicate-xcframework bug — and non-version strings are ignored with a build warning. |
| `iOSPushMode` | `'automatic'` (default) or `'manual'`. iOS only — Android is always `'automatic'` at the bridge boundary. |
| `AndroidNotificationIconResName` | Drawable resource name for the push notification icon on Android. Fallback chain: your name → the plugin's bundled `ic_notification` (correct default — launcher icons crash at delivery) → `ic_launcher` (legacy) → the SDK's own default. |
| `KillSwitchEnabled` | `false` (default) or `true`. Controls the native SDK's remote kill switch on both platforms — see below. The SDK's own bundled default is `true`; this plugin defaults it `false` so apps must opt in explicitly. |
| `KillSwitchUrl` | Remote kill-switch check URL. Only takes effect when `KillSwitchEnabled: true`. |

### Kill switch

Both native SDKs ship with the kill switch on by default (`KillSwitchEnabled=true`); this plugin forces it off unless you opt in via `KillSwitchEnabled: true` + `KillSwitchUrl`.

- **iOS**: `ConnectPlugin.swift`'s `enable()` calls `applyKillSwitchConfig()` before *and* after `ConnectSDK.shared.enable(...)` — the SDK may reload its bundled plist defaults (`KillSwitchEnabled=true`) internally during that call, so the configured value is re-applied both times to make it stick either way.
- **Android**: `ConnectBasicConfig.properties` sets `KillSwitchEnabled` at asset-load time, but that isn't the last word — the native SDK's 2-arg `Tealeaf.enable(appKey, postMessageUrl)` (which `handleEnable()` calls) has an internal handler that unconditionally sets `KillSwitchEnabled=true` and computes its own URL, once, ~100ms after being called. `ConnectPlugin.kt` re-applies the configured value via `Connect.updateConfig(...)` 300ms after `Connect.enable(...)`, comfortably past that window, so either value (on or off) actually sticks. The 0-arg bundled auto-init path (`tryBundledConfigInit`) doesn't hit this internal handler at all, so the properties-file value already applies correctly there without a re-apply.

Verified on-device: with `KillSwitchEnabled: true` and a real `KillSwitchUrl`, the Android SDK logs `KillSwitchEnabled:true` and `Killswitch has enabled Tealeaf with following session id:...` — the real async kill-switch check runs and completes.

The plugin's `before_prepare` hook reads this file on every `cordova prepare` / `cordova build`. `Connect.useRelease` is the single source of truth for which native SDK variant is used, and for whether native SDK logging is verbose:

- `true` → `AcousticConnect` (release) pod on iOS, the release Connect artifact on Android. On Android, `ConnectPlugin.kt` also calls `Connect.updateConfig("DisplayLogging", "false", EOCore.getInstance())` right after `Connect.init()` — native (Tealeaf/EOCore/Connect) logcat output is suppressed regardless of the app's Gradle build type.
- `false` (default) → `AcousticConnectDebug` pod on iOS, verbose native logcat output on Android (the SDK's own default, left untouched). Android always uses the same `connect-push-fcm` Maven artifact regardless of `useRelease` — there is no separate debug Maven artifact, so this flag does not affect which Android binary is pulled, only its logging config.

The flag reaches Android via `www/AcousticConnectNativeConfig.json` (generated alongside the iOS native config, bundled into `assets/www/` by Cordova) — deliberately not via an app-level `EOCoreBasicConfig.properties` asset override, since Android's asset merge replaces the *entire* file on a name collision and the SDK's bundled default carries several other required keys (e.g. `PostMessageTimeInterval`) that a partial override would silently drop, crashing at `enable()` time.

Android reads the flag fresh on every build; iOS bakes the CocoaPods pod name into `plugin.xml` when the plugin is installed, so after changing `useRelease` you must remove and re-add the plugin for it to take effect.

Note: `useRelease` only controls the native SDK's own logcat output. The plugin bridge's own log level (`ConnectPlugin.kt`) is set separately via `AcousticConnect.setLogLevel()` from JavaScript.

## Quick start

```js
document.addEventListener('deviceready', async function () {
  await AcousticConnect.enable(
    'your-app-key',
    'https://your-collector-url',
    'automatic'
  );

  await AcousticConnect.logIdentity('email', 'user@example.com', 'loggedIn');
}, false);
```

`AcousticConnect` is available both as a CommonJS/ES module export and as a global on `window` (installed via the plugin's `<clobbers>` entry), so it's reachable from a plain `<script>`-based Cordova app or from `import`/`require`.

## API reference

### `AcousticConnect.enable(appKey, postURL, pushMode?, options?)`

Initialise and enable the Connect SDK. Must be called from the `deviceready` handler before any other plugin method.

- `appKey: string`
- `postURL: string`
- `pushMode?: 'automatic' | 'manual'` — defaults to `'automatic'`
- `options?: { iosAppGroupIdentifier?: string, androidIconResName?: string }`
- Returns `Promise<void>`, rejecting with `{ code, message }` on invalid arguments or if the native SDK fails to start.

### `AcousticConnect.disable()`

Stop all data capture and push activity. Returns `Promise<void>`.

### `AcousticConnect.setLogLevel(level)`

`level: 'silent' | 'error' | 'warn' | 'info' | 'verbose'`. Affects bridge logging only. Returns `Promise<void>`.

### `AcousticConnect.logIdentity(identifierName, identifierValue, signalType?, additionalParameters?)`

Log an identity signal to the Connect SDK.

- `identifierName: string` — e.g. `'email'`, `'userId'`
- `identifierValue: string` — e.g. `'user@example.com'`
- `signalType?: string` — defaults to `'loggedIn'`
- `additionalParameters?: Record<string, string>`
- Returns `Promise<void>`

Common calls:

```js
// Login
AcousticConnect.logIdentity('email', 'user@example.com', 'loggedIn', { loginMethod: 'email' });

// Registration
AcousticConnect.logIdentity('email', 'user@example.com', 'accountRegistered', { registrationMethod: 'email' });
```

### `AcousticConnect.push`

Push-related methods, namespaced under `push`:

| Method | Returns | Notes |
|---|---|---|
| `push.requestPermission()` | `Promise<{ granted: boolean, error?: string }>` | Presents the OS-level push permission dialog. |
| `push.getPermissionState()` | `Promise<boolean \| null>` | Reads current permission state without prompting. |
| `push.didReceiveAuthorization(granted, error?)` | `Promise<boolean>` | Forward an externally-obtained permission result to the SDK. |
| `push.didReceiveNotification(userInfo)` | `Promise<boolean>` | Manual mode only — forward a notification receipt from your own native delegate. |
| `push.didReceiveResponse(actionIdentifier, userInfo)` | `Promise<boolean>` | Manual mode only — forward a notification tap response from your own native delegate. |

In `automatic` push mode (the default), the SDK owns the native push delegate and the `didReceiveNotification`/`didReceiveResponse` forwarders are not needed. They exist for `manual` mode, where the app owns its own native delegate.

## iOS push setup (Xcode)

After building, open the generated `.xcworkspace` in Xcode:

1. Select the project → **Signing & Capabilities** → set a Team.
2. Add the **Push Notifications** capability.

The Background Modes → Remote notifications entitlement is added automatically by the plugin (`plugin.xml` config-file) and doesn't need a manual toggle.

## Android push setup

Drop a real `google-services.json` into your Cordova project root (gitignored). The plugin's `after_prepare` hook copies it into the generated Android project on each `cordova prepare`.

## Troubleshooting

Common build/push issues and fixes: [TROUBLESHOOTING.md](https://github.com/go-acoustic/cordova-acoustic-connect/blob/main/TROUBLESHOOTING.md).

## License

Licensed under the Acoustic License for Non-Warranted Programs. See [LICENSE](LICENSE) for full terms.
