/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for the suite generator (applications/Demo/e2e/suite.js): the e2e scenario's
 * wire expectations turned into a manifest for the release-verification assertion engine,
 * one per platform and capture phase.
 *
 * The decisive tests run the generated manifest through the REAL engine against synthetic
 * "ideal" captures built from the shapes seen on a device, so the generator and the engine
 * cannot drift apart.
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const DEMO = join(__dirname, '..', '..', '..', 'applications', 'Demo');
const ENGINE = join(__dirname, '..', '..', '..', '.claude', 'skills', 'release-verification', 'scripts', 'assert-messages.mjs');

/* eslint-disable @typescript-eslint/no-var-requires */
const suite = require(join(DEMO, 'e2e', 'suite.js'));
const scenario = require(join(DEMO, 'www', 'js', 'e2e', 'scenario.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

type Row = Record<string, any>;
type Msg = { batchSeq: number; index: number; type: number; receivedAt: string; message: Record<string, any> };

// ── synthetic captures, shaped like the ones seen on a device ─────────────────────────

function ideal(platform: 'ios' | 'android', opts: { layout?: boolean; leak?: boolean; typedAndroid?: boolean; flatIosSignal?: boolean } = {}): Msg[] {
    const ios = platform === 'ios';
    const wrap = (v: Record<string, unknown>) => (ios ? { value: v } : v);
    // Android delivers every custom-event value as a string; iOS keeps JSON types.
    const asWire = (v: Record<string, unknown>) =>
        ios || opts.typedAndroid ? v : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)]));
    let i = 0;
    const m = (type: number, message: Record<string, any>): Msg => ({ batchSeq: 1, index: i++, type, receivedAt: 'x', message });
    const out: Msg[] = [];
    out.push(m(22, { pushRegistration: { mobileProvider: ios ? 'APN' : 'FCM' } }));
    out.push(m(1, { clientState: {} }));
    out.push(m(2, { screenview: { type: 'LOAD', name: 'e2e_checkout', class: 'C', referrer: 'e2e_cart' } }));
    out.push(m(5, { customEvent: { name: 'e2e_purchase', data: wrap(asWire({ sku: 'A1', qty: 2, gift: true })) } }));
    out.push(m(5, { customEvent: { name: 'click', data: wrap(asWire({ controlId: 'e2e_btn', screen: 'e2e' })) } }));
    out.push(m(5, {
        customEvent: {
            name: 'textChange',
            data: wrap(asWire({ controlId: 'e2e_txt', text: opts.leak ? scenario.SECRET_TEXT : 'X'.repeat(scenario.SECRET_TEXT.length), masked: true })),
        },
    }));
    // iOS nests a logSignal payload under signal.data.value; Android puts it at the root (captured on devices)
    const signalPayload = { signalContent: { signalType: 'e2e', url: 'https://e2e.example.com/checkout' }, cart: { items: 3, total: 24.99 }, audience: [{ name: 'Account ID', value: '42' }] };
    out.push(m(21, { signal: ios && !opts.flatIosSignal ? { data: { value: signalPayload } } : signalPayload }));
    // Android carries the stack in stackTrace; iOS has no call stack in an NSException, so it logs
    // "(null)" there and the stack travels in data.stacktrace (both captured on devices)
    out.push(m(6, { exception: ios
        ? { name: 'Cordova Plugin', description: 'e2e exception', unhandled: false, stackTrace: '(null)', data: { stacktrace: 'Error: e2e\n    at e2e.js:1' } }
        : { name: 'Cordova Plugin', description: 'e2e exception', unhandled: false, stackTrace: 'Error: e2e\n    at e2e.js:1', data: {} } }));
    out.push(m(21, { signal: { loginMethod: 'email', identifierName: 'Email' } }));
    out.push(m(2, { screenview: { type: 'UNLOAD', name: 'e2e_cart', class: 'C', referrer: 'e2e_checkout' } }));
    if (opts.layout) out.push(m(10, { layout: { name: 'e2e', controls: [{ id: '1' }] } }));
    return out;
}

// Runs the manifest through the real (ESM) engine in a child process.
function evaluate(manifest: Row[], messages: Msg[], platform?: string) {
    const script = `
        import { evaluateManifest } from ${JSON.stringify('file://' + ENGINE)};
        let raw = ''; for await (const c of process.stdin) raw += c;
        const { manifest, messages, platform } = JSON.parse(raw);
        const r = evaluateManifest(manifest, messages, { platform });
        process.stdout.write(JSON.stringify({ pass: r.pass, counts: r.counts, entries: r.entries.map((e) => ({ name: e.name, status: e.status, detail: e.result?.detail, reason: e.reason })) }));
    `;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        input: JSON.stringify({ manifest, messages, platform }), encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`engine failed: ${run.stderr}`);
    return JSON.parse(run.stdout) as { pass: boolean; counts: { pass: number; fail: number; na: number }; entries: Array<{ name: string; status: string; detail?: string; reason?: string }> };
}

// ── structure ───────────────────────────────────────────────────────────────────────────

describe('phases', () => {
    it('lists the capture settings each phase needs in ConnectConfig.json', () => {
        expect(Object.keys(suite.PHASES)).toEqual(['default', 'screen-capture-off', 'layout-config-off']);
        expect(suite.PHASES.default.connectConfig).toEqual({});
        expect(suite.PHASES['screen-capture-off'].connectConfig).toEqual({ ScreenCaptureEnabled: false });
        expect(suite.PHASES['layout-config-off'].connectConfig)
            .toEqual({ layoutConfigIos: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } } } });
    });

    it('runs the capture-off phases on iOS only: they are not run on Android yet', () => {
        expect(suite.appliesTo('ios', 'screen-capture-off')).toBe(true);
        expect(suite.appliesTo('android', 'screen-capture-off')).toBe(false);
        expect(suite.appliesTo('android', 'default')).toBe(true);
        expect(suite.appliesTo('ios', 'default')).toBe(true);
    });

    it('refuses to build a suite for a phase that does not apply, and says why', () => {
        expect(() => suite.buildSuite({ platform: 'android', phase: 'screen-capture-off' })).toThrow('not run on Android');
    });

    it.each([
        [{ platform: 'windows' }, 'platform must be'],
        [{ platform: 'ios', phase: 'nope' }, 'phase must be'],
    ])('rejects %j', (args, message) => {
        expect(() => suite.buildSuite(args)).toThrow(message);
    });
});

describe('default suite', () => {
    const android: Row[] = suite.buildSuite({ platform: 'android' });
    const ios: Row[] = suite.buildSuite({ platform: 'ios' });

    it.each([['android', android], ['ios', ios]])('%s: row names are unique and every row either checks or explains why not', (_p, rows) => {
        const names = rows.map((r) => r.name);
        expect(new Set(names).size).toBe(names.length);
        for (const r of rows) {
            expect(Boolean(r.check) !== Boolean(r.na)).toBe(true);
            if (r.na) expect(r.na.length).toBeGreaterThan(20);
        }
    });

    it.each([['android', android], ['ios', ios]])('%s: every scenario step that expects something is represented', (_p, rows) => {
        const stepsWithWire = scenario.STEPS.filter((s: { expect: unknown[] }) => s.expect.length > 0).map((s: { id: string }) => s.id);
        for (const id of stepsWithWire) {
            expect(rows.some((r) => r.name.startsWith(id + ':'))).toBe(true);
        }
    });

    it('android: custom-event values are expected as strings, on the flat shape', () => {
        const qty = android.find((r) => r.eventName === 'e2e_purchase' && r.path === 'qty')!;
        expect(qty).toMatchObject({ check: 'value', platform: 'android', type: 5, expected: '2', jsonType: 'string' });
        const gift = android.find((r) => r.eventName === 'e2e_purchase' && r.path === 'gift')!;
        expect(gift).toMatchObject({ expected: 'true', jsonType: 'string' });
    });

    it('ios: custom-event values keep their JSON types, on the wrapped shape', () => {
        const qty = ios.find((r) => r.eventName === 'e2e_purchase' && r.path === 'qty')!;
        expect(qty).toMatchObject({ check: 'value', platform: 'ios', type: 5, expected: 2, jsonType: 'number' });
        const gift = ios.find((r) => r.eventName === 'e2e_purchase' && r.path === 'gift')!;
        expect(gift).toMatchObject({ expected: true, jsonType: 'boolean' });
    });

    it('signal rows keep real types on both platforms but read each platform\'s own shape', () => {
        for (const [platform, rows] of [['android', android], ['ios', ios]] as Array<[string, Row[]]>) {
            const total = rows.find((r) => r.type === 21 && r.path === 'cart.total')!;
            expect(total).toMatchObject({ expected: 24.99, jsonType: 'number', platform });
        }
    });

    it('has no row left that is flagged as not captured: every shape was seen on both platforms', () => {
        for (const rows of [android, ios]) {
            expect(rows.filter((r) => r.name.includes('not yet captured from Cordova'))).toHaveLength(0);
        }
    });

    it('reads the exception stack where each platform puts it', () => {
        expect(android.find((r) => r.type === 6 && r.path === 'stackTrace')).toMatchObject({ expected: 'Error: e2e\n    at e2e.js:1', jsonType: 'string' });
        expect(ios.find((r) => r.type === 6 && r.path === 'data.stacktrace')).toMatchObject({ expected: 'Error: e2e\n    at e2e.js:1', jsonType: 'string' });
        expect(android.some((r) => r.path === 'data.stacktrace')).toBe(false);
        expect(ios.some((r) => r.type === 6 && r.path === 'stackTrace')).toBe(false);
    });

    it('asserts the exception on both platforms with its real types', () => {
        for (const rows of [android, ios]) {
            const unhandled = rows.find((r) => r.type === 6 && r.path === 'unhandled')!;
            expect(unhandled).toMatchObject({ check: 'value', expected: false, jsonType: 'boolean' });
            expect(unhandled.platform).toBeUndefined();
            expect(rows.find((r) => r.type === 6 && r.path === 'description')).toMatchObject({ expected: 'e2e exception', jsonType: 'string' });
        }
    });

    it('keeps the secret text out of every row name (only the leak check carries it, as the thing to look for)', () => {
        for (const rows of [android, ios]) {
            expect(rows.map((r) => r.name).join('\n')).not.toContain(scenario.SECRET_TEXT);
            const carrying = rows.filter((r) => JSON.stringify(r).includes(scenario.SECRET_TEXT));
            expect(carrying.map((r) => r.check)).toEqual(['payload-excludes']);
        }
    });

    it('android: asserts the layout has controls (the pinned SDK sends it)', () => {
        const layout = android.find((r: any) => r.check === 'layout-controls');
        expect(layout).toBeDefined();
        expect(layout!.na).toBeUndefined();
    });

    it('no version of the Android SDK is named in the suite: the plugin pins one and the suite tests that one', () => {
        expect(JSON.stringify(android)).not.toMatch(/\d+\.\d+\.\d+-?beta/);
    });

    it('ios: requires the wrapped shape for the logSignal payload rows and for nothing else', () => {
        const strict = ios.filter((r: any) => r.shape === 'wrapped');
        expect(strict.length).toBeGreaterThan(0);
        for (const r of strict) {
            expect(r.type).toBe(21);
            expect(r.platform).toBe('ios');
            expect(['signalContent.signalType', 'cart.items', 'cart.total']).toContain(r.path);
        }
        // the identity signal is never wrapped, so its row must stay lenient
        expect(ios.find((r: any) => r.type === 21 && r.path === 'loginMethod')!.shape).toBeUndefined();
    });

    it('android: has no shape requirement', () => {
        expect(android.some((r: any) => r.shape !== undefined)).toBe(false);
    });

    it('ios: asserts the layout has controls', () => {
        expect(ios.find((r) => r.check === 'layout-controls')).toBeDefined();
    });

    it('both platforms assert the session start (type 1): iOS sends it too, seen on a simulator', () => {
        for (const rows of [android, ios]) {
            expect(rows.find((r) => r.name.includes('session start'))).toMatchObject({ check: 'type-present', type: 1 });
        }
    });

    it('both platforms assert the push registration', () => {
        for (const rows of [android, ios]) {
            expect(rows.find((r) => r.check === 'type-present' && r.type === 22)).toBeDefined();
        }
    });
});

describe('capture-off suites (ios)', () => {
    for (const phase of ['screen-capture-off', 'layout-config-off']) {
        it(`${phase}: no layout, but the screen views the app logs are still there`, () => {
            const rows: Row[] = suite.buildSuite({ platform: 'ios', phase });
            expect(rows.find((r) => r.check === 'type-absent' && r.type === 10)).toBeDefined();
            expect(rows.filter((r) => r.check === 'screenview-present').map((r) => r.state)).toEqual(['LOAD', 'UNLOAD']);
            expect(rows.some((r) => r.check === 'layout-controls')).toBe(false);
        });
    }
});

// ── through the real engine ─────────────────────────────────────────────────────────────

// `.claude` is not part of the public mirror of this repository (Jenkinsfile excludes it), so
// there the whole skills folder is absent and these tests skip instead of failing for someone who
// runs `npm test` in it. Where the folder exists, a missing engine is a real failure (the file
// was moved or renamed), so these tests do not skip silently.
const SKILLS_DIR = join(__dirname, '..', '..', '..', '.claude', 'skills');
const describeIfEnginePresent = existsSync(SKILLS_DIR) ? describe : describe.skip;

describeIfEnginePresent('the generated suites against the real engine', () => {
    it('finds the assertion engine where the skill keeps it', () => {
        expect(existsSync(ENGINE)).toBe(true);
    });

    it('ios: an ideal capture passes', () => {
        const result = evaluate(suite.buildSuite({ platform: 'ios' }), ideal('ios', { layout: true }));
        expect(result.entries.filter((e) => e.status === 'FAIL')).toEqual([]);
        expect(result.pass).toBe(true);
    });

    it('android: an ideal capture passes, layout included', () => {
        const result = evaluate(suite.buildSuite({ platform: 'android' }), ideal('android', { layout: true }));
        expect(result.entries.filter((e) => e.status === 'FAIL')).toEqual([]);
        expect(result.pass).toBe(true);
        expect(result.counts.na).toBe(0);
    });

    it('android: a capture without a layout fails, so a missing layout is noticed', () => {
        const result = evaluate(suite.buildSuite({ platform: 'android' }), ideal('android'));
        expect(result.pass).toBe(false);
        expect(result.entries.some((e) => e.status === 'FAIL' && e.name.includes('layout'))).toBe(true);
    });

    it('the iOS suite fails on an Android-shaped capture: the shapes differ and the suite says so', () => {
        const result = evaluate(suite.buildSuite({ platform: 'ios' }), ideal('android', { layout: true }));
        expect(result.pass).toBe(false);
        expect(result.entries.some((e) => e.status === 'FAIL' && e.name.includes('e2e_purchase'))).toBe(true);
    });

    it('the Android suite fails when a number arrives as a real number: a platform that stopped stringifying must be noticed', () => {
        const result = evaluate(suite.buildSuite({ platform: 'android' }), ideal('android', { typedAndroid: true }));
        expect(result.pass).toBe(false);
        expect(result.entries.some((e) => e.status === 'FAIL' && e.name.includes('qty'))).toBe(true);
    });

    it('a leaked plaintext text fails the suite on the leak row', () => {
        const result = evaluate(suite.buildSuite({ platform: 'ios' }), ideal('ios', { layout: true, leak: true }));
        expect(result.pass).toBe(false);
        expect(result.entries.filter((e) => e.status === 'FAIL').map((e) => e.name).join('|')).toContain('secret text appears nowhere');
    });

    it('a missing exception message fails the exception rows and nothing else', () => {
        const messages = ideal('ios', { layout: true }).filter((m) => m.type !== 6);
        const failed = evaluate(suite.buildSuite({ platform: 'ios' }), messages).entries.filter((e) => e.status === 'FAIL');
        const exceptionRows = suite.buildSuite({ platform: 'ios' }).filter((r: { type?: number }) => r.type === 6).length;
        expect(exceptionRows).toBeGreaterThan(0);
        expect(failed).toHaveLength(exceptionRows);
        for (const f of failed) expect(f.name).toContain('exception');
    });

    it('an exception reported as unhandled fails, so the flag is really checked', () => {
        const messages = ideal('android').map((m) => m.type === 6 ? { ...m, message: { exception: { ...m.message.exception, unhandled: true } } } : m);
        const failed = evaluate(suite.buildSuite({ platform: 'android' }), messages).entries.filter((e) => e.status === 'FAIL');
        expect(failed.map((f) => f.name).join('|')).toContain('unhandled');
    });

    it('a signal and the identity signal are both found although both are type 21', () => {
        const result = evaluate(suite.buildSuite({ platform: 'ios' }), ideal('ios', { layout: true }));
        const byName = (part: string) => result.entries.find((e) => e.name.includes(part))!;
        expect(byName('cart.total').status).toBe('PASS');
        expect(byName('loginMethod').status).toBe('PASS');
    });

    it.each(['screen-capture-off', 'layout-config-off'])('ios %s: passes without a layout and fails when a layout arrives', (phase) => {
        const manifest = suite.buildSuite({ platform: 'ios', phase });
        expect(evaluate(manifest, ideal('ios')).pass).toBe(true);
        expect(evaluate(manifest, ideal('ios', { layout: true })).pass).toBe(false);
    });
});
