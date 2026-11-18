/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The sample UI contract (CA-162313): the views, screen names, payloads and result texts the end-to-end tests drive by fixed control ids.
 * The same checks run on the behaviour-core of the Cordova Demo, of DemoCapacitor and of DemoCapacitorAngular (transpiled here: the
 * sample's own dependencies are not installed for the plugin's tests), so a drift between the three fails a test.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const APPS = path.join(__dirname, '..', '..', '..', 'applications');
const DEMO_CORE = path.join(APPS, 'Demo', 'www', 'js', 'behaviour', 'behaviour-core.js');
const CAPACITOR_CORE = path.join(APPS, 'DemoCapacitor', 'src', 'js', 'behaviour', 'behaviour-core.js');
const ANGULAR_CORE = path.join(APPS, 'DemoCapacitorAngular', 'src', 'app', 'behaviour-core.ts');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Core = Record<string, any>;

function loadAngularCore(): Core {
  const js = ts.transpileModule(fs.readFileSync(ANGULAR_CORE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} as Core };
  new Function('module', 'exports', 'require', js)(module, module.exports, () => ({}));
  return module.exports;
}

const CORES: [string, () => Core][] = [
  ['Cordova Demo', () => require(DEMO_CORE)],
  ['DemoCapacitor', () => require(CAPACITOR_CORE)],
  ['DemoCapacitorAngular', loadAngularCore],
];

const LONG_NAME = 'Lot 4815 '.repeat(34).slice(0, 300);

const CASES = [
  ['catalog', 'Catalog', true, false],
  ['product_details', 'Product Details', true, false],
  ['bid_confirmation', 'Bid Confirmation', true, false],
  ['checkout', 'Checkout', true, false],
  ['reserved_chars', 'Order #4815 & Refund?ref=a/b', true, true],
  ['non_ascii', 'Płatności ✓ 🛒', true, true],
  ['long', LONG_NAME, true, true],
  ['url_shaped', 'https://app.example.com/looks-like-a-url', true, true],
  ['whitespace', '   ', true, true],
  ['empty', '', false, true],
  ['null', null, false, true],
];

function recordingApi(refuseBlank = false) {
  const calls: string[] = [];
  const sent: unknown[][] = [];
  const guard = (name: unknown) =>
    refuseBlank && (typeof name !== 'string' || !name.trim())
      ? Promise.reject(new Error('bad name'))
      : Promise.resolve();
  const api = {
    logScreenViewContextLoad: (name: string, referrer: string | null) => {
      calls.push(`LOAD ${name} <- ${referrer}`);
      sent.push([name, referrer]);
      return guard(name);
    },
    logScreenViewContextUnload: (name: string, referrer: string | null) => {
      calls.push(`UNLOAD ${name} <- ${referrer}`);
      return Promise.resolve();
    },
  };
  return { api, calls, sent };
}

async function settled(steps: { unload: Promise<unknown> | null; load: Promise<unknown> | null }) {
  await steps.load;
  await steps.unload;
}

describe.each(CORES)('%s: the sample UI contract', (_name, load) => {
  const core = load();

  it('has the screen name cases of the React Native samples, in order', () => {
    expect(core.SCREEN_VIEW_CASES.map((c: any) => [c.id, c.name, c.navigable, c.direct])).toEqual(CASES);
    expect(core.SCREEN_VIEW_CASES[6].name).toHaveLength(300);
    expect(core.NAV_CASES.map((c: any) => c.id)).toEqual(CASES.filter((c) => c[2]).map((c) => c[0]));
    expect(core.DIRECT_SCREEN_CASES.map((c: any) => c.id)).toEqual(CASES.filter((c) => c[3]).map((c) => c[0]));
    for (const c of core.SCREEN_VIEW_CASES) expect(typeof c.label).toBe('string');
  });

  it('sends every direct case with the empty name first and the null name last', () => {
    expect(core.directSendOrder().map((c: any) => c.id)).toEqual([
      'empty',
      'reserved_chars',
      'non_ascii',
      'long',
      'url_shaped',
      'whitespace',
      'null',
    ]);
  });

  it('looks cases up by id and by name, and pushes the first other navigable case', () => {
    expect(core.caseById('whitespace').name).toBe('   ');
    expect(core.caseById('nope')).toBeUndefined();
    expect(core.caseByName('Product Details').id).toBe('product_details');
    expect(core.caseByName('')).toBeUndefined();
    expect(core.nextCase('catalog').id).toBe('product_details');
    expect(core.nextCase('product_details').id).toBe('catalog');
    expect(core.nextCase('whitespace').id).toBe('catalog');
  });

  it('names the detail chain and tells its views from the rest', () => {
    expect([1, 2, 3, 4, 5].map(core.detailScreen)).toEqual([
      'Showcase detail',
      'Showcase detail 2',
      'Showcase detail 3',
      'Showcase detail 4',
      'Showcase detail 5',
    ]);
    expect(core.detailDepth('Showcase detail')).toBe(1);
    expect(core.detailDepth('Showcase detail 5')).toBe(5);
    for (const other of ['Showcase detail 6', 'Showcase detail 1', 'Showcase detail x', 'Showcase', 'Catalog']) {
      expect(core.detailDepth(other)).toBeNull();
    }
    expect(core.viewFor('Gestures')).toEqual({ kind: 'gestures' });
    expect(core.viewFor('Screen Views')).toEqual({ kind: 'screen-views' });
    expect(core.viewFor('Showcase detail 3')).toEqual({ kind: 'detail', depth: 3 });
    expect(core.viewFor('   ').testCase.id).toBe('whitespace');
    expect(core.viewFor('Showcase')).toBeNull();
    expect(core.SCREEN_VIEWS_SCREEN).toBe('Screen Views');
    expect(core.DETAIL_SCREEN).toBe('Showcase detail');
  });

  it('keeps the payloads of the React Native samples, nested signal with its cart', () => {
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
      cart: { items: 3, total: 24.99, coupon: null },
    });
    expect(core.FLAT_SIGNAL).toEqual({ signalType: 'pageview', pageCategory: 'behaviour-demo' });
    expect(core.CUSTOM_EVENT).toEqual({
      name: 'demoCustomEvent',
      values: { tier: 'pro', isTrial: false, seats: 2 },
      level: 1,
    });
    expect(core.SIGNAL_LEVEL).toBe(1);
  });

  it('lists the showcase cards the contract adds', () => {
    const ids = core.FEATURES.map((f: any) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(['taps', 'text-capture', 'custom-event', 'signal', 'exception', 'screen-view', 'capture']),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('result texts', () => {
    const ok = { ok: true };
    const failed = { ok: false, message: 'boom' };

    it('words the taps, custom event, signal and exception results', () => {
      expect(core.TAP_CONTROL_ID).toBe('btn_showcase_tap');
      expect(core.tapsLine(0)).toBe('taps: 0 · control id: btn_showcase_tap');
      expect(core.tapsLine(3)).toBe('taps: 3 · control id: btn_showcase_tap');
      expect(core.customEventLine(ok)).toBe('✓ queued demoCustomEvent — read customEvent in the posted message');
      expect(core.customEventLine(failed)).toBe('✗ boom');
      expect(core.signalLine('flat', core.FLAT_SIGNAL, ok)).toBe(`✓ flat — ${JSON.stringify(core.FLAT_SIGNAL)}`);
      expect(core.signalLine('nested', core.NESTED_SIGNAL, ok)).toBe(
        `✓ nested — ${JSON.stringify(core.NESTED_SIGNAL)}`,
      );
      expect(core.signalLine('nested', core.NESTED_SIGNAL, failed)).toBe('✗ nested — boom');
      expect(core.EXCEPTION_MESSAGE).toBe('Showcase: handled exception');
      expect(core.exceptionLine(ok)).toBe('✓ queued exception "Showcase: handled exception"');
      expect(core.exceptionLine(failed)).toBe('✗ boom');
    });

    it('reports a handled exception with the message and the stack of a thrown error', () => {
      const report = core.handledException();
      expect(report.message).toBe('Showcase: handled exception');
      expect(report.stack).toContain('Showcase: handled exception');
    });

    it('words the capture control, the identity and the re-log results', () => {
      expect(core.captureLine('disable', ok)).toBe(
        'disable() returned true — now navigate and check for further layout captures',
      );
      expect(core.captureLine('enable', ok)).toBe('enable() returned true');
      expect(core.captureLine('enable', failed)).toBe('enable() returned false — boom');
      expect(core.captureLine('disable', failed)).toBe('disable() returned false — boom');
      expect(core.identityLine('defaulted', ok)).toBe('✓ defaulted — expect loginMethod: email');
      expect(core.identityLine('explicit', ok)).toBe('✓ explicit — expect registrationMethod: email');
      expect(core.identityLine('explicit', failed)).toBe('✗ explicit — boom');
      expect(core.reloggedLine(ok)).toBe('✓ re-logged directly');
      expect(core.reloggedLine(failed)).toBe('✗ re-logged directly: boom');
      expect(core.loggedLine(ok)).toBe('✓ logged by navigation');
      expect(core.loggedLine(failed)).toBe('✗ not logged by navigation: boom');
    });

    it('words a screen view entry with its error after a colon, and keeps the latest 12 first', () => {
      expect(core.screenViewLine({ id: 'catalog', ok: true, shown: 'Catalog' })).toBe('✓ catalog → Catalog');
      expect(core.screenViewLine({ id: 'null', ok: false, shown: '(null)', message: 'bad name' })).toBe(
        '✗ null → (null): bad name',
      );
      expect(core.SCREEN_VIEW_LOG_LIMIT).toBe(12);
      let log: any[] = [];
      for (let i = 0; i < 15; i++) log = core.addScreenViewEntry(log, { id: `case${i}`, ok: true, shown: '' });
      expect(log).toHaveLength(12);
      expect(log[0].id).toBe('case14');
      expect(log[11].id).toBe('case3');
    });
  });

  describe('attempt', () => {
    it('resolves the outcome of a call, whichever way it ends', async () => {
      expect(await core.attempt(() => Promise.resolve('x'))).toEqual({ ok: true });
      expect(await core.attempt(() => Promise.reject(new Error('boom')))).toEqual({ ok: false, message: 'boom' });
      expect(
        await core.attempt(() => {
          throw new Error('thrown');
        }),
      ).toEqual({ ok: false, message: 'thrown' });
      expect(await core.attempt(() => Promise.reject({}))).toEqual({ ok: false, message: 'failed' });
    });
  });

  describe('direct screen views', () => {
    it('sends one case straight to the plugin with the diagnostics referrer, a refusal being an entry', async () => {
      const { api, sent } = recordingApi(true);
      expect(await core.sendScreenView(api, core.caseById('catalog'))).toEqual({
        id: 'catalog',
        ok: true,
        shown: 'Catalog',
        message: undefined,
      });
      const refused = await core.sendScreenView(api, core.caseById('whitespace'));
      expect(refused).toEqual({ id: 'whitespace', ok: false, shown: '(whitespace ×3)', message: 'bad name' });
      expect(sent).toEqual([
        ['Catalog', 'Screen View Diagnostics'],
        ['   ', 'Screen View Diagnostics'],
      ]);
    });

    it('sends all in order, handing each entry over as it is known', async () => {
      const { api, sent } = recordingApi(true);
      const seen: string[] = [];
      const entries = await core.sendAllScreenViews(api, (e: any) => seen.push(`${e.ok ? 'ok' : 'refused'} ${e.id}`));
      expect(sent.map((s) => s[0])).toEqual([
        '',
        'Order #4815 & Refund?ref=a/b',
        'Płatności ✓ 🛒',
        LONG_NAME,
        'https://app.example.com/looks-like-a-url',
        '   ',
        null,
      ]);
      expect(seen).toEqual([
        'refused empty',
        'ok reserved_chars',
        'ok non_ascii',
        'ok long',
        'ok url_shaped',
        'refused whitespace',
        'refused null',
      ]);
      expect(entries.map((e: any) => e.id)).toEqual([
        'empty',
        'reserved_chars',
        'non_ascii',
        'long',
        'url_shaped',
        'whitespace',
        'null',
      ]);
      expect(core.screenViewLine(entries[6])).toBe('✗ null → (null): bad name');
    });
  });

  describe('the stack of views of a sub-tab', () => {
    function pageWith() {
      const { api, calls } = recordingApi();
      const screens = core.createPageScreens(() => api);
      screens.showTab('behaviour', 'verification');
      screens.setEnabled(true);
      return { screens, calls };
    }

    it('logs a visit to Screen Views and a case, pushing the next one and coming back', async () => {
      const { screens, calls } = pageWith();
      await settled(screens.open('verification', 'Screen Views'));
      await settled(screens.open('verification', 'Catalog'));
      await settled(screens.open('verification', 'Product Details'));
      await settled(screens.back('verification'));
      await settled(screens.back('verification'));
      await settled(screens.back('verification'));
      expect(calls).toEqual([
        'LOAD Verification <- null',
        'LOAD Screen Views <- Verification',
        'UNLOAD Verification <- null',
        'LOAD Catalog <- Screen Views',
        'UNLOAD Screen Views <- Verification',
        'LOAD Product Details <- Catalog',
        'UNLOAD Catalog <- Screen Views',
        'LOAD Catalog <- Product Details',
        'UNLOAD Product Details <- Catalog',
        'LOAD Screen Views <- Catalog',
        'UNLOAD Catalog <- Product Details',
        'LOAD Verification <- Screen Views',
        'UNLOAD Screen Views <- Catalog',
      ]);
      expect(screens.stack('verification')).toEqual([]);
    });

    it('logs the detail chain from Showcase, one level deeper each time', async () => {
      const { api, calls } = recordingApi();
      const screens = core.createPageScreens(() => api);
      screens.showTab('behaviour', 'showcase');
      screens.setEnabled(true);
      await settled(screens.open('showcase', core.detailScreen(1)));
      await settled(screens.open('showcase', core.detailScreen(2)));
      await settled(screens.back('showcase'));
      expect(calls.slice(1)).toEqual([
        'LOAD Showcase detail <- Showcase',
        'UNLOAD Showcase <- null',
        'LOAD Showcase detail 2 <- Showcase detail',
        'UNLOAD Showcase detail <- Showcase',
        'LOAD Showcase detail <- Showcase detail 2',
        'UNLOAD Showcase detail 2 <- Showcase detail',
      ]);
    });

    it('keeps the stacks of both sub-tabs while another tab or sub-tab is shown', async () => {
      const { screens, calls } = pageWith();
      screens.open('verification', 'Screen Views');
      screens.open('verification', 'Catalog');
      screens.open('showcase', core.detailScreen(1));
      screens.showSubtab('showcase');
      expect(screens.current()).toBe('Showcase detail');
      screens.showTab('identity');
      expect(screens.current()).toBe('Identity');
      screens.showTab('behaviour');
      expect(screens.current()).toBe('Showcase detail');
      screens.showSubtab('verification');
      expect(screens.current()).toBe('Catalog');
      screens.showSubtab('actions');
      expect(screens.current()).toBe('Behaviour');
      expect(screens.stack('showcase')).toEqual(['Showcase detail']);
      expect(screens.stack('verification')).toEqual(['Screen Views', 'Catalog']);
      await settled(screens.showSubtab('verification'));
      expect(calls[calls.length - 2]).toBe('LOAD Catalog <- Behaviour');
    });

    it('logs nothing while the SDK is off, and loads the view on top when it is back', async () => {
      const { api, calls } = recordingApi();
      const screens = core.createPageScreens(() => api);
      screens.showTab('behaviour', 'showcase');
      await settled(screens.setEnabled(true));
      screens.setEnabled(false);
      expect(screens.open('showcase', core.detailScreen(1))).toEqual({ unload: null, load: null });
      expect(screens.back('showcase')).toEqual({ unload: null, load: null });
      screens.open('showcase', core.detailScreen(1));
      await settled(screens.setEnabled(true));
      expect(calls).toEqual(['LOAD Showcase <- null', 'LOAD Showcase detail <- null']);
    });

    it('reports a name the plugin refuses and goes on, as the view of a refused case opens anyway', async () => {
      const { api, calls } = recordingApi(true);
      const screens = core.createPageScreens(() => api);
      screens.showTab('behaviour', 'verification');
      await settled(screens.setEnabled(true));
      await settled(screens.open('verification', 'Screen Views'));
      const refused = screens.open('verification', '   ');
      expect(await refused.load).toEqual({ ok: false, message: 'bad name' });
      await refused.unload;
      expect(screens.current()).toBe('   ');
      expect(screens.stack('verification')).toEqual(['Screen Views', '   ']);
      expect(calls).toContain(`LOAD ${'   '} <- Screen Views`);
    });

    it('rejects a sub-tab without views and hands out a copy of the stack', () => {
      const { screens } = pageWith();
      expect(() => screens.open('actions', 'x')).toThrow(/No views/);
      expect(() => screens.stack('actions')).toThrow(/No views/);
      screens.open('verification', 'Screen Views');
      screens.stack('verification').push('tampered');
      expect(screens.stack('verification')).toEqual(['Screen Views']);
    });
  });
});

describe('the two JavaScript cores', () => {
  const strip = (file: string) =>
    fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//, '')
      .replace(/Cordova Plugin|Capacitor Plugin/, 'Plugin');

  it('differ in their header and in the name of the plugin in one expected text, nowhere else', () => {
    expect(strip(CAPACITOR_CORE)).toBe(strip(DEMO_CORE));
  });
});
