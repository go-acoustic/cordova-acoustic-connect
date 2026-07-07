#!/usr/bin/env node

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs at `before_plugin_install` and rewrites the CocoaPods pod name in
 * plugin.xml based on ConnectConfig.json.Connect.useRelease before Cordova
 * copies the plugin into the host app. cordova prepare then reads the
 * rewritten copy to generate the Podfile.
 *
 *   useRelease: true  → AcousticConnect (= 2.1.15)       — production / release SDK
 *   useRelease: false → AcousticConnectDebug (= 2.1.13) — debug SDK (default)
 *
 * This hook is iOS-only. Android always uses connect-push-fcm regardless of
 * useRelease (connect-push-fcm-debug is not published to public Maven).
 * ConnectConfig.json is the single source of truth. No CLI variable or env var
 * override is accepted;
 * change the flag in ConnectConfig.json and re-add the plugin.
 *
 * IMPORTANT: both the pod name AND spec must change together. AcousticConnectDebug
 * requires = 2.1.13 because requestAuthorization() / getCurrentAuthorization()
 * land in that version.
 *
 * RELEASE_NAME / RELEASE_SPEC / DEBUG_NAME / DEBUG_SPEC below are exported via
 * `module.exports.versions` so tests can derive their expectations from this
 * single source of truth instead of hardcoding an independent copy that could
 * silently drift if these values change here.
 */

'use strict';

var fs   = require('fs');
var path = require('path');

var RELEASE_NAME = 'AcousticConnect';
var RELEASE_SPEC = '= 2.1.15';
var DEBUG_NAME   = 'AcousticConnectDebug';
var DEBUG_SPEC   = '= 2.1.13';

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectSdkVariant(context) {
    var connectConfigPath = path.join(context.opts.projectRoot, 'ConnectConfig.json');

    var variant = 'debug'; // default: debug (matches RN podspec nil → debug)

    if (fs.existsSync(connectConfigPath)) {
        var connectCfg;
        try {
            connectCfg = JSON.parse(fs.readFileSync(connectConfigPath, 'utf8'));
        } catch (e) {
            throw new Error('[acoustic-connect] ConnectConfig.json is malformed JSON: ' + e.message);
        }
        var cfg = connectCfg && (connectCfg.Connect || connectCfg);
        if (cfg && cfg.useRelease !== undefined && cfg.useRelease !== null) {
            variant = cfg.useRelease ? 'release' : 'debug';
        }
    } else {
        console.log('[acoustic-connect] ConnectConfig.json not found — defaulting to debug SDK variant');
    }

    var pluginPath = context.opts.plugin && context.opts.plugin.dir;
    if (!pluginPath) {
        return;
    }

    var pluginXmlPath = path.join(pluginPath, 'plugin.xml');
    var pluginXml = fs.readFileSync(pluginXmlPath, 'utf8');

    var debugNameRe   = new RegExp('<pod name="' + escapeRegExp(DEBUG_NAME) + '"', 'g');
    var releaseNameRe = new RegExp('<pod name="' + escapeRegExp(RELEASE_NAME) + '"', 'g');
    var releaseSpecRe = new RegExp(
        '(<pod name="' + escapeRegExp(RELEASE_NAME) + '"\\s+spec=")[^"]+"', 'g'
    );
    var debugSpecRe = new RegExp(
        '(<pod name="' + escapeRegExp(DEBUG_NAME) + '"\\s+spec=")[^"]+"', 'g'
    );

    // Normalize to release (name + spec), then apply debug overrides if needed.
    // Both must change together so Cordova registers the correct pod in pods.json.
    var normalized = pluginXml
        .replace(debugNameRe, '<pod name="' + RELEASE_NAME + '"')
        .replace(releaseSpecRe, '$1' + RELEASE_SPEC + '"');

    var rewritten = normalized;
    if (variant === 'debug') {
        rewritten = normalized
            .replace(releaseNameRe, '<pod name="' + DEBUG_NAME + '"')
            .replace(debugSpecRe, '$1' + DEBUG_SPEC + '"');
    }

    if (rewritten !== pluginXml) {
        fs.writeFileSync(pluginXmlPath, rewritten, 'utf8');
        console.log('[acoustic-connect] useRelease=' + (variant === 'release') +
                    ' → plugin.xml pod set to ' +
                    (variant === 'release'
                        ? RELEASE_NAME + ' (' + RELEASE_SPEC + ')'
                        : DEBUG_NAME + ' (' + DEBUG_SPEC + ')'));
    }
}

module.exports = selectSdkVariant;
module.exports.versions = {
    RELEASE_NAME: RELEASE_NAME,
    RELEASE_SPEC: RELEASE_SPEC,
    DEBUG_NAME: DEBUG_NAME,
    DEBUG_SPEC: DEBUG_SPEC
};
