# Acoustic Connect — Cordova plugin

Cordova plugin for integrating [Acoustic Connect](https://acoustic.com/connect/) into hybrid mobile applications.

## About

`cordova-acoustic-mobile-connect-push` exposes the Acoustic Connect SDK (CDP + engagement) to Cordova-based mobile apps. The plugin wraps the native iOS and Android Connect SDKs and surfaces a unified JavaScript API under `window.AcousticConnect`.

## Repository structure

```
.
├── applications/Demo/                            Sample Cordova app
├── plugins/cordova-acoustic-mobile-connect-push/ Plugin source (iOS + Android)
├── scripts/                                      Repo-level tooling (e.g. Jenkinsfile validation)
├── Jenkinsfile                                   CI pipeline
└── .github/workflows/                            GitHub Actions (npm publish, AI review)
```

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| Cordova CLI | `npm install -g cordova` |
| Xcode | 15+ (iOS builds) |
| Xcode CLI tools pointed at Xcode | `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` |
| Android Studio + SDK 34+ | (Android builds) |
| CocoaPods | `sudo gem install cocoapods` |

## Configuration

Create `applications/Demo/ConnectConfig.json` (gitignored — never commit real credentials):

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

Only `AppKey` and `PostMessageUrl` are required; everything else has a default.

A `ConnectConfig.example.json` with placeholder values is included for reference. If `ConnectConfig.json` is absent the build falls back to the example file (placeholder values — NSE/NCE will not work).

## Building the demo app

All commands run from `applications/Demo/`.

### First-time setup

```sh
npm install
npx cordova plugin add cordova-acoustic-connect
npx cordova platform add android
npx cordova platform add ios
npx cordova build android
npx cordova build ios
```

The Demo app pulls the plugin from the published `cordova-acoustic-connect` npm package (pinned in `package.json`), not from the local `plugins/` source — this is what lets the public mirror of the demo build without the private monorepo. See [Iterating on plugin source](#iterating-on-plugin-source) to work against local changes instead.

### Clean rebuild (after platform or plugin changes)

```sh
npx cordova platform rm ios && \
npx cordova plugin rm co.acoustic.connect.push && \
npx cordova plugin add cordova-acoustic-connect && \
rm -rf ~/Library/Developer/Xcode/DerivedData && \
npx cordova platform add ios && \
npx cordova build ios
```

### SDK variant (debug vs release)

A single flag, `Connect.useRelease` in `ConnectConfig.json`, controls both platforms — there is no build-time flag or CLI variable.

- Android reads it fresh on every `cordova build android` — no extra step.
- iOS bakes the CocoaPods pod name (`AcousticConnect` vs `AcousticConnectDebug`) into `plugin.xml` when the plugin is installed, so after changing the flag you must remove and re-add the plugin (see the clean rebuild above) for it to take effect.

## Running on device / simulator

```sh
npx cordova run android
npx cordova run ios
```

## Iterating on plugin source

The Demo app installs the plugin from the published npm package by default (see First-time setup). To work against your local edits to `plugins/cordova-acoustic-mobile-connect-push/`, swap to a linked local install once:

```sh
npx cordova plugin rm co.acoustic.connect.push
npx cordova plugin add "../../plugins/cordova-acoustic-mobile-connect-push" --link
```

`--link` symlinks the plugin so further edits only need a re-`prepare` (not a re-install) to take effect:

```sh
# iOS
npx cordova prepare ios && npx cordova build ios

# Android
npx cordova prepare android && npx cordova build android
```

## iOS push setup (Xcode)

After building, open `platforms/ios/App.xcworkspace` in Xcode:

1. Select the project → **Signing & Capabilities** → set a Team.
2. Add the **Push Notifications** capability.

The Background Modes → Remote notifications entitlement is added automatically by the plugin (`plugin.xml` config-file) and doesn't need a manual toggle.

## Android push setup

Drop a real `google-services.json` into `applications/Demo/` (gitignored). The `after_prepare` hook copies it into the generated Android project on each prepare.

## Troubleshooting

Common build/push issues and fixes: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## License

Licensed under the Acoustic License for Non-Warranted Programs. See [license/license.txt](license/license.txt) for full terms.
