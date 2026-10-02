#!/usr/bin/env node
'use strict';

/*
 * Plugin-level before_prepare hook (registered in plugin.xml).
 *
 * Reads ConnectConfig.json from the Cordova project root and emits generated
 * files:
 *
 *   www/js/connect-config.js          — window.ConnectBasicConfig for the JS
 *                                        layer (both platforms)
 *   ConnectBasicConfig.properties     — Android SDK native config; copied into
 *                                        platform assets by after_prepare.js
 *   www/AcousticConnectNativeConfig.json — native runtime config (useRelease,
 *                                        killSwitchEnabled, killSwitchUrl),
 *                                        both platforms. Cordova auto-bundles
 *                                        www/ into platform assets, so this is
 *                                        readable natively on both iOS (Bundle.main)
 *                                        and Android (AssetManager, "www/..." path)
 *                                        without a platform-specific copy step.
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

function buildPropertiesFile(appKey, postMessageUrl, killSwitchUrl, killSwitchEnabled) {

    const lines = [
        '# Auto-generated from ConnectConfig.json — do not edit.',
        '# Android-only: read directly from assets by the Connect Android SDK.',
        '',
        '# Session settings',
        'SessionTimeout=30',
        'SessionTimeoutKillSwitch=false',
        '',
        '# Kill switch settings',
        'KillSwitchEnabled=' + (killSwitchEnabled ? 'true' : 'false'),
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
        '',
        '# This file REPLACES the SDK\'s own ConnectBasicConfig.properties (an app asset wins over a',
        '# library asset of the same name), so the capture settings below are repeated with the SDK',
        '# defaults. Without them the Android SDK refused every layout capture (no type 10 was ever',
        '# sent). Cookie and location settings are left out on purpose: the SDK file holds sample',
        '# values for them, and location is controlled by locationLoggingEnabled.',
        'PrintScreen=3',
        'Connection=3',
        'MaxStringsLength=300',
        'UseWhiteList=true',
        'WhiteListParam=id',
        'UseRandomSample=false',
        'RandomSampleParam=',
        'ScreenshotFormat=JPG',
        'PercentOfScreenshotsSize=40',
        'PercentToCompressImage=80',
        'ScreenShotPixelDensity=1.5',
        'LogViewLayoutOnScreenTransition=true',
        'GetImageDataOnScreenLayout=false',
        'SetGestureDetector=true',
        'CaptureNativeGesturesOnWebview=false',
    ];

    return lines.join('\n') + '\n';
}

// The only layout-config sections the native SDKs consume.
const LAYOUT_KEYS = ['AutoLayout', 'AppendMapIds'];

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Recursively merges `override` over `base` into a new object. Plain objects are
// merged key by key; arrays and scalars in `override` replace the base value
// outright, so a platform block can shorten or clear a shared list (e.g.
// MaskIdList). Neither input is mutated.
function deepMerge(base, override) {
    const result = {};
    Object.keys(base).forEach(function (key) {
        result[key] = isPlainObject(base[key]) ? deepMerge(base[key], {}) : base[key];
    });
    Object.keys(override).forEach(function (key) {
        if (isPlainObject(override[key]) && isPlainObject(result[key])) {
            result[key] = deepMerge(result[key], override[key]);
        } else if (isPlainObject(override[key])) {
            result[key] = deepMerge({}, override[key]);
        } else {
            result[key] = override[key];
        }
    });
    return result;
}

// Reads one layout block (layoutConfig / layoutConfigIos / layoutConfigAndroid).
// Absent or null means "not configured"; anything else must be a JSON object.
function readLayoutBlock(connect, name) {
    const value = connect[name];
    if (value === undefined || value === null) {
        return null;
    }
    if (!isPlainObject(value)) {
        throw new Error('ConnectConfig.json: Connect.' + name + ' must be a JSON object');
    }
    const kept = {};
    Object.keys(value).forEach(function (key) {
        if (LAYOUT_KEYS.indexOf(key) !== -1) {
            kept[key] = value[key];
        } else {
            console.warn('[acoustic-connect] Connect.' + name + '.' + key +
                ' is not a recognised layout key (expected ' + LAYOUT_KEYS.join(' and/or ') + ') — ignoring it');
        }
    });
    return kept;
}

// Shared baseline with the platform block deep-merged over it. Null when neither
// is configured, so the native SDK keeps the defaults from its own bundled config.
function resolveLayoutForPlatform(shared, platform) {
    if (shared === null && platform === null) {
        return null;
    }
    const merged = deepMerge(shared || {}, platform || {});
    return Object.keys(merged).length === 0 ? null : merged;
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
    if (connect.useRelease !== undefined && typeof connect.useRelease !== 'boolean') {
        throw new Error('ConnectConfig.json: Connect.useRelease must be a boolean (got ' + typeof connect.useRelease + ')');
    }
    const useRelease = connect.useRelease === true;

    if (connect.KillSwitchEnabled !== undefined && typeof connect.KillSwitchEnabled !== 'boolean') {
        throw new Error('ConnectConfig.json: Connect.KillSwitchEnabled must be a boolean (got ' + typeof connect.KillSwitchEnabled + ')');
    }
    const killSwitchEnabled = connect.KillSwitchEnabled === true;

    if (connect.LocationLoggingEnabled !== undefined && typeof connect.LocationLoggingEnabled !== 'boolean') {
        throw new Error('ConnectConfig.json: Connect.LocationLoggingEnabled must be a boolean (got ' + typeof connect.LocationLoggingEnabled + ')');
    }
    // Tri-state, unlike killSwitchEnabled/useRelease: null means "not configured,
    // leave the native SDK's own default alone" — this plugin does not decide
    // whether location data collection is on or off unless the app explicitly
    // opts in either direction.
    const locationLoggingEnabled = connect.LocationLoggingEnabled === undefined
        ? null
        : connect.LocationLoggingEnabled;

    if (connect.ScreenCaptureEnabled !== undefined && connect.ScreenCaptureEnabled !== null &&
            typeof connect.ScreenCaptureEnabled !== 'boolean') {
        throw new Error('ConnectConfig.json: Connect.ScreenCaptureEnabled must be a boolean (got ' + typeof connect.ScreenCaptureEnabled + ')');
    }
    // Tri-state like locationLoggingEnabled: null means "not configured, leave the
    // native SDK's own default (screen/layout capture on) alone".
    const screenCaptureEnabled = (connect.ScreenCaptureEnabled === undefined || connect.ScreenCaptureEnabled === null)
        ? null
        : connect.ScreenCaptureEnabled;

    const sharedLayout = readLayoutBlock(connect, 'layoutConfig');
    const layoutConfigIos = resolveLayoutForPlatform(sharedLayout, readLayoutBlock(connect, 'layoutConfigIos'));
    const layoutConfigAndroid = resolveLayoutForPlatform(sharedLayout, readLayoutBlock(connect, 'layoutConfigAndroid'));

    // ── www/js/connect-config.js (JS layer, both platforms) ──────────────
    // PluginVersion is read from this plugin's own package.json (not ConnectConfig.json)
    // so it always matches what's actually installed — no separate value to keep in sync.
    const pluginVersion = require('../package.json').version;

    const jsConfig = {
        AppKey:                appKey,
        PostMessageUrl:        postMessageUrl,
        iOSPushMode:           connect.iOSPushMode                   || 'automatic',
        iOSAppGroupIdentifier: connect.iOSAppGroupIdentifier         || null,
        AndroidIconResName:    connect.AndroidNotificationIconResName || null,
        PluginVersion:         pluginVersion,
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
    const propsContent = buildPropertiesFile(appKey, postMessageUrl, killSwitchUrl, killSwitchEnabled);
    fs.writeFileSync(path.join(projectRoot, 'ConnectBasicConfig.properties'), propsContent);
    console.log('[acoustic-connect] ConnectBasicConfig.properties generated from ConnectConfig.json');

    // ── www/AcousticConnectNativeConfig.json (native runtime config, both platforms) ─
    // Contains only non-sensitive flags native code needs before enable() is called.
    // Cordova auto-bundles www/ for both platforms, so this file is accessible via
    // Bundle.main on iOS and via AssetManager ("www/AcousticConnectNativeConfig.json")
    // on Android.
    //
    // Supported Connect keys consumed here:
    //   useRelease (boolean, default false) — controls native SDK logging verbosity
    //   on both platforms:
    //     iOS: when false, ConnectPlugin.swift sets CONNECT_DEBUG/TLF_DEBUG/EODebug=1
    //       to enable verbose SDK logging (release pod is used when true instead).
    //     Android: ConnectPlugin.kt calls Connect.updateConfig("DisplayLogging", ...)
    //       right after Connect.init() — true suppresses native (Tealeaf/EOCore/Connect)
    //       logcat output regardless of the app's Gradle build type; false (default)
    //       leaves the SDK's own default (verbose) in place. Deliberately NOT done via
    //       an app-level EOCoreBasicConfig.properties asset override — Android's asset
    //       merge replaces the *entire* file on a name collision, and the SDK's bundled
    //       EOCoreBasicConfig.properties carries several other required keys (e.g.
    //       PostMessageTimeInterval) that a partial override would silently drop,
    //       crashing QueueService at enable() time.
    //   Set to true in production builds. Documented in ConnectConfig.example.json.
    //
    //   KillSwitchEnabled (boolean, default false) / KillSwitchUrl (string) — control
    //   the native SDK's remote kill switch. Both platforms hardcode this off by default
    //   (SDK's own bundled default is `true`); apps must opt in explicitly:
    //     iOS: ConnectPlugin.swift applies both via setConfigurableItem/setKillSwitchURL,
    //       before AND after enable() (the SDK may reload its bundled plist defaults
    //       internally during enable()).
    //     Android: ConnectPlugin.kt applies KillSwitchEnabled=false at asset-load time via
    //       ConnectBasicConfig.properties, but the native SDK's own 2-arg
    //       Tealeaf.enable(appKey, postMessageUrl) — which handleEnable() calls — has an
    //       internal ~100ms-delayed handler that unconditionally sets KillSwitchEnabled=true
    //       and computes its own kill-switch URL. So ConnectPlugin.kt must re-apply the
    //       configured value via Connect.updateConfig(...) AFTER that delay to make either
    //       value (true or false) actually stick.
    //   locationLoggingEnabled (boolean|null, default null) — controls the native SDK's
    //   location data collection (kConfigurableItemLogLocationEnabled/"LogLocationEnabled"
    //   on iOS, TLF_LOG_LOCATION_ENABLED on Android — both read once, before enable() is
    //   called, not re-checked afterward like KillSwitchEnabled). Unlike useRelease/
    //   killSwitchEnabled, this plugin does NOT force a default: null means "leave the
    //   SDK's own bundled default alone." Setting this only stops location data reaching
    //   the collector — it does NOT remove CoreLocation linkage from the compiled iOS
    //   xcframework, so it does not by itself resolve Apple's ITMS-90683 App Store
    //   warning (missing NSLocationWhenInUseUsageDescription); that requires either
    //   declaring the Info.plist key or an SDK-side build without CoreLocation linked.
    //   screenCaptureEnabled (boolean|null, default null) — controls the native SDK's
    //   automatic layout/screenshot capture. Tri-state like locationLoggingEnabled: null
    //   leaves the SDK default (capture on) alone. Only an explicit false acts:
    //     iOS: sets AutoLayout.GlobalScreenSettings.CaptureLayoutOn = 0 right AFTER
    //       enable() (verified on a simulator: layout + screenshot stop, screen views stay).
    //     Android: sets LogViewLayoutOnScreenTransition=false before enable(). Not
    //       verified: the Android SDK sent no layout message in the default config.
    //   layoutConfigIos / layoutConfigAndroid (object|null, default null) — the resolved
    //   screen-capture rules (AutoLayout, AppendMapIds) for each platform: the shared
    //   Connect.layoutConfig with Connect.layoutConfigIos / layoutConfigAndroid deep-merged
    //   over it. null leaves the native SDK's bundled layout config untouched.
    //     iOS: applied right after enable() by ConnectPlugin.swift.
    //     Android: also written to ConnectLayoutConfig.json (project root), which the
    //       Android after_prepare hook copies into the app assets, overriding the SDK's own.
    const nativeConfig = {
        useRelease: useRelease,
        killSwitchEnabled: killSwitchEnabled,
        killSwitchUrl: killSwitchUrl || null,
        locationLoggingEnabled: locationLoggingEnabled,
        screenCaptureEnabled: screenCaptureEnabled,
        layoutConfigIos: layoutConfigIos,
        layoutConfigAndroid: layoutConfigAndroid,
    };
    const wwwDir = path.join(projectRoot, 'www');
    fs.mkdirSync(wwwDir, { recursive: true });
    fs.writeFileSync(
        path.join(wwwDir, 'AcousticConnectNativeConfig.json'),
        JSON.stringify(nativeConfig, null, 4) + '\n'
    );
    console.log('[acoustic-connect] AcousticConnectNativeConfig.json generated from ConnectConfig.json');

    // ── ConnectLayoutConfig.json (Android SDK layout rules, copied by after_prepare) ──
    // Written only when an Android block is configured; a stale file from a previous
    // prepare is removed so the SDK's bundled default applies again.
    const layoutFilePath = path.join(projectRoot, 'ConnectLayoutConfig.json');
    if (layoutConfigAndroid !== null) {
        // The file replaces the SDK's bundled ConnectLayoutConfig.json as a whole (verified
        // on a device: the SDK then holds only this block), unlike iOS where the block is
        // merged over the SDK's. A block without GlobalScreenSettings drops the SDK's own.
        const autoLayout = layoutConfigAndroid.AutoLayout;
        if (!isPlainObject(autoLayout) || !isPlainObject(autoLayout.GlobalScreenSettings)) {
            console.warn('[acoustic-connect] Connect.layoutConfigAndroid (with layoutConfig) replaces the Android SDK\'s ' +
                'whole layout config and has no AutoLayout.GlobalScreenSettings — the SDK\'s own screen rules are dropped. ' +
                'Supply a complete block, or omit the Android block to keep the SDK defaults.');
        }
        fs.writeFileSync(layoutFilePath, JSON.stringify(layoutConfigAndroid, null, 4) + '\n');
        console.log('[acoustic-connect] ConnectLayoutConfig.json generated from ConnectConfig.json');
    } else if (fs.existsSync(layoutFilePath)) {
        fs.unlinkSync(layoutFilePath);
    }
};
