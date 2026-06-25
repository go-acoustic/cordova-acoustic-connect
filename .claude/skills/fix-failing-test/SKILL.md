---
name: fix-failing-test
description: Autonomous iteration workflow for diagnosing and fixing failing tests
  in the Acoustic Connect Cordova plugin (JS bridge, Android native, iOS native)
---

# Fix Failing Test Skill

Autonomously iterate on a failing test — run it, analyze the
error, implement a fix, re-run, and repeat until it passes
or a maximum number of attempts is reached.

## When to Use

- Fix a specific failing test in the JS bridge, Android native layer, or iOS native layer
- Iterate autonomously on a test fix (run → analyze → fix → re-run)
- Determine whether a failure is in test code or plugin code

For **diagnosis only** (no code changes), use the
[diagnose-test-results](../diagnose-test-results/SKILL.md) skill instead.

## Test Layers and Locations

| Layer | Path | Runner |
|---|---|---|
| JS bridge | `www/__tests__/*.test.js` | Jest (`npm test`) |
| Android native | `src/android/` | Gradle unit tests |
| iOS native | `src/ios/` | XCTest (`xcodebuild test`) |
| Integration | `applications/Demo/` | `cordova build android/ios` |

## Workflow

### 1. Run the failing test

**JS bridge (Jest):**

```bash
# Run a specific test file
npm test -- --testPathPattern="AcousticConnect" 2>&1 | tee /tmp/test-output.txt

# Run a single test by name
npm test -- --testNamePattern="calls cordova.exec with register action" --no-coverage 2>&1 | tee /tmp/test-output.txt

# Verbose output
npm test -- --testPathPattern="AcousticConnect" --verbose 2>&1 | tee /tmp/test-output.txt
```

**Android native (Gradle):**

```bash
cd applications/Demo
cordova platform add android || true
cd platforms/android
./gradlew :CordovaLib:test 2>&1 | tee /tmp/test-output.txt
# or for plugin-specific tests if a test module exists:
./gradlew test --tests "co.acoustic.mobile.connect.cordova.*" 2>&1 | tee /tmp/test-output.txt
```

**iOS build verification:**

```bash
cd applications/Demo
cordova build ios --verbose 2>&1 | tee /tmp/test-output.txt
```

### 2. Analyze the error

**JS bridge failures:**

- **Assertion failure** — `Expected: X  Received: Y` with file + line number
- **`cordova.exec` not called** — mock not set up; add `jest.spyOn(cordova, 'exec')`
- **Module not found** — wrong `require` path; check `www/` relative imports
- **Async not awaited** — test resolves before the callback fires; use
  `jest.fn().mockImplementation((_, __, ___, success) => success(...))`

**Android native failures:**

- **Build error** — Kotlin compile error in `src/android/`; fix before re-running
- **`ClassNotFoundException`** — plugin class not registered in `plugin.xml`
- **Mockito error** — `InvalidUseOfMatchersException`; check mixed raw/matcher args

**iOS failures:**

- **Build error** — Swift compile error in `src/ios/`
- **Missing framework** — `ConnectSDK` not linked; check `plugin.xml` framework declaration
- **`No such module 'Cordova'`** — CDVPlugin header not found; check the Cordova framework path in the xcode project

### 3. Determine whether the issue is in test code or plugin code

Do not assume the plugin is buggy. Ask:

- Is `cordova.exec` properly mocked before the call under test?
- For JS: is the callback argument order correct (success, error)?
- For Android/iOS: is this a build config issue rather than a logic bug?
- Is there module-level state not reset between tests?

### 4. Implement a fix

**Common JS bridge fixes:**

```javascript
// Missing cordova.exec mock
beforeEach(() => {
  global.cordova = {
    exec: jest.fn((success, error, service, action, args) => success())
  };
});

// Wrong callback invocation
// cordova.exec(successCb, errorCb, 'AcousticConnect', 'registerPush', [options])
// The mock must call successCb, not errorCb, for success cases
```

**Common Android fixes:**

- Guard null `CallbackContext` before calling `.success()` / `.error()`
- Ensure `plugin.xml` declares the correct `<source-file>` path for Kotlin files
- Wrap FCM registration in the correct Kotlin coroutine scope

**Common iOS fixes:**

- Guard nil delegate before calling push methods
- Ensure `ConnectSDK.shared.push` is accessed on the main thread
- Check that APNs token is converted correctly (`Data` → hex string)

### 5. Re-run and iterate

Re-run the same command after each change. If the test still fails:

- Note what you tried and why you thought it would work
- Note the new error (it may differ from the original)
- Try a different approach
- Continue until the test passes or you have made **5 attempts**

Once the targeted test passes, run the full suite to confirm nothing else broke:

```bash
npm test 2>&1 | tee /tmp/full-suite-output.txt
```

### 6. Present results

**On success**: Show the final diff and explain the root cause in 2–3 sentences.

**After 5 failed attempts**: Stop. Summarise what the original error was, each
approach tried, your current hypothesis, and what information is needed to proceed.

Do not create a PR or mark the ticket done if tests are still failing.

## Failure Patterns

| Symptom | Likely cause |
|---|---|
| `Expected: called  Received: never called` | `cordova.exec` mock not wired; spy not set up in `beforeEach` |
| Test passes alone, fails in suite | Module-level state leak; add `jest.clearAllMocks()` in `afterEach` |
| `Cannot find module './AcousticConnect'` | Wrong `require` path in test file |
| Android: `error: unresolved reference: Connect` | Missing import; `Connect` SDK dependency not in `build.gradle` |
| iOS: `No such module 'Cordova'` | CDVPlugin framework not linked in plugin.xml or xcconfig |
| `cordova build android` hangs | Gradle daemon issue; kill with `./gradlew --stop` and retry |
| `cordova build ios` fails with signing error | Code signing identity not set; add `--buildFlag="-allowProvisioningUpdates"` or use simulator target |
