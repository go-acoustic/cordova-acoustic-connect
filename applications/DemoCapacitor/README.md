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
| Behaviour › Showcase | Open Gestures (`btn_open_gestures`) | Opens the Gestures screen, which becomes the page's screen (below): `logScreenViewContextLoad('Gestures', 'Showcase')`, then `logScreenViewContextUnload('Showcase', …)`; Back moves it back to `Showcase`. Targets `gesture_long_press`, `gesture_double_tap`, `gesture_swipe`, `gesture_pinch_zoom`, the status line `tv_gestures_last` (`Last gesture: <name>`) and a 40-row list `gesture_scroll_list`. The targets use plain pointer events and log nothing themselves. |
| Behaviour › Showcase and Verification | the sample UI contract (CA-159374) | The controls the end-to-end tests drive by fixed DOM ids, as on the React Native samples (`Examples/shared`): the hub buttons `btn_open_showcase` and `btn_open_verification`; on Showcase `btn_showcase_tap` (counter `txt_showcase_taps`, nothing logged by the page), the fields `field_showcase_note` and `field_showcase_secret`, `btn_send_custom_event`, `btn_send_nested_signal` and `btn_send_flat_signal` (results `txt_custom_event_result`, `txt_signal_result`), `btn_showcase_exception`, `btn_capture_disable` / `btn_capture_enable` (`txt_capture_state`) and `btn_showcase_open_detail` (the detail chain `Showcase detail` to `Showcase detail 5`, `btn_showcase_push_detail`, `btn_showcase_back`); on Verification `btn_send_custom_event`, `btn_send_nested_signal`, `btn_identity_defaulted` / `btn_identity_explicit` (`txt_identity_defaults_result`) and `btn_open_screen_views`, which opens Screen Views (`btn_navigate_<case>`, `btn_screenview_<case>`, `btn_screenview_send_all`, `txt_screenview_result`, `btn_screen_views_back`) and a view per case (`btn_case_relog`, `txt_case_relog_result`, `btn_case_push_next`, `btn_case_back`). |

**Screen views.** The app is one native screen, so the page logs its own, one current screen at a time (`createPageScreens` in `behaviour-core.js`): the Notification tab is `Push`, Identity `Identity`, and on Behaviour the sub-tab Actions is `Behaviour`, Showcase `Showcase` (`Gestures` while that screen is open) and Verification `Verification`, the names of the native and React Native samples. Moving on logs `logScreenViewContextLoad` for the next screen, with the screen left as referrer, then `logScreenViewContextUnload` for the screen left, with the referrer it was entered with (the Android SDK refuses an UNLOAD of the current screen); the first screen, logged once the SDK is enabled, has none. `setCurrentScreenName` is not called: it names the screen without logging a screen view.

**Views.** Each of Showcase and Verification keeps a stack of the views opened on it (the Gestures screen, the detail chain, Screen Views and its case views), in the page's screens (`open`, `back`, `stack` in `behaviour-core`): the view on top is the screen on display, and its name is logged as above on every move (`Catalog <- Screen Views`, then `Product Details <- Catalog`, back to `Catalog <- Product Details`). A stack is kept while another tab or sub-tab is shown. `btn_capture_disable` calls `disable()` and stops the page's screen views; `btn_capture_enable` calls `enable()` again with the `DEMO_ENABLE` key and collector URL declared next to `enableSdk` in `behaviour.js` (set your own: the page cannot read `capacitor.config.json`); while the key is the placeholder it refuses and `txt_capture_state` says what to set.

Behaviour also has a Showcase (one card per feature) and a Verification section (scenarios with what to do and what the
collector must show). A resolved call means the SDK queued the event; batches are posted later, typically when the app
goes to the background. Identity submissions are kept in a local "Recent" history (last 5, tap to refill the form).

`VITE_E2E=1 npx vite build` builds the app with the verification scenario switched on (see [e2e/README.md](e2e/README.md)):
it runs once the SDK is up and reports `E2E_DONE ...` on the console and in a hidden `#e2eDone` marker.
