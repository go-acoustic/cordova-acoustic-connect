#!/usr/bin/env node
'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Lets an e2e build reach the plain-http collector sink. Runs on every
 * `cordova prepare`, but acts only while `node e2e/prepare.js prepare` has been run
 * (its state file exists), and only for the platform that run was prepared for. A normal
 * build is untouched. The platform files are regenerated on every prepare, which is why
 * this is a hook and not a one-off edit.
 */

const fs = require('fs');
const path = require('path');
const prepare = require('../e2e/prepare.js');
const patches = require('../e2e/patches.js');

// Patches one generated platform file and records what is needed to undo it. The hook
// runs on every prepare, so the original is only captured the first time.
function patchFile(root, file, kind, label) {
    if (!fs.existsSync(file)) return;
    const android = kind === 'android-manifest';
    const original = fs.readFileSync(file, 'utf8');
    const patched = android ? patches.patchAndroidManifest(original) : patches.patchInfoPlist(original);
    fs.writeFileSync(file, patched);
    prepare.recordPatchedFile(root, {
        path: path.relative(root, file),
        kind: kind,
        original: original,
        flags: android ? patches.readAndroidCleartext(original) : patches.readAts(original),
        patched: patched
    });
    console.log('[e2e] ' + label + ' patched: ' + path.relative(process.cwd(), file));
}

module.exports = function (context) {
    const projectRoot = context.opts.projectRoot;
    const state = prepare.readState(projectRoot);
    if (!state) return;

    const platforms = context.opts.platforms || [];
    if (platforms.indexOf(state.platform) === -1) return;

    if (state.platform === 'android') {
        patchFile(
            projectRoot,
            path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
            'android-manifest',
            'AndroidManifest.xml (cleartext http)'
        );
    } else {
        const platformRoot = path.join(projectRoot, 'platforms', 'ios');
        const xcodeproj = fs.existsSync(platformRoot)
            ? fs.readdirSync(platformRoot).find(function (f) { return f.endsWith('.xcodeproj'); })
            : null;
        const appName = xcodeproj ? xcodeproj.replace('.xcodeproj', '') : 'App';
        patchFile(
            projectRoot,
            path.join(platformRoot, appName, appName + '-Info.plist'),
            'ios-plist',
            'Info.plist (App Transport Security)'
        );
    }
};
