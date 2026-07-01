# Acoustic Connect — sample Cordova app

Reference Cordova app for exercising the `cordova-acoustic-connect` plugin during development. Not a production app.

## Prerequisites

- Node 18+
- Cordova CLI: `npm install -g cordova`
- iOS: Xcode + an Apple developer team with Push Notifications capability enabled
- Android: Android Studio with platform SDK 34+

## First-time setup

From this directory (`applications/Demo`):

```sh
npm install
npm run install:plugin    # cordova plugin add cordova-acoustic-connect
cordova platform add android
cordova platform add ios
```

`install:plugin` pulls the plugin from the published `cordova-acoustic-connect` npm package (pinned in `package.json`) — not from `../../plugins/` — so the demo builds the same way the public mirror does. To iterate against local plugin source instead, see [Iterating on the plugin](#iterating-on-the-plugin) below.

### Android push prerequisites

Drop a real `google-services.json` into `applications/Demo/google-services.json` (gitignored). The `after_prepare` hook copies it into the generated Android project on each `cordova prepare android`.

The native SDK variant (debug vs release) is controlled by `Connect.useRelease` in `ConnectConfig.json`, not a build flag — Android reads it fresh on every build.

### iOS push prerequisites

Open `platforms/ios/App.xcworkspace` in Xcode and:

1. Select the project → Signing & Capabilities → set a Team.
2. Add the **Push Notifications** capability.

(Background Modes → Remote notifications is added automatically by the plugin — no manual toggle needed. If you change `Connect.useRelease` for iOS, remove and re-add the plugin — the pod name is baked into `plugin.xml` at install time.)

Provisioning profile must include the push notifications entitlement and your APNs auth key must be uploaded in the Connect channel configuration.

## Running

```sh
npm run run:android    # cordova run android
npm run run:ios        # cordova run ios
```

## App layout

The SDK is enabled automatically on `deviceready` from the bundled `ConnectConfig.json` — there's no manual Enable/Disable step. Three tabs:

| Tab | Button | What it does |
|---|---|---|
| Notification | Enable Push | Calls `pushRequestPermission`; the auth dot/status text reflects the OS permission state and re-checks on every app resume |
| Identity | Log Logged In With Email | `AcousticConnect.logIdentity(name, value, 'loggedIn', { loginMethod: 'email' })` |
| Identity | Log Account Registered With Email | `AcousticConnect.logIdentity(name, value, 'accountRegistered', { registrationMethod: 'email' })` |
| Behaviour | — | Placeholder ("Coming Soon") — not implemented yet |

Identity submissions are also kept in a local "Recent" history (last 5, tap to refill the form). There's no generic output/log panel — each tab shows its own inline status text.

## Iterating on the plugin

By default the plugin comes from the published npm package, not `../../plugins/`. To iterate on plugin source, link it locally once:

```sh
cordova plugin rm co.acoustic.connect.push
cordova plugin add ../../plugins/cordova-acoustic-mobile-connect-push --link
```

`--link` symlinks the plugin so edits to `../../plugins/cordova-acoustic-mobile-connect-push/src/` only need `cordova prepare` (not a re-install) to take effect:

```sh
# from applications/Demo/
cordova prepare android && cordova run android
```

## Notes

- This is a reference app for exercising the plugin during development — not a production app.
- `google-services.json`, APNs keys, and any real credentials stay out of git.
