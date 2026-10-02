/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs the e2e scenario (scenario.js) inside the Demo app when js/e2e-config.js
 * enables it, then reports the outcome in two ways a runner can read without
 * touching the UI: one greppable `E2E_DONE ...` console line (logcat / os_log) and a
 * hidden `<div id="e2eDone" data-status="...">` marker.
 *
 * Does nothing unless `window.E2E_CONFIG.enabled === true`, so the normal Demo is
 * unaffected.
 */
(function () {
    'use strict';

    var config = window.E2E_CONFIG;
    if (!config || config.enabled !== true) {
        return;
    }

    var scenario = window.E2EScenario;

    function finish(summary) {
        var line = scenario.formatDoneLine(summary);
        var status = line.split(' ')[1].split('=')[1];

        var marker = document.createElement('div');
        marker.id = 'e2eDone';
        marker.setAttribute('data-status', status);
        marker.style.display = 'none';
        document.body.appendChild(marker);

        console.log(line);
        console.log('E2E_RESULT ' + JSON.stringify(summary));
    }

    function start() {
        var api = window.AcousticConnect;
        if (!api) {
            finish({ ok: false, noPlugin: true, failed: 0, unavailable: 0, results: [] });
            return;
        }

        scenario.waitForSdk(api, { maxTries: config.sdkMaxTries, intervalMs: config.sdkIntervalMs })
            .then(function (ready) {
                if (!ready) {
                    finish({ ok: false, timeout: true, failed: 0, unavailable: 0, results: [] });
                    return null;
                }
                // Give the SDK a moment after it reports ready (push setup, first screen view).
                return new Promise(function (resolve) {
                    setTimeout(resolve, config.settleMs === undefined ? 2000 : config.settleMs);
                }).then(function () { return scenario.runScenario(api); }).then(finish);
            });
    }

    document.addEventListener('deviceready', start, false);
}());
