# Acoustic Connect — sample Capacitor app

Reference Capacitor app for the `capacitor-acoustic-connect-beta` plugin (`plugins/capacitor-acoustic-connect`), with the same
screens as the Cordova Demo app. Use it to try the plugin by hand and to run the wire verification (see
[e2e/README.md](e2e/README.md)). Not a production app.

## Config

`capacitor.config.example.json` is the tracked template; copy it to `capacitor.config.json`, which is yours and not in
git:

```bash
cp capacitor.config.example.json capacitor.config.json
```

Its `plugins.AcousticConnect` block starts the SDK when the app launches: put your own `appKey` and `postMessageUrl`
in it. To look at the traffic yourself, point `postMessageUrl` at a local collector sink (`http://localhost:9877/...`;
for the Android emulator also run `adb reverse tcp:9877 tcp:9877`). The wire verification does that on its own for a
run and puts your file back afterwards (see [e2e/README.md](e2e/README.md)).

## Run it

```bash
npm install
(cd ../../plugins/capacitor-acoustic-connect && npm install && npm run build)   # builds the plugin's dist/
npx vite build && npx cap sync
npx cap run android                 # or: open android/ in Android Studio
```

Android needs `minSdkVersion` 26 and the Connect Maven repository, both already set in `android/`.
Push is off here. To try it, set `pushEnabled: true` in `capacitor.config.json`, add your own
`android/app/google-services.json` (gitignored; `android/app/google-services.json.example` is the template, for the package
`co.acoustic.connect.capacitor.demo`), run `npx cap sync` and rebuild.

The iOS project uses Swift Package Manager and links the Connect SDK through it. It has a Run Script phase that
copies `ConnectResources.bundle` to the app root, which the Swift package does not do (see the README). To try the
CocoaPods route, `node e2e/ios-host.js <dir>` builds a CocoaPods app from these sources.

## App layout

The same screens as the Cordova Demo app. The SDK starts when the app launches, from the plugin block of
`capacitor.config.json`; the page waits for it and then enables the buttons. Three tabs:

| Tab | Button | What it does |
|---|---|---|
| Notification | Enable Push | `AcousticConnect.push.requestPermission()`; the auth dot and status text show the OS permission state and are re-checked whenever the app comes back to the foreground |
| Identity | Log Logged In With Email | `AcousticConnect.logIdentity(name, value, 'loggedIn', { loginMethod: 'email' })` |
| Identity | Log Account Registered With Email | `AcousticConnect.logIdentity(name, value, 'accountRegistered', { registrationMethod: 'email' })` |
| Behaviour | Log Custom Event | `AcousticConnect.logCustomEvent(name, { source, platform })` |
| Behaviour | Log Signal (nested JSON) | `AcousticConnect.logSignal({ signalContent: {...}, audience: [...] })` |
| Behaviour | Log Click (btn_demo) | `AcousticConnect.logClickEvent('btn_demo', { screen: 'behaviour' })` |
| Behaviour | Log Text Change (masked) | `AcousticConnect.logTextChangeEvent('txt_demo', { text })`: only the text length is sent, as `X` characters |
| Behaviour | Log Screen Load / Unload | `AcousticConnect.logScreenViewContextLoad` / `logScreenViewContextUnload('demo_screen', 'behaviour')` |
| Behaviour | Log Handled Exception | `AcousticConnect.logExceptionEvent(message, stack, false)` |
| Behaviour | Flush Queues | `AcousticConnect.flushQueues()` |

Behaviour also has a Showcase (one card per feature) and a Verification section (scenarios with what to do and what the
collector must show). A resolved call means the SDK queued the event; batches are posted later, typically when the app
goes to the background. Identity submissions are kept in a local "Recent" history (last 5, tap to refill the form).

`VITE_E2E=1 npx vite build` builds the app with the verification scenario switched on (see [e2e/README.md](e2e/README.md)):
it runs once the SDK is up and reports `E2E_DONE ...` on the console and in a hidden `#e2eDone` marker.
