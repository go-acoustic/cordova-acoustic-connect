# Acoustic Connect — internal demo app

Internal-only Cordova app for exercising the `cordova-acoustic-connect` plugin during development. Not published.

## Prerequisites

- Node 18+
- Cordova CLI: `npm install -g cordova`
- iOS: Xcode + an Apple developer team with Push Notifications capability enabled
- Android: Android Studio with platform SDK 34+

## First-time setup

From this directory (`applications/Demo`):

```sh
npm install
npm run install:plugin    # cordova plugin add cordova-acoustic-connect-beta@<version>
cordova platform add android
cordova platform add ios
```

This installs the published `cordova-acoustic-connect-beta` package from npm, pinned to the version in `install:plugin` (kept in sync with the `devDependencies` range in `package.json` — check npm for the latest before bumping). To exercise unreleased local plugin changes instead, link the workspace copy directly:

```sh
cordova plugin rm cordova-acoustic-connect-beta
cordova plugin add ../../plugins/cordova-acoustic-mobile-connect-push --link
```

`--link` symlinks the plugin so edits in `../../src/` reflect after a `cordova prepare` — no re-install needed.

### Android push prerequisites

Drop a real `google-services.json` into `applications/Demo/google-services.json` (gitignored). The `after_prepare` hook copies it into the generated Android project on each `cordova prepare android`.

You can pin the native Connect SDK variant at build time:

```sh
cordova build android -- --gradleArg=-PACOUSTIC_SDK_VARIANT=debug
```

Default is `release` (resolves `io.github.go-acoustic:connect-push-fcm`).

### iOS push prerequisites

Open `platforms/ios/Demo.xcworkspace` in Xcode and:

1. Select the project → Signing & Capabilities → set a Team.
2. Add the **Push Notifications** capability.
3. Add the **Background Modes** capability and tick **Remote notifications**.

Provisioning profile must include the push notifications entitlement and your APNs auth key must be uploaded in the Connect channel configuration.

## Running

```sh
npm run run:android    # cordova run android
npm run run:ios        # cordova run ios
```

## What the buttons do

| Button | Action invoked via `cordova.exec` | Status |
|---|---|---|
| Enable | `enable` | ✅ |
| Disable | `disable` | ✅ |
| Request permission | `push.requestPermission` | ✅ |
| Get permission state | `push.getPermissionState` | ✅ |
| Log identity | `logIdentity` | ✅ |
| Log event | `logEvent` | ✅ |
| Log screen | `logScreen` | ✅ |
| Show token | `push.getToken` | ✅ |

Output appears in the inline panel below the buttons. Resolved Promises render as `✓`; rejected as `✗`.

## Iterating on the plugin

Switch to the linked local plugin first (see First-time setup above). Once installed with `--link`, edits to `../../src/android/` or `../../src/ios/` only need `cordova prepare` (not a re-install) to take effect in this demo.

```sh
# from applications/Demo/
cordova prepare android && cordova run android
```

## Notes

- This app is internal-only. Do not publish or expose `applications/Demo/` outside the private `cordova-acoustic-connect` repository.
- `google-services.json`, APNs keys, and any real credentials stay out of git.
