'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The device-facing commands of the e2e runner, as plain data, and the parsers for what
 * they print. No process is started here, so everything is unit-testable.
 */

const PLUGIN_ID = 'co.acoustic.connect.push';
const NPM_PACKAGE = 'cordova-acoustic-connect';
const IOS_BACKGROUND_APP = 'com.apple.Preferences';

function readAppId(configXml) {
    const match = /<widget\b[^>]*\bid="([^"]+)"/.exec(configXml);
    if (!match) throw new Error('config.xml has no widget id');
    return match[1];
}

function readAppName(configXml) {
    const match = /<name>([^<]+)<\/name>/.exec(configXml);
    return match ? match[1].trim() : null;
}

// Every adb call carries the serial: on a shared machine an unscoped adb command can reach
// emulators that are not ours.
function androidCommands(args) {
    if (!args || !args.serial) throw new Error('an Android serial is required');
    const s = ['-s', args.serial];
    const adb = function (rest) { return ['adb', s.concat(rest)]; };
    return {
        build: ['cordova', ['build', 'android']],
        install: adb(['install', '-r', args.apk]),
        launch: adb(['shell', 'am', 'start', '-n', args.appId + '/.MainActivity']),
        home: adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']),
        stop: adb(['shell', 'am', 'force-stop', args.appId]),
        clearLog: adb(['logcat', '-c']),
        logs: adb(['logcat', '-d']),
        model: adb(['shell', 'getprop', 'ro.product.model']),
        release: adb(['shell', 'getprop', 'ro.build.version.release'])
    };
}

function iosCommands(args) {
    const u = args.udid;
    return {
        build: ['cordova', ['build', 'ios', '--emulator']],
        boot: ['xcrun', ['simctl', 'boot', u]],
        install: ['xcrun', ['simctl', 'install', u, args.appPath]],
        launch: ['xcrun', ['simctl', 'launch', u, args.appId]],
        terminate: ['xcrun', ['simctl', 'terminate', u, args.appId]],
        // iOS has no "home key" command; opening another app sends ours to the background
        home: ['xcrun', ['simctl', 'launch', u, IOS_BACKGROUND_APP]],
        // a WKWebView console is usually not in the system log, so this may find nothing
        logs: ['xcrun', ['simctl', 'spawn', u, 'log', 'show', '--last', '3m', '--style', 'compact',
            '--predicate', 'eventMessage CONTAINS "E2E_DONE"']]
    };
}

// Switches the Demo to the plugin under test: the source in this repo (linked, so edits
// need no reinstall) or the published package.
function pluginCommands(args) {
    // --nosave: without it Cordova writes the plugin into the Demo's package.json and lock
    // file, which are tracked (a run once left a file: dependency there).
    const remove = ['cordova', ['plugin', 'rm', PLUGIN_ID, '--nosave']];
    if (args.mode === 'local') {
        if (!args.pluginDir) throw new Error('pluginDir is required for mode local');
        return [remove, ['cordova', ['plugin', 'add', args.pluginDir, '--link', '--nosave']]];
    }
    if (args.mode === 'npm') {
        return [remove, ['cordova', ['plugin', 'add', NPM_PACKAGE, '--nosave']]];
    }
    throw new Error('mode must be local or npm (got ' + JSON.stringify(args.mode) + ')');
}

function parseDoneLine(text) {
    const re = /E2E_DONE status=(\S+) steps=(\d+) failed=(\d+) unavailable=(\d+)/g;
    let last = null;
    let match;
    while ((match = re.exec(text)) !== null) last = match;
    return last
        ? { status: last[1], steps: Number(last[2]), failed: Number(last[3]), unavailable: Number(last[4]) }
        : null;
}

// The steps the app reports on its E2E_RESULT line: a JSON object, which a console line wraps in
// quotes with the inner quotes escaped and text after it. Returns the last one, or null.
function parseResultLine(text) {
    const marker = 'E2E_RESULT ';
    const at = String(text || '').lastIndexOf(marker);
    if (at === -1) return null;
    let body = String(text).slice(at + marker.length);
    if (body.indexOf('{\\"') === 0) body = body.replace(/\\"/g, '"');
    let depth = 0;
    let inString = false;
    for (let i = 0; i < body.length; i += 1) {
        const c = body[i];
        if (inString) {
            if (c === '\\') i += 1; else if (c === '"') inString = false;
        } else if (c === '"') {
            inString = true;
        } else if (c === '{') {
            depth += 1;
        } else if (c === '}') {
            depth -= 1;
            if (depth === 0) {
                try { return JSON.parse(body.slice(0, i + 1)); } catch (e) { return null; }
            }
        }
    }
    return null;
}

// One line per step that did not pass, for the report.
function problemSteps(result) {
    return ((result && result.results) || [])
        .filter(function (r) { return r.status !== 'ok'; })
        .map(function (r) { return r.id + ' ' + r.status + (r.error ? ': ' + r.error : ''); });
}

function parseAndroidSdkVersion(logcat) {
    const match = /EOCore\s*:\s*LibraryVersion:(\S+)/.exec(logcat);
    return match ? match[1] : null;
}

function parseIosPod(podfileLock) {
    const match = /^\s*- (AcousticConnect(?:Debug)?) \((\d[^)]*)\)/m.exec(podfileLock);
    return match ? { pod: match[1], version: match[2] } : null;
}

// Picks the simulator the CI stage runs on from `simctl list devices available -j`: a booted
// iPhone first (so no second one is started), otherwise one on the newest iOS runtime.
function pickIosSimulator(simctlJson) {
    let parsed;
    try {
        parsed = JSON.parse(simctlJson);
    } catch (e) {
        throw new Error('could not read the simctl output as JSON: ' + e.message);
    }
    const candidates = [];
    Object.keys((parsed && parsed.devices) || {}).forEach(function (runtime) {
        const match = /\.iOS-(\d+(?:-\d+)*)$/.exec(runtime);
        if (!match) return;
        const version = match[1].split('-').map(Number);
        parsed.devices[runtime].forEach(function (d) {
            if (d.isAvailable && /^iPhone/.test(d.name)) {
                candidates.push({ udid: d.udid, booted: d.state === 'Booted', version: version });
            }
        });
    });
    if (candidates.length === 0) throw new Error('no available iPhone simulator on an iOS runtime');
    candidates.sort(function (a, b) {
        if (a.booted !== b.booted) return a.booted ? -1 : 1;
        for (let i = 0; i < Math.max(a.version.length, b.version.length); i += 1) {
            const diff = (b.version[i] || 0) - (a.version[i] || 0);
            if (diff !== 0) return diff;
        }
        // same state and version: the lowest udid, so one agent always gets the same simulator
        return a.udid < b.udid ? -1 : a.udid > b.udid ? 1 : 0;
    });
    return candidates[0].udid;
}

function pickAndroidSerial(adbDevicesOutput, requested) {
    const usable = adbDevicesOutput.split('\n').slice(1)
        .map(function (line) { return line.trim().split(/\s+/); })
        .filter(function (parts) { return parts.length >= 2 && parts[1] === 'device'; })
        .map(function (parts) { return parts[0]; });
    if (requested) {
        if (usable.indexOf(requested) === -1) throw new Error('the requested device ' + requested + ' is not connected and authorized');
        return requested;
    }
    if (usable.length === 0) throw new Error('no Android device is connected and authorized');
    if (usable.length > 1) {
        throw new Error('several Android devices are connected (' + usable.join(', ') + '); pick yours with --device <serial>');
    }
    return usable[0];
}

// The names of the Connect keys that differ from the example - never the values, which
// can be credentials.
function diffConfigKeys(real, example) {
    const a = (real && real.Connect) || {};
    const b = (example && example.Connect) || {};
    return Object.keys(a)
        .filter(function (k) { return JSON.stringify(a[k]) !== JSON.stringify(b[k]); })
        .sort();
}

module.exports = {
    PLUGIN_ID, NPM_PACKAGE,
    readAppId, readAppName, androidCommands, iosCommands, pluginCommands,
    parseDoneLine, parseResultLine, problemSteps, parseAndroidSdkVersion, parseIosPod, pickAndroidSerial, pickIosSimulator, diffConfigKeys
};
