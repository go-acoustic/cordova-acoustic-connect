#!/usr/bin/env node

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Cordova after_prepare hook — Android icon resources.
 *
 * Copies the Acoustic brand icon assets from res/android/ into the
 * Android platform at every `cordova prepare`. This keeps the tracked
 * source of truth (res/android/) separate from the gitignored
 * platforms/ directory so icons survive a full platform rebuild.
 *
 * After copying, removes any .png file whose .webp counterpart was just
 * installed — Cordova's default prepare generates ic_launcher.png for
 * every density; our hook replaces them with .webp. Without the cleanup
 * the resource merger treats the pair as duplicates and fails the build.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

module.exports = function (context) {
    const platforms = context.opts.platforms || [];
    if (!platforms.includes('android')) return;

    const projectRoot = context.opts.projectRoot;
    const srcRes  = path.join(projectRoot, 'res', 'android');
    const destRes = path.join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'res');

    if (!fs.existsSync(srcRes)) {
        console.log('[after_prepare_icons] res/android/ not found — skipping');
        return;
    }

    let copied  = 0;
    let removed = 0;

    copyDir(srcRes, destRes, (destPath) => {
        copied++;
        // If we just wrote a .webp, delete the .png with the same base name.
        if (destPath.endsWith('.webp')) {
            const pngPath = destPath.slice(0, -5) + '.png';
            if (fs.existsSync(pngPath)) {
                fs.unlinkSync(pngPath);
                removed++;
            }
        }
    });

    console.log(
        '[after_prepare_icons] copied ' + copied + ' file(s)' +
        (removed ? ', removed ' + removed + ' duplicate .png(s)' : '')
    );
};

function copyDir(src, dest, onFile) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
        const srcPath  = path.join(src,  entry);
        const destPath = path.join(dest, entry);
        if (fs.statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath, onFile);
        } else {
            fs.copyFileSync(srcPath, destPath);
            if (onFile) onFile(destPath);
        }
    }
}
