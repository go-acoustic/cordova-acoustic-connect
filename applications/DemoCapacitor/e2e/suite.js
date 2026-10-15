'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The wire expectations for the Capacitor plugin: the Cordova e2e scenario
 * (e2e/core/scenario.js), which the example app also runs, so the calls and
 * the checks stay one list. Two rows differ for this plugin:
 *   - the exception is named after the plugin ("Capacitor Plugin");
 *   - the layout row is not applicable when layout capture is off (see LAYOUT_OFF_REASON);
 *   - the push registration row (type 22) is not applicable when push is off or Android has no Firebase config.
 */

const cordova = require('../../../e2e/core/suite.js');
const scenario = require('../../../e2e/core/scenario.js');

const PLATFORMS = ['android', 'ios'];

// The Cordova phases (which platforms they run on, what they check), with the settings that set each one up written as
// the plugin's capacitor.config block.
const CONNECT_CONFIG = {
    'default': {},
    'screen-capture-off': { screenCaptureEnabled: false },
    'layout-config-off': {
        layoutConfigIos: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } } },
        layoutConfigAndroid: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } } }
    }
};
const PHASES = {};
Object.keys(cordova.PHASES).forEach(function (name) {
    // Cordova runs the capture-off phases on iOS only, as it has no baseline to compare Android against; here Android
    // runs them too, on an SDK that captures layout by default (see parseArgs in run.js)
    PHASES[name] = Object.assign({}, cordova.PHASES[name], { platforms: PLATFORMS, connectConfig: CONNECT_CONFIG[name] });
});

const LAYOUT_OFF_REASON = 'layout capture is off: on Connect Android before 11.1.10 the layout of a WebView screen ' +
    'never completes and holds back every later message, so the plugin turns it off (screenCaptureEnabled: true overrides)';

const PUSH_OFF_REASON = 'push is not part of this run: pushEnabled is off in the example config, or the Android app has no google-services.json';

function buildSuite(args) {
    const platform = args && args.platform;
    if (PLATFORMS.indexOf(platform) === -1) {
        throw new Error('platform must be android or ios (got ' + JSON.stringify(platform) + ')');
    }
    const phase = (args && args.phase) || 'default';
    if (!PHASES[phase]) throw new Error('phase must be one of ' + Object.keys(PHASES).join(', ') + ' (got ' + JSON.stringify(phase) + ')');
    if (phase !== 'default') {
        // the screen views the app logs itself stay, and no layout is sent
        return cordova.buildSuite({ platform: 'android', phase: 'default' })
            .filter(function (row) { return row.check === 'screenview-present'; })
            .concat([{
                name: 'capture off (' + PHASES[phase].description + '): no layout (type 10) is sent',
                check: 'type-absent', type: 10
            }]);
    }
    // steps for APIs the Capacitor plugin does not have yet are skipped by the app, so their checks stay out
    const skipped = scenario.OPTIONAL_STEP_IDS;
    const rows = cordova.buildSuite({ platform: platform, phase: phase }).filter(function (row) {
        return !skipped.some(function (id) { return row.name.indexOf(id + ':') === 0; });
    }).map(function (row) {
        if (row.check === 'value' && row.type === 6 && row.path === 'name') {
            return Object.assign({}, row, {
                name: row.name.replace('Cordova Plugin', 'Capacitor Plugin'),
                expected: 'Capacitor Plugin'
            });
        }
        if (row.check === 'layout-controls' && !args.layoutExpected) {
            return { name: row.name, na: LAYOUT_OFF_REASON };
        }
        if (row.check === 'type-present' && row.type === 22 && args.pushExpected === false) {
            return { name: row.name, na: PUSH_OFF_REASON };
        }
        return row;
    });
    return args.pushExpected === false ? rows : rows.concat(pushRegistrationRows(platform));
}

/**
 * What the registration for push must look like, which the Cordova scenario only checks for presence: the provider of the platform, a
 * device token that is not empty (the first registration on iOS goes out before the system has handed one over, and a later one carries
 * it), and on Android that the notification permission was granted (the run grants it, as the dialog cannot be answered by a script).
 * The iOS registration has no acceptPush.
 */
function pushRegistrationRows(platform) {
    const rows = [
        { name: 'push: registration provider is ' + (platform === 'ios' ? 'APN' : 'FCM'), check: 'value', type: 22,
            path: 'mobileProvider', expected: platform === 'ios' ? 'APN' : 'FCM', jsonType: 'string' },
        { name: 'push: registration carries the device token', check: 'value', type: 22,
            path: 'mobileToken', jsonType: 'string', nonEmpty: true }
    ];
    if (platform === 'android') {
        rows.push({ name: 'push: the notification permission was granted (acceptPush)', check: 'value', type: 22,
            path: 'acceptPush', expected: true, jsonType: 'boolean' });
    }
    return rows;
}

module.exports = { buildSuite, PHASES, LAYOUT_OFF_REASON, PUSH_OFF_REASON };
