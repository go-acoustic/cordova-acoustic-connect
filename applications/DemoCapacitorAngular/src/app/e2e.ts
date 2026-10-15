import { AcousticConnect } from 'capacitor-acoustic-connect';

/*
 * Runs the wire-verification scenario inside the app when it is built for it (`E2E_BUILD`, set by `npm run e2e:android`
 * and `npm run e2e:ios`), then reports the outcome the way the runner reads it: one `E2E_DONE ...` console line and a
 * hidden `<div id="e2eDone" data-status="...">`. The scenario is the Cordova Demo's, shared with DemoCapacitor
 * (e2e/core/scenario.js), so the calls and the wire checks (DemoCapacitor/e2e/suite.js) are one list.
 * A normal build does not contain this file.
 */

const SDK_MAX_TRIES = 30;
const SDK_INTERVAL_MS = 1000;
// After the SDK reports ready it makes its own start-up messages (session start, the first screen and its layout, the push
// registration). A scenario that starts sooner overwrites the first screen and loses them: 2s was not enough on a cold launch.
const SETTLE_MS = 10000;

interface Scenario {
  formatDoneLine(summary: unknown): string;
  waitForSdk(plugin: unknown, options: { maxTries: number; intervalMs: number }): Promise<boolean>;
  runScenario(plugin: unknown): Promise<unknown>;
}

function finish(scenario: Scenario | null, summary: Record<string, unknown>): void {
  const line = scenario ? scenario.formatDoneLine(summary) : 'E2E_DONE status=scenario-load-failed steps=0 failed=0 unavailable=0';
  const status = line.split(' ')[1].split('=')[1];

  const marker = document.createElement('div');
  marker.id = 'e2eDone';
  marker.setAttribute('data-status', status);
  marker.style.display = 'none';
  document.body.appendChild(marker);

  console.log(line);
  console.log('E2E_RESULT ' + JSON.stringify(summary));
}

export async function startE2e(): Promise<void> {
  let scenario: Scenario | undefined;
  try {
    // The scenario lives in the Cordova demo, so this import breaks if the repository layout changes: say so on the line the
    // runner reads. The file is a UMD: the bundler may expose it as the module's default or leave it on window.
    // @ts-ignore: a plain JavaScript file with no types
    const loaded = await import('../../../../e2e/core/scenario.js');
    scenario = (loaded.default ?? (window as unknown as { E2EScenario?: Scenario }).E2EScenario) as Scenario | undefined;
    if (!scenario) throw new Error('the module does not expose E2EScenario');
  } catch (error) {
    console.log('E2E_ERROR the scenario (e2e/core/scenario.js) could not be loaded: ' + (error as Error).message);
    finish(null, { ok: false, scenarioLoadFailed: true, failed: 0, unavailable: 0, results: [] });
    return;
  }

  const ready = await scenario.waitForSdk(AcousticConnect, { maxTries: SDK_MAX_TRIES, intervalMs: SDK_INTERVAL_MS });
  if (!ready) {
    finish(scenario, { ok: false, timeout: true, failed: 0, unavailable: 0, results: [] });
    return;
  }
  // Give the SDK a moment after it reports ready (push setup, the first screen view).
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  finish(scenario, (await scenario.runScenario(AcousticConnect)) as Record<string, unknown>);
}
