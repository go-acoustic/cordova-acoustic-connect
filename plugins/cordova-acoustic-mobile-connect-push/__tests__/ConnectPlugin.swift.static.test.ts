/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Static-source checks against `src/ios/ConnectPlugin.swift`.
 *
 * Covers ACs testable without running XCTest / a real iOS SDK:
 *  - Kill-switch bypass: setConfigurableItem("KillSwitchEnabled", ...) is
 *    called twice inside enable() — before and after ConnectSDK.enable().
 *  - Readiness guard: _connectIsReadyForLogging() gates both waitForEnabled
 *    and logIdentificationEvent so calls before kill-switch completion are
 *    rejected with a clear error rather than silently returning false.
 *  - waitForEnabled uses a Date-based deadline (not DispatchTime) and a
 *    loop (not recursion) so deadline drift and stack growth are avoided.
 *  - applyRuntimeConfig reads AcousticConnectNativeConfig.json from www/,
 *    logs a diagnostic on missing-file and malformed-file paths, and only
 *    activates debug env vars when useRelease is explicitly false (not when
 *    the key is absent).
 *  - No deinit / removeObserver present (no matching addObserver exists).
 *  - Token forwarder actions (pushDidRegisterWithToken, pushDidFailToRegister)
 *    are absent — removed along with the JS facade methods.
 */

export {};

import { readFileSync } from 'fs';
import { join }         from 'path';

const PLUGIN_DIR = join(__dirname, '..');
const SWIFT_RAW  = readFileSync(
    join(PLUGIN_DIR, 'src/ios/ConnectPlugin.swift'),
    'utf8'
);

function stripSwiftComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');
}

const SWIFT = stripSwiftComments(SWIFT_RAW);

// ── Kill-switch bypass ─────────────────────────────────────────────────────

describe('ConnectPlugin.swift — kill-switch bypass', () => {
    test('setConfigurableItem("KillSwitchEnabled") appears twice in enable()', () => {
        // Scope to enable() body so a future call in another method doesn't
        // satisfy this count. Terminates at the first class-body-level `}` which
        // is the function's own closing brace (inner guards close at 8+ spaces).
        const enableBlock = SWIFT.match(
            /func\s+enable\s*\([\s\S]*?(?=\n(?:    |\t)\})/
        )?.[0];
        expect(enableBlock).toBeDefined();
        const matches = enableBlock!.match(/setConfigurableItem\s*\(\s*"KillSwitchEnabled"/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBe(2);
    });

    test('KillSwitchEnabled is set to false (not true)', () => {
        const enableBlock = SWIFT.match(
            /func\s+enable\s*\([\s\S]*?(?=\n(?:    |\t)\})/
        )?.[0];
        expect(enableBlock).toBeDefined();
        const matches = [...enableBlock!.matchAll(
            /setConfigurableItem\s*\(\s*"KillSwitchEnabled"\s*,\s*value:\s*(\w+)/g
        )];
        expect(matches.length).toBe(2);
        for (const m of matches) {
            expect(m[1]).toBe('false');
        }
    });
});

// ── Readiness guard ────────────────────────────────────────────────────────

describe('ConnectPlugin.swift — readiness guard', () => {
    test('waitForEnabled calls _connectIsReadyForLogging()', () => {
        expect(SWIFT).toMatch(/_connectIsReadyForLogging\s*\(\s*\)/);
    });

    test('logIdentificationEvent guards on _connectIsReadyForLogging()', () => {
        // Terminate at the next method, MARK, decorator, or class closing brace
        // at class-body indentation (4 spaces or 1 tab) so the regex can't swallow
        // the rest of the file, and works regardless of exact indent character.
        const block = SWIFT.match(
            /func\s+logIdentificationEvent[\s\S]*?(?=\n(?:    |\t)(?:func |@objc\b|@objc\(|private |internal |public |\/\/ MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/_connectIsReadyForLogging\s*\(\s*\)/);
    });

    test('waitForEnabled uses Date-based deadline, not DispatchTime', () => {
        const block = SWIFT.match(
            /func\s+waitForEnabled[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/Date\s*\(\s*\)/);
        expect(block).not.toMatch(/DispatchTime/);
    });

    test('waitForEnabled uses a loop, not recursion', () => {
        const block = SWIFT.match(
            /func\s+waitForEnabled[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/while\s+/);
        expect(block).not.toMatch(/self\?\s*\.waitForEnabled/);
    });

    test('waitForEnabled runs sleep off MainActor via Task.detached', () => {
        const block = SWIFT.match(
            /func\s+waitForEnabled[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/Task\.detached/);
        expect(block).not.toMatch(/Task\s*\{\s*@MainActor/);
    });

    test('waitForEnabled hops to MainActor only for readiness check and callback', () => {
        const block = SWIFT.match(
            /func\s+waitForEnabled[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/await\s+MainActor\.run/);
    });

    test('waitForEnabled captures commandDelegate and callbackId so JS promise resolves even if plugin is deallocated', () => {
        const block = SWIFT.match(
            /func\s+waitForEnabled[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        // delegate and callbackId are captured before Task.detached so the response
        // can be sent regardless of whether the plugin object is still alive.
        expect(block).toMatch(/let\s+delegate\s*=/);
        expect(block).toMatch(/let\s+callbackId[^=]*=/);
        expect(block).toMatch(/delegate\.send/);
    });

    test('waitForEnabled logs a diagnostic when commandDelegate is nil rather than silently dropping the callback', () => {
        const block = SWIFT_RAW.match(
            /func\s+waitForEnabled[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/commandDelegate.*nil.*NSLog|NSLog.*commandDelegate.*nil/s);
    });

    test('waitForEnabled times out with a user-facing error', () => {
        const block = SWIFT.match(
            /func\s+waitForEnabled[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/ACOUSTIC_INTERNAL_ERROR/);
        expect(block).toMatch(/5\s*s/);
    });
});

// ── applyRuntimeConfig ─────────────────────────────────────────────────────

describe('ConnectPlugin.swift — applyRuntimeConfig', () => {
    test('reads AcousticConnectNativeConfig.json from www/ subdirectory', () => {
        expect(SWIFT).toMatch(/AcousticConnectNativeConfig/);
        expect(SWIFT).toMatch(/subdirectory:\s*"www"/);
    });

    test('logs a diagnostic when config file is not found', () => {
        expect(SWIFT_RAW).toMatch(/not found.*www/i);
    });

    test('logs a diagnostic when config file is malformed', () => {
        expect(SWIFT_RAW).toMatch(/malformed/i);
    });

    test('activates debug env vars only when useRelease is explicitly false', () => {
        expect(SWIFT).toMatch(/useRelease\s*==\s*false/);
        expect(SWIFT).not.toMatch(/useRelease\s*\?\?\s*false/);
        expect(SWIFT).not.toMatch(/!\s*useRelease/);
    });

    test('sets CONNECT_DEBUG, TLF_DEBUG, and EODebug env vars', () => {
        expect(SWIFT).toMatch(/setenv\s*\(\s*"CONNECT_DEBUG"/);
        expect(SWIFT).toMatch(/setenv\s*\(\s*"TLF_DEBUG"/);
        expect(SWIFT).toMatch(/setenv\s*\(\s*"EODebug"/);
    });

    test('setenv calls are guarded by #if DEBUG — cannot run in release builds', () => {
        // Find the specific #if DEBUG block that contains setenv — not just the
        // first block in the file — so a new earlier #if DEBUG cannot mask a
        // regression where setenv is moved outside the guard.
        const allDebugBlocks = [...SWIFT_RAW.matchAll(/#if\s+DEBUG[\s\S]*?#endif/g)]
            .map(m => m[0]);
        const setenvBlock = allDebugBlocks.find(b => b.includes('setenv'));
        expect(setenvBlock).toBeDefined();
        expect(setenvBlock).toMatch(/CONNECT_DEBUG/);
        expect(setenvBlock).toMatch(/TLF_DEBUG/);
        expect(setenvBlock).toMatch(/EODebug/);
    });
});

// ── Dead code absence ──────────────────────────────────────────────────────

describe('ConnectPlugin.swift — dead code absent', () => {
    test('no deinit block present', () => {
        expect(SWIFT).not.toMatch(/\bdeinit\b/);
    });

    test('no removeObserver call present', () => {
        expect(SWIFT).not.toMatch(/removeObserver/);
    });

    test('pushDidRegisterWithToken selector is absent', () => {
        expect(SWIFT).not.toMatch(/pushDidRegisterWithToken/);
    });

    test('pushDidFailToRegister selector is absent', () => {
        expect(SWIFT).not.toMatch(/pushDidFailToRegister/);
    });
});
