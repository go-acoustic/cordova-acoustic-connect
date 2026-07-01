#!/usr/bin/env node

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs at `before_plugin_install` and rewrites the CocoaPods pod name in
 * plugin.xml based on ConnectConfig.json.Connect.useRelease before Cordova
 * copies the plugin into the host app. cordova prepare then reads the
 * rewritten copy to generate the Podfile.
 *
 *   useRelease: true  → AcousticConnect (~> 2.0)         — production / release SDK
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
 */

'use strict';

var fs   = require('fs');
var path = require('path');

module.exports = function (context) {
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

    // Normalize to release (name + spec), then apply debug overrides if needed.
    // Both must change together so Cordova registers the correct pod in pods.json.
    var normalized = pluginXml
        .replace(/<pod name="AcousticConnectDebug"/g, '<pod name="AcousticConnect"')
        .replace(/(<pod name="AcousticConnect"\s+spec=")= 2\.1\.13"/g, '$1~> 2.0"');

    var rewritten = normalized;
    if (variant === 'debug') {
        rewritten = normalized
            .replace(/<pod name="AcousticConnect"/g, '<pod name="AcousticConnectDebug"')
            .replace(/(<pod name="AcousticConnectDebug"\s+spec=")~> 2\.0"/g, '$1= 2.1.13"');
    }

    if (rewritten !== pluginXml) {
        fs.writeFileSync(pluginXmlPath, rewritten, 'utf8');
        console.log('[acoustic-connect] useRelease=' + (variant === 'release') +
                    ' → plugin.xml pod set to ' +
                    (variant === 'release' ? 'AcousticConnect (~> 2.0)' : 'AcousticConnectDebug (= 2.1.13)'));
    }
};
