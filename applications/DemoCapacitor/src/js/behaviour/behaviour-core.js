/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Logic of the Behaviour testing screens (Showcase and Verification), kept free of
 * DOM access so it can be unit-tested. The same payloads and scenario registry as the Cordova Demo app
 * (applications/Demo), which is modelled on the React Native example app.
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

    // ── Current screen (tabs, Behaviour sub-tabs, the Gestures view) ─────
    //
    // The app is one native screen, so the page logs its own screens, named as in the native and React Native samples.

    var TAB_SCREENS = { notification: 'Push', identity: 'Identity' };
    var SUBTAB_SCREENS = { actions: 'Behaviour', showcase: 'Showcase', verification: 'Verification' };
    var GESTURE_SCREEN = 'Gestures';

    // Moving to another screen enters the next one with the current one as referrer, then leaves the current one (its
    // UNLOAD keeps the referrer it was entered with): the Android SDK refuses an UNLOAD of the current screen, so the next
    // one is loaded first. Moving to the current screen logs nothing.
    function moveScreen(current, name) {
        if (current && current.name === name) return { current: current, unload: null, load: null };
        var referrer = current ? current.name : null;
        return {
            current: { name: name, referrer: referrer },
            unload: current ? { name: current.name, referrer: current.referrer } : null,
            load: { name: name, referrer: referrer }
        };
    }

    // Keeps one current screen and logs each move while the SDK is enabled; enabling logs the move to the screen on
    // display, and disabling forgets what was logged, so the next enable loads that screen again. `show` and `setEnabled` return the outcome ({ ok, message }) of the LOAD and of the UNLOAD, null for a
    // call not made. An outcome never rejects, and the calls go out in order, the LOAD first.
    function createScreenTracker(api) {
        var shown = null;
        var logged = null;
        var enabled = false;
        var queue = Promise.resolve();

        function call(method, view) {
            queue = queue.then(function () {
                var A = api();
                if (!A || typeof A[method] !== 'function') throw new Error('This plugin version has no ' + method);
                return A[method](view.name, view.referrer);
            }).then(function () { return { ok: true }; },
                    function (e) { return { ok: false, message: errorMessage(e) }; });
            return queue;
        }

        function sync() {
            if (!enabled || shown === null) return { unload: null, load: null };
            var move = moveScreen(logged, shown);
            logged = move.current;
            var load = move.load ? call('logScreenViewContextLoad', move.load) : null;
            var unload = move.unload ? call('logScreenViewContextUnload', move.unload) : null;
            return { unload: unload, load: load };
        }

        return {
            show: function (name) { shown = name; return sync(); },
            setEnabled: function (value) {
                enabled = value;
                if (!value) logged = null;
                return sync();
            },
            current: function () { return shown; }
        };
    }

    // The screen on display: a tab, on Behaviour its sub-tab, and on Showcase the Gestures view while it is open.
    function screenFor(page) {
        if (!page.tab) return null;
        if (page.tab !== 'behaviour') return TAB_SCREENS[page.tab];
        if (page.subtab === 'showcase' && page.gesturesOpen) return GESTURE_SCREEN;
        return SUBTAB_SCREENS[page.subtab];
    }

    // What the page shows, logged through one screen tracker: the demos report the tab, the sub-tab and the Gestures
    // view, and a report that does not change the screen on display logs nothing.
    function createPageScreens(api) {
        var tracker = createScreenTracker(api);
        var page = { tab: null, subtab: 'actions', gesturesOpen: false };
        function sync() {
            var name = screenFor(page);
            return name === null ? { unload: null, load: null } : tracker.show(name);
        }
        return {
            showTab: function (tab, subtab) {
                page.tab = tab;
                if (subtab) page.subtab = subtab;
                return sync();
            },
            showSubtab: function (subtab) { page.subtab = subtab; return sync(); },
            setGesturesOpen: function (open) { page.gesturesOpen = open; return sync(); },
            setEnabled: tracker.setEnabled,
            current: tracker.current
        };
    }

    var GESTURE_ROWS = 40;
    var LONG_PRESS_MS = 500;
    var DOUBLE_TAP_MS = 300;
    var TAP_SLOP = 8;
    var SWIPE_THRESHOLD = 48;
    var MIN_ZOOM = 0.5;
    var MAX_ZOOM = 4;

    function gestureLabel(name) {
        return 'Last gesture: ' + (name || 'none');
    }

    function gestureRows() {
        var rows = [];
        for (var i = 0; i < GESTURE_ROWS; i++) {
            rows.push({ id: 'gesture_row_' + i, text: 'Scrollable row ' + (i + 1) });
        }
        return rows;
    }

    function swipeName(dx, dy) {
        var ax = Math.abs(dx);
        var ay = Math.abs(dy);
        if (ax < SWIPE_THRESHOLD && ay < SWIPE_THRESHOLD) return null;
        if (ax >= ay) return dx > 0 ? 'swipeRight' : 'swipeLeft';
        return dy > 0 ? 'swipeDown' : 'swipeUp';
    }

    function pressName(heldMs) {
        return heldMs >= LONG_PRESS_MS ? 'longPress' : 'tap';
    }

    function isDoubleTap(previousUpAt, downAt) {
        return typeof previousUpAt === 'number' && downAt - previousUpAt <= DOUBLE_TAP_MS;
    }

    function distance(a, b) {
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    function pinchName(previousDistance, currentDistance) {
        if (!(previousDistance > 0) || currentDistance === previousDistance) return null;
        return currentDistance > previousDistance ? 'zoomIn' : 'zoomOut';
    }

    function clampZoom(zoom, factor) {
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    }

    // ── Showcase features ───────────────────────────────────────────────

    var FEATURES = [
        { id: 'taps',         title: 'Taps',                 description: 'Count taps and log each one as a click event.' },
        { id: 'gestures',     title: 'Gestures',             description: 'Long press, double tap, swipe and pinch targets and a scrollable list, with nothing logged by the page.' },
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
            expected: 'Exception message named "Capacitor Plugin". iOS keeps the stack in data.stacktrace (stackTrace is "(null)"); Android in stackTrace.',
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
        TAB_SCREENS: TAB_SCREENS,
        SUBTAB_SCREENS: SUBTAB_SCREENS,
        GESTURE_SCREEN: GESTURE_SCREEN,
        LONG_PRESS_MS: LONG_PRESS_MS,
        DOUBLE_TAP_MS: DOUBLE_TAP_MS,
        TAP_SLOP: TAP_SLOP,
        SWIPE_THRESHOLD: SWIPE_THRESHOLD,
        MIN_ZOOM: MIN_ZOOM,
        MAX_ZOOM: MAX_ZOOM,
        FEATURES: FEATURES,
        SCENARIOS: SCENARIOS,
        describeName: describeName,
        maskPreview: maskPreview,
        openScreen: openScreen,
        closeScreen: closeScreen,
        moveScreen: moveScreen,
        createScreenTracker: createScreenTracker,
        screenFor: screenFor,
        createPageScreens: createPageScreens,
        runDirectCases: runDirectCases,
        gestureLabel: gestureLabel,
        gestureRows: gestureRows,
        swipeName: swipeName,
        pressName: pressName,
        isDoubleTap: isDoubleTap,
        distance: distance,
        pinchName: pinchName,
        clampZoom: clampZoom,
        findScenario: findScenario,
        scenariosFor: scenariosFor,
        runScenario: runScenario
    };
}));
