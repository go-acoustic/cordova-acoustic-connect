# Troubleshooting

Common issues when building or running an app with the `cordova-acoustic-connect` plugin installed.

## Prerequisites

| Platform | Requirement |
|---|---|
| Android | JDK 17 (the plugin sets `AndroidJavaSourceCompatibility`/`AndroidJavaTargetCompatibility`/`AndroidKotlinJVMTarget` to 17) |
| Android | A standalone Gradle install — see note below |
| Android | Firebase `google-services.json` at the Cordova project root |
| iOS | Xcode 15+ and CocoaPods |
| iOS | A real APNs auth key uploaded for your app — iOS push uses direct APNs, not Firebase |

## Android

**Android Studio (Giraffe and later) no longer bundles a runnable Gradle.** It ships the Gradle IntelliJ plugin only — you need a `gradle` binary on `PATH` for `cordova-android` to bootstrap the project's Gradle wrapper.

| Symptom | Cause | Fix |
|---|---|---|
| `Could not find an installed version of Gradle...`; Studio Run button greyed out | Android Studio ships only the Gradle IntelliJ plugin, not a `gradle` binary; cordova-android needs one on `PATH` to bootstrap the wrapper | Install standalone Gradle (`brew install gradle`, or SDKMAN/manual) and ensure it's on `PATH`. cordova-android then uses the project's Gradle wrapper. (Verified with cordova-android 15 + Gradle 9.6.1 host, wrapper 8.14.2, JDK 17.) |
| `File google-services.json is missing. The Google Services Plugin cannot function without it.` | The Connect push plugin applies `com.google.gms.google-services`, which hard-fails without the file | Download `google-services.json` from Firebase Console → place at the Cordova project root. The package name in it must match the `config.xml` widget id (e.g. `co.acoustic.connect.cordova.demo`). |
| `adb devices` shows the emulator as `unauthorized`; deploy hangs | Play Store (`google_apis_playstore`) system images require manual USB-debugging approval, which is invisible on a headless emulator | Launch the AVD with a window and tap **Allow** on "Allow USB debugging?" (check "Always allow"). Or use a non-Play `google_apis` image (`ro.adb.secure=0`, auto-authorizes). |

**Environment cleanup:** a duplicate `adb` (Homebrew's `/opt/homebrew/bin/adb` alongside the Android SDK's `platform-tools/adb`) can cause `Address already in use` on port 5037. Keep only the SDK's `adb` (`brew uninstall android-platform-tools`).

## iOS

| Symptom | Cause | Fix |
|---|---|---|
| `pod install`/`cordova build ios` fails with `[after_prepare] pod install failed — see CocoaPods output above: ...command not found: pod` | The plugin's `after_prepare` hook shells out to `pod install` to link the native SDK — CocoaPods isn't installed | `sudo gem install cocoapods && pod repo update`. On Apple Silicon, an outdated `ffi` gem can also break `pod install` — reinstall with `sudo gem install ffi` if `gem install cocoapods` itself fails (verify). |
| Undefined symbols / "Framework not found Pods_App" at build time | Opened `platforms/ios/App.xcodeproj` instead of the CocoaPods-generated workspace | Always open `platforms/ios/App.xcworkspace` after `cordova prepare ios`/`build ios`, never the `.xcodeproj` |
| `Signing for "App" requires a development team. Select a development team in the Signing & Capabilities editor.` | No Apple Developer team assigned to the target | Xcode → project → **Signing & Capabilities** → set a Team (automatic signing is fine for development) |
| APNs registration never completes / `didFailToRegisterForRemoteNotificationsWithError` fires; app rejected or fails to run with an entitlement/provisioning mismatch | The **Push Notifications** capability (and its `aps-environment` entitlement) isn't added — the plugin auto-adds the `UIBackgroundModes` → `remote-notification` background mode, but not this capability | Xcode → project → **Signing & Capabilities** → add **Push Notifications** |
| No push received even with a valid device token | Real APNs auth key (`.p8`) not uploaded, or uploaded to the wrong place | Upload the key wherever your Acoustic Connect app/channel push configuration expects it — this is not a Firebase step for iOS (verify the exact console/location with your Acoustic Connect account team; not confirmed in this repo). |
| Push never arrives when testing on the iOS Simulator | Simulators can't register for real APNs tokens or receive server-sent pushes — `registerForRemoteNotifications()` fails there regardless of app/plugin config. `xcrun simctl push` only delivers a locally-injected payload for UI testing, not a real end-to-end push | Use a physical device for end-to-end push testing; use `xcrun simctl push` only to test notification UI/handling code |
| `xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance` | Command Line Tools are selected instead of the full Xcode install | Check with `xcode-select -p`; fix with `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer` |
| CocoaPods fails with a platform-compatibility error naming `AcousticConnect`/`AcousticConnectDebug` | Project's `deployment-target` is set below the SDK's minimum (iOS 15.0; the plugin defaults `deployment-target` to 15.1) | Remove any `config.xml` override of `deployment-target` below 15.1, or raise it to at least 15.1 |
