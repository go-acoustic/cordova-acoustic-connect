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

function loadPage(demo: Demo) {
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
    };
    const script = (file: string) => readFileSync(join(demo.root, 'js', file), 'utf8');
    w.eval(script('behaviour/behaviour-core.js'));
    w.eval(script('behaviour/behaviour.js'));
    w.eval(demo.switchTab(script('index.js')));
    return { w, calls, click: (selector: string) => (w.document.querySelector(selector) as { click(): void }).click() };
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
