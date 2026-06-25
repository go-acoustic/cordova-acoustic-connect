---
name: implementation
description: Full JIRA ticket workflow for the Acoustic Connect Cordova plugin —
  investigate, TDD, implement, validate, and raise a PR
---

# JIRA Ticket Implementation Skill

End-to-end workflow for implementing a JIRA ticket in the
`cordova-acoustic-connect` plugin. Follow every step in order.

## When to Use

- Implementing a new feature ticket (`CA-XXXXXX`)
- Fixing a bug ticket with a clear acceptance criterion
- Any work that will result in a pull request against `develop`

---

## Step 1: Understand the Ticket

Before touching any code:

1. Read the JIRA ticket description, acceptance criteria, and any linked spec.
2. Identify which layer is affected:
   - **JS bridge** (`www/AcousticConnect.js`) — unified JS API for Cordova apps
   - **Android native** (`src/android/`) — Kotlin `CordovaPlugin` → `Connect.push` (FCM)
   - **iOS native** (`src/ios/`) — Swift `CDVPlugin` → `ConnectSDK.shared.push` (APNs)
   - **Plugin manifest** (`plugin.xml`) — wires src/ ↔ www/, declares frameworks
   - **Demo app** (`applications/Demo/`) — build verification
3. Clarify anything ambiguous before proceeding.

---

## Step 2: Explore the Codebase

```bash
# Find JS bridge methods
grep -n "cordova.exec\|exports\." www/AcousticConnect.js

# Find Android Kotlin classes
find src/android -name "*.kt" | xargs grep -l "CordovaPlugin\|execute"

# Find iOS Swift classes
find src/ios -name "*.swift" | xargs grep -l "CDVPlugin\|commandDelegate"

# Find TypeScript definitions
cat types/index.d.ts

# Inspect plugin.xml wiring
cat plugin.xml
```

Read the source files and existing tests before writing a single line of new code.

---

## Step 3: Write Failing Tests First (TDD)

For **new features** and **bug fixes**, always write the test before the
implementation. See the [unit-test](../unit-test/SKILL.md) skill for full patterns.

### New feature — JS bridge

```javascript
// www/__tests__/AcousticConnect.test.js
const AcousticConnect = require('../AcousticConnect');

describe('AcousticConnect.registerPush', () => {
  beforeEach(() => {
    global.cordova = { exec: jest.fn((success) => success({ channelId: 'ch-1' })) };
  });

  it('calls cordova.exec with registerPush action', () => {
    AcousticConnect.registerPush({}, jest.fn(), jest.fn());
    expect(global.cordova.exec).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      'AcousticConnect',
      'registerPush',
      [expect.any(Object)]
    );
  });
});
```

Run to confirm it fails:

```bash
npm test -- --testPathPattern="AcousticConnect" --no-coverage
```

### Bug fix

Write one `it` block that reproduces the bug. Confirm it fails before touching the fix:

```javascript
// This test should FAIL before the fix, then PASS after
it('calls error callback when token is empty', () => {
  const errorCb = jest.fn();
  AcousticConnect.registerPush({ token: '' }, jest.fn(), errorCb);
  expect(errorCb).toHaveBeenCalled();
});
```

---

## Step 4: Implement the Feature or Fix

Apply the minimum change needed to make the failing tests pass.

### Layer-specific rules

| Layer | Language | Rule |
|---|---|---|
| `www/AcousticConnect.js` | JavaScript | Calls `cordova.exec(success, error, 'AcousticConnect', action, args)` |
| `types/index.d.ts` | TypeScript | Matches every public function in `www/` exactly |
| `src/android/` | Kotlin | `CordovaPlugin` subclass; route actions via `execute()`; call `Connect.push` |
| `src/ios/` | Swift | `CDVPlugin` subclass; route actions via `@objc func`; call `ConnectSDK.shared.push` |
| `plugin.xml` | XML | Declare every `<source-file>`, `<framework>`, `<config-file>` change |

### Push actions — both platforms

Built-in actions to support: `OPEN_URL`, `OPEN_DIALER`, `OPEN_APP`.

| Platform | API entry point | Auto-push method |
|---|---|---|
| Android | `Connect.push` (Kotlin) | Override `FirebaseMessagingService` via SDK |
| iOS | `ConnectSDK.shared.push` (Swift) | `UNUserNotificationCenterDelegate` via SDK |

### Copyright header

Add to every new file:

```swift
/*
 **********************************************************************************************
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any intellectual or
 * industrial property rights of Acoustic, L.P. except as may be provided in an agreement with
 * Acoustic, L.P. Any unauthorized copying or distribution of content from this file is
 * prohibited.
 **********************************************************************************************
 */
```

---

## Step 5: Verify Tests Pass

```bash
# Re-run targeted test
npm test -- --testPathPattern="AcousticConnect" --no-coverage

# Run full suite
npm test

# Verify cordova build succeeds after native changes
cd applications/Demo && cordova build android
```

If a test fails unexpectedly, use the [fix-failing-test](../fix-failing-test/SKILL.md) skill.

---

## Step 6: Run Full Validation

```bash
.claude/skills/implementation/validate.sh
```

This runs in order:

1. **TypeScript type check** — ensures `types/index.d.ts` is valid
2. **ESLint** — lints `www/` and `types/`
3. **Unit tests** — Jest suite with coverage
4. **Demo app build** — `cordova build android` in `applications/Demo/`

Fix any type errors or lint violations before proceeding.

---

## Step 7: Create the Pull Request

```bash
.claude/skills/implementation/create-pr.sh CA-XXXXXX "Brief description"
```

Example:

```bash
.claude/skills/implementation/create-pr.sh CA-131254 "Add manual push registration support for Android"
```

After creating the PR:

1. Monitor CI — resolve any SonarQube critical/blocker issues
2. Verify both Android and iOS build stages pass in Jenkins
3. Mark the PR ready for review when all checks pass
4. Add the PR link to the JIRA ticket
5. Move the JIRA ticket to **In Review**

---

## Quick Reference

```bash
# Run a specific test file
npm test -- --testPathPattern="AcousticConnect"

# Run all tests with coverage
npm test -- --coverage

# TypeScript type check
npx tsc --noEmit

# Lint www/ and types/
npx eslint www types --ext .js,.ts

# Build demo app (Android)
cd applications/Demo && cordova build android

# Build demo app (iOS, macOS only)
cd applications/Demo && cordova build ios --emulator

# Full validation
.claude/skills/implementation/validate.sh

# Create PR
.claude/skills/implementation/create-pr.sh CA-XXXXXX "description"
```

## Related Skills

| Skill | When to reach for it |
|---|---|
| [unit-test](../unit-test/SKILL.md) | Detailed Jest patterns — mocking cordova.exec, async callbacks |
| [fix-failing-test](../fix-failing-test/SKILL.md) | A test is failing and needs iterative diagnosis |
| [diagnose-test-results](../diagnose-test-results/SKILL.md) | Reading Jest, Gradle, or xcodebuild output |
