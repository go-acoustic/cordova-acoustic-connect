#!/usr/bin/env node

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Cordova after_prepare hook for the Acoustic Connect plugin (Android).
 *
 * Copies google-services.json from the Cordova project root into
 * platforms/android/app/ so the Google Services Gradle plugin can
 * initialise Firebase and enable FCM token registration.
 *
 * FCM will not work without this file. Obtain google-services.json from
 * the Firebase Console for your app's package name and place it alongside
 * ConnectConfig.json in the Cordova project root.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

module.exports = function (context) {
    const platforms = context.opts.platforms || [];
    if (platforms.indexOf('android') === -1) {
        return;
    }

    const projectRoot = context.opts.projectRoot;
    const src  = path.join(projectRoot, 'google-services.json');
    const dest = path.join(projectRoot, 'platforms', 'android', 'app', 'google-services.json');

    if (!fs.existsSync(src)) {
        console.warn(
            '[acoustic-connect] google-services.json not found at ' + src +
            ' — FCM push will not work. ' +
            'Add google-services.json (from Firebase Console) to your Cordova project root.'
        );
    } else {
        fs.copyFileSync(src, dest);
        console.log('[acoustic-connect] google-services.json copied to ' + dest);
    }

    const assetsDir = path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    // Copy ConnectBasicConfig.properties under BOTH expected file names so the
    // Connect SDK picks up AppKey / PostMessageUrl regardless of which name it
    // resolves first. BasicConfig.properties is the legacy name.
    const configSrc = path.join(projectRoot, 'ConnectBasicConfig.properties');
    if (fs.existsSync(configSrc)) {
        ['BasicConfig.properties', 'ConnectBasicConfig.properties'].forEach((name) => {
            fs.copyFileSync(configSrc, path.join(assetsDir, name));
            console.log('[acoustic-connect] ' + name + ' copied to assets');
        });
    }

    // Copy optional SDK config JSONs when present in the project root.
    [
        'ConnectLayoutConfig.json',
        'ConnectAdvancedConfig.json',
    ].forEach((name) => {
        const src = path.join(projectRoot, name);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(assetsDir, name));
            console.log('[acoustic-connect] ' + name + ' copied to assets');
        }
    });
};