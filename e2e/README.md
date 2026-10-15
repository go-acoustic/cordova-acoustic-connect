# Shared e2e core

The wire-level verification of the Cordova and the Capacitor plugin runs one scenario and one set of
checks. The platform-neutral part lives here, so both plugins use it equally. Each plugin's example app
keeps only what is specific to it.

What it checks: a demo app runs a fixed scenario (screen views, custom events, a signal, an exception, an
identity, a layout capture, a flush), a local collector sink records what the plugin and the native SDK really
send, and the assertion engine (`.claude/skills/release-verification/scripts/assert-messages.mjs`) compares that with
the scenario's expectations. It is not a unit test and not a UI test.

## What is here

| File | What it does |
|---|---|
| `core/scenario.js` | The scenario: each step lists the call the app makes and the wire message it must produce (`expect`), written platform-neutral. Steps marked `optional` call an API that not every plugin has; a plugin without the method skips them. Loaded in the apps as a script (Cordova) or imported (Capacitor), and by Jest. |
| `core/suite.js` | Turns the scenario's expectations into the checks for one platform and one phase (`default`, `screen-capture-off`, `layout-config-off`). `node e2e/core/suite.js --platform ios` prints them. |
| `core/commands.js` | The adb and simctl commands, the app-log and `Podfile.lock` parsers, device picking. |
| `core/pick-simulator.js` | Picks the iOS simulator for CI (a booted iPhone, else the newest). |
| `core/report.js` | The verdict, `results-<platform>.md` and the per-batch summary of what reached the sink when a check fails. |
| `core/wait.js` | The waits every runner needs: for the app to finish and for the sink to stop receiving. |

## What stays with each plugin

| Plugin | Runner and its own files |
|---|---|
| Cordova | `applications/Demo/e2e/run.js` (builds the Cordova demo and runs it), `prepare.js` and `patches.js` (point the app at the sink and undo it), and the hook `applications/Demo/hooks/before_prepare_e2e_scenario.js` that copies `core/scenario.js` into the app's `www`, which a Cordova app can only load from. |
| Capacitor | `applications/DemoCapacitor/e2e/run.js` (also runs `applications/DemoCapacitorAngular` with `--app`), `config.js` (swaps `capacitor.config.json`), `ios-host.js` (CocoaPods host) and `suite.js` (adapts the shared checks to Capacitor: the exception name, push rows, steps for APIs it does not have yet). |

## Running it

See `applications/Demo/README.md` (Cordova) and `applications/DemoCapacitor/e2e/README.md` (Capacitor). Both runners need the
collector sink checkout (`ac-sdk-mobile-interceptor`) and a simulator or emulator. Exit code: `0` PASS, `1` FAIL, `2` INCONCLUSIVE.

The Jenkins `E2E Verification` stage runs both on an iOS simulator (Cordova first, then Capacitor with this checkout's plugin
installed into the example app). Android is run by hand.

## A runner has to do the following, or the first run is flaky

These came from measured failures, not from taste:

- Start from the same state every time. On Android: clear the app data and grant the notification permission before the run
  (the permission dialog covers the app on a fresh install).
- Let the app wait about 10 s after the SDK reports ready before the scenario starts (`SETTLE_MS` in the example apps,
  `settleMs` in `applications/Demo/e2e/prepare.js`): the SDK makes its own start-up messages in that time, and a scenario that
  starts sooner can overwrite the first screen.
- Wait for the sink to settle after the app goes to the background (`core/wait.js`), because the SDK posts in batches.

## Adding a plugin

Write a runner that builds the example app with the scenario switched on, points the SDK at the sink, runs the app, and calls
`core/suite.js` (`buildSuite`), `core/wait.js` and `core/report.js`. Use `applications/DemoCapacitor/e2e/run.js` as the template.
