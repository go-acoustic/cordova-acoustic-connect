# Acoustic Connect — Cordova plugin

Cordova plugin for integrating [Acoustic Connect](https://acoustic.com/connect/) into hybrid mobile applications.

## About

`cordova-acoustic-mobile-connect-push` exposes the Acoustic Connect SDK (CDP + engagement) to Cordova-based mobile apps. The plugin wraps the native iOS and Android Connect SDKs and surfaces a unified JavaScript API under `window.AcousticConnect`.

## Repository structure

```
.
├── applications/Demo/                            Sample Cordova app
├── plugins/cordova-acoustic-mobile-connect-push/ Plugin source (iOS + Android)
├── docs/                                         Project documentation
├── Jenkinsfile                                   CI pipeline
└── .github/workflows/                            GitHub Actions (npm publish on release)
```

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18+ |
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
    "appKey": "<your-app-key>",
    "postMessageUrl": "<your-collector-url>",
    "useRelease": false,
    "iOSAppGroupIdentifier": "group.<your-bundle-id>"
  }
}
```

A `ConnectConfig.example.json` with placeholder values is included for reference. If `ConnectConfig.json` is absent the build falls back to the example file (placeholder values — NSE/NCE will not work).

## Building the demo app

All commands run from `applications/Demo/`.

### First-time setup

```sh
npm install
npx cordova plugin add "../../plugins/cordova-acoustic-mobile-connect-push"
npx cordova platform add android
npx cordova platform add ios
npx cordova build android
npx cordova build ios
```

### Clean rebuild (after platform or plugin changes)

```sh
npx cordova platform rm ios && \
npx cordova plugin rm co.acoustic.connect.push && \
npx cordova plugin add "../../plugins/cordova-acoustic-mobile-connect-push" && \
rm -rf ~/Library/Developer/Xcode/DerivedData && \
npx cordova platform add ios && \
npx cordova build ios
```

### Android only

```sh
npx cordova build android
# or with explicit SDK variant:
npx cordova build android -- --gradleArg=-PACOUSTIC_SDK_VARIANT=release
```

## Running on device / simulator

```sh
npx cordova run android
npx cordova run ios
```

## Iterating on plugin source

The plugin is installed from a local path. After editing source files:

```sh
# iOS
npx cordova prepare ios && npx cordova build ios

# Android
npx cordova prepare android && npx cordova build android
```

No re-install needed — `cordova prepare` picks up the changes from the local plugin directory.

## iOS push setup (Xcode)

After building, open `platforms/ios/App.xcworkspace` in Xcode:

1. Select the project → **Signing & Capabilities** → set a Team.
2. Add the **Push Notifications** capability.
3. Add **Background Modes** → tick **Remote notifications**.

## Android push setup

Drop a real `google-services.json` into `applications/Demo/` (gitignored). The `after_prepare` hook copies it into the generated Android project on each prepare.

## License

Licensed under the Acoustic License for Non-Warranted Programs. See [LICENSE](LICENSE) for full terms.
