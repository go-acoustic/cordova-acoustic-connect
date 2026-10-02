/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * End-to-end scenario for the release-verification run.
 *
 * One list is the single source of truth for BOTH halves of the check:
 *   - what the app calls on the plugin (`run`), and
 *   - what each call must put on the wire (`expect`), written platform-neutral.
 * The suite files for the collector sink are generated from `expectations()`, so the
 * calls and the assertions cannot drift apart.
 *
 * Loaded as a plain script in the app (exposes `window.E2EScenario`) and with
 * `require()` from the Jest tests.
 */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.E2EScenario = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Typed on purpose: the masked text must come back as X characters of this length,
    // and this exact string must appear nowhere on the wire.
    var SECRET_TEXT = 'hunter2-secret';
    var MASKED_TEXT = new Array(SECRET_TEXT.length + 1).join('X');

    // Expectations are platform-neutral. `expected` keeps its real JS type; the suite
    // generator decides how each platform shows it (iOS keeps JSON types, Android
    // delivers every custom-event value as a string). `unverifiedOn` lists the platforms
    // on which a wire shape has not been captured from Cordova yet (none now: everything
    // here was seen on an Android emulator and an iOS simulator, 2026-10-01). A `path` may
    // be an object { android, ios } where the platforms put the same thing in different places.
    var STEPS = [
        {
            id: 'screen-load',
            description: 'Log a screen entered, with a referrer',
            needs: 'logScreenViewContextLoad',
            run: function (A) { return A.logScreenViewContextLoad('e2e_checkout', 'e2e_cart'); },
            expect: [
                { check: 'screenview-present', screenName: 'e2e_checkout', state: 'LOAD', referrer: 'e2e_cart' }
            ]
        },
        {
            id: 'custom-event',
            description: 'Log a custom event with string, number and boolean values',
            needs: 'logCustomEvent',
            run: function (A) { return A.logCustomEvent('e2e_purchase', { sku: 'A1', qty: 2, gift: true }); },
            expect: [
                { check: 'value', type: 5, eventName: 'e2e_purchase', path: 'sku', expected: 'A1' },
                { check: 'value', type: 5, eventName: 'e2e_purchase', path: 'qty', expected: 2 },
                { check: 'value', type: 5, eventName: 'e2e_purchase', path: 'gift', expected: true }
            ]
        },
        {
            id: 'click',
            description: 'Log a click on a control, with extra data',
            needs: 'logClickEvent',
            run: function (A) { return A.logClickEvent('e2e_btn', { screen: 'e2e' }); },
            expect: [
                { check: 'value', type: 5, eventName: 'click', path: 'controlId', expected: 'e2e_btn' },
                { check: 'value', type: 5, eventName: 'click', path: 'screen', expected: 'e2e' }
            ]
        },
        {
            id: 'text-change',
            description: 'Log typed text; it must reach the wire masked, never in plaintext',
            needs: 'logTextChangeEvent',
            run: function (A) { return A.logTextChangeEvent('e2e_txt', { text: SECRET_TEXT }); },
            expect: [
                { check: 'value', type: 5, eventName: 'textChange', path: 'controlId', expected: 'e2e_txt' },
                { check: 'value', type: 5, eventName: 'textChange', path: 'text', expected: MASKED_TEXT },
                { check: 'value', type: 5, eventName: 'textChange', path: 'masked', expected: true },
                { check: 'payload-excludes', text: SECRET_TEXT }
            ]
        },
        {
            id: 'signal',
            description: 'Log a signal with a nested object, a nested number and an array of objects',
            needs: 'logSignal',
            run: function (A) {
                return A.logSignal({
                    signalContent: { signalType: 'e2e', url: 'https://e2e.example.com/checkout' },
                    cart: { items: 3, total: 24.99 },
                    audience: [{ name: 'Account ID', value: '42' }]
                });
            },
            expect: [
                { check: 'value', type: 21, viaLogSignal: true, path: 'signalContent.signalType', expected: 'e2e' },
                { check: 'value', type: 21, viaLogSignal: true, path: 'cart.items', expected: 3 },
                { check: 'value', type: 21, viaLogSignal: true, path: 'cart.total', expected: 24.99 }
            ]
        },
        {
            id: 'exception',
            description: 'Log a handled exception with a stack',
            needs: 'logExceptionEvent',
            run: function (A) { return A.logExceptionEvent('e2e exception', 'Error: e2e\n    at e2e.js:1', false); },
            expect: [
                { check: 'value', type: 6, path: 'name', expected: 'Cordova Plugin' },
                { check: 'value', type: 6, path: 'description', expected: 'e2e exception' },
                { check: 'value', type: 6, path: 'unhandled', expected: false },
                // Android keeps the stack in stackTrace. iOS has no call stack in an NSException,
                // logs "(null)" there, and the stack arrives in data.stacktrace.
                { check: 'value', type: 6, path: { android: 'stackTrace', ios: 'data.stacktrace' }, expected: 'Error: e2e\n    at e2e.js:1' }
            ]
        },
        {
            id: 'identity',
            description: 'Log an identity (rides as a signal, type 21, never type 24)',
            needs: 'logIdentity',
            run: function (A) { return A.logIdentity('Email', 'e2e@example.com', 'loggedIn', { loginMethod: 'email' }); },
            expect: [
                { check: 'value', type: 21, path: 'loginMethod', expected: 'email' }
            ]
        },
        {
            id: 'screen-unload',
            description: 'Log the previous screen left (not the one just loaded: the Android SDK drops a screen view whose screen is still queued)',
            needs: 'logScreenViewContextUnload',
            run: function (A) { return A.logScreenViewContextUnload('e2e_cart', 'e2e_checkout'); },
            expect: [
                { check: 'screenview-present', screenName: 'e2e_cart', state: 'UNLOAD', referrer: 'e2e_checkout' }
            ]
        },
        {
            id: 'flush',
            description: 'Flush the queue',
            needs: 'flushQueues',
            run: function (A) { return A.flushQueues(); },
            expect: []
        }
    ];

    // Present on any run regardless of the steps (the SDK registers the device itself).
    var BASELINE = [{ check: 'type-present', type: 22 }];

    function describeError(error) {
        if (error && typeof error === 'object') {
            return (error.code ? error.code + ': ' : '') + (error.message || JSON.stringify(error));
        }
        return String(error);
    }

    // Runs the steps strictly in order. A failing or unavailable step is recorded and the
    // run carries on, so one broken method does not hide the state of the others.
    async function runScenario(api) {
        var results = [];
        for (var i = 0; i < STEPS.length; i += 1) {
            var step = STEPS[i];
            if (typeof api[step.needs] !== 'function') {
                results.push({ id: step.id, status: 'unavailable', error: 'plugin has no ' + step.needs + '()' });
                continue;
            }
            try {
                await step.run(api);
                results.push({ id: step.id, status: 'ok' });
            } catch (error) {
                results.push({ id: step.id, status: 'failed', error: describeError(error) });
            }
        }
        var failed = results.filter(function (r) { return r.status === 'failed'; }).length;
        var unavailable = results.filter(function (r) { return r.status === 'unavailable'; }).length;
        return { ok: failed === 0 && unavailable === 0, failed: failed, unavailable: unavailable, results: results };
    }

    // Every step's wire expectation, tagged with the step that produced it.
    function expectations() {
        var list = [];
        STEPS.forEach(function (step) {
            step.expect.forEach(function (e) {
                var copy = { step: step.id };
                Object.keys(e).forEach(function (k) { copy[k] = e[k]; });
                list.push(copy);
            });
        });
        return list;
    }

    function defaultSleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // The scenario must not start before the SDK is up. A rejected check counts as
    // "not ready yet" rather than aborting the wait.
    async function waitForSdk(api, options) {
        var opts = options || {};
        var maxTries = opts.maxTries || 30;
        var intervalMs = opts.intervalMs || 1000;
        var sleep = opts.sleep || defaultSleep;
        for (var i = 0; i < maxTries; i += 1) {
            try {
                if (await api.isSdkEnabled()) return true;
            } catch (_) { /* not up yet */ }
            if (i < maxTries - 1) await sleep(intervalMs);
        }
        return false;
    }

    // One greppable line for logcat / os_log, so a runner can tell when the app is done.
    function formatDoneLine(summary) {
        var status = summary.noPlugin ? 'no-plugin'
            : summary.timeout ? 'sdk-timeout'
            : (summary.ok ? 'pass' : 'fail');
        return 'E2E_DONE status=' + status + ' steps=' + summary.results.length +
            ' failed=' + summary.failed + ' unavailable=' + summary.unavailable;
    }

    return {
        SECRET_TEXT: SECRET_TEXT,
        STEPS: STEPS,
        BASELINE: BASELINE,
        runScenario: runScenario,
        expectations: expectations,
        waitForSdk: waitForSdk,
        formatDoneLine: formatDoneLine
    };
}));
