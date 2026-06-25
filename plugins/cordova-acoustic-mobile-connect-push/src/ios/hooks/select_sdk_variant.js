#!/usr/bin/env node

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs at `before_plugin_install` and rewrites the CocoaPods pod name in
 * plugin.xml based on ACOUSTIC_SDK_VARIANT before Cordova copies the plugin
 * into the host app. cordova prepare then reads the rewritten copy to generate
 * the Podfile.
 *
 *   release (default) → AcousticConnect (~> 2.0)
 *   debug             → AcousticConnectDebug (>= 2.1.12)
 *
 * IMPORTANT: both the pod name AND spec must change together. The debug pod
 * (AcousticConnectDebug) requires >= 2.1.12 because requestAuthorization() and
 * getCurrentAuthorization() land in that version. Swapping only the name would
 * register AcousticConnectDebug ~> 2.0 in pods.json, which Cordova then merges
 * with the existing Podfile entry, producing two conflicting pods.
 */

'use strict';

var fs = require('fs');
var path = require('path');

module.exports = function (context) {
    // Resolution order:
    //   1. --variable ACOUSTIC_SDK_VARIANT=<value> passed on the CLI
    //   2. ACOUSTIC_SDK_VARIANT environment variable (CI / Jenkins)
    //   3. ConnectConfig.json Connect.useRelease (false → debug, true → release)
    //   4. default declared in plugin.xml <preference> element
    //   5. hard-coded 'release' guard (should never be reached)
    //
    // ConnectConfig.json is the single source of truth shared with
    // before_prepare_pod.js so both hooks always select the same pod.
    var pluginPrefs = (
        context.opts.plugin &&
        context.opts.plugin.pluginInfo &&
        typeof context.opts.plugin.pluginInfo.getPreferences === 'function'
    ) ? context.opts.plugin.pluginInfo.getPreferences() : {};

    var variantFromConfig = null;
    var connectConfigPath = path.join(context.opts.projectRoot, 'ConnectConfig.json');
    if (fs.existsSync(connectConfigPath)) {
        try {
            var connectCfg = JSON.parse(fs.readFileSync(connectConfigPath, 'utf8'));
            if (connectCfg && connectCfg.Connect) {
                variantFromConfig = connectCfg.Connect.useRelease === false ? 'debug' : 'release';
            }
        } catch (_) { /* ignore — fall through to plugin.xml default */ }
    }

    var variantRaw = (
        context.opts.cli_variables &&
        context.opts.cli_variables.ACOUSTIC_SDK_VARIANT
    ) || process.env.ACOUSTIC_SDK_VARIANT
      || variantFromConfig
      || pluginPrefs['ACOUSTIC_SDK_VARIANT']
      || 'release';

    var variant = String(variantRaw).toLowerCase();

    if (variant !== 'release' && variant !== 'debug') {
        throw new Error(
            'ACOUSTIC_SDK_VARIANT must be "release" or "debug", got "' + variantRaw + '"'
        );
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
        .replace(/(<pod name="AcousticConnect"\s+spec=")>= 2\.1\.12"/g, '$1~> 2.0"');

    var rewritten = normalized;
    if (variant === 'debug') {
        rewritten = normalized
            .replace(/<pod name="AcousticConnect"/g, '<pod name="AcousticConnectDebug"')
            .replace(/(<pod name="AcousticConnectDebug"\s+spec=")~> 2\.0"/g, '$1>= 2.1.12"');
    }

    if (rewritten !== pluginXml) {
        fs.writeFileSync(pluginXmlPath, rewritten, 'utf8');
        console.log('[acoustic-connect] ACOUSTIC_SDK_VARIANT=' + variant +
                    ' → plugin.xml updated');
    }
};
