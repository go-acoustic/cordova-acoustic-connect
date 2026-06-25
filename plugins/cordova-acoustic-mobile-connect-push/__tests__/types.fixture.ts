/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * TypeScript compile-time fixture for `types/index.d.ts`.
 *
 * Not executed at runtime (filename does not match jest.config.js
 * `testMatch`). Picked up by tsconfig.test.json so `npm run test:strict`
 * exercises the full public surface under `tsc --strict --noImplicitAny`.
 * Any breaking change to the declared surface fails strict compilation.
 */

import AcousticConnect = require('../types');

function _publicSurfaceCompiles(): void {
    // ── Core ─────────────────────────────────────────────────────────────
    void AcousticConnect.enable('key', 'https://example.com');
    void AcousticConnect.enable('key', 'https://example.com', 'automatic');
    void AcousticConnect.enable(
        'key', 'https://example.com', 'manual',
        { iosAppGroupIdentifier: 'group.x' }
    );
    void AcousticConnect.enable(
        'key', 'https://example.com', 'automatic',
        { androidIconResName: 'ic_notification' }
    );
    void AcousticConnect.disable();
    void AcousticConnect.setLogLevel('silent');
    void AcousticConnect.setLogLevel('error');
    void AcousticConnect.setLogLevel('warn');
    void AcousticConnect.setLogLevel('info');
    void AcousticConnect.setLogLevel('verbose');

    // ── Identity ─────────────────────────────────────────────────────────
    void AcousticConnect.logIdentity('email', 'user@example.com');
    void AcousticConnect.logIdentity('email', 'user@example.com', 'loggedIn');
    void AcousticConnect.logIdentity(
        'email', 'user@example.com', 'loggedIn', { loginMethod: 'email' }
    );
    void AcousticConnect.logIdentity(
        'email', 'user@example.com', 'accountRegistered',
        { registrationMethod: 'email' }
    );
    // return type is Promise<void>
    void AcousticConnect.logIdentity('email', 'u@e.com').then((): void => {});

    // ── Push ─────────────────────────────────────────────────────────────
    void AcousticConnect.push.requestPermission();
    void AcousticConnect.push.getPermissionState();
    void AcousticConnect.push.didReceiveAuthorization(true);
    void AcousticConnect.push.didReceiveAuthorization(false, 'err');
    void AcousticConnect.push.didReceiveAuthorization(null);
    void AcousticConnect.push.didReceiveNotification(
        { s: 'string', n: 1, b: true }
    );
    void AcousticConnect.push.didReceiveResponse(
        'action', { s: 'string' }
    );

    // ── Type aliases must be exported and assignable ─────────────────────
    const mode: AcousticConnect.PushMode = 'manual';
    const level: AcousticConnect.LogLevel = 'info';
    const err: AcousticConnect.AcousticError = { code: 'X', message: 'Y' };
    const opts: AcousticConnect.EnableOptions = {};
    void mode; void level; void err; void opts;

    // ── Return-shape narrowing ───────────────────────────────────────────
    void AcousticConnect.push.getPermissionState().then(
        (s: boolean | null): void => { void s; }
    );
    void AcousticConnect.push.requestPermission().then(
        (r: { granted: boolean; error?: string }): void => { void r; }
    );
}

void _publicSurfaceCompiles;
