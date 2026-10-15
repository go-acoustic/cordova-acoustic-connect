'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The app keeps a placeholder config in git (capacitor.config.example.json) and the developer's own, untracked
 * capacitor.config.json next to it. A wire run has to point the SDK at the local collector sink without losing
 * either, so it swaps the config in for the run and puts the original back (or removes the file when there was none):
 *
 *   node e2e/run.js restore      puts the original back after a run that was killed
 *
 * The original is saved in e2e/.prepare-state.json (git-ignored: it can hold the real app key).
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = '.prepare-state.json';
const CONFIG = 'capacitor.config.json';
const EXAMPLE = 'capacitor.config.example.json';

function deepMerge(target, source) {
    Object.keys(source).forEach(function (key) {
        const value = source[key];
        if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') {
            deepMerge(target[key], value);
        } else {
            target[key] = JSON.parse(JSON.stringify(value));
        }
    });
    return target;
}

/**
 * The config for a wire run: the same, with the settings of the phase (options.overrides) merged over the plugin block
 * and the SDK pointed at the sink on this machine.
 */
function buildRunConfig(base, options) {
    const config = JSON.parse(JSON.stringify(base));
    const sink = 'http://localhost:' + options.port;
    config.plugins = config.plugins || {};
    const block = config.plugins.AcousticConnect = config.plugins.AcousticConnect || {};
    deepMerge(block, options.overrides || {});
    block.postMessageUrl = sink + '/collector/collectorPost';
    // the scenario waits for an SDK that the config starts
    block.autoEnable = true;
    if (block.killSwitchEnabled === true) {
        block.killSwitchUrl = sink + '/collector/switch/' + (block.appKey || '');
    }
    return config;
}

function statePath(root) {
    return path.join(root, 'e2e', STATE_FILE);
}

function prepareConfig(options) {
    const root = options.root;
    if (fs.existsSync(statePath(root))) {
        throw new Error('already prepared - run `node e2e/run.js restore` first, so the saved original is not overwritten');
    }
    const configFile = path.join(root, CONFIG);
    const exampleFile = path.join(root, EXAMPLE);
    const existed = fs.existsSync(configFile);
    const sourceFile = existed ? configFile : exampleFile;
    if (!fs.existsSync(sourceFile)) {
        throw new Error('neither ' + CONFIG + ' nor ' + EXAMPLE + ' found in ' + root);
    }
    const original = existed ? fs.readFileSync(configFile, 'utf8') : null;
    // written first, so a run that is killed can still be restored
    fs.mkdirSync(path.dirname(statePath(root)), { recursive: true });      // an app that has no e2e/ of its own (DemoCapacitorAngular)
    fs.writeFileSync(statePath(root), JSON.stringify({ existed: existed, original: original }, null, 2));
    const run = buildRunConfig(JSON.parse(fs.readFileSync(sourceFile, 'utf8')), { port: options.port, overrides: options.overrides });
    fs.writeFileSync(configFile, JSON.stringify(run, null, 2) + '\n');
}

function restoreConfig(options) {
    const root = options.root;
    if (!fs.existsSync(statePath(root))) return { restored: false };
    const state = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
    const configFile = path.join(root, CONFIG);
    if (state.existed) {
        fs.writeFileSync(configFile, state.original);
    } else if (fs.existsSync(configFile)) {
        fs.unlinkSync(configFile);
    }
    fs.unlinkSync(statePath(root));
    return { restored: true };
}

module.exports = { buildRunConfig, prepareConfig, restoreConfig, STATE_FILE };
