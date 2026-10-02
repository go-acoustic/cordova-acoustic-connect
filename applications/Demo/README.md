# Acoustic Connect — sample Cordova app

Reference Cordova app for exercising the `cordova-acoustic-connect` plugin during development. Not a production app.

## Prerequisites

- Node 20+
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
| Behaviour | Log Custom Event | `AcousticConnect.logCustomEvent(name, { source, platform })` |
| Behaviour | Log Signal (nested JSON) | `AcousticConnect.logSignal({ signalContent: {...}, audience: [...] })` |
| Behaviour | Log Click (btn_demo) | `AcousticConnect.logClickEvent('btn_demo', { screen: 'behaviour' })` |
| Behaviour | Log Text Change (masked) | `AcousticConnect.logTextChangeEvent('txt_demo', { text })` — only the text length is sent, as `X` characters |
| Behaviour | Log Screen Load / Unload | `AcousticConnect.logScreenViewContextLoad` / `logScreenViewContextUnload('demo_screen', 'behaviour')` |
| Behaviour | Log Handled Exception | `AcousticConnect.logExceptionEvent(message, stack, false)` |
| Behaviour | Flush Queues | `AcousticConnect.flushQueues()` |

The Behaviour tab needs a plugin version that includes the analytics API; on an older published plugin it shows a message instead of failing. A resolved call means the SDK queued the event — batches are posted later, typically when the app goes to the background.

Identity submissions are also kept in a local "Recent" history (last 5, tap to refill the form). There's no generic output/log panel — each tab shows its own inline status text.

## End-to-end verification

`e2e/` checks what the plugin really puts on the wire. It builds this app, runs it on an Android emulator or an iOS simulator against a local collector sink, lets the app run a fixed scenario of analytics calls, and asserts the messages the sink received. A bridge call that resolves only means the SDK queued the event; this checks what was sent.

```sh
# from applications/Demo/
node e2e/run.js --platform android --device emulator-5554
node e2e/run.js --platform ios --device <simulator-udid>
node e2e/run.js --platform ios --device <udid> --phase screen-capture-off   # also: layout-config-off
node e2e/run.js --platform android --device <serial> --skip-build           # reuse the last build
node e2e/run.js --platform android --device <serial> --plugin npm           # test the published package
```

**What you need**

- Node 20+, `npm ci` in this directory and in the plugin directory (the tests read `plist` from here).
- Android: JDK 17 (`JAVA_HOME`), a standalone Gradle, one authorized emulator or device. With several devices connected pass `--device <serial>`; the runner never guesses.
- iOS: Xcode 15+, CocoaPods, a simulator UDID (`xcrun simctl list devices`).
- A checkout of the collector sink (`ac-sdk-mobile-interceptor`): set `AC_SINK_DIR` or pass `--sink-repo`.
- A `ConnectConfig.json` (copy `ConnectConfig.example.json`) and, for Android, `google-services.json`.

**What a run does**

1. Starts the sink on a free port and prepares the build (`e2e/prepare.js`): points `ConnectConfig.json` at the sink, switches the in-app scenario on in `www/js/e2e-config.js`, and lets the build talk to plain http (Android cleartext, iOS App Transport Security) through `hooks/after_prepare_e2e.js`.
2. Switches the app to the plugin under test (`--plugin local`: the source in this repository, linked; `npm`: the published package), builds, installs, and launches it.
3. Waits for the app to finish the scenario, then sends it through the background twice so the SDK posts its queue, and waits until the sink stops receiving.
4. Builds the checks from the same scenario (`e2e/suite.js`) and runs the assertion engine on what arrived.
5. Writes `e2e/evidence/<timestamp>-<platform>-<phase>/`: `results-<platform>.md` (verdict, environment, one row per check, what was reverted), `messages.json`, `suite.json`, and the sink's raw `captures/`. This directory is gitignored because captures can hold app data.
6. Always puts the Demo back: `ConnectConfig.json`, `e2e-config.js` and the patched platform file are restored byte for byte, and the sink and the app are stopped.

Exit code: `0` PASS, `1` FAIL, `2` INCONCLUSIVE (no evidence could be produced: the build failed, nothing reached the sink, the SDK never started).

Extra `ConnectConfig.json` settings for one run go in `--connect-config '<json>'`, merged over the phase's own. Use it to try another native SDK version, for example `--connect-config '{"AndroidVersion":"11.1.10-beta"}'` (the Demo has `useRelease: false`, so the beta tree is used). The report lists the extra settings, so keep credentials out of them.

**In Jenkins**

The `E2E Verification` stage of the `Jenkinsfile` runs after `Test` and before any publish stage, on the `aws_mac` agent: it clones the sink over SSH, picks an iOS simulator with `node e2e/pick-simulator.js` (a booted iPhone first, otherwise the newest iOS runtime), runs `node e2e/run.js --platform ios` with the `default` phase, archives `e2e/evidence/**` and shuts the simulator down. Only iOS runs in CI; Android and the other capture phases are run by hand.

The stage is new, so it is deliberately cautious:

- It always runs on `develop` and `main`; on a feature branch it runs only when you tick `RUN_E2E` (default off).
- It does not block the build yet: a runner exit code `1` (FAIL) or `2` (INCONCLUSIVE, no evidence) marks the build UNSTABLE, and the stage itself shows red. Set `e2eBuildResult` to `'FAILURE'` in the `Jenkinsfile` to make it blocking once it has proved stable.
- Builds queue for the simulator (`lock(resource: 'ios-simulator-e2e')`) instead of sharing it.
- Every run logs `E2E Verification took <n>s`, so the duration and the pass rate can be read from the build history.

The `E2E Verification` stage of the `Jenkinsfile` runs after `Test` and before any publish stage, on the `aws_mac` agent: it clones the sink over SSH, picks an iOS simulator with `node e2e/pick-simulator.js` (a booted iPhone first, otherwise the newest iOS runtime), runs `node e2e/run.js --platform ios` with the `default` phase, archives `e2e/evidence/**` and shuts the simulator down. A runner exit code `1` (FAIL) fails the build; `2` (INCONCLUSIVE, no evidence) marks it unstable. Turn the stage off for one build with the `RUN_E2E` parameter. Only iOS runs in CI; Android and the other capture phases are run by hand.

**What it changes on your machine**

- The app on the emulator or simulator is replaced by the e2e build (it points at the sink). Install the normal build again afterwards.
- With `--plugin local` the Demo's installed plugin becomes a link to the source in this repository (`--nosave`: `package.json` is not touched). Re-add the published package with `cordova plugin add cordova-acoustic-connect --nosave` if you want it back.
- If a run is killed half way, run `node e2e/prepare.js restore`. `node e2e/prepare.js status` tells whether a run is still prepared.

**How the checks are chosen**

The scenario (`www/js/e2e/scenario.js`) lists each call together with the wire message it must produce, so the calls and the checks cannot drift apart. The two platforms differ and the checks follow that: iOS nests custom-event and signal payloads (`data.value`, `signal.data.value`) and keeps JSON types, Android is flat and delivers custom-event values as strings; iOS sends a layout (type 10) and the Android SDK sends none, so that row is reported N/A with its reason instead of being dropped. An N/A row always carries a reason.

The capture phases are separate runs because they need different `ConnectConfig.json` settings: `default`, and on iOS `screen-capture-off` (`ScreenCaptureEnabled: false`) and `layout-config-off` (`layoutConfigIos` with `CaptureLayoutOn: 0`). Both must send no layout while the screen views the app logs itself stay. On Android the layout row is checked when the run asks for Connect Android SDK `11.1.10-beta` or later (the first version that sends a layout for a WebView screen); on older SDKs it is N/A with that reason. The capture phases are not run on Android yet.

**Things that bite**

- In zsh a variable holding several words is not split: build arguments as an array, not a string.
- The Android SDK drops a screen view whose screen is still queued, so the scenario unloads the previous screen, not the one it just loaded.
- `ScreenCaptureEnabled` and `layoutConfig*` are read at prepare time, so a capture phase needs a real build, not `--skip-build`.
- The Android emulator reaches the host at `10.0.2.2`; the runner sets that for you (`--device-host` is for a physical device).

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
