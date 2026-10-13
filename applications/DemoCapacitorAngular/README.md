# Acoustic Connect: Angular + Ionic sample for Capacitor

Sample app for the `capacitor-acoustic-connect-beta` plugin (`plugins/capacitor-acoustic-connect`) on **Angular 20, Ionic 8.8 and Capacitor 8.5**.
It has the same screens and look as [`../DemoCapacitor`](../DemoCapacitor) and the Cordova Demo app, written as Angular components. It calls every analytics
method of the plugin and every push call. Not a production app.

- `src/app/acoustic.service.ts`: the one place that talks to the plugin, a thin method per call; copy it into your app.
- `src/app/home`: the page, with the tab bar: **Notification** (permission state, Enable Push), **Identity** (log in / registered, the last five) and **Behaviour**
  with **Actions** (quick calls), **Showcase** (a card per feature, including the SDK calls and the iOS manual push calls) and **Verification** (scenarios with the
  expected result, to check against the collector).
- `src/app/behaviour-core.ts`: the payloads and scenarios, the same list as `DemoCapacitor/src/js/behaviour/behaviour-core.js`.

For the Vite and plain JavaScript sample, and the wire verification (e2e), see [`../DemoCapacitor`](../DemoCapacitor).

## Requirements

Node 22 or newer, Android Studio (Android SDK, a device or emulator), Xcode 16 or newer for iOS (simulator or device), and for iOS also
Ruby with the `xcodeproj` gem (`gem install xcodeproj`; CocoaPods brings it).

## Run it

```bash
(cd ../../plugins/capacitor-acoustic-connect && npm install && npm run build)   # builds the plugin's dist/
npm install
cp capacitor.config.example.json capacitor.config.json                              # then put your appKey and postMessageUrl in it
npm run native:setup                                                             # builds the web app, adds android/ and ios/, applies the steps below, syncs
npx cap run android                                                              # or: npx cap run ios
```

`capacitor.config.json` is yours and not in git. With `appKey` and `postMessageUrl` in its `plugins.AcousticConnect` block, the SDK starts when the
app launches; the page then shows "SDK enabled". After a change to the Angular code run `npm run sync` (`ng build` and `cap sync`).

`npm run native:setup` (`scripts/prepare-native.mjs`, add `--android` or `--ios` for one platform) applies what the plugin README asks for, which Capacitor's templates do not have:

- **Android:** `minSdkVersion = 26` in `android/variables.gradle` and the Connect Maven repository
  (`https://raw.githubusercontent.com/go-acoustic/Android_Maven/master`, group `io.github.go-acoustic`) in `android/build.gradle`.
- **iOS (Swift Package Manager):** a Run Script phase that copies `ConnectResources.bundle` to the app root. Without it the SDK starts without
  its default settings and sends only part of its data.

`npx acoustic-connect doctor` lists what is still missing (it needs the plugin installed).

## Wire verification (e2e)

The same scenario and checks as `DemoCapacitor` run on this app, through the same runner (`../DemoCapacitor/e2e/run.js --app .`; see
[`../DemoCapacitor/e2e/README.md`](../DemoCapacitor/e2e/README.md) for the options, the collector sink and what the checks are):

```bash
npm run e2e:android        # or: npm run e2e:ios   (a booted iPhone simulator)
```

It builds the app with `ng build --define E2E_BUILD=true` (a normal build does not contain the scenario), points the SDK at a local collector
sink for the run, and puts your `capacitor.config.json` back afterwards. Results and raw captures go to `e2e/evidence/` (not in git). The push check is
not applicable while `pushEnabled` is `false`.

## Push

Push is off in the template (`pushEnabled: false`). To try it:

- **Android:** set `pushEnabled: true`, put a `google-services.json` for your `appId` in `android/app/`, run `npm run sync`.
- **iOS:** set `pushEnabled: true`, `iosAppGroupIdentifier` and `iosDevelopmentTeam`, create the App Group and give the app id and the two
  extensions' ids (`<app id>.ConnectNSE`, `<app id>.ConnectNCE`) the Push Notifications capability and the App Group in your Apple developer account,
  then run `npx acoustic-connect setup-ios-push` (rich push; needs Ruby and `xcodeproj`). A push needs a real device on iOS.

Tapping a notification is handled by the SDK. The calls of the iOS `manual` push mode (`iosPushMode: 'manual'`) are in Behaviour › Showcase › Push, iOS manual mode; they reject
with `ACOUSTIC_PUSH_MODE_NOT_MANUAL` in any other mode and on Android. See the plugin's `docs/push.md`.

## Good to know

- **Screen views.** The SDK records the activity's own screen (`Home`) and refuses a manual `load` with the same name. An `unload` of the screen that is
  current is refused too (Behaviour › Actions › Log Screen Unload shows it): load the next screen first, then unload the one you leave
  (Behaviour › Showcase › Screen view chain does).
- **Settings.** The module name for `setConfigItem` and `getConfigItem` on Android is `EOCore`.
- **`Script error.` in the console (Android).** The Connect Android SDK runs scripts in the WebView that look for Tealeaf's `TLT` and `tlBridge`; the plugin
  gives the page inert stand-ins, which removes the `TLT` and `tlBridge` messages, but an `ErrorEvent` `Script error.` can still reach Angular's error handler at
  start-up (in 4 to 8 of 12 launches on a Pixel 9 emulator). Events still reach the collector. It also happens in a Cordova app on the same SDK.
