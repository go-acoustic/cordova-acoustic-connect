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
| `LocationLoggingEnabled` | Optional. Omit the field (or set `null`) to leave the native SDK's own default untouched — unlike `KillSwitchEnabled`, this plugin does **not** force a default either way. Set `true`/`false` to explicitly opt in/out of the SDK's location data collection. Only stops location data reaching the collector — does **not** remove `CoreLocation` linkage from the compiled iOS SDK, so on its own it does not resolve Apple's `ITMS-90683` App Store warning (missing `NSLocationWhenInUseUsageDescription`); that still needs either the Info.plist key declared or an SDK-side build without CoreLocation linked. |
| `ScreenCaptureEnabled` | Optional boolean. Omit it (or set `null`) or set `true` to leave the SDK default (layout and screenshot captured on every screen). `false` turns layout and screenshot capture off on both platforms while screen views keep flowing — see [Screen capture and privacy](#screen-capture-and-privacy). |
| `layoutConfig`, `layoutConfigIos`, `layoutConfigAndroid` | Optional objects with the SDK's screen-capture rules (`AutoLayout`, `AppendMapIds`). `layoutConfig` is the shared baseline; the platform block is deep-merged over it (objects merge, arrays are replaced). See [Screen capture and privacy](#screen-capture-and-privacy). |

### Kill switch

Both native SDKs ship with the kill switch on by default (`KillSwitchEnabled=true`); this plugin forces it off unless you opt in via `KillSwitchEnabled: true` + `KillSwitchUrl`.

- **iOS**: `ConnectPlugin.swift`'s `enable()` calls `applyKillSwitchConfig()` before *and* after `ConnectSDK.shared.enable(...)` — the SDK may reload its bundled plist defaults (`KillSwitchEnabled=true`) internally during that call, so the configured value is re-applied both times to make it stick either way.
- **Android**: `ConnectBasicConfig.properties` sets `KillSwitchEnabled` at asset-load time, but that isn't the last word — the native SDK's 2-arg `Tealeaf.enable(appKey, postMessageUrl)` (which `handleEnable()` calls) has an internal handler that unconditionally sets `KillSwitchEnabled=true` and computes its own URL, once, ~100ms after being called. `ConnectPlugin.kt` re-applies the configured value via `Connect.updateConfig(...)` 300ms after `Connect.enable(...)`, comfortably past that window, so either value (on or off) actually sticks. The 0-arg bundled auto-init path (`tryBundledConfigInit`) doesn't hit this internal handler at all, so the properties-file value already applies correctly there without a re-apply.

Verified on-device: with `KillSwitchEnabled: true` and a real `KillSwitchUrl`, the Android SDK logs `KillSwitchEnabled:true` and `Killswitch has enabled Tealeaf with following session id:...` — the real async kill-switch check runs and completes.

The plugin's `before_prepare` hook reads this file on every `cordova prepare` / `cordova build`. `Connect.useRelease` is the single source of truth for which native SDK variant is used, and for whether native SDK logging is verbose:

- `true` → `AcousticConnect` (release) pod on iOS, the release Connect artifact on Android. On Android, `ConnectPlugin.kt` also calls `Connect.updateConfig("DisplayLogging", "false", EOCore.getInstance())` right after `Connect.init()` — native (Tealeaf/EOCore/Connect) logcat output is suppressed regardless of the app's Gradle build type.
- `false` (default) → `AcousticConnectDebug` pod on iOS, verbose native logcat output on Android (the SDK's own default, left untouched). Android always uses the same `connect-push-fcm` Maven artifact regardless of `useRelease` — there is no separate debug Maven artifact. The flag does decide where Android resolves Connect from: with `false` the GitHub-hosted Maven tree (`go-acoustic/Android_Maven`, where Connect betas are published; they do not reach Maven Central) is declared after Google and Maven Central, limited to the `io.github.go-acoustic` group; with `true` only Maven Central is used and every beta is rejected.

The flag reaches Android via `www/AcousticConnectNativeConfig.json` (generated alongside the iOS native config, bundled into `assets/www/` by Cordova) — deliberately not via an app-level `EOCoreBasicConfig.properties` asset override, since Android's asset merge replaces the *entire* file on a name collision and the SDK's bundled default carries several other required keys (e.g. `PostMessageTimeInterval`) that a partial override would silently drop, crashing at `enable()` time.

Android reads the flag fresh on every build; iOS bakes the CocoaPods pod name into `plugin.xml` when the plugin is installed, so after changing `useRelease` you must remove and re-add the plugin for it to take effect:

```sh
npx cordova plugin rm co.acoustic.connect.push
npx cordova plugin add cordova-acoustic-connect
npx cordova prepare ios
```

A full `cordova platform rm ios && cordova platform add ios` is **not** required for this — earlier versions of the plugin left a stale `"[CP] Prepare AcousticConnectDebug xcframeworks"` (or `AcousticConnect`) script phase behind on the `ConnectNSE`/`ConnectNCE` targets after a Debug↔Release switch, whose referenced `.xcfilelist` no longer existed post-switch and failed the build with `Unable to load contents of file list: ...`. The plugin's `after_prepare` hook now removes any such stale phase from a previous SDK variant before adding the current one, so the lighter `plugin rm`/`add` workflow above is sufficient.

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

### Analytics

All analytics methods return `Promise<void>` and reject with `{ code, message }` (`ACOUSTIC_INVALID_ARGS` for bad arguments). A resolved promise means the SDK **queued** the event; it does not mean the collector has it. Events are batched on the device and posted later, typically when the app goes to the background.

| Method | Notes |
|---|---|
| `logCustomEvent(eventName, values?, level?)` | `values` is a **flat** object of string / number / boolean (the Android SDK carries strings only). `level` is a non-negative integer, default `3`. |
| `logSignal(values, level?)` | `values` is arbitrary JSON, nested objects and arrays included. Functions, `undefined`, `NaN`/`Infinity`, dates and circular references are rejected. |
| `setCurrentScreenName(name)` | Sets the screen name later events are attributed to. It does not emit a screen view by itself. |
| `logScreenViewContextLoad(name, referrer?)` | Logs that a screen was entered. `referrer` is the previous screen; empty or `null` means none. |
| `logScreenViewContextUnload(name, referrer?)` | Logs that a screen was left. On Android the SDK drops a screen view whose screen name still has an unsent message in its queue, so unloading the screen you have just loaded rejects with `ACOUSTIC_INTERNAL_ERROR` (`returned false`). Unload the *previous* screen instead. |
| `logClickEvent(controlId, data?)` | Sent as a `click` **custom event** carrying `controlId` plus optional flat `data`. |
| `logTextChangeEvent(controlId, { text?, masked? })` | Sent as a `textChange` custom event. The text is **masked by default** (each character becomes `X`, only the length is kept) before it leaves JavaScript. Pass `masked: false` to send it as is — never for passwords or personal data. |
| `logExceptionEvent(message, stackInfo?, unhandled?)` | Logs an exception event with the name `Cordova Plugin`, the message as its description and the `unhandled` flag. The stack text arrives in `stackTrace` on Android; on iOS `stackTrace` is `(null)` (an `NSException` carries no call stack) and the text is in `data.stacktrace`. |
| `flushQueues()` | Persists the queue. It does not force an immediate network post on Android. |
| `isSdkEnabled()` | Resolves a strict boolean. |
| `getSdkVersion()` | Resolves the native Connect SDK's own version. |

```js
await AcousticConnect.setCurrentScreenName('checkout');
await AcousticConnect.logScreenViewContextLoad('checkout', 'cart');
await AcousticConnect.logCustomEvent('coupon_applied', { code: 'SPRING', amount: 10 });
await AcousticConnect.logClickEvent('btnPay', { method: 'card' });
await AcousticConnect.logTextChangeEvent('txtEmail', { text: email });   // masked
```

Things to know:

- **Clicks and typing inside the page are not captured automatically.** The native SDK cannot see DOM events inside the WebView, so call `logClickEvent` / `logTextChangeEvent` yourself (or from your own listeners). The native control-event APIs are not used: on a device iOS rejects them for every view, and Android reports the whole WebView as the target.
- **`logCustomEvent` and `logSignal` payloads are shaped differently on the wire per platform.** iOS nests them under `data.value` (custom event) and `signal.data.value` (signal); Android does not. Android also delivers every custom-event value as a string, iOS keeps the JSON types. Keep that in mind when you query the data.
- **`logSignal` on Android:** with the plugin's default SDK (`11.0.21-beta`) a number at the *top level* of the payload is dropped (strings and booleans arrive; numbers nested inside an object or array are not affected). Checked on an emulator: it arrives on `11.1.10-beta`. Nest numeric values, or set `AndroidVersion` to `11.1.10-beta` or later; the versions in between were not checked.

### Runtime configuration items

```js
await AcousticConnect.setConfigItem('DisplayLogging', true, 'EOCore');
const interval = await AcousticConnect.getConfigItem('PostMessageTimeInterval', 0, 'EOCore'); // number
```

`setConfigItem(key, value, moduleName)` takes a boolean, a string or a finite number. `getConfigItem(key, defaultValue, moduleName)` returns a value of the type of `defaultValue`, and returns the default when the item is not set or does not fit that type (a stored `false` stays `false`).

| | Android | iOS |
|---|---|---|
| `moduleName` | Selects the SDK module (`EOCore`, `Tealeaf`, `Connect`). An unknown module rejects with `ACOUSTIC_INTERNAL_ERROR`. | Ignored: one config store. |
| Reading SDK settings | Reads the SDK's own items, for example `DisplayLogging` and `PostMessageTimeInterval`. | Items you set read back. Android's SDK key names such as `DisplayLogging` and `PostMessageTimeInterval` returned the default when tried; other SDK-owned keys were not checked. |

A set that resolves means the SDK accepted the item, not that it changed behaviour: most items are read when the SDK starts, so set them before `enable()` where you can. Both calls need the SDK to be initialised; before that, `setConfigItem` rejects on Android.

### Screen capture and privacy

By default the native SDK captures the view hierarchy and a **screenshot** of each screen. On iOS this was observed on every test launch: a layout message (type 10) with the screen image, plus the screen view itself. In a Cordova app the page is a single WebView, so the screenshot shows whatever the page displays, personal data included.

Native masking rules (`Masking` inside `AutoLayout`) apply to **native controls only**. They do not mask text inside the WebView — the WebView appears as one control. To keep page content out of captures, turn the capture off:

```json
{ "Connect": { "ScreenCaptureEnabled": false } }
```

| Platform | What `false` does |
|---|---|
| iOS | Right after `enable()`, sets `AutoLayout.GlobalScreenSettings.CaptureLayoutOn` to `0`. Verified on a simulator: layout and screenshot stop, screen views continue. |
| Android | Before `enable()`, sets `LogViewLayoutOnScreenTransition` to `false`. On an emulator, with Connect Android SDK `11.1.10-beta`, one run sent a layout (type 10) with capture on and none with `ScreenCaptureEnabled: false`. Older SDKs send no layout for a WebView screen (see below), so there the setting could not be observed. |

**Layout on Android.** The Android SDK sends a layout (type 10) for a WebView screen from `11.1.10-beta`; before that it waited for an id from the Tealeaf web library inside the page and then dropped the layout, so none arrived (the plugin's default pin, `11.0.21-beta`, is in that range). The plugin also has to keep the SDK's capture settings (`PrintScreen`, `LogViewLayoutOnScreenTransition`, `ScreenshotFormat` and others) in the `ConnectBasicConfig.properties` it generates, which replaces the SDK's own file; without them the SDK refused every layout capture. Both are needed. Because the page has no Tealeaf web library, the layout lists the WebView as one control with `dcid: "dcid-none"` and no page content. Try it with `"AndroidVersion": "11.1.10-beta"` (and `useRelease` left `false`, so the beta tree is used).

`layoutConfig`, `layoutConfigIos` and `layoutConfigAndroid` carry the SDK's own screen rules:

```json
{
  "Connect": {
    "layoutConfig": {
      "AutoLayout": { "GlobalScreenSettings": { "CaptureLayoutDelay": 500 } }
    },
    "layoutConfigIos": {
      "AutoLayout": { "GlobalScreenSettings": { "CaptureLayoutOn": 0 } }
    }
  }
}
```

- The platform block is deep-merged over the shared one when you build (objects merge, arrays are replaced). Only `AutoLayout` and `AppendMapIds` are used; other keys are ignored with a warning.
- **iOS** merges the block over the rules the SDK has in effect, so a partial block keeps the rest.
- **Android** writes the block to `ConnectLayoutConfig.json` in the app assets, which **replaces the SDK's whole layout config**. Give it a complete block or omit it; the build warns when `AutoLayout.GlobalScreenSettings` is missing.
  The hook generates `ConnectLayoutConfig.json` (and `ConnectBasicConfig.properties`) in your Cordova project root on every `cordova prepare`, so add both to your `.gitignore`.
- Only `CaptureLayoutOn: 0` was observed to take effect on iOS. Do not assume other values of that key mean "on".

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
