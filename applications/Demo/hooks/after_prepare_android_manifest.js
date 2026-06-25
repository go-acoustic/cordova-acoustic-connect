#!/usr/bin/env node

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Cordova after_prepare hook — Android manifest permissions + activity config.
 *
 * Cordova's config.xml parser does not propagate <uses-permission> entries into
 * the Android platform manifest (only plugin.xml declarations are merged).
 * This hook injects the three permissions the Connect SDK and Android 13+ require,
 * and is idempotent — running prepare multiple times produces no duplicate entries.
 *
 * Permissions injected:
 *   ACCESS_NETWORK_STATE  — Connect SDK uses this for cellular-vs-WiFi detection
 *   ACCESS_WIFI_STATE     — same
 *   POST_NOTIFICATIONS    — Android 13+ runtime permission for showing notifications
 */

'use strict';

const fs   = require('fs');
const path = require('path');

module.exports = function (context) {
    if (!context.opts.platforms.includes('android') &&
        !context.opts.cordova.platforms.includes('android')) {
        return;
    }

    const manifestPath = path.join(
        context.opts.projectRoot,
        'platforms', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'
    );

    if (!fs.existsSync(manifestPath)) return;

    let xml = fs.readFileSync(manifestPath, 'utf8');

    const required = [
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.ACCESS_WIFI_STATE',
        'android.permission.POST_NOTIFICATIONS',
    ];

    let changed = false;
    for (const perm of required) {
        if (!xml.includes(perm)) {
            xml = xml.replace(
                '<uses-permission android:name="android.permission.INTERNET" />',
                `<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="${perm}" />`
            );
            console.log(`[after_prepare_android_manifest] added permission: ${perm}`);
            changed = true;
        }
    }

    if (changed) fs.writeFileSync(manifestPath, xml, 'utf8');
};
