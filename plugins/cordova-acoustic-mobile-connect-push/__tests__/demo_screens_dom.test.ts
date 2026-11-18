/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs the page of the Cordova Demo and of DemoCapacitor in jsdom: their tab switcher (js/index.js `switchTab`) and the
 * Behaviour screens (js/behaviour/behaviour.js), and checks the screen views they log. DemoCapacitor's index.js is an ES
 * module that imports the plugin, so only its `switchTab` is taken from it.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

const APPS = join(__dirname, '..', '..', '..', 'applications');

interface Demo { name: string; root: string; switchTab: (source: string) => string }

const DEMOS: Demo[] = [
    { name: 'Cordova Demo', root: join(APPS, 'Demo', 'www'), switchTab: (source) => source + '\nwindow.switchTab = switchTab;' },
    {
        name: 'DemoCapacitor',
        root: join(APPS, 'DemoCapacitor', 'src'),
        switchTab: (source) => {
            const start = source.indexOf('const TAB_TITLES');
            const end = source.indexOf('\n}\n', source.indexOf('function switchTab(')) + 3;
            return source.slice(start, end) + '\nwindow.switchTab = switchTab;';
        },
    },
];

function loadPage(demo: Demo, extraApi: Record<string, unknown> = {}) {
    const dom = new JSDOM(readFileSync(join(demo.root, 'index.html'), 'utf8'), { runScripts: 'outside-only' });
    const w = dom.window as unknown as Record<string, any>;
    const calls: string[] = [];
    const record = (kind: string) => (name: string, referrer: string | null) => {
        calls.push(kind + ' ' + name + ' <- ' + referrer);
        return Promise.resolve();
    };
    w.AcousticConnect = {
        logCustomEvent: () => Promise.resolve(),
        logScreenViewContextLoad: record('LOAD'),
        logScreenViewContextUnload: record('UNLOAD'),
        ...extraApi,
    };
    const script = (file: string) => readFileSync(join(demo.root, 'js', file), 'utf8');
    w.eval(script('behaviour/behaviour-core.js'));
    w.eval(script('behaviour/behaviour.js'));
    w.eval(demo.switchTab(script('index.js')));
    return {
        w,
        calls,
        click: (selector: string) => (w.document.querySelector(selector) as { click(): void }).click(),
        text: (selector: string) => (w.document.querySelector(selector) as { textContent: string } | null)?.textContent ?? null,
    };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe.each(DEMOS)('the screen views of the $name page', (demo) => {
    it('follow the tabs, the sub-tabs and the Gestures view, the next screen loaded first', async () => {
        const { w, calls, click } = loadPage(demo);
        w.BehaviourUi.init();
        w.switchTab('identity');
        expect(calls).toEqual([]);
        w.BehaviourUi.setEnabled(true);
        await settle();
        w.switchTab('notification');
        w.switchTab('behaviour');
        click('[data-subtab="showcase"]');
        click('#btn_open_gestures');
        await settle();
        expect(w.document.querySelector('#showcaseGestures .result-line').textContent).toBe('Queued');
        click('[data-subtab="showcase"]');
        click('#btn_gestures_back');
        click('[data-subtab="verification"]');
        w.switchTab('identity');
        w.switchTab('behaviour');
        w.switchTab('behaviour');
        await settle();
        expect(calls).toEqual([
            'LOAD Identity <- null',
            'LOAD Push <- Identity',
            'UNLOAD Identity <- null',
            'LOAD Behaviour <- Push',
            'UNLOAD Push <- Identity',
            'LOAD Showcase <- Behaviour',
            'UNLOAD Behaviour <- Push',
            'LOAD Gestures <- Showcase',
            'UNLOAD Showcase <- Behaviour',
            'LOAD Showcase <- Gestures',
            'UNLOAD Gestures <- Showcase',
            'LOAD Verification <- Showcase',
            'UNLOAD Showcase <- Gestures',
            'LOAD Identity <- Verification',
            'UNLOAD Verification <- Showcase',
            'LOAD Verification <- Identity',
            'UNLOAD Identity <- Verification',
        ]);
    });
});

// The sample UI contract (CA-162313): fixed control ids, the payloads and the result texts the end-to-end tests drive and read.
describe.each(DEMOS)('the sample UI contract on the $name page', (demo) => {
    const SHOWCASE_IDS = [
        'btn_showcase_tap', 'txt_showcase_taps', 'field_showcase_note', 'field_showcase_secret', 'btn_send_custom_event',
        'btn_send_nested_signal', 'btn_send_flat_signal', 'btn_showcase_exception', 'btn_capture_disable', 'btn_capture_enable',
        'btn_showcase_open_detail', 'btn_open_gestures',
    ];
    const VERIFICATION_IDS = ['btn_send_custom_event', 'btn_send_nested_signal', 'btn_identity_defaulted', 'btn_identity_explicit', 'btn_open_screen_views'];

    function recordingApi() {
        const sent: Record<string, unknown[][]> = {};
        const spy = (name: string, impl: (...args: unknown[]) => Promise<unknown> = () => Promise.resolve()) => (...args: unknown[]) => {
            (sent[name] = sent[name] || []).push(args);
            return impl(...args);
        };
        const refuseBlank = (name: unknown) =>
            typeof name === 'string' && name.trim() ? Promise.resolve() : Promise.reject(new Error('bad name'));
        return {
            sent,
            api: {
                logCustomEvent: spy('logCustomEvent'),
                logSignal: spy('logSignal'),
                logExceptionEvent: spy('logExceptionEvent'),
                logIdentity: spy('logIdentity'),
                disable: spy('disable'),
                enable: spy('enable'),
            },
            refuseBlank,
        };
    }

    function pageWithSdk(extra: Record<string, unknown> = {}) {
        const page = loadPage(demo, extra);
        page.w.BehaviourUi.init();
        page.w.BehaviourUi.setEnabled(true);
        return page;
    }

    it('has its ids once on each sub-tab, and the hub buttons on the page', () => {
        const { w } = pageWithSdk();
        const doc = w.document as Document;
        for (const [container, ids] of [['#subtab-showcase', SHOWCASE_IDS], ['#subtab-verification', VERIFICATION_IDS]] as const) {
            for (const id of ids) expect([container, id, doc.querySelectorAll(container + ' [id="' + id + '"]').length]).toEqual([container, id, 1]);
        }
        expect(doc.querySelector('#btn_open_showcase')?.getAttribute('data-subtab')).toBe('showcase');
        expect(doc.querySelector('#btn_open_verification')?.getAttribute('data-subtab')).toBe('verification');
    });

    it('counts taps without logging anything itself', async () => {
        const { sent, api } = recordingApi();
        const { click, text } = pageWithSdk(api);
        expect(text('#txt_showcase_taps')).toBe('taps: 0 · control id: btn_showcase_tap');
        click('#btn_showcase_tap');
        click('#btn_showcase_tap');
        await settle();
        expect(text('#txt_showcase_taps')).toBe('taps: 2 · control id: btn_showcase_tap');
        expect(sent).toEqual({});
    });

    it('sends the custom event, the signals and the exception with the texts of the React Native samples', async () => {
        const { sent, api } = recordingApi();
        const { click, text, w } = pageWithSdk(api);
        click('#subtab-showcase #btn_send_custom_event');
        click('#subtab-showcase #btn_send_nested_signal');
        await settle();
        expect(text('#subtab-showcase #txt_custom_event_result')).toBe('✓ queued demoCustomEvent — read customEvent in the posted message');
        expect(text('#subtab-showcase #txt_signal_result')).toBe(`✓ nested — ${JSON.stringify(w.BehaviourCore.NESTED_SIGNAL)}`);
        click('#subtab-showcase #btn_send_flat_signal');
        click('#btn_showcase_exception');
        await settle();
        expect(text('#subtab-showcase #txt_signal_result')).toBe(`✓ flat — ${JSON.stringify(w.BehaviourCore.FLAT_SIGNAL)}`);
        expect(text('#txt_showcase_exception_result')).toBe('✓ queued exception "Showcase: handled exception"');
        expect(sent['logCustomEvent']).toEqual([['demoCustomEvent', { tier: 'pro', isTrial: false, seats: 2 }, 1]]);
        expect(sent['logSignal'].map((call) => call[1])).toEqual([1, 1]);
        expect(sent['logSignal'][0][0]).toMatchObject({ cart: { items: 3, total: 24.99, coupon: null } });
        expect(sent['logSignal'][1][0]).toEqual({ signalType: 'pageview', pageCategory: 'behaviour-demo' });
        const [message, stack, unhandled] = sent['logExceptionEvent'][0];
        expect([message, unhandled]).toEqual(['Showcase: handled exception', false]);
        expect(stack).toContain('Showcase: handled exception');
    });

    it('shows a rejection as the result, not as a failure of the page', async () => {
        const { api } = recordingApi();
        const { click, text } = pageWithSdk({ ...api, logCustomEvent: () => Promise.reject(new Error('SDK not enabled')) });
        click('#subtab-showcase #btn_send_custom_event');
        await settle();
        expect(text('#subtab-showcase #txt_custom_event_result')).toBe('✗ SDK not enabled');
    });

    it('logs the identity on Verification with and without the optional arguments', async () => {
        const { sent, api } = recordingApi();
        const { click, text } = pageWithSdk(api);
        click('[data-subtab="verification"]');
        click('#btn_identity_defaulted');
        click('#btn_identity_explicit');
        await settle();
        expect(sent['logIdentity']).toEqual([
            ['Email', 'defaults@example.com'],
            ['Email', 'explicit@example.com', 'accountRegistered', { registrationMethod: 'email' }],
        ]);
        expect(text('#txt_identity_defaults_result')).toBe('✓ explicit — expect registrationMethod: email');
        click('#btn_identity_defaulted');
        await settle();
        expect(text('#txt_identity_defaults_result')).toBe('✓ defaulted — expect loginMethod: email');
        click('#subtab-verification #btn_send_custom_event');
        click('#subtab-verification #btn_send_nested_signal');
        await settle();
        expect(text('#subtab-verification #txt_custom_event_result')).toMatch(/^✓ queued demoCustomEvent/);
        expect(text('#subtab-verification #txt_signal_result')).toMatch(/^✓ nested — /);
    });

    (demo.name === 'DemoCapacitor' ? it : it.skip)('refuses to re-enable the SDK with the placeholder app key', async () => {
        const { sent, api } = recordingApi();
        const { click, text, calls, w } = pageWithSdk(api);
        w.switchTab('behaviour');
        click('[data-subtab="showcase"]');
        await settle();
        click('#btn_capture_disable');
        await settle();
        const before = calls.length;
        click('#btn_capture_enable');
        await settle();
        expect(text('#txt_capture_state')).toBe(
            'enable() returned false — set appKey and postURL in DEMO_ENABLE (js/behaviour/behaviour.js) first');
        expect(sent['enable']).toBeUndefined();
        expect(calls.slice(before)).toEqual([]);
    });

    (demo.name === 'DemoCapacitor' ? it.skip : it)('disables and enables the SDK, the screen views stopping and starting with it', async () => {
        const { sent, api } = recordingApi();
        const { click, text, calls, w } = pageWithSdk(api);
        w.ConnectBasicConfig = { AppKey: 'app-key', PostMessageUrl: 'https://collector.example.com/post' };
        w.switchTab('behaviour');
        click('[data-subtab="showcase"]');
        await settle();
        const before = calls.length;
        click('#btn_capture_disable');
        await settle();
        expect(text('#txt_capture_state')).toBe('disable() returned true — now navigate and check for further layout captures');
        click('#btn_showcase_open_detail');
        click('#btn_showcase_back');
        await settle();
        expect(calls.length).toBe(before);
        click('#btn_capture_enable');
        await settle();
        expect(text('#txt_capture_state')).toBe('enable() returned true');
        expect(sent['disable']).toHaveLength(1);
        expect(sent['enable']).toHaveLength(1);
        expect(calls.slice(before)).toEqual(['LOAD Showcase <- null']);
    });

    it('walks the detail chain to its limit and back, logging each move', async () => {
        const { api } = recordingApi();
        const { click, text, calls, w } = pageWithSdk(api);
        w.switchTab('behaviour');
        click('[data-subtab="showcase"]');
        click('#btn_showcase_open_detail');
        for (let i = 1; i < 5; i++) click('#btn_showcase_push_detail');
        await settle();
        const push = w.document.querySelector('#btn_showcase_push_detail') as HTMLButtonElement;
        expect(push.textContent).toBe('Chain limit reached');
        expect(push.disabled).toBe(true);
        expect(text('#showcaseDetail .mono')).toBe('Showcase detail 5');
        click('#btn_showcase_push_detail');
        for (let i = 0; i < 5; i++) click('#btn_showcase_back');
        await settle();
        expect((w.document.querySelector('#showcaseList') as HTMLElement).classList.contains('hidden')).toBe(false);
        const loads = calls.filter((c) => c.startsWith('LOAD Showcase')).slice(1);
        expect(loads).toEqual([
            'LOAD Showcase detail <- Showcase',
            'LOAD Showcase detail 2 <- Showcase detail',
            'LOAD Showcase detail 3 <- Showcase detail 2',
            'LOAD Showcase detail 4 <- Showcase detail 3',
            'LOAD Showcase detail 5 <- Showcase detail 4',
            'LOAD Showcase detail 4 <- Showcase detail 5',
            'LOAD Showcase detail 3 <- Showcase detail 4',
            'LOAD Showcase detail 2 <- Showcase detail 3',
            'LOAD Showcase detail <- Showcase detail 2',
            'LOAD Showcase <- Showcase detail',
        ]);
    });

    describe('Screen Views', () => {
        const { refuseBlank } = recordingApi();
        function pageOnVerification() {
            const page = loadPage(demo);
            const calls = page.calls;
            const direct: unknown[][] = [];
            page.w.AcousticConnect.logScreenViewContextLoad = (name: string, referrer: string | null) => {
                calls.push('LOAD ' + name + ' <- ' + referrer);
                if (referrer === 'Screen View Diagnostics') direct.push([name, referrer]);
                return refuseBlank(name);
            };
            page.w.BehaviourUi.init();
            page.w.BehaviourUi.setEnabled(true);
            page.w.switchTab('behaviour');
            page.click('[data-subtab="verification"]');
            return { ...page, direct };
        }

        it('opens from Verification and goes back to it', async () => {
            const { click, calls, w } = pageOnVerification();
            click('#btn_open_screen_views');
            await settle();
            const view = w.document.querySelector('#verificationView') as HTMLElement;
            expect(view.classList.contains('hidden')).toBe(false);
            expect((w.document.querySelector('#verificationList') as HTMLElement).classList.contains('hidden')).toBe(true);
            for (const c of w.BehaviourCore.NAV_CASES) expect(view.querySelector('#btn_navigate_' + c.id)).not.toBeNull();
            for (const c of w.BehaviourCore.DIRECT_SCREEN_CASES) expect(view.querySelector('#btn_screenview_' + c.id)).not.toBeNull();
            expect(view.querySelector('#btn_screenview_send_all')).not.toBeNull();
            click('#btn_screen_views_back');
            await settle();
            expect(view.classList.contains('hidden')).toBe(true);
            expect(calls.filter((c) => c.startsWith('LOAD Screen Views') || c.startsWith('LOAD Verification')).slice(1)).toEqual([
                'LOAD Screen Views <- Verification',
                'LOAD Verification <- Screen Views',
            ]);
        });

        it('sends every direct name without the screen tracker, the latest outcome on the first line', async () => {
            const { click, text, w, direct } = pageOnVerification();
            click('#btn_open_screen_views');
            click('#btn_screenview_send_all');
            await settle();
            expect(direct.map((d) => d[0])).toEqual(w.BehaviourCore.directSendOrder().map((c: { name: string | null }) => c.name));
            expect(direct.every((d) => d[1] === 'Screen View Diagnostics')).toBe(true);
            expect(text('#txt_screenview_result')).toBe('✗ null → (null): bad name');
            const lines = Array.from(w.document.querySelectorAll('#verificationView .result-log .result-line')).map((n) => (n as Element).textContent);
            expect(lines).toEqual([
                '✗ null → (null): bad name',
                '✗ whitespace → (whitespace ×3): bad name',
                '✓ url_shaped → https://app.example.com/looks-like-a-url',
                '✓ long → ' + 'Lot 4815 '.repeat(5).slice(0, 45) + '… (300 chars)',
                '✓ non_ascii → Płatności ✓ 🛒',
                '✓ reserved_chars → Order #4815 & Refund?ref=a/b',
                '✗ empty → (empty string): bad name',
            ]);
        });

        it('keeps the latest 12 outcomes of single sends, the latest first', async () => {
            const { click, text, w } = pageOnVerification();
            click('#btn_open_screen_views');
            for (let i = 0; i < 14; i++) click(i % 2 ? '#btn_screenview_url_shaped' : '#btn_screenview_non_ascii');
            click('#btn_screenview_null');
            await settle();
            expect(text('#txt_screenview_result')).toBe('✗ null → (null): bad name');
            expect(w.document.querySelectorAll('#verificationView .result-log .result-line')).toHaveLength(12);
        });

        it('visits a case through the screen tracker, pushes the next one and comes back', async () => {
            const { click, text, calls, w } = pageOnVerification();
            click('#btn_open_screen_views');
            click('#btn_navigate_catalog');
            await settle();
            expect(text('#verificationView .mono')).toBe('Catalog');
            expect(text('#txt_case_load_result')).toBe('✓ logged by navigation');
            click('#btn_case_push_next');
            await settle();
            expect(text('#verificationView .mono')).toBe('Product Details');
            expect((w.document.querySelector('#btn_case_push_next') as HTMLElement).textContent).toBe('Push deeper — Catalog');
            click('#btn_case_back');
            click('#btn_case_back');
            click('#btn_screen_views_back');
            await settle();
            expect(calls.filter((c) => !c.startsWith('UNLOAD')).slice(-6)).toEqual([
                'LOAD Screen Views <- Verification',
                'LOAD Catalog <- Screen Views',
                'LOAD Product Details <- Catalog',
                'LOAD Catalog <- Product Details',
                'LOAD Screen Views <- Catalog',
                'LOAD Verification <- Screen Views',
            ]);
        });

        it('opens the whitespace case anyway and shows the refusal, also for the direct re-log', async () => {
            const { click, text } = pageOnVerification();
            click('#btn_open_screen_views');
            click('#btn_navigate_whitespace');
            await settle();
            expect(text('#verificationView .mono')).toBe('(whitespace ×3)');
            expect(text('#txt_case_load_result')).toBe('✗ not logged by navigation: bad name');
            click('#btn_case_relog');
            await settle();
            expect(text('#txt_case_relog_result')).toBe('✗ re-logged directly: bad name');
        });

        it('re-logs a case straight to the plugin with Screen Views as referrer', async () => {
            const { click, text, calls } = pageOnVerification();
            click('#btn_open_screen_views');
            click('#btn_navigate_checkout');
            click('#btn_case_relog');
            await settle();
            expect(text('#txt_case_relog_result')).toBe('✓ re-logged directly');
            // The visit's own LOAD and the direct one carry the same name and referrer.
            expect(calls.filter((c) => c === 'LOAD Checkout <- Screen Views')).toHaveLength(2);
        });

        it('is the screen shown again when Verification comes back from another tab', async () => {
            const { click, w, calls } = pageOnVerification();
            click('#btn_open_screen_views');
            click('#btn_navigate_catalog');
            w.switchTab('identity');
            w.switchTab('behaviour');
            await settle();
            expect(w.BehaviourCore).toBeDefined();
            expect((w.document.querySelector('#verificationView') as HTMLElement).classList.contains('hidden')).toBe(false);
            expect(calls.filter((c) => c.startsWith('LOAD')).slice(-2)).toEqual(['LOAD Identity <- Catalog', 'LOAD Catalog <- Identity']);
        });
    });
});
