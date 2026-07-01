#!/usr/bin/env node
'use strict';

/*
 * Copies Demo.entitlements into the Xcode project and sets
 * CODE_SIGN_ENTITLEMENTS in both xcconfig files so the Push
 * Notifications entitlement is applied without a manual Xcode step.
 * Runs on every `cordova prepare ios`.
 */

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const platforms = context.opts.platforms || [];
    if (!platforms.includes('ios')) return;

    const projectRoot = context.opts.projectRoot;
    const platformRoot = path.join(projectRoot, 'platforms', 'ios');
    if (!fs.existsSync(platformRoot)) return;

    // Resolve the Xcode app directory name from the .xcodeproj filename.
    const xcodeproj = fs.readdirSync(platformRoot).find(f => f.endsWith('.xcodeproj'));
    if (!xcodeproj) return;
    const appName = xcodeproj.replace('.xcodeproj', '');
    const appDir = path.join(platformRoot, appName);

    // Copy entitlements file into the platform app directory.
    const src = path.join(projectRoot, 'entitlements', 'Demo.entitlements');
    fs.mkdirSync(appDir, { recursive: true });
    fs.copyFileSync(src, path.join(appDir, 'Demo.entitlements'));

    // Append CODE_SIGN_ENTITLEMENTS to each xcconfig if not already present.
    const setting = `CODE_SIGN_ENTITLEMENTS = $(PROJECT_DIR)/${appName}/Demo.entitlements`;
    ['build-debug.xcconfig', 'build-release.xcconfig'].forEach(cfg => {
        const cfgPath = path.join(platformRoot, 'cordova', cfg);
        if (!fs.existsSync(cfgPath)) return;
        const content = fs.readFileSync(cfgPath, 'utf8');
        if (!content.includes('CODE_SIGN_ENTITLEMENTS')) {
            fs.appendFileSync(cfgPath, `\n${setting}\n`);
        }
    });
};
