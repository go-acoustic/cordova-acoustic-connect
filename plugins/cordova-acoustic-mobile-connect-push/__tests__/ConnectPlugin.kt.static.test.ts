/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Static-source checks against `src/android/ConnectPlugin.kt`.
 *
 * Covers ACs testable today without running the Gradle / Robolectric
 * test runner:
 *  - Action names in the Kotlin `when` switch match the JS facade dispatch.
 *  - No `runBlocking { ... }` anywhere in the file.
 *  - `MobileServiceType.FCM` is hardcoded; no `MobileServiceType.HMS`
 *    reference (IDF Out of Scope).
 *  - `handleEnable` marshals onto the UI thread.
 *  - `Connect.push.enable` + `Connect.push.turnOnPush` ARE wired into
 *    `handleEnable` for automatic mode.
 *  - `Connect.push.turnOffPush` is NOT called — Android supports only the
 *    automatic mode at the bridge boundary (squad decision).
 *  - `androidIconResName` is resolved via `resources.getIdentifier(...)`
 *    with an `ic_launcher` fallback.
 *  - Permission flow handlers: `handlePushRequestPermission`,
 *    `handlePushGetPermissionState`, `handlePushDidReceiveAuthorization`
 *    are wired into `execute()` (no longer fall into `handlePushStub`)
 *    and call the appropriate Connect SDK surfaces with API 33+ gating
 *    + null-drop defense-in-depth + tri-state enum mapping.
 *  - The legacy `handlePushStub` / `NOT_IMPLEMENTED_YET` constants are removed.
 *  - Token forwarder actions (`pushDidRegisterWithToken`, `pushDidFailToRegister`)
 *    are removed — the JS facade no longer exposes them.
 */

export {};

import { readFileSync } from 'fs';
import { join } from 'path';

const PLUGIN_DIR = join(__dirname, '..');
const KOTLIN = readFileSync(
    join(PLUGIN_DIR, 'src/android/ConnectPlugin.kt'),
    'utf8'
);
const JS_FACADE = readFileSync(
    join(PLUGIN_DIR, 'www/AcousticConnect.js'),
    'utf8'
);

/**
 * Strip Kotlin block + line comments so absence-of-code checks ignore
 * documentation that intentionally mentions deferred patterns
 * (e.g. doc-comment that mentions deferred patterns).
 */
function stripKotlinComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');
}

const KOTLIN_CODE = stripKotlinComments(KOTLIN);

const EXPECTED_ACTIONS = [
    'enable',
    'disable',
    'setLogLevel',
    'pushRequestPermission',
    'pushGetPermissionState',
    'pushDidReceiveAuthorization',
    'pushDidReceiveNotification',
    'pushDidReceiveResponse',
    'logIdentificationEvent',
] as const;

describe('ConnectPlugin.kt — static source checks', () => {
    describe('action-name parity with JS facade', () => {
        test.each(EXPECTED_ACTIONS)(
            'JS facade dispatches "%s"',
            (action) => {
                expect(JS_FACADE).toContain(`'${action}'`);
            }
        );

        test.each(EXPECTED_ACTIONS)(
            'Kotlin file defines a constant for action "%s"',
            (action) => {
                expect(KOTLIN).toContain(`"${action}"`);
            }
        );

        test('Kotlin file uses an `ACTION_*` constant for every JS action', () => {
            const constNamePerAction: Record<string, string> = {
                'enable': 'ACTION_ENABLE',
                'disable': 'ACTION_DISABLE',
                'setLogLevel': 'ACTION_SET_LOG_LEVEL',
                'pushRequestPermission': 'ACTION_PUSH_REQUEST_PERMISSION',
                'pushGetPermissionState': 'ACTION_PUSH_GET_PERMISSION_STATE',
                'pushDidReceiveAuthorization':
                    'ACTION_PUSH_DID_RECEIVE_AUTHORIZATION',
                'pushDidReceiveNotification':
                    'ACTION_PUSH_DID_RECEIVE_NOTIFICATION',
                'pushDidReceiveResponse': 'ACTION_PUSH_DID_RECEIVE_RESPONSE',
                'logIdentificationEvent': 'ACTION_LOG_IDENTIFICATION_EVENT',
            };
            for (const [action, constName] of Object.entries(constNamePerAction)) {
                expect(KOTLIN_CODE).toContain(constName);
                // Allow the declaration to wrap across multiple lines.
                const declRegex = new RegExp(
                    `${constName}\\s*=\\s*"${action}"`
                );
                expect(KOTLIN_CODE).toMatch(declRegex);
            }
        });
    });

    describe('threading guarantees', () => {
        test('no `runBlocking` invocation in source code (comments allowed)', () => {
            expect(KOTLIN_CODE).not.toMatch(/\brunBlocking\b/);
        });

        test('handleEnable marshals SDK calls via cordova.activity.runOnUiThread', () => {
            // Find handleEnable, then assert runOnUiThread appears within it.
            const enableBlock = KOTLIN.match(
                /internal fun handleEnable[\s\S]*?\n {4}\}/
            )?.[0];
            expect(enableBlock).toBeTruthy();
            expect(enableBlock).toMatch(/activity\.runOnUiThread\s*\{/);
            expect(enableBlock).toMatch(/Connect\.init\s*\(/);
            expect(enableBlock).toMatch(/Connect\.enable\s*\(/);
        });

        test('handleDisable marshals via runOnUiThread', () => {
            const disableBlock = KOTLIN.match(
                /internal fun handleDisable[\s\S]*?\n {4}\}/
            )?.[0];
            expect(disableBlock).toBeTruthy();
            expect(disableBlock).toMatch(/activity\.runOnUiThread\s*\{/);
            expect(disableBlock).toMatch(/Connect\.disable\s*\(\)/);
        });

        test('runtime check asserts main looper inside handleEnable', () => {
            expect(KOTLIN).toMatch(
                /Looper\.myLooper\(\)\s*==\s*Looper\.getMainLooper\(\)/
            );
        });
    });

    describe('mobile service provider', () => {
        test('MobileServiceType.FCM is referenced as the hardcoded provider', () => {
            expect(KOTLIN_CODE).toMatch(/MobileServiceType\.FCM\b/);
        });

        test('MobileServiceType.HMS is NOT referenced in source code', () => {
            expect(KOTLIN_CODE).not.toMatch(/MobileServiceType\.HMS\b/);
        });

        test('no bare "HMS" identifier in source code', () => {
            expect(KOTLIN_CODE).not.toMatch(/\bHMS\b/);
        });
    });

    describe('push orchestration wired into handleEnable', () => {
        // Undefined (not '') so downstream toMatch() calls produce a clear
        // "received undefined" failure rather than silently passing against ''.
        const enableBlock =
            KOTLIN_CODE.match(/internal fun handleEnable[\s\S]*?\n {4}\}/)?.[0];

        test('handleEnable block can be extracted from source (regex guard)', () => {
            expect(enableBlock).toBeTruthy();
        });

        test('handleEnable calls Connect.push.enable(...) with MobileServiceType.FCM', () => {
            expect(enableBlock).toMatch(/Connect\.push\.enable\s*\(/);
            expect(enableBlock).toMatch(/MobileServiceType\.FCM/);
        });

        test('handleEnable calls Connect.push.turnOnPush() for automatic mode', () => {
            expect(enableBlock).toMatch(/Connect\.push\.turnOnPush\s*\(/);
        });

        test('Work<Unit> result is bridged via addOnSuccessListener / addOnFailureListener', () => {
            expect(enableBlock).toMatch(/addOnSuccessListener\s*\{/);
            expect(enableBlock).toMatch(/addOnFailureListener\s*\{/);
        });

        test('Connect.push.turnOffPush is NOT called (off mode rejected at bridge boundary)', () => {
            expect(KOTLIN_CODE).not.toMatch(/Connect\.push\.turnOffPush\s*\(/);
        });
    });

    describe('iconRes resolution', () => {
        test('androidIconResName option is read from the JS enable() options bag', () => {
            expect(KOTLIN_CODE).toMatch(/optString\(\s*"androidIconResName"/);
        });

        test('resolution uses resources.getIdentifier against the host drawable namespace', () => {
            expect(KOTLIN_CODE).toMatch(
                /getIdentifier\([^,]+,\s*"drawable"\s*,\s*packageName/
            );
        });

        test('resolution falls back to ic_launcher when requested name is missing', () => {
            expect(KOTLIN_CODE).toMatch(
                /getIdentifier\(\s*"ic_launcher"\s*,\s*"drawable"/
            );
        });
    });


    describe('permission flow handlers', () => {
        test('execute() routes pushRequestPermission to handlePushRequestPermission', () => {
            expect(KOTLIN_CODE).toMatch(
                /ACTION_PUSH_REQUEST_PERMISSION\s*->\s*\{[\s\S]*?handlePushRequestPermission\s*\(/
            );
        });

        test('execute() routes pushGetPermissionState to handlePushGetPermissionState', () => {
            expect(KOTLIN_CODE).toMatch(
                /ACTION_PUSH_GET_PERMISSION_STATE\s*->\s*\{[\s\S]*?handlePushGetPermissionState\s*\(/
            );
        });

        test('execute() routes pushDidReceiveAuthorization to handlePushDidReceiveAuthorization', () => {
            expect(KOTLIN_CODE).toMatch(
                /ACTION_PUSH_DID_RECEIVE_AUTHORIZATION\s*->\s*\{[\s\S]*?handlePushDidReceiveAuthorization\s*\(/
            );
        });

        test('handlePushRequestPermission is defined and calls Connect.push.requestNotificationPermission', () => {
            expect(KOTLIN_CODE).toMatch(/fun\s+handlePushRequestPermission\s*\(/);
            expect(KOTLIN_CODE).toMatch(
                /Connect\.push\.requestNotificationPermission\s*\(/
            );
        });

        test('handlePushRequestPermission gates on Build.VERSION.SDK_INT >= TIRAMISU', () => {
            expect(KOTLIN_CODE).toMatch(
                /Build\.VERSION\.SDK_INT\s*<\s*Build\.VERSION_CODES\.TIRAMISU/
            );
        });

        test('handlePushRequestPermission casts host activity to ComponentActivity', () => {
            expect(KOTLIN_CODE).toMatch(/activity\s+as\?\s+ComponentActivity/);
        });

        test('handlePushGetPermissionState is defined and calls Connect.push.getPushPermissionState', () => {
            expect(KOTLIN_CODE).toMatch(/fun\s+handlePushGetPermissionState\s*\(/);
            expect(KOTLIN_CODE).toMatch(
                /Connect\.push\.getPushPermissionState\s*\(/
            );
        });

        test('handlePushGetPermissionState maps PushPermissionState tri-state via enum', () => {
            expect(KOTLIN_CODE).toMatch(/PushPermissionState\.GRANTED/);
            expect(KOTLIN_CODE).toMatch(/PushPermissionState\.DENIED/);
            expect(KOTLIN_CODE).toMatch(/PushPermissionState\.NOT_DETERMINED/);
        });

        test('handlePushDidReceiveAuthorization is defined and short-circuits on JSONObject.NULL', () => {
            expect(KOTLIN_CODE).toMatch(/fun\s+handlePushDidReceiveAuthorization\s*\(/);
            expect(KOTLIN_CODE).toMatch(/JSONObject\.NULL/);
        });

        test('handlePushRequestPermission resolves a structured result on missing activity / cast failure', () => {
            const reqBlock =
                KOTLIN_CODE.match(
                    /fun\s+handlePushRequestPermission[\s\S]*?\n {4}\}/
                )?.[0];
            expect(reqBlock).toBeDefined();
            expect(reqBlock).toMatch(/put\(\s*"granted"\s*,\s*false\s*\)/);
            expect(reqBlock).toMatch(/put\(\s*"error"\s*,/);
        });

        test('no setKeepCallback(true) is used anywhere in the file', () => {
            expect(KOTLIN_CODE).not.toMatch(/setKeepCallback\s*\(\s*true\s*\)/);
        });
    });

    describe('push action cleanup', () => {
        test('handlePushStub is removed (no longer needed)', () => {
            expect(KOTLIN_CODE).not.toMatch(/fun\s+handlePushStub\s*\(/);
        });

        test('NOT_IMPLEMENTED_YET constant is removed', () => {
            expect(KOTLIN_CODE).not.toMatch(/NOT_IMPLEMENTED_YET/);
        });
    });

    describe('logIdentificationEvent handler', () => {
        test('additionalParameters is read from args[3] via optJSONObject', () => {
            expect(KOTLIN_CODE).toMatch(/args\.optJSONObject\(\s*3\s*\)/);
        });

        test('additionalParameters keys are iterated via json.keys()', () => {
            expect(KOTLIN_CODE).toMatch(/\.keys\(\)\.asSequence\(\)/);
        });

        test('no hardcoded test email address in source', () => {
            expect(KOTLIN_CODE).not.toMatch(/connectcordova@hotmail\.com/);
        });

        test('no hardcoded additionalParameters map literal in handleLogIdentificationEvent', () => {
            const handlerBlock =
                KOTLIN_CODE.match(
                    /fun\s+handleLogIdentificationEvent[\s\S]*?\n {4}\}/
                )?.[0];
            expect(handlerBlock).toBeDefined();
            expect(handlerBlock).not.toMatch(/mapOf\s*\(/);
        });

        test('handleLogIdentificationEvent dispatches via activity.runOnUiThread and calls Connect.logIdentificationEvent', () => {
            const handlerBlock =
                KOTLIN_CODE.match(
                    /fun\s+handleLogIdentificationEvent[\s\S]*?\n {4}\}/
                )?.[0];
            expect(handlerBlock).toBeDefined();
            expect(handlerBlock).toMatch(/Connect\.logIdentificationEvent\s*\(/);
            expect(handlerBlock).toMatch(/activity\.runOnUiThread\s*\{/);
        });
    });

    describe('manual-mode rejection (Android automatic-only stance)', () => {
        test('manual-mode forwarders reject with ACOUSTIC_PUSH_MODE_NOT_MANUAL', () => {
            expect(KOTLIN_CODE).toContain('ACOUSTIC_PUSH_MODE_NOT_MANUAL');
        });
    });

    describe('WorkWrapper helper', () => {
        test('WorkWrapper class is declared in the file', () => {
            expect(KOTLIN).toMatch(/class WorkWrapper\s*\(/);
        });

        test('WorkWrapper dispatches via cordova.threadPool.execute', () => {
            const wwBlock = KOTLIN
                .split(/internal class WorkWrapper/)[1] ?? '';
            expect(wwBlock).toMatch(/cordova\.threadPool\.execute\s*\{/);
        });
    });

    describe('package and class identity', () => {
        test('package matches plugin.xml <feature> android-package', () => {
            expect(KOTLIN).toMatch(
                /^package co\.acoustic\.connect\.cordova\.plugin\s*$/m
            );
        });

        test('class is named ConnectPlugin and extends CordovaPlugin', () => {
            expect(KOTLIN).toMatch(
                /class ConnectPlugin\s*:\s*CordovaPlugin\(\)/
            );
        });
    });
});
