/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for the Demo app's e2e scenario (applications/Demo/www/js/e2e/scenario.js).
 *
 * The scenario is the single source of truth for the release-verification e2e run:
 * it lists the plugin calls to make AND the wire messages each one must produce, so
 * the suite files for the collector sink are generated from it rather than written
 * by hand beside it.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import * as vm from 'vm';

const SCENARIO_PATH = join(__dirname, '..', '..', '..', 'applications', 'Demo', 'www', 'js', 'e2e', 'scenario.js');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const scenario = require(SCENARIO_PATH);

type Api = Record<string, jest.Mock>;

function makeApi(overrides: Record<string, jest.Mock> = {}): Api {
    const names = [
        'logScreenViewContextLoad', 'logScreenViewContextUnload', 'logCustomEvent',
        'logClickEvent', 'logTextChangeEvent', 'logSignal', 'logExceptionEvent',
        'logIdentity', 'flushQueues', 'isSdkEnabled',
    ];
    const api: Api = {};
    for (const n of names) api[n] = jest.fn().mockResolvedValue(undefined);
    api.isSdkEnabled = jest.fn().mockResolvedValue(true);
    return { ...api, ...overrides };
}

describe('scenario definition', () => {
    it('lists the steps in a fixed order with unique ids', () => {
        const ids = scenario.STEPS.map((s: { id: string }) => s.id);
        expect(ids).toEqual([
            'screen-load', 'custom-event', 'click', 'text-change', 'signal',
            'exception', 'identity', 'screen-unload', 'flush',
        ]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('gives every step a description, the plugin method it needs and a run function', () => {
        for (const step of scenario.STEPS) {
            expect(typeof step.description).toBe('string');
            expect(step.description.length).toBeGreaterThan(0);
            expect(typeof step.needs).toBe('string');
            expect(typeof step.run).toBe('function');
            expect(Array.isArray(step.expect)).toBe(true);
        }
    });

    it('masks a secret text whose plaintext is excluded from the wire', () => {
        const textStep = scenario.STEPS.find((s: { id: string }) => s.id === 'text-change');
        const exclude = textStep.expect.find((e: { check: string }) => e.check === 'payload-excludes');
        expect(exclude).toBeDefined();
        expect(exclude.text).toBe(scenario.SECRET_TEXT);
        const masked = textStep.expect.find((e: { path?: string }) => e.path === 'text');
        expect(masked.expected).toBe('X'.repeat(scenario.SECRET_TEXT.length));
        expect(masked.expected).not.toContain(scenario.SECRET_TEXT);
    });
});

describe('runScenario', () => {
    it('calls the plugin with the exact arguments, in order', async () => {
        const api = makeApi();
        const summary = await scenario.runScenario(api);

        expect(api.logScreenViewContextLoad).toHaveBeenCalledWith('e2e_checkout', 'e2e_cart');
        expect(api.logCustomEvent).toHaveBeenCalledWith('e2e_purchase', { sku: 'A1', qty: 2, gift: true });
        expect(api.logClickEvent).toHaveBeenCalledWith('e2e_btn', { screen: 'e2e' });
        expect(api.logTextChangeEvent).toHaveBeenCalledWith('e2e_txt', { text: scenario.SECRET_TEXT });
        expect(api.logSignal).toHaveBeenCalledWith({
            signalContent: { signalType: 'e2e', url: 'https://e2e.example.com/checkout' },
            cart: { items: 3, total: 24.99 },
            audience: [{ name: 'Account ID', value: '42' }],
        });
        expect(api.logExceptionEvent).toHaveBeenCalledWith('e2e exception', 'Error: e2e\n    at e2e.js:1', false);
        expect(api.logIdentity).toHaveBeenCalledWith('Email', 'e2e@example.com', 'loggedIn', { loginMethod: 'email' });
        // the screen being left is the previous one: the SDK drops an UNLOAD for a screen whose
        // LOAD is still queued, so unloading the one just loaded cannot work in a single batch
        expect(api.logScreenViewContextUnload).toHaveBeenCalledWith('e2e_cart', 'e2e_checkout');
        expect(api.flushQueues).toHaveBeenCalledTimes(1);

        expect(summary.ok).toBe(true);
        expect(summary.results.map((r: { status: string }) => r.status)).toEqual(Array(9).fill('ok'));
    });

    it('runs the steps strictly one after another', async () => {
        const order: string[] = [];
        const tracked = (name: string) => jest.fn().mockImplementation(async () => {
            order.push(name + ':start');
            await Promise.resolve();
            order.push(name + ':end');
        });
        const api = makeApi({
            logScreenViewContextLoad: tracked('load'),
            logCustomEvent: tracked('custom'),
        });
        await scenario.runScenario(api);
        expect(order.slice(0, 4)).toEqual(['load:start', 'load:end', 'custom:start', 'custom:end']);
    });

    it('records a rejected step, carries on, and reports the run as failed', async () => {
        const api = makeApi({
            logCustomEvent: jest.fn().mockRejectedValue({ code: 'ACOUSTIC_INVALID_ARGS', message: 'bad values' }),
        });
        const summary = await scenario.runScenario(api);

        const custom = summary.results.find((r: { id: string }) => r.id === 'custom-event');
        expect(custom.status).toBe('failed');
        expect(custom.error).toContain('bad values');
        expect(api.flushQueues).toHaveBeenCalledTimes(1);
        expect(summary.ok).toBe(false);
        expect(summary.failed).toBe(1);
    });

    it('marks a step unavailable, without throwing, when the plugin lacks the method', async () => {
        const api = makeApi();
        delete (api as Record<string, unknown>).logSignal;
        const summary = await scenario.runScenario(api);

        const signal = summary.results.find((r: { id: string }) => r.id === 'signal');
        expect(signal.status).toBe('unavailable');
        expect(signal.error).toContain('logSignal');
        expect(summary.ok).toBe(false);
    });

    it('turns a synchronous throw into a failed step', async () => {
        const api = makeApi({
            logClickEvent: jest.fn().mockImplementation(() => { throw new Error('boom'); }),
        });
        const summary = await scenario.runScenario(api);
        expect(summary.results.find((r: { id: string }) => r.id === 'click').status).toBe('failed');
    });
});

describe('expectations', () => {
    it('flattens every step\'s wire expectation, tagged with the step that produced it', () => {
        const list = scenario.expectations();
        expect(list.length).toBeGreaterThan(10);
        for (const e of list) {
            expect(typeof e.step).toBe('string');
            expect(typeof e.check).toBe('string');
        }
        expect(list.filter((e: { step: string }) => e.step === 'flush')).toHaveLength(0);
    });

    it('keeps typed expected values platform-neutral so a generator can adapt them', () => {
        const list = scenario.expectations();
        const qty = list.find((e: { eventName?: string; path?: string }) => e.eventName === 'e2e_purchase' && e.path === 'qty');
        const gift = list.find((e: { eventName?: string; path?: string }) => e.eventName === 'e2e_purchase' && e.path === 'gift');
        expect(qty.expected).toBe(2);
        expect(gift.expected).toBe(true);
    });

    it('has no expectation left whose wire shape has not been captured on a platform', () => {
        // signal, exception and identity were captured on Android and on an iOS simulator (2026-10-01)
        const list = scenario.expectations();
        expect(list.filter((e: { unverifiedOn?: string[] }) => (e.unverifiedOn || []).length > 0)).toEqual([]);
    });

    it('checks the exception by what it says, including the stack, not only that one arrived', () => {
        const list = scenario.expectations().filter((e: { step: string }) => e.step === 'exception');
        const name = (e: { path: unknown }) => (typeof e.path === 'string' ? e.path : 'stack');
        expect(list.map(name).sort()).toEqual(['description', 'name', 'stack', 'unhandled']);
        expect(list.find((e: { path: unknown }) => name(e) === 'description').expected).toBe('e2e exception');
        expect(list.find((e: { path: unknown }) => name(e) === 'unhandled').expected).toBe(false);
        for (const e of list) expect(e.type).toBe(6);
    });

    it('reads the stack from where each platform puts it: Android stackTrace, iOS data.stacktrace', () => {
        const stack = scenario.expectations().find((e: { step: string; path: unknown }) => e.step === 'exception' && typeof e.path !== 'string');
        expect(stack.path).toEqual({ android: 'stackTrace', ios: 'data.stacktrace' });
        expect(stack.expected).toBe('Error: e2e\n    at e2e.js:1');
    });

    it('includes the baseline push registration separately from the steps', () => {
        expect(scenario.BASELINE).toEqual([{ check: 'type-present', type: 22 }]);
    });
});

describe('waitForSdk', () => {
    it('resolves true as soon as the SDK reports it is enabled', async () => {
        const isSdkEnabled = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const sleep = jest.fn().mockResolvedValue(undefined);
        await expect(scenario.waitForSdk({ isSdkEnabled }, { maxTries: 5, sleep })).resolves.toBe(true);
        expect(isSdkEnabled).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('gives up after maxTries and resolves false', async () => {
        const isSdkEnabled = jest.fn().mockResolvedValue(false);
        const sleep = jest.fn().mockResolvedValue(undefined);
        await expect(scenario.waitForSdk({ isSdkEnabled }, { maxTries: 3, sleep })).resolves.toBe(false);
        expect(isSdkEnabled).toHaveBeenCalledTimes(3);
    });

    it('treats a rejected readiness check as "not ready yet"', async () => {
        const isSdkEnabled = jest.fn().mockRejectedValueOnce(new Error('not up')).mockResolvedValueOnce(true);
        const sleep = jest.fn().mockResolvedValue(undefined);
        await expect(scenario.waitForSdk({ isSdkEnabled }, { maxTries: 3, sleep })).resolves.toBe(true);
    });
});

describe('formatDoneLine', () => {
    it('reports a passing run on one greppable line', () => {
        const line = scenario.formatDoneLine({ ok: true, failed: 0, unavailable: 0, results: Array(9).fill({ status: 'ok' }) });
        expect(line).toBe('E2E_DONE status=pass steps=9 failed=0 unavailable=0');
    });

    it('reports failures and unavailable steps', () => {
        const line = scenario.formatDoneLine({
            ok: false, failed: 1, unavailable: 2,
            results: [{ status: 'ok' }, { status: 'failed' }, { status: 'unavailable' }, { status: 'unavailable' }],
        });
        expect(line).toBe('E2E_DONE status=fail steps=4 failed=1 unavailable=2');
    });

    it('reports a missing plugin as its own status', () => {
        expect(scenario.formatDoneLine({ ok: false, noPlugin: true, failed: 0, unavailable: 0, results: [] }))
            .toBe('E2E_DONE status=no-plugin steps=0 failed=0 unavailable=0');
    });

    it('reports an SDK that never became ready as its own status', () => {
        expect(scenario.formatDoneLine({ ok: false, timeout: true, failed: 0, unavailable: 0, results: [] }))
            .toBe('E2E_DONE status=sdk-timeout steps=0 failed=0 unavailable=0');
    });
});

describe('e2e bootstrap (applications/Demo/www/js/e2e/e2e.js)', () => {
    const BOOTSTRAP = readFileSync(join(__dirname, '..', '..', '..', 'applications', 'Demo', 'www', 'js', 'e2e', 'e2e.js'), 'utf8');

    type Listener = () => void;

    function load(config: unknown, api: unknown) {
        const listeners: Record<string, Listener[]> = {};
        const logs: string[] = [];
        const appended: Array<{ id?: string; attrs: Record<string, string> }> = [];
        const document = {
            addEventListener: (name: string, fn: Listener) => { (listeners[name] = listeners[name] || []).push(fn); },
            createElement: () => {
                const el = { id: '', style: {} as Record<string, string>, attrs: {} as Record<string, string>,
                    setAttribute(k: string, v: string) { this.attrs[k] = v; } };
                return el;
            },
            body: { appendChild: (el: { id: string; attrs: Record<string, string> }) => { appended.push(el); } },
        };
        const win: Record<string, unknown> = { E2E_CONFIG: config, E2EScenario: scenario, AcousticConnect: api };
        const context = vm.createContext({
            window: win, document, setTimeout, clearTimeout, Promise,
            console: { log: (m: string) => logs.push(String(m)) },
        });
        vm.runInContext(BOOTSTRAP, context);
        const fire = async () => {
            (listeners.deviceready || []).forEach((fn) => fn());
            await new Promise((resolve) => setTimeout(resolve, 80));
        };
        return { listeners, logs, appended, fire };
    }

    it('does nothing when e2e is not enabled', () => {
        const { listeners } = load({ enabled: false }, makeApi());
        expect(listeners.deviceready).toBeUndefined();
    });

    it('does nothing when there is no e2e config at all', () => {
        const { listeners } = load(undefined, makeApi());
        expect(listeners.deviceready).toBeUndefined();
    });

    it('runs the scenario on deviceready and reports a pass with a marker element', async () => {
        const api = makeApi();
        const { fire, logs, appended } = load({ enabled: true, settleMs: 0, sdkIntervalMs: 1 }, api);
        await fire();

        expect(api.logCustomEvent).toHaveBeenCalledTimes(1);
        expect(logs).toContain('E2E_DONE status=pass steps=9 failed=0 unavailable=0');
        expect(logs.some((l) => l.startsWith('E2E_RESULT '))).toBe(true);
        expect(appended).toHaveLength(1);
        expect(appended[0].id).toBe('e2eDone');
        expect(appended[0].attrs['data-status']).toBe('pass');
    });

    it('reports a failing step in the done line and the marker', async () => {
        const api = makeApi({ logSignal: jest.fn().mockRejectedValue({ code: 'X', message: 'nope' }) });
        const { fire, logs, appended } = load({ enabled: true, settleMs: 0, sdkIntervalMs: 1 }, api);
        await fire();
        expect(logs).toContain('E2E_DONE status=fail steps=9 failed=1 unavailable=0');
        expect(appended[0].attrs['data-status']).toBe('fail');
    });

    it('reports sdk-timeout without running any step when the SDK never comes up', async () => {
        const api = makeApi({ isSdkEnabled: jest.fn().mockResolvedValue(false) });
        const { fire, logs, appended } = load({ enabled: true, settleMs: 0, sdkIntervalMs: 1, sdkMaxTries: 2 }, api);
        await fire();
        expect(logs).toContain('E2E_DONE status=sdk-timeout steps=0 failed=0 unavailable=0');
        expect(api.logCustomEvent).not.toHaveBeenCalled();
        expect(appended[0].attrs['data-status']).toBe('sdk-timeout');
    });

    it('reports no-plugin when AcousticConnect is not installed', async () => {
        const { fire, logs, appended } = load({ enabled: true, settleMs: 0 }, undefined);
        await fire();
        expect(logs).toContain('E2E_DONE status=no-plugin steps=0 failed=0 unavailable=0');
        expect(appended[0].attrs['data-status']).toBe('no-plugin');
    });
});

describe('scenario against the real JS bridge', () => {
    // The steps must pass the plugin's own argument validation, otherwise the device
    // run would fail for a reason that has nothing to do with the SDK.
    const mockExec: jest.Mock = jest.fn();
    jest.mock('cordova/exec', () => mockExec, { virtual: true });

    it('every step is accepted by the argument validation of www/AcousticConnect.js', async () => {
        mockExec.mockReset();
        mockExec.mockImplementation((resolve: (v: unknown) => void) => resolve(true));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const bridge = require('../www/AcousticConnect.js');

        const summary = await scenario.runScenario(bridge);
        expect(summary.results.filter((r: { status: string }) => r.status !== 'ok')).toEqual([]);
        expect(summary.ok).toBe(true);
    });

    it('sends the custom events in the order the expectations assume', async () => {
        mockExec.mockReset();
        mockExec.mockImplementation((resolve: (v: unknown) => void) => resolve(true));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const bridge = require('../www/AcousticConnect.js');
        await scenario.runScenario(bridge);

        const sent = mockExec.mock.calls.map((c: unknown[]) => {
            const args = c[4] as unknown[];
            return c[3] === 'logCustomEvent' ? `logCustomEvent:${args[0]}` : String(c[3]);
        });
        expect(sent).toEqual([
            'logScreenViewContextLoad',
            'logCustomEvent:e2e_purchase',
            'logCustomEvent:click',
            'logCustomEvent:textChange',
            'logSignal',
            'logExceptionEvent',
            'logIdentificationEvent',
            'logScreenViewContextUnload',
            'flushQueues',
        ]);
    });

    it('never lets the plaintext secret reach the native layer', async () => {
        mockExec.mockReset();
        mockExec.mockImplementation((resolve: (v: unknown) => void) => resolve(true));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const bridge = require('../www/AcousticConnect.js');
        await scenario.runScenario(bridge);
        expect(JSON.stringify(mockExec.mock.calls.map((c: unknown[]) => c[4]))).not.toContain(scenario.SECRET_TEXT);
    });
});

describe('which signal expectations come from logSignal', () => {
    it('tags the payload rows of the signal step, so the iOS suite can require the wrapped shape', () => {
        const rows = scenario.expectations().filter((e: { type?: number }) => e.type === 21);
        const fromSignal = rows.filter((e: { step: string }) => e.step === 'signal');
        const fromIdentity = rows.filter((e: { step: string }) => e.step === 'identity');
        expect(fromSignal.length).toBeGreaterThan(0);
        expect(fromIdentity.length).toBeGreaterThan(0);
        for (const e of fromSignal) expect(e.viaLogSignal).toBe(true);
        // logIdentity is never wrapped on either platform
        for (const e of fromIdentity) expect(e.viaLogSignal).toBeUndefined();
    });
});

