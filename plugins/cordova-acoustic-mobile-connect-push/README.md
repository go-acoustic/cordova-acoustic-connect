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
    "iOSAppGroupIdentifier": "group.<your-bundle-id>"
  }
}
```

The plugin's `before_prepare` hook reads this file on every `cordova prepare` / `cordova build`. `Connect.useRelease` is the single source of truth for which native SDK variant is used:

- `true` → `AcousticConnect` (release) pod on iOS, the release Connect artifact on Android.
- `false` (default) → `AcousticConnectDebug` pod on iOS. Android always uses the same `connect-push-fcm` artifact regardless of `useRelease` — there is no separate debug Maven artifact.

Android reads the flag fresh on every build; iOS bakes the CocoaPods pod name into `plugin.xml` when the plugin is installed, so after changing `useRelease` you must remove and re-add the plugin for it to take effect.

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
