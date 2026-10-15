/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Logic of the Behaviour testing screens (Showcase and Verification), kept free of
 * DOM access so it can be unit-tested. Modelled on the React Native example app
 * (Examples/shared): the same payloads, the same scenario registry shape.
 */

'use strict';

(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        root.BehaviourCore = api;
    }
}(typeof self !== 'undefined' ? self : this, function () {

    var MAX_DEPTH = 5;
    var SAMPLE_TEXT = 'hunter2-secret';
    var DIRECT_REFERRER = 'Screen View Diagnostics';

    var CUSTOM_EVENT = {
        name: 'demoCustomEvent',
        values: { tier: 'pro', isTrial: false, seats: 2 },
        level: 1
    };

    var NESTED_SIGNAL = {
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

    var FLAT_SIGNAL = { signalType: 'pageview', pageCategory: 'behaviour-demo' };

    // An item no SDK module reads, so writing it changes no behaviour.
    var CONFIG_PROBE = { key: 'DemoConfigProbe', value: 'roundtrip', module: 'EOCore' };

    // Renders a name so a blank or null one is visible rather than invisible.
    function describeName(name) {
        if (name === null || name === undefined) return '(null)';
        if (name === '') return '(empty string)';
        if (name.trim() === '') return '(whitespace ×' + name.length + ')';
        if (name.length > 48) return name.slice(0, 45) + '… (' + name.length + ' chars)';
        return name;
    }

    // What the plugin sends for a masked text: one X per code point.
    function maskPreview(text) {
        return Array.from(text).map(function () { return 'X'; }).join('');
    }

    // ── Screen chain (Showcase › Screen view) ───────────────────────────

    function openScreen(chain, name) {
        if (chain.length >= MAX_DEPTH) {
            return { chain: chain.slice(), load: null, blocked: true };
        }
        var referrer = chain.length ? chain[chain.length - 1] : null;
        return {
            chain: chain.concat([name]),
            load: { name: name, referrer: referrer },
            blocked: false
        };
    }

    function closeScreen(chain) {
        if (!chain.length) return { chain: [], unload: null };
        var name = chain[chain.length - 1];
        var rest = chain.slice(0, -1);
        return {
            chain: rest,
            unload: { name: name, referrer: rest.length ? rest[rest.length - 1] : null }
        };
    }

    // ── Direct screen view with an exact name ───────────────────────────

    var DIRECT_CASES = [
        { id: 'plain',      name: 'Plain Name' },
        { id: 'spaces',     name: 'Name With  Spaces' },
        { id: 'unicode',    name: 'Страница 日本語 😀' },
        { id: 'long',       name: 'L'.repeat(64) },
        { id: 'empty',      name: '' },
        { id: 'whitespace', name: '   ' },
        { id: 'null',       name: null }
    ];

    function errorMessage(error, fallback) {
        return (error && error.message) ? error.message : (fallback || 'failed');
    }

    // Sends every case in order. A rejected case is a result, not a failure of the run:
    // the bridge refuses blank and null names, and the card shows that.
    function runDirectCases(A) {
        return DIRECT_CASES.reduce(function (previous, testCase) {
            return previous.then(function (results) {
                return A.logScreenViewContextLoad(testCase.name, DIRECT_REFERRER)
                    .then(function () { return results.concat([{ id: testCase.id, ok: true, shown: describeName(testCase.name) }]); },
                          function (e) { return results.concat([{ id: testCase.id, ok: false, shown: describeName(testCase.name), message: errorMessage(e) }]); });
            });
        }, Promise.resolve([]));
    }

    // ── Showcase features ───────────────────────────────────────────────

    var FEATURES = [
        { id: 'taps',         title: 'Taps',                 description: 'Count taps and log each one as a click event.' },
        { id: 'text',         title: 'Text entry',           description: 'Log typing masked (default) or in plain text.' },
        { id: 'custom-event', title: 'Custom event',         description: 'One event with string, boolean and number values.' },
        { id: 'signal',       title: 'Signals',              description: 'Nested and flat signal payloads.' },
        { id: 'exception',    title: 'Exception',            description: 'A handled exception with a stack text.' },
        { id: 'screen-view',  title: 'Screen view',          description: 'Load and unload screens with a referrer chain, or an exact name.' },
        { id: 'identity',     title: 'Identity',             description: 'Default signal type versus an explicit one.' },
        { id: 'config',       title: 'Config item',          description: 'Set and read a native SDK configuration item at runtime.' }
    ];

    // ── Verification scenarios ──────────────────────────────────────────
    // key, title, action (what to do), expected (what the collector must show),
    // channel, platform, run(A).

    var SCENARIOS = [
        {
            key: 'custom-event-types', title: 'Custom event value types', channel: 'custom-event', platform: 'both',
            action: 'Run. One event with a string, a boolean and a number, level 1.',
            expected: 'iOS: data.value.tier "pro", isTrial false, seats 2 (JSON types). Android: flat, values stringified.',
            run: function (A) { return A.logCustomEvent(CUSTOM_EVENT.name, CUSTOM_EVENT.values, CUSTOM_EVENT.level); }
        },
        {
            key: 'nested-signal', title: 'Nested signal', channel: 'signal', platform: 'both',
            action: 'Run. Signal with signalContent and an audience array.',
            expected: 'Type 6 message; payload under signal.data.value on iOS, at the root of signal on Android.',
            run: function (A) { return A.logSignal(NESTED_SIGNAL); }
        },
        {
            key: 'flat-signal', title: 'Flat signal', channel: 'signal', platform: 'both',
            action: 'Run. Signal with two top-level string keys.',
            expected: 'Type 6 message with signalType "pageview" and pageCategory "behaviour-demo".',
            run: function (A) { return A.logSignal(FLAT_SIGNAL); }
        },
        {
            key: 'identity-defaults', title: 'Identity, default signal type', channel: 'signal', platform: 'both',
            action: 'Run. logIdentity("Email", "defaults@example.com") with no signal type.',
            expected: 'Type 21 signal, not wrapped in data.value. Never a type 24 message.',
            run: function (A) { return A.logIdentity('Email', 'defaults@example.com'); }
        },
        {
            key: 'identity-explicit', title: 'Identity, explicit signal type', channel: 'signal', platform: 'both',
            action: 'Run. Signal type "accountRegistered" with registrationMethod "email".',
            expected: 'Type 21 signal carrying accountRegistered and registrationMethod.',
            run: function (A) {
                return A.logIdentity('Email', 'explicit@example.com', 'accountRegistered', { registrationMethod: 'email' });
            }
        },
        {
            key: 'click', title: 'Click event', channel: 'custom-event', platform: 'both',
            action: 'Run. Logs a click for control "scenario_btn".',
            expected: 'Custom event "click" with controlId "scenario_btn".',
            run: function (A) { return A.logClickEvent('scenario_btn', { screen: 'verification' }); }
        },
        {
            key: 'text-masked', title: 'Text change, masked', channel: 'custom-event', platform: 'both',
            action: 'Run. Logs the sample text "' + SAMPLE_TEXT + '" with the default masking.',
            expected: 'Custom event "textChange" with only X characters (' + maskPreview(SAMPLE_TEXT).length + '); the sample text appears nowhere in the payload.',
            run: function (A) { return A.logTextChangeEvent('scenario_txt', { text: SAMPLE_TEXT }); }
        },
        {
            key: 'text-plain', title: 'Text change, plain', channel: 'custom-event', platform: 'both',
            action: 'Run. Same text with masked: false.',
            expected: 'Custom event "textChange" carrying the sample text as typed.',
            run: function (A) { return A.logTextChangeEvent('scenario_txt', { text: SAMPLE_TEXT, masked: false }); }
        },
        {
            key: 'screen-chain', title: 'Screen view referrer chain', channel: 'screenview', platform: 'both',
            action: 'Run. Loads Chain 1, 2, 3 (each with the previous as referrer), then unloads back to the first.',
            expected: 'Type 2 messages in order with referrers null, Chain 1, Chain 2. Android may drop a screen whose earlier message is still queued.',
            run: function (A) {
                var chain = [];
                var steps = ['Chain 1', 'Chain 2', 'Chain 3'];
                var p = Promise.resolve();
                steps.forEach(function (name) {
                    p = p.then(function () {
                        var r = openScreen(chain, name);
                        chain = r.chain;
                        return A.logScreenViewContextLoad(r.load.name, r.load.referrer);
                    });
                });
                steps.forEach(function () {
                    p = p.then(function () {
                        var r = closeScreen(chain);
                        chain = r.chain;
                        return A.logScreenViewContextUnload(r.unload.name, r.unload.referrer);
                    });
                });
                return p;
            }
        },
        {
            key: 'config-roundtrip', title: 'Config item round trip', channel: 'config', platform: 'both',
            action: 'Run. Writes ' + CONFIG_PROBE.key + ' = "' + CONFIG_PROBE.value + '" to module ' + CONFIG_PROBE.module + ' and reads it back.',
            expected: 'Queued, which here means the value read back equals the value written. Nothing is sent to the collector.',
            run: function (A) {
                return A.setConfigItem(CONFIG_PROBE.key, CONFIG_PROBE.value, CONFIG_PROBE.module)
                    .then(function () { return A.getConfigItem(CONFIG_PROBE.key, '', CONFIG_PROBE.module); })
                    .then(function (value) {
                        if (value !== CONFIG_PROBE.value) {
                            throw new Error('config item read back as ' + JSON.stringify(value) + ', expected ' + JSON.stringify(CONFIG_PROBE.value));
                        }
                    });
            }
        },
        {
            key: 'exception', title: 'Handled exception', channel: 'exception', platform: 'both',
            action: 'Run. Logs a handled exception with a stack text.',
            expected: 'Exception message named "Cordova Plugin". iOS keeps the stack in data.stacktrace (stackTrace is "(null)"); Android in stackTrace.',
            run: function (A) {
                return A.logExceptionEvent('Scenario handled exception', 'Error: scenario\n    at scenario (behaviour.js)', false);
            }
        }
    ];

    function findScenario(key) {
        return SCENARIOS.filter(function (s) { return s.key === key; })[0];
    }

    function scenariosFor(platform) {
        return SCENARIOS.filter(function (s) { return s.platform === 'both' || s.platform === platform; });
    }

    // Runs one scenario and returns its outcome. A resolved promise means the SDK queued
    // the message, not that the collector has it.
    function runScenario(scenario, A) {
        if (!A || typeof A.logCustomEvent !== 'function') {
            return Promise.resolve({ key: scenario.key, ok: false, message: 'This plugin version has no analytics API' });
        }
        return Promise.resolve()
            .then(function () { return scenario.run(A); })
            .then(function () { return { key: scenario.key, ok: true, message: 'queued' }; },
                  function (e) { return { key: scenario.key, ok: false, message: errorMessage(e) }; });
    }

    return {
        MAX_DEPTH: MAX_DEPTH,
        SAMPLE_TEXT: SAMPLE_TEXT,
        CUSTOM_EVENT: CUSTOM_EVENT,
        NESTED_SIGNAL: NESTED_SIGNAL,
        FLAT_SIGNAL: FLAT_SIGNAL,
        CONFIG_PROBE: CONFIG_PROBE,
        DIRECT_CASES: DIRECT_CASES,
        FEATURES: FEATURES,
        SCENARIOS: SCENARIOS,
        describeName: describeName,
        maskPreview: maskPreview,
        openScreen: openScreen,
        closeScreen: closeScreen,
        runDirectCases: runDirectCases,
        findScenario: findScenario,
        scenariosFor: scenariosFor,
        runScenario: runScenario
    };
}));
