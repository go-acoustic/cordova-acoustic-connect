#!/usr/bin/env node
'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Prepares the Demo app for an e2e (release-verification) run and puts everything back.
 *
 *   node e2e/prepare.js prepare --platform android|ios --sink http://localhost:9877
 *                               [--device-host <host>] [--settle-ms <n>]
 *   node e2e/prepare.js restore
 *   node e2e/prepare.js status
 *
 * `prepare` points ConnectConfig.json at the collector sink (as the device sees it) and
 * switches js/e2e-config.js on. Plain http needs more than that: Android must allow
 * cleartext traffic and iOS must relax App Transport Security. Those live in generated
 * platform files that every `cordova prepare` rewrites, so they are patched by
 * hooks/after_prepare_e2e.js, which acts only while this script's state file exists.
 *
 * The original contents of every file touched - including the generated platform files
 * the hook patches - are saved in e2e/.prepare-state.json (gitignored: it can hold the real
 * ConnectConfig.json) and `restore` writes them back. Cordova edits those platform files in
 * place, so a patch would otherwise survive into the next normal build.
 */

const fs = require('fs');
const path = require('path');

const STATE_REL = path.join('e2e', '.prepare-state.json');
const CONFIG_REL = 'ConnectConfig.json';
const EXAMPLE_REL = 'ConnectConfig.example.json';
const E2E_CONFIG_REL = path.join('www', 'js', 'e2e-config.js');
// Written by the plugin's before_prepare hook during the build, from layoutConfigAndroid: it did not
// come from this run's setup, but it must not outlive the run.
const LAYOUT_CONFIG_REL = 'ConnectLayoutConfig.json';
const PLATFORMS = ['android', 'ios'];
const patches = require('./patches.js');

// What the device sees. The Android emulator reaches the host at 10.0.2.2 (its own
// localhost is the emulator); the iOS simulator shares the host's network.
function deviceBaseUrl(args) {
    const platform = args && args.platform;
    if (PLATFORMS.indexOf(platform) === -1) {
        throw new Error('platform must be android or ios (got ' + JSON.stringify(platform) + ')');
    }
    if (!args.sink || typeof args.sink !== 'string') {
        throw new Error('sink URL is required (for example http://localhost:9877)');
    }
    let url;
    try {
        url = new URL(args.sink);
    } catch (_) {
        throw new Error('sink is not a valid URL: ' + args.sink);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('sink must be an http(s) URL (got ' + url.protocol + ')');
    }
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const host = args.deviceHost || (platform === 'android' && loopback ? '10.0.2.2' : url.hostname);
    return url.protocol + '//' + host + (url.port ? ':' + url.port : '');
}

// Recursively merges `override` over `base` into a new object: nested objects merge,
// scalars and arrays from `override` replace. Neither input is mutated.
function deepMerge(base, override) {
    const result = JSON.parse(JSON.stringify(base));
    Object.keys(override).forEach(function (key) {
        const value = override[key];
        const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
        if (isObject && result[key] !== null && typeof result[key] === 'object' && !Array.isArray(result[key])) {
            result[key] = deepMerge(result[key], value);
        } else {
            result[key] = JSON.parse(JSON.stringify(value));
        }
    });
    return result;
}

// Keeps every setting and only repoints the collector urls. The kill-switch url ends in
// the app key, like the real one, and the sink answers it with "1".
function buildConnectConfig(config, base) {
    const copy = JSON.parse(JSON.stringify(config));
    const connect = copy && copy.Connect;
    if (!connect || !connect.AppKey) {
        throw new Error('ConnectConfig.json: Connect.AppKey is required');
    }
    connect.PostMessageUrl = base + '/collector/collectorPost';
    connect.KillSwitchUrl = base + '/collector/switch/' + connect.AppKey;
    return copy;
}

function buildE2EConfigFile(options) {
    const o = options || {};
    const config = {
        enabled: true,
        settleMs: o.settleMs === undefined ? 2000 : o.settleMs,
        sdkMaxTries: o.sdkMaxTries === undefined ? 30 : o.sdkMaxTries,
        sdkIntervalMs: o.sdkIntervalMs === undefined ? 1000 : o.sdkIntervalMs
    };
    return '/* Written by e2e/prepare.js for an e2e run - restored by `prepare.js restore`. */\n' +
        'window.E2E_CONFIG = ' + JSON.stringify(config) + ';\n';
}

function readIfExists(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function readState(root) {
    const raw = readIfExists(path.join(root, STATE_REL));
    return raw === null ? null : JSON.parse(raw);
}

function writeState(root, state) {
    fs.mkdirSync(path.join(root, 'e2e'), { recursive: true });
    fs.writeFileSync(path.join(root, STATE_REL), JSON.stringify(state, null, 2));
}

// Called by hooks/after_prepare_e2e.js each time it patches a generated platform file.
// The first call for a file keeps its original text and what the patched setting said
// before; later calls (the hook runs on every prepare) only update the patched text.
function recordPatchedFile(root, entry) {
    const state = readState(root);
    if (!state) return;
    state.platformFiles = state.platformFiles || [];
    const existing = state.platformFiles.find(function (f) { return f.path === entry.path; });
    if (existing) {
        existing.patched = entry.patched;
    } else {
        state.platformFiles.push(entry);
    }
    writeState(root, state);
}

function reversePlatformFile(root, entry) {
    const target = path.join(root, entry.path);
    if (!fs.existsSync(target)) {
        return entry.path + ': not found, nothing to undo';
    }
    const current = fs.readFileSync(target, 'utf8');
    if (current === entry.patched) {
        fs.writeFileSync(target, entry.original);
        return entry.path + ': original content written back';
    }
    // Changed since it was patched (a later prepare edited it): undo only our setting.
    const undone = entry.kind === 'android-manifest'
        ? patches.unpatchAndroidManifest(current, entry.flags)
        : patches.unpatchInfoPlist(current, entry.flags);
    fs.writeFileSync(target, undone);
    return entry.path + ': e2e setting undone, later changes kept';
}

function prepare(opts) {
    const root = opts.root;
    const deviceBase = deviceBaseUrl(opts);   // validates before anything is touched

    if (readState(root)) {
        throw new Error('already prepared - run `node e2e/prepare.js restore` first, so the saved originals are not overwritten');
    }

    const configFile = path.join(root, CONFIG_REL);
    const original = readIfExists(configFile);
    const source = original !== null ? original : readIfExists(path.join(root, EXAMPLE_REL));
    if (source === null) {
        throw new Error('ConnectConfig.json (or ConnectConfig.example.json) not found in ' + root);
    }
    // The phase's capture settings go on first; the sink urls are set last so an override
    // can never point the run somewhere else.
    const base = JSON.parse(source);
    if (opts.connectOverrides) {
        base.Connect = deepMerge(base.Connect || {}, opts.connectOverrides);
    }
    const nextConfig = buildConnectConfig(base, deviceBase);

    const e2eFile = path.join(root, E2E_CONFIG_REL);
    const e2eOriginal = readIfExists(e2eFile);

    writeState(root, {
        createdAt: new Date().toISOString(),
        platform: opts.platform,
        deviceBase: deviceBase,
        files: [
            { path: CONFIG_REL, original: original },
            { path: E2E_CONFIG_REL, original: e2eOriginal },
            { path: LAYOUT_CONFIG_REL, original: readIfExists(path.join(root, LAYOUT_CONFIG_REL)) }
        ],
        platformFiles: []
    });

    // The state file is written first so a killed run can be restored; if a write fails here the
    // run never starts, so put everything back now instead of leaving a half-changed project and
    // a state file that makes every later run say "already prepared".
    try {
        fs.writeFileSync(configFile, JSON.stringify(nextConfig, null, 4) + '\n');
        fs.mkdirSync(path.dirname(e2eFile), { recursive: true });
        fs.writeFileSync(e2eFile, buildE2EConfigFile({ settleMs: opts.settleMs }));
    } catch (error) {
        restore({ root: root });
        throw error;
    }

    return {
        deviceBase: deviceBase,
        changes: [
            CONFIG_REL + ': collector and kill-switch urls -> ' + deviceBase,
            E2E_CONFIG_REL + ': e2e scenario enabled',
            'platform files (' + (opts.platform === 'android' ? 'AndroidManifest.xml cleartext' : 'Info.plist ATS') +
                '): patched by hooks/after_prepare_e2e.js on the next cordova prepare/build'
        ]
    };
}

function restore(opts) {
    const root = opts.root;
    const state = readState(root);
    if (!state) {
        return { reverted: [] };
    }
    const reverted = [];
    state.files.forEach(function (f) {
        const target = path.join(root, f.path);
        if (f.original === null) {
            if (fs.existsSync(target)) fs.unlinkSync(target);
            reverted.push(f.path + ': removed (it did not exist before)');
        } else {
            fs.writeFileSync(target, f.original);
            reverted.push(f.path + ': original content written back');
        }
    });
    (state.platformFiles || []).forEach(function (entry) {
        reverted.push(reversePlatformFile(root, entry));
    });
    fs.unlinkSync(path.join(root, STATE_REL));
    return { reverted: reverted };
}

function status(opts) {
    const state = readState(opts.root);
    return state
        ? { prepared: true, platform: state.platform, deviceBase: state.deviceBase, createdAt: state.createdAt }
        : { prepared: false };
}

function parseArgs(argv) {
    const opts = {};
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i].indexOf('--') === 0) {
            opts[argv[i].slice(2)] = argv[i + 1];
            i += 1;
        }
    }
    return opts;
}

function main() {
    const command = process.argv[2];
    const opts = parseArgs(process.argv.slice(3));
    const root = path.resolve(__dirname, '..');
    try {
        if (command === 'prepare') {
            const result = prepare({
                root: root,
                platform: opts.platform,
                sink: opts.sink,
                deviceHost: opts['device-host'],
                settleMs: opts['settle-ms'] === undefined ? undefined : Number(opts['settle-ms'])
            });
            result.changes.forEach(function (c) { console.log('changed: ' + c); });
        } else if (command === 'restore') {
            const result = restore({ root: root });
            if (result.reverted.length === 0) console.log('nothing to restore');
            result.reverted.forEach(function (r) { console.log('reverted: ' + r); });
        } else if (command === 'status') {
            console.log(JSON.stringify(status({ root: root })));
        } else {
            console.error('Usage: prepare.js prepare --platform android|ios --sink <url> [--device-host <host>] [--settle-ms <n>] | restore | status');
            process.exit(2);
        }
    } catch (error) {
        console.error('ERROR: ' + error.message);
        process.exit(1);
    }
}

module.exports = {
    deviceBaseUrl, deepMerge, buildConnectConfig, buildE2EConfigFile,
    prepare, restore, status, readState, recordPatchedFile
};

if (require.main === module) {
    main();
}
