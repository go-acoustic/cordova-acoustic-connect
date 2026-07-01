#!/usr/bin/env node
'use strict';

/*
 * Plugin-level before_prepare hook (registered in plugin.xml).
 *
 * Reads ConnectConfig.json from the Cordova project root and emits two
 * generated files:
 *
 *   www/js/connect-config.js          — window.ConnectBasicConfig for the JS
 *                                        layer (both platforms)
 *   ConnectBasicConfig.properties     — Android SDK native config; copied into
 *                                        platform assets by after_prepare.js
 *
 * ConnectBasicConfig.properties is Android-only. iOS uses ConnectBasicConfig.plist
 * bundled inside the SDK's ConnectResources.bundle — apps do not ship their own.
 *
 * Runs on every `cordova prepare` (before the www -> platform_www copy).
 */

const fs = require('fs');
const path = require('path');

// Escape special characters for a .properties file value.
// Colons are valid in values when = is the key-value separator and do not
// need escaping; omitting it keeps URLs readable and avoids test divergence.
function escapeValue(val) {
    return String(val)
        .replace(/\\/g, '\\\\')   // must be first
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
}

function buildPropertiesFile(appKey, postMessageUrl, killSwitchUrl) {

    const lines = [
        '# Auto-generated from ConnectConfig.json — do not edit.',
        '# Android-only: read directly from assets by the Connect Android SDK.',
        '',
        '# Session settings',
        'SessionTimeout=30',
        'SessionTimeoutKillSwitch=false',
        '',
        '# Kill switch settings',
        'KillSwitchEnabled=false',
        'KillSwitchUrl=' + escapeValue(killSwitchUrl),
        'KillSwitchMaxNumberOfTries=3',
        'KillSwitchTimeInterval=5',
        '',
        '# Post settings',
        'PostMessageUrl=' + escapeValue(postMessageUrl),
        'AppKey=' + escapeValue(appKey),
        '',
        '# Disable Analytics WebView client injection (required for Cordova compatibility).',
        '# Cordova replaces the default WebViewClient with ConnectSystemWebViewClient, which',
        '# extends SystemWebViewClient. The Analytics SDK calls setWebViewClient() on',
        '# activity resume with a plain AnalyticsWebViewClient; Cordova\'s SystemWebView',
        '# enforces a strict type check and throws ClassCastException if the client is not',
        '# a SystemWebViewClient subclass. Setting this to false prevents the injection.',
        '#',
        '# Tested against Connect Android SDK ≥ 25.10.0 / Cordova Android 13.x.',
        '# Re-evaluate if the Analytics SDK adds a Cordova-aware injection path, or if',
        '# Cordova relaxes the setWebViewClient() type check in a future major release.',
        'GoogleWebViewEnabled=false',
    ];

    return lines.join('\n') + '\n';
}

module.exports = function (context) {
    const projectRoot = context.opts.projectRoot;
    const configPath  = path.join(projectRoot, 'ConnectConfig.json');
    const examplePath = path.join(projectRoot, 'ConnectConfig.example.json');
    let resolvedPath  = configPath;
    if (!fs.existsSync(configPath)) {
        if (fs.existsSync(examplePath)) {
            console.warn('[acoustic-connect] ConnectConfig.json not found — falling back to ConnectConfig.example.json (placeholder values)');
            resolvedPath = examplePath;
        } else {
            throw new Error('ConnectConfig.json not found at ' + configPath);
        }
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    } catch (e) {
        throw new Error('Failed to parse ' + path.basename(resolvedPath) + ': ' + e.message);
    }

    const connect = (parsed && parsed.Connect) || {};

    const appKey         = connect.AppKey        || '';
    const postMessageUrl = connect.PostMessageUrl || '';
    const killSwitchUrl  = connect.KillSwitchUrl  || '';

    if (!appKey) {
        throw new Error('ConnectConfig.json: Connect.AppKey is required');
    }
    if (!postMessageUrl) {
        throw new Error('ConnectConfig.json: Connect.PostMessageUrl is required');
    }

    // ── www/js/connect-config.js (JS layer, both platforms) ──────────────
    const jsConfig = {
        AppKey:                appKey,
        PostMessageUrl:        postMessageUrl,
        iOSPushMode:           connect.iOSPushMode                   || 'automatic',
        iOSAppGroupIdentifier: connect.iOSAppGroupIdentifier         || null,
        AndroidIconResName:    connect.AndroidNotificationIconResName || null,
    };

    const outDir = path.join(projectRoot, 'www', 'js');
    fs.mkdirSync(outDir, { recursive: true });

    const jsBanner = '/* Auto-generated from ConnectConfig.json — do not edit. */\n';
    const jsBody =
        'window.ConnectBasicConfig = Object.freeze(' +
        JSON.stringify(jsConfig, null, 4) +
        ');\n';
    fs.writeFileSync(path.join(outDir, 'connect-config.js'), jsBanner + jsBody);

    // ── ConnectBasicConfig.properties (Android SDK, copied by after_prepare) ──
    const propsContent = buildPropertiesFile(appKey, postMessageUrl, killSwitchUrl);
    fs.writeFileSync(path.join(projectRoot, 'ConnectBasicConfig.properties'), propsContent);
    console.log('[acoustic-connect] ConnectBasicConfig.properties generated from ConnectConfig.json');

    // ── www/AcousticConnectNativeConfig.json (iOS native runtime config) ─────
    // Contains only non-sensitive flags that iOS Swift code needs before enable()
    // is called. Cordova auto-bundles www/ for both platforms, so this file is
    // accessible via Bundle.main on iOS.
    //
    // Supported Connect keys consumed here:
    //   useRelease (boolean, default false) — when false, ConnectPlugin.swift sets
    //     CONNECT_DEBUG/TLF_DEBUG/EODebug=1 to enable verbose SDK logging. Set to
    //     true in production builds. Documented in ConnectConfig.example.json.
    if (connect.useRelease !== undefined && typeof connect.useRelease !== 'boolean') {
        throw new Error('ConnectConfig.json: Connect.useRelease must be a boolean (got ' + typeof connect.useRelease + ')');
    }
    const nativeConfig = {
        useRelease: connect.useRelease === true,
    };
    const wwwDir = path.join(projectRoot, 'www');
    fs.mkdirSync(wwwDir, { recursive: true });
    fs.writeFileSync(
        path.join(wwwDir, 'AcousticConnectNativeConfig.json'),
        JSON.stringify(nativeConfig, null, 4) + '\n'
    );
    console.log('[acoustic-connect] AcousticConnectNativeConfig.json generated from ConnectConfig.json');
};
