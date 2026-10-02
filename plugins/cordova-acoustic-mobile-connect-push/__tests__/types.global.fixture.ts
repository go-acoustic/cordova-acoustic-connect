/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * TypeScript compile-time fixture for `types/index.d.ts`.
 *
 * Not executed at runtime (filename does not match jest.config.js
 * `testMatch`). Picked up by tsconfig.test.json so `npm run test:strict`
 * exercises the full public surface under `tsc --strict --noImplicitAny`.
 * Any breaking change to the declared surface fails strict compilation.
 *
 * Deliberately a script, not a module — no top-level import/export
 * statement — so `AcousticConnect` resolves as the ambient global that
 * `export as namespace AcousticConnect` in types/index.d.ts declares. This
 * is the only supported integration pattern (README, Demo app, and the JS
 * bridge tests all use the plugin.xml-clobbered global — see
 * `<clobbers target="AcousticConnect" />` in plugin.xml); a prior version of
 * this fixture used `import AcousticConnect = require('../types')`, which
 * compiles but demonstrates a module-import pattern this package does not
 * document or support. Do not reintroduce an import/require form here.
 */

function _globalPublicSurfaceCompiles(): void {
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

    // ── SDK info ─────────────────────────────────────────────────────────
    void AcousticConnect.getSdkVersion().then((v: string): void => { void v; });
    void AcousticConnect.isSdkEnabled().then((b: boolean): void => { void b; });

    // ── Analytics ────────────────────────────────────────────────────────
    void AcousticConnect.logCustomEvent('purchase');
    void AcousticConnect.logCustomEvent('purchase', { sku: 'A1', qty: 2, gift: true });
    void AcousticConnect.logCustomEvent('purchase', { sku: 'A1' }, 2);
    void AcousticConnect.logCustomEvent('purchase').then((): void => {});
    void AcousticConnect.setCurrentScreenName('home');
    void AcousticConnect.setCurrentScreenName('home').then((): void => {});
    void AcousticConnect.flushQueues();
    void AcousticConnect.flushQueues().then((): void => {});
    void AcousticConnect.logClickEvent('btnSignup');
    void AcousticConnect.logClickEvent('btnSignup', { plan: 'pro', seats: 3, trial: true });
    void AcousticConnect.logClickEvent('btnSignup').then((): void => {});
    void AcousticConnect.logTextChangeEvent('txtEmail');
    void AcousticConnect.logTextChangeEvent('txtEmail', { text: 'abc' });
    void AcousticConnect.logTextChangeEvent('txtName', { text: 'Ada', masked: false });
    void AcousticConnect.logTextChangeEvent('txtEmail').then((): void => {});
    const textOpts: AcousticConnect.TextChangeOptions = { text: 'a', masked: true };
    void textOpts;
    void AcousticConnect.logSignal({ a: 1 });
    void AcousticConnect.logSignal({ signalContent: { signalType: 'pageview' }, tags: ['a', 'b'] }, 1);
    void AcousticConnect.logSignal({ a: null }).then((): void => {});
    void AcousticConnect.logExceptionEvent('boom');
    void AcousticConnect.logExceptionEvent('boom', 'stack');
    void AcousticConnect.logExceptionEvent('boom', 'stack', true).then((): void => {});
    void AcousticConnect.logScreenViewContextLoad('detail');
    void AcousticConnect.logScreenViewContextLoad('detail', 'home');
    void AcousticConnect.logScreenViewContextLoad('detail', null);
    void AcousticConnect.logScreenViewContextUnload('detail');
    void AcousticConnect.logScreenViewContextUnload('detail', 'home');
    void AcousticConnect.logScreenViewContextUnload('detail').then((): void => {});

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

    // ── Runtime configuration items ──────────────────────────────────────
    void AcousticConnect.setConfigItem('DisplayLogging', true, 'EOCore');
    void AcousticConnect.setConfigItem('PostMessageTimeInterval', 30, 'EOCore');
    void AcousticConnect.setConfigItem('Key', 'text', 'Tealeaf').then((): void => {});
    // the result has the type of the default, whether the default is a literal or not
    void AcousticConnect.getConfigItem('DisplayLogging', false, 'EOCore').then((v: boolean): void => { void v; });
    void AcousticConnect.getConfigItem('Key', 'fallback', 'EOCore').then((v: string): void => { void v; });
    void AcousticConnect.getConfigItem('PostMessageTimeInterval', 0, 'EOCore').then((v: number): void => { void v; });

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

void _globalPublicSurfaceCompiles;