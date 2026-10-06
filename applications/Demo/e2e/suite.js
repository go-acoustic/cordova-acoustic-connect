#!/usr/bin/env node
'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Builds the manifest for the release-verification assertion engine
 * (.claude/skills/release-verification/scripts/assert-messages.mjs, `suite --file`)
 * from the e2e scenario's wire expectations, so the checks cannot drift from the calls.
 *
 *   node e2e/suite.js --platform android|ios [--phase default] [--out suite.json]
 *
 * The scenario's expectations are platform-neutral. Two things differ per platform and
 * are decided here:
 *   - custom events: iOS nests the values under data.value and keeps JSON types; Android
 *     keeps them flat and delivers every value as a string;
 *   - capture: iOS sends a layout (type 10, with a screenshot); the Android SDK sent none
 *     in the default configuration, so layout rows are N/A there, with the reason.
 */

const fs = require('fs');
const path = require('path');
const scenario = require('../www/js/e2e/scenario.js');

const PLATFORMS = ['android', 'ios'];

// A phase is one app run. `connectConfig` is what that run needs in ConnectConfig.json's
// Connect block (the e2e runner applies it on top of the sink settings).
const PHASES = {
    'default': {
        description: 'SDK defaults',
        platforms: ['android', 'ios'],
        connectConfig: {}
    },
    'screen-capture-off': {
        description: 'ScreenCaptureEnabled: false',
        platforms: ['ios'],
        connectConfig: { ScreenCaptureEnabled: false }
    },
    'layout-config-off': {
        description: 'layoutConfigIos with CaptureLayoutOn: 0',
        platforms: ['ios'],
        connectConfig: { layoutConfigIos: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } } } }
    }
};

// The capture-off phases need a baseline run with a layout and a comparison of Android's
// ScreenCaptureEnabled: false against it, which has not been done, so they run on iOS only.
const NOT_ON_ANDROID = 'the capture-off phases are not run on Android yet';
const UNVERIFIED = ' [wire shape not yet captured from Cordova]';

function appliesTo(platform, phase) {
    return Boolean(PHASES[phase]) && PHASES[phase].platforms.indexOf(platform) !== -1;
}

function jsonTypeOf(value) {
    return typeof value;   // string | number | boolean - all this scenario expects
}

function describe(e) {
    switch (e.check) {
        case 'screenview-present':
            return 'screen view ' + e.state + ' ' + e.screenName + (e.referrer ? ' (referrer ' + e.referrer + ')' : '');
        case 'value':
            return (e.type === 5 ? e.eventName : e.type === 6 ? 'exception' : 'signal') + ' ' + e.path + ' = ' + JSON.stringify(e.expected);
        case 'type-present':
            return 'type ' + e.type + ' present';
        case 'payload-excludes':
            return 'the typed secret text appears nowhere on the wire';
        default:
            return e.check;
    }
}

// One platform-neutral expectation -> one manifest row for this platform.
function adapt(source, platform) {
    // a path may differ per platform (the exception stack does)
    const e = Object.assign({}, source);
    if (e.path && typeof e.path === 'object') e.path = e.path[platform];

    const unverified = (e.unverifiedOn || []).indexOf(platform) !== -1;
    const row = { name: e.step + ': ' + describe(e) + (unverified ? UNVERIFIED : '') };
    switch (e.check) {
        case 'screenview-present':
            row.check = e.check;
            row.screenName = e.screenName;
            row.state = e.state;
            if (e.referrer !== undefined) row.referrer = e.referrer;
            return row;
        case 'value':
            row.check = 'value';
            row.type = e.type;
            if (e.eventName !== undefined) row.eventName = e.eventName;
            row.path = e.path;
            if (e.type === 5) {
                // custom events: the shape and the value types depend on the platform
                row.platform = platform;
                row.expected = platform === 'android' ? String(e.expected) : e.expected;
                row.jsonType = platform === 'android' ? 'string' : jsonTypeOf(e.expected);
            } else {
                // signals keep their JSON types on both platforms, but a logSignal payload is
                // nested under signal.data.value on iOS and sits at the root on Android
                if (e.type === 21) row.platform = platform;
                // iOS must nest a logSignal payload under signal.data.value; without the shape the engine
                // falls back to the root of signal, which a flat (broken) payload would also satisfy.
                // logIdentity signals are never wrapped, so they stay lenient.
                if (e.type === 21 && e.viaLogSignal && platform === 'ios') row.shape = 'wrapped';
                row.expected = e.expected;
                row.jsonType = jsonTypeOf(e.expected);
            }
            return row;
        case 'type-present':
            row.check = e.check;
            row.type = e.type;
            return row;
        case 'payload-excludes':
            row.check = e.check;
            row.text = e.text;
            return row;
        default:
            throw new Error('suite.js does not know how to adapt the check "' + e.check + '"');
    }
}

function buildSuite(args) {
    const platform = args && args.platform;
    const phase = (args && args.phase) || 'default';
    if (PLATFORMS.indexOf(platform) === -1) {
        throw new Error('platform must be android or ios (got ' + JSON.stringify(platform) + ')');
    }
    if (!PHASES[phase]) {
        throw new Error('phase must be one of ' + Object.keys(PHASES).join(', ') + ' (got ' + JSON.stringify(phase) + ')');
    }
    if (!appliesTo(platform, phase)) {
        throw new Error('phase "' + phase + '" does not apply to ' + platform + ': ' + NOT_ON_ANDROID);
    }

    const rows = [];

    if (phase === 'default') {
        rows.push({ name: 'baseline: session start (type 1)', check: 'type-present', type: 1 });
        scenario.BASELINE.forEach(function (b) {
            rows.push({ name: 'baseline: ' + describe(b), check: b.check, type: b.type });
        });
        scenario.expectations().forEach(function (e) { rows.push(adapt(e, platform)); });
        rows.push({ name: 'capture: layout (type 10) has non-empty control trees', check: 'layout-controls' });
        return rows;
    }

    // capture-off phases (iOS): no layout, yet the screen views the app logs itself stay
    scenario.expectations()
        .filter(function (e) { return e.check === 'screenview-present'; })
        .forEach(function (e) { rows.push(adapt(e, platform)); });
    rows.push({ name: 'capture off (' + PHASES[phase].description + '): no layout (type 10) is sent', check: 'type-absent', type: 10 });
    return rows;
}

function main() {
    const argv = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
    try {
        const manifest = buildSuite({ platform: opts.platform, phase: opts.phase });
        const json = JSON.stringify(manifest, null, 2) + '\n';
        if (opts.out) {
            fs.writeFileSync(path.resolve(opts.out), json);
            console.log('wrote ' + manifest.length + ' rows to ' + opts.out);
        } else {
            process.stdout.write(json);
        }
    } catch (error) {
        console.error('ERROR: ' + error.message);
        process.exit(1);
    }
}

module.exports = { PHASES, appliesTo, buildSuite };

if (require.main === module) {
    main();
}
