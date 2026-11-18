import type { AcousticConnectApi, FlatValue, SignalValues } from 'capacitor-acoustic-connect-beta';

/*
 * Logic of the Behaviour screens (Showcase and Verification), free of the DOM and of Angular. The same payloads and the same
 * scenario list as applications/DemoCapacitor (src/js/behaviour/behaviour-core.js) and the Cordova Demo app.
 */

export const MAX_DEPTH = 5;
export const SAMPLE_TEXT = 'hunter2-secret';
const DIRECT_REFERRER = 'Screen View Diagnostics';

export const CUSTOM_EVENT = {
  name: 'demoCustomEvent',
  values: { tier: 'pro', isTrial: false, seats: 2 } as Record<string, FlatValue>,
  level: 1
};

export const NESTED_SIGNAL: SignalValues = {
  signalContent: {
    signalType: 'pageview',
    url: 'https://app.example.com/behaviour-demo',
    pageCategory: 'behaviour-demo'
  },
  audience: [
    { name: 'Account Name', value: 'Acme Corp' },
    { name: 'Account ID', value: '4815162342' }
  ],
  cart: { items: 3, total: 24.99, coupon: null }
};

export const FLAT_SIGNAL: SignalValues = { signalType: 'pageview', pageCategory: 'behaviour-demo' };

/** The level the sample UI contract's signal and custom event buttons log at, as in the React Native samples. */
export const SIGNAL_LEVEL = 1;

/** An item no SDK module reads, so writing it changes no behaviour. */
export const CONFIG_PROBE = { key: 'DemoConfigProbe', value: 'roundtrip', module: 'EOCore' };

/** Renders a name so a blank or null one is visible rather than invisible. */
export function describeName(name: string | null | undefined): string {
  if (name === null || name === undefined) return '(null)';
  if (name === '') return '(empty string)';
  if (name.trim() === '') return `(whitespace ×${name.length})`;
  if (name.length > 48) return `${name.slice(0, 45)}… (${name.length} chars)`;
  return name;
}

/** What the plugin sends for a masked text: one X per code point. */
export function maskPreview(text: string): string {
  return Array.from(text).map(() => 'X').join('');
}

export interface ScreenStep {
  chain: string[];
  load: { name: string; referrer: string | null } | null;
  blocked: boolean;
}

export function openScreen(chain: string[], name: string): ScreenStep {
  if (chain.length >= MAX_DEPTH) return { chain: chain.slice(), load: null, blocked: true };
  const referrer = chain.length ? chain[chain.length - 1] : null;
  return { chain: chain.concat([name]), load: { name, referrer }, blocked: false };
}

export function closeScreen(chain: string[]): { chain: string[]; unload: { name: string; referrer: string | null } | null } {
  if (!chain.length) return { chain: [], unload: null };
  const name = chain[chain.length - 1];
  const rest = chain.slice(0, -1);
  return { chain: rest, unload: { name, referrer: rest.length ? rest[rest.length - 1] : null } };
}

const DIRECT_CASES: { id: string; name: string | null }[] = [
  { id: 'plain', name: 'Plain Name' },
  { id: 'spaces', name: 'Name With  Spaces' },
  { id: 'unicode', name: 'Страница 日本語 😀' },
  { id: 'long', name: 'L'.repeat(64) },
  { id: 'empty', name: '' },
  { id: 'whitespace', name: '   ' },
  { id: 'null', name: null }
];

export function errorMessage(error: unknown, fallback = 'failed'): string {
  const e = error as { message?: string } | null;
  return e && e.message ? e.message : fallback;
}

export interface DirectResult { id: string; ok: boolean; shown: string; message?: string }

/**
 * Sends every case in order. A rejected case is a result, not a failure of the run: the bridge refuses blank and null names, and the
 * card shows that.
 */
export async function runDirectCases(A: AcousticConnectApi): Promise<DirectResult[]> {
  const results: DirectResult[] = [];
  for (const c of DIRECT_CASES) {
    try {
      await A.logScreenViewContextLoad(c.name as string, DIRECT_REFERRER);
      results.push({ id: c.id, ok: true, shown: describeName(c.name) });
    } catch (e) {
      results.push({ id: c.id, ok: false, shown: describeName(c.name), message: errorMessage(e) });
    }
  }
  return results;
}

// The app is one native screen, so the page logs its own screens (tabs, Behaviour sub-tabs, the Gestures view), named as in the native
// and React Native samples.
export const TAB_SCREENS = { notification: 'Push', identity: 'Identity' };
export const SUBTAB_SCREENS = { actions: 'Behaviour', showcase: 'Showcase', verification: 'Verification' };
export const GESTURE_SCREEN = 'Gestures';

export interface ScreenView { name: string; referrer: string | null }
export interface ScreenOutcome { ok: boolean; message?: string }
export interface ScreenSteps { unload: Promise<ScreenOutcome> | null; load: Promise<ScreenOutcome> | null }

/**
 * Moving to another screen enters the next one with the current one as referrer, then leaves the current one (its UNLOAD keeps the
 * referrer it was entered with): the Android SDK refuses an UNLOAD of the current screen, so the next one is loaded first. Moving to the
 * current screen logs nothing.
 */
export function moveScreen(current: ScreenView | null, name: string): { current: ScreenView; unload: ScreenView | null; load: ScreenView | null } {
  if (current && current.name === name) return { current, unload: null, load: null };
  const referrer = current ? current.name : null;
  return {
    current: { name, referrer },
    unload: current ? { name: current.name, referrer: current.referrer } : null,
    load: { name, referrer }
  };
}

type ScreenApi = Pick<AcousticConnectApi, 'logScreenViewContextLoad' | 'logScreenViewContextUnload'>;

/**
 * Keeps one current screen and logs each move while the SDK is enabled; enabling logs the move to the screen on display, and disabling
 * forgets what was logged, so the next enable loads that screen again. `show` and
 * `setEnabled` return the outcome of the LOAD and of the UNLOAD, null for a call not made. An outcome never rejects, and the calls go out
 * in order, the LOAD first.
 */
export function createScreenTracker(api: () => ScreenApi | null | undefined) {
  let shown: string | null = null;
  let logged: ScreenView | null = null;
  let enabled = false;
  let queue: Promise<ScreenOutcome> = Promise.resolve({ ok: true });

  const call = (method: keyof ScreenApi, view: ScreenView): Promise<ScreenOutcome> => {
    queue = queue.then(async () => {
      const A = api();
      if (!A || typeof A[method] !== 'function') throw new Error('This plugin version has no ' + method);
      await A[method](view.name, view.referrer);
    }).then(() => ({ ok: true }), (e) => ({ ok: false, message: errorMessage(e) }));
    return queue;
  };

  const sync = (): ScreenSteps => {
    if (!enabled || shown === null) return { unload: null, load: null };
    const move = moveScreen(logged, shown);
    logged = move.current;
    const load = move.load ? call('logScreenViewContextLoad', move.load) : null;
    const unload = move.unload ? call('logScreenViewContextUnload', move.unload) : null;
    return { unload, load };
  };

  return {
    show(name: string): ScreenSteps {
      shown = name;
      return sync();
    },
    setEnabled(value: boolean): ScreenSteps {
      enabled = value;
      if (!value) logged = null;
      return sync();
    },
    current: (): string | null => shown
  };
}

export interface PageState { tab: string | null; subtab: string; stacks: Record<string, string[]> }

/** The screen on display: a tab, on Behaviour its sub-tab, and on a sub-tab with views open the one on top of its stack. */
export function screenFor(page: PageState): string | null {
  if (!page.tab) return null;
  if (page.tab !== 'behaviour') return TAB_SCREENS[page.tab as keyof typeof TAB_SCREENS];
  const stack = page.stacks[page.subtab];
  if (stack && stack.length) return stack[stack.length - 1];
  return SUBTAB_SCREENS[page.subtab as keyof typeof SUBTAB_SCREENS];
}

/**
 * What the page shows, logged through one screen tracker: the screens report the tab, the sub-tab and the views opened on Showcase and on
 * Verification (the Gestures screen, the detail chain, Screen Views and its case views), each sub-tab with its own stack of view names, kept
 * while another tab or sub-tab is shown. A report that does not change the screen on display logs nothing.
 */
export function createPageScreens(api: () => ScreenApi | null | undefined) {
  const tracker = createScreenTracker(api);
  const page: PageState = { tab: null, subtab: 'actions', stacks: { showcase: [], verification: [] } };
  const stackOf = (subtab: string): string[] => {
    const stack = page.stacks[subtab];
    if (!stack) throw new Error('No views are opened on ' + subtab);
    return stack;
  };
  const sync = (): ScreenSteps => {
    const name = screenFor(page);
    return name === null ? { unload: null, load: null } : tracker.show(name);
  };
  return {
    showTab(tab: string, subtab?: string): ScreenSteps {
      page.tab = tab;
      if (subtab) page.subtab = subtab;
      return sync();
    },
    showSubtab(subtab: string): ScreenSteps {
      page.subtab = subtab;
      return sync();
    },
    open(subtab: string, name: string): ScreenSteps {
      stackOf(subtab).push(name);
      return sync();
    },
    back(subtab: string): ScreenSteps {
      stackOf(subtab).pop();
      return sync();
    },
    stack: (subtab: string): string[] => stackOf(subtab).slice(),
    setEnabled: tracker.setEnabled,
    current: tracker.current
  };
}

const GESTURE_ROWS = 40;
export const LONG_PRESS_MS = 500;
export const DOUBLE_TAP_MS = 300;
export const TAP_SLOP = 8;
export const SWIPE_THRESHOLD = 48;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;

export interface Point { x: number; y: number }

export function gestureLabel(name?: string | null): string {
  return 'Last gesture: ' + (name || 'none');
}

export function gestureRows(): { id: string; text: string }[] {
  return Array.from({ length: GESTURE_ROWS }, (_, i) => ({ id: 'gesture_row_' + i, text: 'Scrollable row ' + (i + 1) }));
}

export function swipeName(dx: number, dy: number): string | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < SWIPE_THRESHOLD && ay < SWIPE_THRESHOLD) return null;
  if (ax >= ay) return dx > 0 ? 'swipeRight' : 'swipeLeft';
  return dy > 0 ? 'swipeDown' : 'swipeUp';
}

export function pressName(heldMs: number): 'longPress' | 'tap' {
  return heldMs >= LONG_PRESS_MS ? 'longPress' : 'tap';
}

export function isDoubleTap(previousUpAt: number | null | undefined, downAt: number): boolean {
  return typeof previousUpAt === 'number' && downAt - previousUpAt <= DOUBLE_TAP_MS;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pinchName(previousDistance: number | null, currentDistance: number): 'zoomIn' | 'zoomOut' | null {
  if (previousDistance === null || !(previousDistance > 0) || currentDistance === previousDistance) return null;
  return currentDistance > previousDistance ? 'zoomIn' : 'zoomOut';
}

export function clampZoom(zoom: number, factor: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
}

// ── Views of the sample UI contract (Showcase detail chain, Screen Views, case views) ──

export const SCREEN_VIEWS_SCREEN = 'Screen Views';
export const DETAIL_SCREEN = 'Showcase detail';
export const SCREEN_VIEW_LOG_LIMIT = 12;
const LONG_NAME = 'Lot 4815 '.repeat(34).slice(0, 300);

export interface ScreenViewCase { id: string; label: string; name: string | null; navigable: boolean; direct: boolean }

/**
 * The screen name cases of the React Native samples (screenViewCases.ts): `navigable` ones open a view through the page's screen tracker,
 * `direct` ones are sent with logScreenViewContextLoad to keep the exact string (the empty and the null name are only reachable that way).
 */
export const SCREEN_VIEW_CASES: ScreenViewCase[] = [
  { id: 'catalog', label: 'Catalog', name: 'Catalog', navigable: true, direct: false },
  { id: 'product_details', label: 'Product Details', name: 'Product Details', navigable: true, direct: false },
  { id: 'bid_confirmation', label: 'Bid Confirmation', name: 'Bid Confirmation', navigable: true, direct: false },
  { id: 'checkout', label: 'Checkout', name: 'Checkout', navigable: true, direct: false },
  { id: 'reserved_chars', label: 'URL-reserved characters', name: 'Order #4815 & Refund?ref=a/b', navigable: true, direct: true },
  { id: 'non_ascii', label: 'Non-ASCII + emoji', name: 'Płatności ✓ 🛒', navigable: true, direct: true },
  { id: 'long', label: '300-character name', name: LONG_NAME, navigable: true, direct: true },
  { id: 'url_shaped', label: 'Already URL-shaped', name: 'https://app.example.com/looks-like-a-url', navigable: true, direct: true },
  { id: 'whitespace', label: 'Whitespace only', name: '   ', navigable: true, direct: true },
  { id: 'empty', label: 'Empty name', name: '', navigable: false, direct: true },
  { id: 'null', label: 'Null name', name: null, navigable: false, direct: true }
];

export const NAV_CASES = SCREEN_VIEW_CASES.filter((c) => c.navigable);
export const DIRECT_SCREEN_CASES = SCREEN_VIEW_CASES.filter((c) => c.direct);

/** Every direct case in the order of "Send all": the empty name first, the null name last. */
export function directSendOrder(): ScreenViewCase[] {
  const only = (id: string) => DIRECT_SCREEN_CASES.filter((c) => c.id === id);
  const rest = DIRECT_SCREEN_CASES.filter((c) => c.id !== 'empty' && c.id !== 'null');
  return [...only('empty'), ...rest, ...only('null')];
}

export function caseById(id: string): ScreenViewCase | undefined {
  return SCREEN_VIEW_CASES.find((c) => c.id === id);
}

/** The case a view named so shows. */
export function caseByName(name: string): ScreenViewCase | undefined {
  return NAV_CASES.find((c) => c.name === name);
}

/** The case pushed on top of another: the first navigable one with another id. */
export function nextCase(id: string): ScreenViewCase {
  return NAV_CASES.filter((c) => c.id !== id)[0];
}

export function detailScreen(depth: number): string {
  return depth <= 1 ? DETAIL_SCREEN : `${DETAIL_SCREEN} ${depth}`;
}

/** The depth of a detail view named so, null for another name. */
export function detailDepth(name: string): number | null {
  if (name === DETAIL_SCREEN) return 1;
  const match = /^Showcase detail (\d+)$/.exec(name);
  const depth = match ? parseInt(match[1], 10) : 0;
  return depth >= 2 && depth <= MAX_DEPTH ? depth : null;
}

export type View = { kind: 'gestures' } | { kind: 'screen-views' } | { kind: 'detail'; depth: number } | { kind: 'case'; testCase: ScreenViewCase };

/** What a name on a view stack shows: the Gestures screen, a detail view, Screen Views or the view of a case. */
export function viewFor(name: string): View | null {
  if (name === GESTURE_SCREEN) return { kind: 'gestures' };
  if (name === SCREEN_VIEWS_SCREEN) return { kind: 'screen-views' };
  const depth = detailDepth(name);
  if (depth) return { kind: 'detail', depth };
  const testCase = caseByName(name);
  return testCase ? { kind: 'case', testCase } : null;
}

export interface CallOutcome { ok: boolean; message?: string }

/** Resolves { ok } or { ok: false, message } for a call, whichever way it ends. */
export async function attempt(call: () => unknown): Promise<CallOutcome> {
  try {
    await call();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export interface ScreenViewEntry { id: string; ok: boolean; shown: string; message?: string }

/** One direct screen view with the case's exact name: the entry for the result log. */
export async function sendScreenView(A: ScreenApi, testCase: ScreenViewCase): Promise<ScreenViewEntry> {
  const outcome = await attempt(() => A.logScreenViewContextLoad(testCase.name as string, DIRECT_REFERRER));
  return { id: testCase.id, ok: outcome.ok, shown: describeName(testCase.name), message: outcome.message };
}

/** Sends every direct case in order, one after another; `onEntry` gets each entry as it is known. */
export async function sendAllScreenViews(A: ScreenApi, onEntry: (entry: ScreenViewEntry) => void): Promise<ScreenViewEntry[]> {
  const entries: ScreenViewEntry[] = [];
  for (const testCase of directSendOrder()) {
    const entry = await sendScreenView(A, testCase);
    onEntry(entry);
    entries.push(entry);
  }
  return entries;
}

/** The result log, latest first. */
export function addScreenViewEntry(log: ScreenViewEntry[], entry: ScreenViewEntry): ScreenViewEntry[] {
  return [entry, ...log].slice(0, SCREEN_VIEW_LOG_LIMIT);
}

// ── Result texts of the sample UI contract (the React Native samples' texts) ──

export const TAP_CONTROL_ID = 'btn_showcase_tap';
export const EXCEPTION_MESSAGE = 'Showcase: handled exception';

export function tapsLine(count: number): string {
  return `taps: ${count} · control id: ${TAP_CONTROL_ID}`;
}

export function customEventLine(outcome: CallOutcome): string {
  return outcome.ok ? `✓ queued ${CUSTOM_EVENT.name} — read customEvent in the posted message` : `✗ ${outcome.message}`;
}

export function signalLine(label: string, payload: SignalValues, outcome: CallOutcome): string {
  return `${outcome.ok ? '✓ ' : '✗ '}${label} — ${outcome.ok ? JSON.stringify(payload) : outcome.message}`;
}

/** The error a page catches and reports, with the stack the engine gives it. */
export function handledException(): { message: string; stack: string } {
  try {
    throw new Error(EXCEPTION_MESSAGE);
  } catch (error) {
    const e = error as Error;
    return { message: e.message, stack: e.stack || '' };
  }
}

export function exceptionLine(outcome: CallOutcome): string {
  return outcome.ok ? `✓ queued exception "${EXCEPTION_MESSAGE}"` : `✗ ${outcome.message}`;
}

/** The plugin resolves nothing from disable() and enable(), so a resolved call reads as `true`. */
export function captureLine(method: 'disable' | 'enable', outcome: CallOutcome): string {
  const tail = method === 'disable' ? ' — now navigate and check for further layout captures' : '';
  return `${method}() returned ${outcome.ok}${outcome.ok ? tail : ' — ' + outcome.message}`;
}

const IDENTITY_EXPECTED = {
  defaulted: 'expect loginMethod: email',
  explicit: 'expect registrationMethod: email'
};

export function identityLine(kind: keyof typeof IDENTITY_EXPECTED, outcome: CallOutcome): string {
  return `${outcome.ok ? '✓ ' : '✗ '}${kind} — ${outcome.ok ? IDENTITY_EXPECTED[kind] : outcome.message}`;
}

/** The entry of the result log: `✓ catalog → Catalog`, a refusal with its error after a colon. */
export function screenViewLine(entry: ScreenViewEntry): string {
  return `${entry.ok ? '✓ ' : '✗ '}${entry.id} → ${entry.shown}${entry.ok ? '' : ': ' + entry.message}`;
}

export function reloggedLine(outcome: CallOutcome): string {
  return outcome.ok ? '✓ re-logged directly' : `✗ re-logged directly: ${outcome.message}`;
}

/** What the page's screen tracker did for the view just opened: a refused name still opens the view. */
export function loggedLine(outcome: CallOutcome): string {
  return outcome.ok ? '✓ logged by navigation' : `✗ not logged by navigation: ${outcome.message}`;
}

export interface Feature { id: string; title: string; description: string }

export const FEATURES: Feature[] = [
  { id: 'taps', title: 'Taps', description: 'Count taps. The page logs nothing: the plugin logs each tap as a click with the control id.' },
  { id: 'gestures', title: 'Gestures', description: 'Long press, double tap, swipe and pinch targets and a scrollable list, with nothing logged by the page.' },
  { id: 'text', title: 'Text entry', description: 'Log typing masked (default) or in plain text.' },
  { id: 'text-capture', title: 'Text entry and masking', description: 'Typing into a field is captured by the plugin: the page logs nothing. A value matching a masking rule in ConnectConfig.json is redacted before it leaves the device.' },
  { id: 'custom-event', title: 'Custom event', description: 'One event with string, boolean and number values.' },
  { id: 'signal', title: 'Signals', description: 'Nested and flat signal payloads.' },
  { id: 'exception', title: 'Exception', description: 'A handled exception with a stack text.' },
  { id: 'screen-view', title: 'Screen view', description: 'Open a detail screen chain with a referrer chain, or send direct names.' },
  { id: 'identity', title: 'Identity', description: 'Default signal type versus an explicit one.' },
  { id: 'config', title: 'Config item', description: 'Set and read a native SDK configuration item at runtime.' },
  { id: 'capture', title: 'Runtime capture control', description: 'disable() stops the capture; navigate a few screens and check that no further layout messages arrive, then enable() again.' },
  { id: 'sdk', title: 'SDK', description: 'Version, log level, and starting or stopping the SDK from code.' },
  { id: 'push-manual', title: 'Push, iOS manual mode', description: 'The calls an app makes in iosPushMode "manual"; they reject in any other mode and on Android.' }
];

export interface Scenario {
  key: string;
  title: string;
  channel: string;
  platform: 'both' | 'android' | 'ios';
  action: string;
  expected: string;
  run: (A: AcousticConnectApi) => Promise<unknown>;
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'custom-event-types', title: 'Custom event value types', channel: 'custom-event', platform: 'both',
    action: 'Run. One event with a string, a boolean and a number, level 1.',
    expected: 'iOS: data.value.tier "pro", isTrial false, seats 2 (JSON types). Android: flat, values stringified.',
    run: (A) => A.logCustomEvent(CUSTOM_EVENT.name, CUSTOM_EVENT.values, CUSTOM_EVENT.level)
  },
  {
    key: 'nested-signal', title: 'Nested signal', channel: 'signal', platform: 'both',
    action: 'Run. Signal with signalContent and an audience array.',
    expected: 'Type 6 message; payload under signal.data.value on iOS, at the root of signal on Android.',
    run: (A) => A.logSignal(NESTED_SIGNAL)
  },
  {
    key: 'flat-signal', title: 'Flat signal', channel: 'signal', platform: 'both',
    action: 'Run. Signal with two top-level string keys.',
    expected: 'Type 6 message with signalType "pageview" and pageCategory "behaviour-demo".',
    run: (A) => A.logSignal(FLAT_SIGNAL)
  },
  {
    key: 'identity-defaults', title: 'Identity, default signal type', channel: 'signal', platform: 'both',
    action: 'Run. logIdentity("Email", "defaults@example.com") with no signal type.',
    expected: 'Type 21 signal, not wrapped in data.value. Never a type 24 message.',
    run: (A) => A.logIdentity('Email', 'defaults@example.com')
  },
  {
    key: 'identity-explicit', title: 'Identity, explicit signal type', channel: 'signal', platform: 'both',
    action: 'Run. Signal type "accountRegistered" with registrationMethod "email".',
    expected: 'Type 21 signal carrying accountRegistered and registrationMethod.',
    run: (A) => A.logIdentity('Email', 'explicit@example.com', 'accountRegistered', { registrationMethod: 'email' })
  },
  {
    key: 'click', title: 'Click event', channel: 'custom-event', platform: 'both',
    action: 'Run. Logs a click for control "scenario_btn".',
    expected: 'Custom event "click" with controlId "scenario_btn".',
    run: (A) => A.logClickEvent('scenario_btn', { screen: 'verification' })
  },
  {
    key: 'text-masked', title: 'Text change, masked', channel: 'custom-event', platform: 'both',
    action: `Run. Logs the sample text "${SAMPLE_TEXT}" with the default masking.`,
    expected: `Custom event "textChange" with only X characters (${maskPreview(SAMPLE_TEXT).length}); the sample text appears nowhere in the payload.`,
    run: (A) => A.logTextChangeEvent('scenario_txt', { text: SAMPLE_TEXT })
  },
  {
    key: 'text-plain', title: 'Text change, plain', channel: 'custom-event', platform: 'both',
    action: 'Run. Same text with masked: false.',
    expected: 'Custom event "textChange" carrying the sample text as typed.',
    run: (A) => A.logTextChangeEvent('scenario_txt', { text: SAMPLE_TEXT, masked: false })
  },
  {
    key: 'screen-chain', title: 'Screen view referrer chain', channel: 'screenview', platform: 'both',
    action: 'Run. Loads Chain 1, 2, 3 (each with the previous as referrer), then unloads back to the first.',
    expected: 'Type 2 messages in order with referrers null, Chain 1, Chain 2. Android may drop a screen whose earlier message is still queued.',
    run: async (A) => {
      let chain: string[] = [];
      for (const name of ['Chain 1', 'Chain 2', 'Chain 3']) {
        const r = openScreen(chain, name);
        chain = r.chain;
        await A.logScreenViewContextLoad(r.load!.name, r.load!.referrer);
      }
      for (let i = 0; i < 3; i++) {
        const r = closeScreen(chain);
        chain = r.chain;
        await A.logScreenViewContextUnload(r.unload!.name, r.unload!.referrer);
      }
    }
  },
  {
    key: 'config-roundtrip', title: 'Config item round trip', channel: 'config', platform: 'both',
    action: `Run. Writes ${CONFIG_PROBE.key} = "${CONFIG_PROBE.value}" to module ${CONFIG_PROBE.module} and reads it back.`,
    expected: 'Queued, which here means the value read back equals the value written. Nothing is sent to the collector.',
    run: async (A) => {
      await A.setConfigItem(CONFIG_PROBE.key, CONFIG_PROBE.value, CONFIG_PROBE.module);
      const value = await A.getConfigItem(CONFIG_PROBE.key, '', CONFIG_PROBE.module);
      if (value !== CONFIG_PROBE.value) {
        throw new Error(`config item read back as ${JSON.stringify(value)}, expected ${JSON.stringify(CONFIG_PROBE.value)}`);
      }
    }
  },
  {
    key: 'exception', title: 'Handled exception', channel: 'exception', platform: 'both',
    action: 'Run. Logs a handled exception with a stack text.',
    expected: 'Exception message named "Capacitor Plugin". iOS keeps the stack in data.stacktrace (stackTrace is "(null)"); Android in stackTrace.',
    run: (A) => A.logExceptionEvent('Scenario handled exception', 'Error: scenario\n    at scenario (behaviour-core.ts)', false)
  }
];

export function scenariosFor(platform: string): Scenario[] {
  return SCENARIOS.filter((s) => s.platform === 'both' || s.platform === platform);
}

export interface Outcome { key: string; ok: boolean; message: string }

/** Runs one scenario. A resolved promise means the SDK queued the message, not that the collector has it. */
export async function runScenario(scenario: Scenario, A: AcousticConnectApi): Promise<Outcome> {
  try {
    await scenario.run(A);
    return { key: scenario.key, ok: true, message: 'queued' };
  } catch (e) {
    return { key: scenario.key, ok: false, message: errorMessage(e) };
  }
}
