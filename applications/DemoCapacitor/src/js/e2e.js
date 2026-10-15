/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs the e2e scenario inside the app when it is built with `VITE_E2E=1`, then reports the outcome in two ways a
 * runner can read without touching the UI: one greppable `E2E_DONE ...` console line (logcat / os_log) and a hidden
 * `<div id="e2eDone" data-status="...">` marker. The same as the Cordova Demo's e2e.js.
 *
 * The scenario is the shared one (e2e/core/scenario.js), so the calls and the wire checks in
 * e2e/suite.js come from one list. It is not part of a normal build: index.js imports this file only for VITE_E2E.
 */

import { AcousticConnect } from 'capacitor-acoustic-connect';

const SDK_MAX_TRIES = 30;
const SDK_INTERVAL_MS = 1000;
// After the SDK reports ready it makes its own start-up messages (session start, the first screen and its layout, the push
// registration). A scenario that starts sooner overwrites the first screen and loses them: 2s was not enough on a cold launch.
const SETTLE_MS = 10000;

function finish(scenario, summary) {
    const line = scenario ? scenario.formatDoneLine(summary) : 'E2E_DONE status=no-plugin steps=0 failed=0 unavailable=0';
    const status = line.split(' ')[1].split('=')[1];

    const marker = document.createElement('div');
    marker.id = 'e2eDone';
    marker.setAttribute('data-status', status);
    marker.style.display = 'none';
    document.body.appendChild(marker);

    console.log(line);
    console.log('E2E_RESULT ' + JSON.stringify(summary));
}

async function start() {
    let scenario;
    try {
        // The scenario lives in the sibling Cordova demo, so this import breaks if the repository layout changes.
        // Say so on the log line the runner reads, instead of leaving the run waiting for a result.
        // The file is a UMD: the bundler may expose it as the module's default or leave it on window.
        const loaded = await import('../../../../e2e/core/scenario.js');
        scenario = loaded.default ?? window.E2EScenario;
        if (!scenario) throw new Error('the module does not expose E2EScenario');
    } catch (error) {
        console.log('E2E_ERROR the scenario (e2e/core/scenario.js) could not be loaded: ' + error.message);
        finish(null, { ok: false, noPlugin: true, failed: 0, unavailable: 0, results: [] });
        return;
    }

    const ready = await scenario.waitForSdk(AcousticConnect, { maxTries: SDK_MAX_TRIES, intervalMs: SDK_INTERVAL_MS });
    if (!ready) {
        finish(scenario, { ok: false, timeout: true, failed: 0, unavailable: 0, results: [] });
        return;
    }
    // Give the SDK a moment after it reports ready (push setup, the first screen view).
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    finish(scenario, await scenario.runScenario(AcousticConnect));
}

start();
