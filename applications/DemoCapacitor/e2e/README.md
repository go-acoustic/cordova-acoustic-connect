# Wire verification

Runs the release-verification scenario (the shared one in [`../../../e2e/core`](../../../e2e/README.md), which the Cordova demo runs too, so the calls and the checks
are one list) in the DemoCapacitor app, collects what the SDK posts in a local collector sink, and asserts on it
with the release-verification engine. Exit code: 0 PASS, 1 FAIL, 2 INCONCLUSIVE; the report is written to
`e2e/evidence/<run>/results-<platform>.md` (git-ignored).

Needs the collector sink checkout (`ac-sdk-mobile-interceptor`, default
`~/AndroidStudioProjects/server_tests/ac-sdk-mobile-interceptor`, or `--sink-repo` / `AC_SINK_DIR`) and a
free port 9877 (`--port`). For the run the runner swaps the app's `capacitor.config.json` (yours, or the example when
you have none) for one that points the SDK at `localhost:<port>`, and puts yours back byte for byte when the run ends
(`e2e/config.js`; `node e2e/run.js restore` does it after a run that was killed). The iOS simulator reaches the machine
as it is; for the Android emulator the runner sets up `adb reverse`.

From `applications/DemoCapacitor` (or `plugins/capacitor-acoustic-connect`, which has the same scripts):

```bash
npm run e2e:android -- --device emulator-5554          # builds the app, runs, asserts
npm run e2e:android -- --sdk-version 11.1.10-beta      # another Connect Android SDK
npm run e2e:ios                                        # a booted iPhone simulator
npm run e2e:ios -- --phase screen-capture-off          # a capture phase
```

- **Phases** (`--phase`, as in the Cordova demo): `default` (SDK defaults), `screen-capture-off`
  (`screenCaptureEnabled: false`) and `layout-config-off` (`layoutConfigIos` / `layoutConfigAndroid` with
  `CaptureLayoutOn: 0`; the report names only the iOS key, which is the Cordova row text): the screen views the app logs
  itself stay, and no layout (type 10) is sent. The run puts the phase's settings into the swapped config; the report is
  `results-<platform>-<phase>.md`. Unlike Cordova, Android runs the capture-off phases too, and needs
  `--sdk-version 11.1.10-beta` or later: before that the plugin turns layout capture off itself, so "no layout" would
  prove nothing.
- **Android** uses the SDK the plugin pins. Layout (type 10) is expected only from Connect Android 11.1.10 on
  (`--layout expected|off|auto`, default `auto` reads the version from logcat); before that the plugin
  turns layout capture off and the row is reported as not applicable, with the reason.
- **iOS** runs the DemoCapacitor app, whose iOS project uses Swift Package Manager and links the SDK through it.
  `--ios-host <dir>` runs a CocoaPods app instead, which `e2e/ios-host.js` builds from the app's sources the first
  time (it needs network for `pod install`). The simulator's app log cannot be read, so the app's `E2E_DONE` line is not
  observed and the wire checks decide.
- With push on the run also checks what the registration says (type 22): the provider (`FCM` on Android, `APN` on iOS), a device token
  that is not empty and, on Android, `acceptPush` (the run grants the notification permission). A notification arriving and being tapped
  need a real push to a device, so they are not covered by this run.
- The push registration row (type 22) is expected on iOS and on Android when the app has a
  `google-services.json`; otherwise it is reported as not applicable.
- **Another app.** `--app <dir>` runs the same scenario and checks on another Capacitor app: `applications/DemoCapacitorAngular` (Angular 20 + Ionic)
  does, with `npm run e2e:android` / `npm run e2e:ios` in its folder. The runner builds the web assets the way the app does (`vite build` with
  `VITE_E2E=1`, or, for an app with an `angular.json`, `ng build --define E2E_BUILD=true`); the app must carry the scenario driver behind that
  switch (`src/js/e2e.js` here, `src/app/e2e.ts` there) and keep `capacitor.config.json` and `capacitor.config.example.json` like this one.
