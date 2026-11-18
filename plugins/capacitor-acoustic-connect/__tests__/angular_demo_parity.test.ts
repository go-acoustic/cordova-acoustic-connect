import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// The Angular sample (applications/DemoCapacitorAngular) promises a call for every public method of the plugin: this fails
// when a method is added to AcousticConnectApi and the sample does not call it. The methods in NOT_IN_THE_SAMPLE are left out on
// purpose: the Cordova Demo and the React Native examples have no buttons for them either, and the shared end-to-end scenario
// (e2e/core/scenario.js) exercises them.
const NOT_IN_THE_SAMPLE = [
  'logLocation',
  'logLocationUpdate',
  'logDialogShowEvent',
  'logDialogDismissEvent',
  'logDialogButtonClickEvent',
  'logDialogCustomEvent',
];

const DEFINITIONS = path.join(__dirname, '..', 'src', 'definitions.ts');
const SERVICE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'applications',
  'DemoCapacitorAngular',
  'src',
  'app',
  'acoustic.service.ts',
);

function apiBlock(): string {
  const text = fs.readFileSync(DEFINITIONS, 'utf8');
  const start = text.indexOf('export interface AcousticConnectApi');
  return text.slice(start);
}

function methodNames(block: string): { top: string[]; push: string[] } {
  const pushStart = block.indexOf('push: {');
  const pushEnd = block.indexOf('\n  };', pushStart);
  const pushBlock = block.slice(pushStart, pushEnd);
  const top = block.slice(0, pushStart);
  const names = (s: string) => Array.from(new Set(Array.from(s.matchAll(/^\s{2,4}(\w+)\(/gm)).map((m) => m[1])));
  return { top: names(top), push: names(pushBlock) };
}

describe('the Angular sample covers the plugin API', () => {
  const service = fs.readFileSync(SERVICE, 'utf8');
  const { top: allTop, push } = methodNames(apiBlock());
  const top = allTop.filter((n) => !NOT_IN_THE_SAMPLE.includes(n));

  it('reads the methods of the API', () => {
    expect(top).toEqual(
      expect.arrayContaining(['enable', 'disable', 'logCustomEvent', 'logIdentity', 'getConfigItem']),
    );
    expect(push).toEqual(expect.arrayContaining(['requestPermission', 'getPermissionState', 'didReceiveResponse']));
  });

  it.each(top.map((n) => [n]))('calls AcousticConnect.%s', (name) => {
    expect(service).toMatch(new RegExp(`AcousticConnect\\.${name}\\(`));
  });

  it.each(push.map((n) => [n]))('calls AcousticConnect.push.%s', (name) => {
    expect(service).toMatch(new RegExp(`AcousticConnect\\.push\\.${name}\\(`));
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadAngularCore(): Record<string, any> {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'applications', 'DemoCapacitorAngular', 'src', 'app', 'behaviour-core.ts'),
    'utf8',
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function('module', 'exports', 'require', js)(module, module.exports, () => ({}));
  return module.exports;
}

describe('the Angular sample shows the screens of DemoCapacitor', () => {
  const root = path.join(__dirname, '..', '..', '..', 'applications');
  const ts = fs.readFileSync(path.join(root, 'DemoCapacitorAngular', 'src', 'app', 'behaviour-core.ts'), 'utf8');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const core = require(path.join(root, 'DemoCapacitor', 'src', 'js', 'behaviour', 'behaviour-core.js'));
  const keys = (re: RegExp) => Array.from(ts.matchAll(re)).map((m) => m[1]);

  it('has the verification scenarios of DemoCapacitor, in the same order', () => {
    expect(keys(/^\s{4}key: '([\w-]+)'/gm)).toEqual(core.SCENARIOS.map((s: { key: string }) => s.key));
  });

  it('has the showcase features of DemoCapacitor, then its own two (the SDK and the manual push calls)', () => {
    const own = keys(/^\s{2}\{ id: '([\w-]+)', title:/gm);
    expect(own.slice(0, core.FEATURES.length)).toEqual(core.FEATURES.map((f: { id: string }) => f.id));
    expect(own.slice(core.FEATURES.length)).toEqual(['sdk', 'push-manual']);
  });

  it('has the screen names of DemoCapacitor', () => {
    const literal = (screens: Record<string, string>) =>
      '{ ' +
      Object.entries(screens)
        .map(([key, name]) => `${key}: '${name}'`)
        .join(', ') +
      ' }';
    expect(ts).toContain(`TAB_SCREENS = ${literal(core.TAB_SCREENS)}`);
    expect(ts).toContain(`SUBTAB_SCREENS = ${literal(core.SUBTAB_SCREENS)}`);
    expect(ts).toContain(`GESTURE_SCREEN = '${core.GESTURE_SCREEN}'`);
  });

  it('has the gesture thresholds and zoom limits of DemoCapacitor', () => {
    for (const name of ['LONG_PRESS_MS', 'DOUBLE_TAP_MS', 'TAP_SLOP', 'SWIPE_THRESHOLD', 'MIN_ZOOM', 'MAX_ZOOM']) {
      expect(ts).toContain(`${name} = ${core[name]}`);
    }
  });

  it('has the ids of the Gestures screen of DemoCapacitor in the showcase', () => {
    const showcase = fs.readFileSync(
      path.join(root, 'DemoCapacitorAngular', 'src', 'app', 'tabs', 'behaviour-showcase.ts'),
      'utf8',
    );
    for (const id of [
      'btn_open_gestures',
      'btn_gestures_back',
      'tv_gestures_last',
      'gesture_long_press',
      'gesture_double_tap',
      'gesture_swipe',
      'gesture_pinch_zoom',
      'gesture_scroll_list',
    ]) {
      expect(showcase).toContain(`id="${id}"`);
    }
  });

  it('has the ids of the sample UI contract in its templates', () => {
    const app = path.join(root, 'DemoCapacitorAngular', 'src', 'app');
    const ids: Record<string, string[]> = {
      'tabs/behaviour-tab.ts': ['btn_open_showcase', 'btn_open_verification'],
      'tabs/behaviour-showcase.ts': [
        'btn_showcase_tap',
        'txt_showcase_taps',
        'field_showcase_note',
        'field_showcase_secret',
        'btn_showcase_exception',
        'txt_showcase_exception_result',
        'btn_capture_disable',
        'btn_capture_enable',
        'txt_capture_state',
        'btn_showcase_open_detail',
        'btn_showcase_push_detail',
        'btn_showcase_back',
      ],
      'tabs/behaviour-contract-bodies.ts': [
        'btn_send_custom_event',
        'txt_custom_event_result',
        'btn_send_nested_signal',
        'btn_send_flat_signal',
        'txt_signal_result',
        'btn_identity_defaulted',
        'btn_identity_explicit',
        'txt_identity_defaults_result',
      ],
      'tabs/behaviour-verification.ts': ['btn_open_screen_views'],
      'tabs/behaviour-screen-views.ts': [
        'btn_screen_views_back',
        "'btn_navigate_' + c.id",
        "'btn_screenview_' + c.id",
        'btn_screenview_send_all',
        'txt_screenview_result',
        'btn_case_back',
        'btn_case_relog',
        'txt_case_relog_result',
        'btn_case_push_next',
      ],
    };
    for (const [file, wanted] of Object.entries(ids)) {
      const source = fs.readFileSync(path.join(app, file), 'utf8');
      for (const id of wanted) expect(source).toContain(id);
    }
  });

  it('has the contract views, cases, payloads and result texts of DemoCapacitor', () => {
    const angular = loadAngularCore();
    for (const name of [
      'SCREEN_VIEWS_SCREEN',
      'DETAIL_SCREEN',
      'SCREEN_VIEW_LOG_LIMIT',
      'SCREEN_VIEW_CASES',
      'NAV_CASES',
      'DIRECT_SCREEN_CASES',
      'TAP_CONTROL_ID',
      'EXCEPTION_MESSAGE',
      'NESTED_SIGNAL',
      'FLAT_SIGNAL',
      'CUSTOM_EVENT',
      'SIGNAL_LEVEL',
      'MAX_DEPTH',
    ]) {
      expect([name, angular[name]]).toEqual([name, core[name]]);
    }
    for (const name of [
      'directSendOrder',
      'caseById',
      'caseByName',
      'nextCase',
      'detailScreen',
      'detailDepth',
      'viewFor',
      'tapsLine',
      'customEventLine',
      'signalLine',
      'exceptionLine',
      'captureLine',
      'identityLine',
      'screenViewLine',
      'reloggedLine',
      'loggedLine',
      'addScreenViewEntry',
      'handledException',
      'attempt',
      'sendScreenView',
      'sendAllScreenViews',
      'createPageScreens',
    ]) {
      expect([name, typeof angular[name]]).toEqual([name, 'function']);
      expect([name, typeof core[name]]).toEqual([name, 'function']);
    }
  });

  it('has the same probe, payloads and chain depth', () => {
    expect(ts).toContain(`key: '${core.CONFIG_PROBE.key}'`);
    expect(ts).toContain(`name: '${core.CUSTOM_EVENT.name}'`);
    expect(ts).toContain(`MAX_DEPTH = ${core.MAX_DEPTH}`);
    expect(ts).toContain(`SAMPLE_TEXT = '${core.SAMPLE_TEXT}'`);
  });
});
