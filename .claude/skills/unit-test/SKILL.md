---
name: unit-test
description: Creates Jest unit tests for the Connect Cordova plugin JS bridge,
  following TDD for new features and failing-test-first for bug fixes
---

# Unit Test Creation Skill

This skill guides writing Jest unit tests for the `www/` JS bridge layer of
the `cordova-acoustic-connect` plugin.

The native layers (`src/android/` in Kotlin, `src/ios/` in Swift) are verified
primarily through `cordova build android` / `cordova build ios` in the Demo app.
Isolated unit tests for native logic, if added, follow JUnit 4 (Android) or
XCTest (iOS) — see the implementation skill for guidance on those.

## When to Use

- **New feature (TDD)**: Write `it` blocks describing expected JS bridge
  behaviour _before_ implementing. Tests fail first, then pass after implementation.
- **Bug fix**: Write a failing `it` block that reproduces the bug _before_
  touching the fix. The fix is done when it passes.
- **Coverage gap**: Add tests for existing untested code paths in `www/`.

## Test File Placement

```
www/
├── AcousticConnect.js         # JS bridge — cordova.exec() calls
└── __tests__/
    └── AcousticConnect.test.js
types/
└── index.d.ts                  # TypeScript definitions (no runtime tests needed)
```

**Naming convention**: `<Subject>.test.js` (match the www/ source filename).

## Copyright Header

Add to every new file:

```javascript
/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any
 * intellectual or industrial property rights of Acoustic, L.P. except as may
 * be provided in an agreement with Acoustic, L.P. Any unauthorized copying or
 * distribution of content from this file is prohibited.
 */
```

## Class Structure

### JS bridge test with cordova.exec mock

The JS bridge calls `cordova.exec(successCb, errorCb, 'AcousticConnect', action, args)`.
Mock `global.cordova` in `beforeEach` so tests can run outside a real Cordova environment.

```javascript
const AcousticConnect = require('../AcousticConnect');

describe('AcousticConnect', () => {
  let execMock;

  beforeEach(() => {
    execMock = jest.fn();
    global.cordova = { exec: execMock };
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.cordova;
  });

  describe('registerPush', () => {
    it('calls cordova.exec with registerPush action and options', () => {
      const options = { mode: 'auto' };
      AcousticConnect.registerPush(options, jest.fn(), jest.fn());

      expect(execMock).toHaveBeenCalledTimes(1);
      expect(execMock).toHaveBeenCalledWith(
        expect.any(Function),  // success callback
        expect.any(Function),  // error callback
        'AcousticConnect',
        'registerPush',
        [options]
      );
    });

    it('invokes success callback with the channel ID', () => {
      execMock.mockImplementation((success) => success({ channelId: 'ch-123' }));
      const successCb = jest.fn();

      AcousticConnect.registerPush({}, successCb, jest.fn());

      expect(successCb).toHaveBeenCalledWith({ channelId: 'ch-123' });
    });

    it('invokes error callback when exec fails', () => {
      execMock.mockImplementation((_, error) => error('Registration failed'));
      const errorCb = jest.fn();

      AcousticConnect.registerPush({}, jest.fn(), errorCb);

      expect(errorCb).toHaveBeenCalledWith('Registration failed');
    });
  });
});
```

### Testing push actions (OPEN_URL, OPEN_DIALER, OPEN_APP)

```javascript
describe('handleAction', () => {
  it('calls cordova.exec with OPEN_URL action and url', () => {
    AcousticConnect.handleAction('OPEN_URL', { url: 'https://example.com' }, jest.fn(), jest.fn());

    expect(execMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      'AcousticConnect',
      'handleAction',
      [{ type: 'OPEN_URL', url: 'https://example.com' }]
    );
  });

  it('calls cordova.exec with OPEN_DIALER action and phone number', () => {
    AcousticConnect.handleAction('OPEN_DIALER', { phone: '+1234567890' }, jest.fn(), jest.fn());

    expect(execMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      'AcousticConnect',
      'handleAction',
      [{ type: 'OPEN_DIALER', phone: '+1234567890' }]
    );
  });
});
```

### Testing manual vs automatic push mode

```javascript
describe('setPushMode', () => {
  it('sends "auto" mode to native layer', () => {
    AcousticConnect.setPushMode('auto', jest.fn(), jest.fn());
    expect(execMock).toHaveBeenCalledWith(
      expect.any(Function), expect.any(Function),
      'AcousticConnect', 'setPushMode', ['auto']
    );
  });

  it('sends "manual" mode to native layer', () => {
    AcousticConnect.setPushMode('manual', jest.fn(), jest.fn());
    expect(execMock).toHaveBeenCalledWith(
      expect.any(Function), expect.any(Function),
      'AcousticConnect', 'setPushMode', ['manual']
    );
  });
});
```

## Assertions

| Intent | Jest |
|---|---|
| Function called | `expect(execMock).toHaveBeenCalledWith(...)` |
| Called N times | `expect(execMock).toHaveBeenCalledTimes(1)` |
| Never called | `expect(execMock).not.toHaveBeenCalled()` |
| Object shape | `expect(obj).toEqual(expect.objectContaining({ key: val }))` |
| Value equals | `expect(actual).toBe(expected)` (primitive) |
| Deep equals | `expect(actual).toEqual(expected)` |
| Value is null | `expect(value).toBeNull()` |

> **Argument order**: `expect(actual).toBe(expected)` — actual inside `expect(...)`.

## Mock Patterns

### Synchronous success callback

```javascript
execMock.mockImplementation((success) => success({ channelId: 'ch-1' }));
```

### Synchronous error callback

```javascript
execMock.mockImplementation((_, error) => error('Network timeout'));
```

### No callback (fire-and-forget)

```javascript
execMock.mockImplementation(() => {}); // does not call success or error
```

### Reset between tests

```javascript
afterEach(() => {
  jest.clearAllMocks();
  delete global.cordova;
});
```

## Bug Reproduction Pattern

1. Write the test so it **fails** with current code
2. Confirm the failure matches the expected wrong behaviour (not a crash)
3. Only then implement the fix
4. Re-run — the test must now pass
5. Run full suite: `npm test`

```javascript
// Bug: empty token should call error callback, but currently calls success
// This FAILS before the fix, PASSES after
it('calls error callback when APNs token is empty string', () => {
  const errorCb = jest.fn();
  AcousticConnect.registerPush({ token: '' }, jest.fn(), errorCb);
  expect(errorCb).toHaveBeenCalled();
});
```

## Running Tests Locally

```bash
# Run all tests
npm test

# Run a single test file
npm test -- --testPathPattern="AcousticConnect"

# Run a single test by name
npm test -- --testNamePattern="calls cordova.exec with registerPush"

# Run with coverage
npm test -- --coverage

# Watch mode during development
npm test -- --watch

# Skip coverage for faster iteration
npm test -- --no-coverage
```

Or use the full validation script before raising a PR:

```bash
.claude/skills/implementation/validate.sh
```

## Checklist

- [ ] Test file in `www/__tests__/` named `<Subject>.test.js`
- [ ] Copyright header present
- [ ] `describe` block names the module under test
- [ ] `beforeEach` sets up `global.cordova = { exec: jest.fn() }`
- [ ] `afterEach` calls `jest.clearAllMocks()` and removes `global.cordova`
- [ ] Every `cordova.exec` call is asserted with the correct service name `'AcousticConnect'`
- [ ] Both success and error callback paths are tested
- [ ] For bug fixes: test fails _before_ the fix, passes _after_
- [ ] Full suite still passes: `npm test`
