/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for the Demo app's Behaviour testing screens
 * (applications/Demo/www/js/behaviour/behaviour-core.js): the Showcase cards and the
 * Verification scenario registry, modelled on the React Native example app.
 */

import { join } from 'path';

const CORE_PATH = join(__dirname, '..', '..', '..', 'applications', 'Demo', 'www', 'js', 'behaviour', 'behaviour-core.js');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require(CORE_PATH);

function makeApi(overrides: Record<string, jest.Mock> = {}): Record<string, jest.Mock> {
    const names = [
        'logScreenViewContextLoad', 'logScreenViewContextUnload', 'logCustomEvent',
        'logClickEvent', 'logTextChangeEvent', 'logSignal', 'logExceptionEvent',
        'logIdentity', 'flushQueues', 'setCurrentScreenName', 'setConfigItem', 'getConfigItem',
    ];
    const api: Record<string, jest.Mock> = {};
    for (const n of names) api[n] = jest.fn().mockResolvedValue(undefined);
    return { ...api, ...overrides };
}

describe('describeName', () => {
    it('makes blank and null names visible', () => {
        expect(core.describeName(null)).toBe('(null)');
        expect(core.describeName('')).toBe('(empty string)');
        expect(core.describeName('   ')).toBe('(whitespace ×3)');
    });

    it('shortens a long name and reports its length', () => {
        const long = 'a'.repeat(60);
        expect(core.describeName(long)).toBe('a'.repeat(45) + '… (60 chars)');
    });

    it('returns an ordinary name unchanged', () => {
        expect(core.describeName('checkout')).toBe('checkout');
    });
});

describe('maskPreview', () => {
    it('shows one X per code point', () => {
        expect(core.maskPreview('hunter2')).toBe('XXXXXXX');
        expect(core.maskPreview('a😀b')).toBe('XXX');
        expect(core.maskPreview('')).toBe('');
    });
});

describe('payloads', () => {
    it('keeps the React Native example payloads so the two apps send the same data', () => {
        expect(core.CUSTOM_EVENT).toEqual({
            name: 'demoCustomEvent', values: { tier: 'pro', isTrial: false, seats: 2 }, level: 1,
        });
        expect(core.NESTED_SIGNAL).toEqual({
            signalContent: {
                signalType: 'pageview',
                url: 'https://app.example.com/behaviour-demo',
                pageCategory: 'behaviour-demo',
            },
            audience: [
                { name: 'Account Name', value: 'Acme Corp' },
                { name: 'Account ID', value: '4815162342' },
            ],
        });
        expect(core.FLAT_SIGNAL).toEqual({ signalType: 'pageview', pageCategory: 'behaviour-demo' });
    });
});

describe('screen chain', () => {
    it('opens the first screen without a referrer', () => {
        const r = core.openScreen([], 'Screen 1');
        expect(r.chain).toEqual(['Screen 1']);
        expect(r.load).toEqual({ name: 'Screen 1', referrer: null });
        expect(r.blocked).toBe(false);
    });

    it('uses the previous screen as the referrer', () => {
        const r = core.openScreen(['Screen 1', 'Screen 2'], 'Screen 3');
        expect(r.chain).toEqual(['Screen 1', 'Screen 2', 'Screen 3']);
        expect(r.load).toEqual({ name: 'Screen 3', referrer: 'Screen 2' });
    });

    it('stops at the maximum depth and leaves the chain untouched', () => {
        const full = ['1', '2', '3', '4', '5'];
        const r = core.openScreen(full, '6');
        expect(r.blocked).toBe(true);
        expect(r.chain).toEqual(full);
        expect(r.load).toBeNull();
        expect(core.MAX_DEPTH).toBe(5);
    });

    it('does not mutate its input', () => {
        const input = ['a'];
        core.openScreen(input, 'b');
        expect(input).toEqual(['a']);
    });

    it('closes the top screen and reports it with the screen below as referrer', () => {
        const r = core.closeScreen(['Screen 1', 'Screen 2']);
        expect(r.chain).toEqual(['Screen 1']);
        expect(r.unload).toEqual({ name: 'Screen 2', referrer: 'Screen 1' });
    });

    it('closes the only screen with no referrer', () => {
        const r = core.closeScreen(['Screen 1']);
        expect(r.chain).toEqual([]);
        expect(r.unload).toEqual({ name: 'Screen 1', referrer: null });
    });

    it('has nothing to close on an empty chain', () => {
        const r = core.closeScreen([]);
        expect(r.chain).toEqual([]);
        expect(r.unload).toBeNull();
    });
});

describe('direct screen view cases', () => {
    it('include blank and null names, which the JS bridge must reject', async () => {
        const ids = core.DIRECT_CASES.map((c: { id: string }) => c.id);
        expect(ids).toEqual(expect.arrayContaining(['plain', 'empty', 'whitespace', 'null']));
        const A = {
            logScreenViewContextLoad: jest.fn((name: unknown) =>
                typeof name === 'string' && name.trim() ? Promise.resolve() : Promise.reject(new Error('bad name'))),
        };
        const results = await core.runDirectCases(A);
        const byId = Object.fromEntries(results.map((r: { id: string; ok: boolean }) => [r.id, r.ok]));
        expect(byId.plain).toBe(true);
        expect(byId.empty).toBe(false);
        expect(byId.whitespace).toBe(false);
        expect(byId.null).toBe(false);
        expect(A.logScreenViewContextLoad).toHaveBeenCalledTimes(core.DIRECT_CASES.length);
    });
});

describe('scenario registry', () => {
    it('has unique keys and the fields every card renders', () => {
        const keys = core.SCENARIOS.map((s: { key: string }) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const s of core.SCENARIOS) {
            expect(typeof s.title).toBe('string');
            expect(typeof s.action).toBe('string');
            expect(typeof s.expected).toBe('string');
            expect(['custom-event', 'signal', 'screenview', 'exception', 'config']).toContain(s.channel);
            expect(['both', 'ios', 'android']).toContain(s.platform);
            expect(typeof s.run).toBe('function');
        }
    });

    it('covers the analytics surface of the plugin', () => {
        const keys = core.SCENARIOS.map((s: { key: string }) => s.key);
        expect(keys).toEqual(expect.arrayContaining([
            'custom-event-types', 'nested-signal', 'flat-signal', 'identity-defaults', 'identity-explicit',
            'click', 'text-masked', 'text-plain', 'screen-chain', 'exception', 'config-roundtrip',
        ]));
    });

    it('sends the custom event with its JSON types and level', async () => {
        const A = makeApi();
        await core.findScenario('custom-event-types').run(A);
        expect(A.logCustomEvent).toHaveBeenCalledWith('demoCustomEvent', { tier: 'pro', isTrial: false, seats: 2 }, 1);
    });

    it('sends nested and flat signals', async () => {
        const A = makeApi();
        await core.findScenario('nested-signal').run(A);
        await core.findScenario('flat-signal').run(A);
        expect(A.logSignal).toHaveBeenNthCalledWith(1, core.NESTED_SIGNAL);
        expect(A.logSignal).toHaveBeenNthCalledWith(2, core.FLAT_SIGNAL);
    });

    it('logs identity with the defaults and with an explicit signal type', async () => {
        const A = makeApi();
        await core.findScenario('identity-defaults').run(A);
        await core.findScenario('identity-explicit').run(A);
        expect(A.logIdentity).toHaveBeenNthCalledWith(1, 'Email', 'defaults@example.com');
        expect(A.logIdentity).toHaveBeenNthCalledWith(
            2, 'Email', 'explicit@example.com', 'accountRegistered', { registrationMethod: 'email' });
    });

    it('masks the text by default and sends it plain only when asked', async () => {
        const A = makeApi();
        await core.findScenario('text-masked').run(A);
        await core.findScenario('text-plain').run(A);
        expect(A.logTextChangeEvent).toHaveBeenNthCalledWith(1, 'scenario_txt', { text: core.SAMPLE_TEXT });
        expect(A.logTextChangeEvent).toHaveBeenNthCalledWith(2, 'scenario_txt', { text: core.SAMPLE_TEXT, masked: false });
    });

    it('walks the screen chain forwards and back, ending with every screen unloaded', async () => {
        const A = makeApi();
        await core.findScenario('screen-chain').run(A);
        const loads = A.logScreenViewContextLoad.mock.calls.map((c) => c.slice(0, 2));
        const unloads = A.logScreenViewContextUnload.mock.calls.map((c) => c.slice(0, 2));
        expect(loads[0]).toEqual(['Chain 1', null]);
        expect(loads[1]).toEqual(['Chain 2', 'Chain 1']);
        expect(unloads[0][0]).toBe('Chain 3');
        expect(loads.length).toBe(unloads.length);
    });

    it('returns the outcome of a run and does not throw when the call is rejected', async () => {
        const A = makeApi({ logSignal: jest.fn().mockRejectedValue(new Error('boom')) });
        const out = await core.runScenario(core.findScenario('nested-signal'), A);
        expect(out).toEqual({ key: 'nested-signal', ok: false, message: 'boom' });
        const ok = await core.runScenario(core.findScenario('flat-signal'), makeApi());
        expect(ok).toEqual({ key: 'flat-signal', ok: true, message: 'queued' });
    });

    it('reports a plugin without the analytics API instead of throwing', async () => {
        const out = await core.runScenario(core.findScenario('nested-signal'), {});
        expect(out.ok).toBe(false);
        expect(out.message).toMatch(/analytics API/i);
    });

    it('returns undefined for an unknown key', () => {
        expect(core.findScenario('nope')).toBeUndefined();
    });

    it('applies only to the current platform', () => {
        const ios = core.scenariosFor('ios').map((s: { key: string }) => s.key);
        const android = core.scenariosFor('android').map((s: { key: string }) => s.key);
        expect(ios).toEqual(expect.arrayContaining(['custom-event-types']));
        expect(android).toEqual(expect.arrayContaining(['custom-event-types']));
        for (const s of core.scenariosFor('ios')) expect(['both', 'ios']).toContain(s.platform);
        for (const s of core.scenariosFor('android')) expect(['both', 'android']).toContain(s.platform);
    });
});

describe('config round trip scenario', () => {
    it('writes a probe item and reads the same value back', async () => {
        const store: Record<string, unknown> = {};
        const A = makeApi({
            setConfigItem: jest.fn((k: string, v: unknown) => { store[k] = v; return Promise.resolve(); }),
            getConfigItem: jest.fn((k: string, d: unknown) => Promise.resolve(k in store ? store[k] : d)),
        });
        const out = await core.runScenario(core.findScenario('config-roundtrip'), { ...A, logCustomEvent: jest.fn() });
        expect(out).toEqual({ key: 'config-roundtrip', ok: true, message: 'queued' });
        expect(A.setConfigItem).toHaveBeenCalledWith(core.CONFIG_PROBE.key, core.CONFIG_PROBE.value, core.CONFIG_PROBE.module);
    });

    it('fails when the value read back differs', async () => {
        const A = makeApi({
            setConfigItem: jest.fn().mockResolvedValue(undefined),
            getConfigItem: jest.fn().mockResolvedValue('something else'),
        });
        const out = await core.runScenario(core.findScenario('config-roundtrip'), A);
        expect(out.ok).toBe(false);
        expect(out.message).toMatch(/read back/);
    });

    it('fails with the plugin error when the set is refused', async () => {
        const A = makeApi({ setConfigItem: jest.fn().mockRejectedValue(new Error('refused')) });
        const out = await core.runScenario(core.findScenario('config-roundtrip'), A);
        expect(out).toEqual({ key: 'config-roundtrip', ok: false, message: 'refused' });
    });
});

describe('showcase features', () => {
    it('lists each feature once with a title and description', () => {
        const ids = core.FEATURES.map((f: { id: string }) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(expect.arrayContaining([
            'taps', 'text', 'custom-event', 'signal', 'exception', 'screen-view', 'identity', 'config',
        ]));
        for (const f of core.FEATURES) {
            expect(typeof f.title).toBe('string');
            expect(typeof f.description).toBe('string');
        }
    });
});

describe('Demo page wiring', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    const demo = join(__dirname, '..', '..', '..', 'applications', 'Demo', 'www');
    const html: string = readFileSync(join(demo, 'index.html'), 'utf8');

    it('has the three Behaviour sections: Actions, Showcase and Verification', () => {
        for (const id of ['actions', 'showcase', 'verification']) {
            expect(html).toContain('data-subtab="' + id + '"');
            expect(html).toContain('id="subtab-' + id + '"');
        }
    });

    it('keeps the existing Behaviour buttons', () => {
        for (const id of ['btn_log_custom_event', 'btn_log_signal', 'btn_log_click', 'btn_log_text_change',
            'btn_screen_load', 'btn_screen_unload', 'btn_log_exception', 'btn_flush']) {
            expect(html).toContain('id="' + id + '"');
        }
    });

    it('loads the behaviour scripts before index.js', () => {
        const core = html.indexOf('<script src="js/behaviour/behaviour-core.js">');
        const ui = html.indexOf('<script src="js/behaviour/behaviour.js">');
        const index = html.indexOf('<script src="js/index.js">');
        expect(core).toBeGreaterThan(-1);
        expect(ui).toBeGreaterThan(core);
        expect(index).toBeGreaterThan(ui);
    });

    it('has the containers the renderer fills', () => {
        for (const id of ['showcaseList', 'showcaseDetail', 'verificationList']) {
            expect(html).toContain('id="' + id + '"');
        }
    });
});
