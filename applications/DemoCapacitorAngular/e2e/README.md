# Wire verification (e2e) of DemoCapacitorAngular

This app has no runner of its own. It uses the one of [`../../DemoCapacitor/e2e`](../../DemoCapacitor/e2e/README.md) (`run.js --app .`), which runs the
Cordova demo's scenario and the same checks, against a local collector sink, on an Android device or emulator or an iOS simulator.

```bash
npm run e2e:android -- --device emulator-5554          # builds with ng build --define E2E_BUILD=true, runs, asserts
npm run e2e:ios -- --device <simulator udid>           # a booted iPhone simulator
npm run e2e:android -- --phase screen-capture-off --sdk-version 11.1.10-beta   # a capture phase (also layout-config-off)
```

- **In the app:** `src/app/e2e.ts` runs the scenario and prints the `E2E_DONE` line, only in a build with the `E2E_BUILD` define (see `angular.json`).
- **Config:** the runner swaps `capacitor.config.json` for one that points the SDK at the sink and puts yours back afterwards (`node ../DemoCapacitor/e2e/run.js restore --app .` after a killed run).
- **Push:** the push check (type 22) applies when `pushEnabled` is `true` and, on Android, `android/app/google-services.json` exists for the app id.
- **Output:** `e2e/evidence/` and `e2e/.prepare-state.json` are created by a run and are not in git.
