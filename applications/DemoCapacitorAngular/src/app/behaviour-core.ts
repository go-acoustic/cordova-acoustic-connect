import type { AcousticConnectApi, FlatValue, SignalValues } from 'capacitor-acoustic-connect';

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
  ]
};

export const FLAT_SIGNAL: SignalValues = { signalType: 'pageview', pageCategory: 'behaviour-demo' };

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

export interface Feature { id: string; title: string; description: string }

export const FEATURES: Feature[] = [
  { id: 'taps', title: 'Taps', description: 'Count taps and log each one as a click event.' },
  { id: 'text', title: 'Text entry', description: 'Log typing masked (default) or in plain text.' },
  { id: 'custom-event', title: 'Custom event', description: 'One event with string, boolean and number values.' },
  { id: 'signal', title: 'Signals', description: 'Nested and flat signal payloads.' },
  { id: 'exception', title: 'Exception', description: 'A handled exception with a stack text.' },
  { id: 'screen-view', title: 'Screen view', description: 'Load and unload screens with a referrer chain, or an exact name.' },
  { id: 'identity', title: 'Identity', description: 'Default signal type versus an explicit one.' },
  { id: 'config', title: 'Config item', description: 'Set and read a native SDK configuration item at runtime.' },
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
