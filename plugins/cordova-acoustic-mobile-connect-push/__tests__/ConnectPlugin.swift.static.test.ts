/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Static-source checks against `src/ios/ConnectPlugin.swift`.
 *
 * Covers ACs testable without running XCTest / a real iOS SDK:
 *  - Kill-switch config: applyKillSwitchConfig() is called twice inside
 *    enable() — before and after ConnectSDK.enable() — and applies the
 *    configured killSwitchEnabled/killSwitchUrl (from ConnectConfig.json via
 *    AcousticConnectNativeConfig.json), not a hardcoded value.
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

// Extracts a `{ ... }` block by counting braces from an opening brace, instead of
// guessing at indentation. `anchorPattern` must match text ending in the literal
// `{` that opens the block (e.g. /func\s+enable\s*\([^)]*\)\s*\{/ or
// /guard\s+let\s+self\s+else\s*\{/). A lazy regex like [\s\S]*?(?=\n    }) breaks
// as soon as ANY nested closure/guard happens to close at the same indentation as
// the outer block — which is exactly what happened when enable() grew a
// multi-line guard-else body: its closing brace could be mistaken for enable()'s
// own, silently truncating the extracted block. Brace-counting has no such
// indentation dependency, so it stays correct regardless of nesting depth.
function extractBlock(source: string, anchorPattern: RegExp): string | undefined {
    const match = anchorPattern.exec(source);
    if (!match) return undefined;
    const openBraceIndex = match.index + match[0].length - 1;
    if (source[openBraceIndex] !== '{') return undefined;
    let depth = 0;
    for (let i = openBraceIndex; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(match.index, i + 1);
        }
    }
    return undefined; // unbalanced braces — anchor's block never closes
}

const ENABLE_HEADER = /func\s+enable\s*\([^)]*\)\s*\{/;

// ── Kill-switch bypass ─────────────────────────────────────────────────────

describe('ConnectPlugin.swift — kill-switch config', () => {
    test('applyKillSwitchConfig() appears exactly once in enable(), before ConnectSDK.shared.enable(...)', () => {
        // Scope to enable() body so a future call in another method doesn't
        // satisfy this count.
        const enableBlock = extractBlock(SWIFT, ENABLE_HEADER);
        expect(enableBlock).toBeDefined();
        const matches = enableBlock!.match(/applyKillSwitchConfig\s*\(\s*\)/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBe(1);
        // No re-apply after enable(): that was a defensive guess, not a fix for an
        // observed issue on this closed-source iOS binary — dropped until there's
        // evidence the SDK actually needs it.
        expect(enableBlock!.indexOf('applyKillSwitchConfig()'))
            .toBeLessThan(enableBlock!.indexOf('ConnectSDK.shared.enable('));
    });

    test('applyKillSwitchConfig applies the configured value, not a hardcoded literal', () => {
        const block = SWIFT.match(
            /func\s+applyKillSwitchConfig[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/setConfigurableItem\s*\(\s*"KillSwitchEnabled"\s*,\s*value:\s*killSwitchEnabled\b/);
        // Must not be a hardcoded true/false literal.
        expect(block).not.toMatch(/setConfigurableItem\s*\(\s*"KillSwitchEnabled"\s*,\s*value:\s*(true|false)\b/);
    });

    test('applyKillSwitchConfig applies KillSwitchUrl via setKillSwitchURL only when enabled', () => {
        const block = SWIFT.match(
            /func\s+applyKillSwitchConfig[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/setKillSwitchURL\s*\(/);
        expect(block).toMatch(/killSwitchEnabled/);
    });

    test('killSwitchEnabled/killSwitchUrl are populated from AcousticConnectNativeConfig.json in applyRuntimeConfig', () => {
        const block = SWIFT.match(
            /func\s+applyRuntimeConfig[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/killSwitchEnabled\s*=\s*config\[\s*"killSwitchEnabled"\s*\]/);
        expect(block).toMatch(/killSwitchUrl\s*=\s*config\[\s*"killSwitchUrl"\s*\]/);
    });
});

// ── Screen-capture config ──────────────────────────────────────────────────

describe('ConnectPlugin.swift — screen-capture config', () => {
    test('applyScreenCaptureConfig() is defined but NOT called from enable() — capture stays at the SDK default pending product confirmation', () => {
        const enableBlock = extractBlock(SWIFT, ENABLE_HEADER);
        expect(enableBlock).toBeDefined();
        expect(enableBlock).not.toMatch(/applyScreenCaptureConfig\s*\(\s*\)/);
        // The function itself must still exist (kept for future use), just unused.
        expect(SWIFT).toMatch(/func\s+applyScreenCaptureConfig\s*\(/);
    });

    test('applyScreenCaptureConfig sets DisableAutoInstrumentation to true unconditionally', () => {
        // Brace-counted (extractBlock), not indentation-guessed — a lazy regex
        // terminating at the first same-indent `}` would truncate early if this
        // function ever grows a nested closure/guard, silently passing on a
        // partial match. See the ENABLE_HEADER/extractBlock comment above for why.
        const block = extractBlock(SWIFT, /func\s+applyScreenCaptureConfig\s*\([^)]*\)\s*\{/);
        expect(block).toBeDefined();
        expect(block).toMatch(/setConfigurableItem\s*\(\s*"DisableAutoInstrumentation"\s*,\s*value:\s*true\b/);
    });
});

// ── enable() thread dispatch ────────────────────────────────────────────────

describe('ConnectPlugin.swift — enable() thread dispatch', () => {
    test('enable() dispatches SDK work via Task, not inline, so the action handler returns immediately', () => {
        const enableBlock = extractBlock(SWIFT, ENABLE_HEADER);
        expect(enableBlock).toBeDefined();
        expect(enableBlock).toMatch(/Task\s*\{\s*@MainActor\s*\[weak self\]/);
        // ConnectSDK.shared.enable(...) itself must be inside that Task, not called
        // synchronously before it (that would defeat the point of deferring).
        const taskBody = enableBlock!.split(/Task\s*\{\s*@MainActor\s*\[weak self\]\s*in/)[1];
        expect(taskBody).toBeDefined();
        expect(taskBody).toMatch(/ConnectSDK\.shared\.enable\s*\(/);
    });

    test('argument validation (appKey/postURL/pushMode) still happens synchronously, before the Task', () => {
        const enableBlock = extractBlock(SWIFT, ENABLE_HEADER);
        expect(enableBlock).toBeDefined();
        const taskIndex = enableBlock!.search(/Task\s*\{\s*@MainActor\s*\[weak self\]/);
        expect(taskIndex).toBeGreaterThan(-1);
        const beforeTask = enableBlock!.slice(0, taskIndex);
        expect(beforeTask).toMatch(/appKey\.isEmpty/);
        expect(beforeTask).toMatch(/postURL\.isEmpty/);
        expect(beforeTask).toMatch(/validPushModes\.contains/);
    });

    test('enable() captures commandDelegate and callbackId before the Task, so the guard-else branch can still resolve the JS Promise if the plugin is deallocated', () => {
        const enableBlock = extractBlock(SWIFT, ENABLE_HEADER);
        expect(enableBlock).toBeDefined();
        const taskIndex = enableBlock!.search(/Task\s*\{\s*@MainActor\s*\[weak self\]/);
        expect(taskIndex).toBeGreaterThan(-1);
        const beforeTask = enableBlock!.slice(0, taskIndex);
        expect(beforeTask).toMatch(/let\s+delegate\s*=\s*commandDelegate/);
        expect(beforeTask).toMatch(/let\s+callbackId[^=]*=\s*command\.callbackId/);

        // The guard-else (self deallocated) branch must send a failure result via
        // the captured `delegate`, not silently `return` — otherwise the JS Promise
        // from AcousticConnect.enable(...) hangs forever with no resolve/reject.
        // Brace-counted rather than split on a fixed indentation depth, so this
        // stays correct regardless of how the guard-else body is indented.
        const guardElseBody = extractBlock(enableBlock!, /guard\s+let\s+self\s+else\s*\{/);
        expect(guardElseBody).toBeDefined();
        expect(guardElseBody).toMatch(/delegate\??\.send/);
        expect(guardElseBody).toMatch(/status:\s*\.error/);
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

    test('waitForEnabled times out with a user-facing error when isEnabled=false', () => {
        const block = SWIFT.match(
            /func\s+waitForEnabled[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/ACOUSTIC_INTERNAL_ERROR/);
        expect(block).toMatch(/5\s*s/);
    });

    test('waitForEnabled falls back to isEnabled when _connectIsReadyForLogging() times out', () => {
        // Covers the XPC / kill-switch accumulator-timeout scenario where the SDK
        // is functional but hasKillSwitchCompleted stays NO — the JS promise must
        // still resolve rather than leaving the app stuck.
        const block = SWIFT.match(
            /func\s+waitForEnabled[\s\S]*?(?=\n(?:    |\t)(?:private |internal |public |open |fileprivate |@objc\b|@objc\(|func |\/\/\s*MARK:|\}))/
        )?.[0];
        expect(block).toBeDefined();
        expect(block).toMatch(/ConnectSDK\.shared\.isEnabled/);
        // Success path sends .ok (not .error) on the fallback branch.
        expect(block).toMatch(/isEnabled[\s\S]*?CDVPluginResult\s*\(\s*status:\s*\.ok\s*\)/);
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
