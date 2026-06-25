/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Ensures google-services.json is present in both the project root AND the
 * Gradle app module directory before the build runs.
 *
 * Background: `cordova prepare android` copies google-services.json from the
 * project root into platforms/android/app/ at prepare time. Because the file
 * is gitignored, a fresh clone has no google-services.json and prepare cannot
 * copy it. This hook runs after prepare (before_build) and handles both steps:
 *
 *   1. If google-services.json is missing from the project root it is auto-
 *      copied from google-services.json.example so the build proceeds.
 *   2. The JSON is validated before it is copied anywhere — a corrupted file
 *      is rejected with a clear error rather than passed to Gradle silently.
 *   3. The file is synced from the project root into platforms/android/app/
 *      so Gradle's processDebugGoogleServices task finds it.
 *   4. A prominent warning is printed when placeholder credentials are in use.
 *
 * Does NOT fail the build so CI can continue with placeholder credentials.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const PLACEHOLDER_PROJECT_NUMBER = '000000000000';

module.exports = function(context) {
    // context.opts.platforms is populated by `cordova build android` but may
    // be undefined or empty when invoked as `cordova build` (no explicit
    // platform) or from certain Cordova CLI versions. Fall back to checking
    // whether platforms/android/ exists so the hook still runs in both cases.
    const platforms   = context.opts.platforms || [];
    const root        = context.opts.projectRoot;
    const androidDir  = path.join(root, 'platforms', 'android');
    const isAndroid   = platforms.includes('android') || fs.existsSync(androidDir);
    if (!isAndroid) return;

    const gservicesPath = path.join(root, 'google-services.json');
    const examplePath   = path.join(root, 'google-services.json.example');
    const platformPath  = path.join(androidDir, 'app', 'google-services.json');
    const SEP           = '='.repeat(72);

    // ── Step 1: ensure the file exists in the project root ──────────────
    if (!fs.existsSync(gservicesPath)) {
        if (!fs.existsSync(examplePath)) {
            console.warn('\n' + SEP);
            console.warn('  WARNING: google-services.json and google-services.json.example are');
            console.warn('  both missing — the build will likely fail.');
            console.warn(SEP + '\n');
            return;
        }
        try {
            fs.copyFileSync(examplePath, gservicesPath);
        } catch (e) {
            console.warn('\n' + SEP);
            console.warn('  WARNING: google-services.json is missing and could not be auto-copied');
            console.warn('  from .example: ' + e.message);
            console.warn('  Copy it manually: cp google-services.json.example google-services.json');
            console.warn('  The build will likely fail without it.');
            console.warn(SEP + '\n');
            return;
        }
        console.warn('\n' + SEP);
        console.warn('  WARNING: google-services.json was missing — copied from .example.');
        console.warn('  FCM push notifications will NOT work with placeholder credentials.');
        console.warn('  Replace applications/Demo/google-services.json with real values from:');
        console.warn('    https://console.firebase.google.com  →  Project settings  →  Download');
        console.warn(SEP + '\n');
    }

    // ── Step 2: validate JSON before copying anywhere ────────────────────
    // Parse first so a corrupted file (e.g. trailing comma from manual edit)
    // is caught here rather than passed to Gradle which emits an opaque error.
    let json;
    try {
        json = JSON.parse(fs.readFileSync(gservicesPath, 'utf8'));
    } catch (e) {
        console.warn('\n' + SEP);
        console.warn('  WARNING: google-services.json is not valid JSON: ' + e.message);
        console.warn('  The file has NOT been copied to the platform directory.');
        console.warn('  Fix or replace applications/Demo/google-services.json and rebuild.');
        console.warn(SEP + '\n');
        return;
    }

    // ── Step 3: sync into platforms/android/app/ for Gradle ─────────────
    // cordova prepare copies google-services.json during prepare, but if the
    // file was absent at prepare time (fresh clone) the platform directory
    // won't have it. Copy it now so processDebugGoogleServices finds it.
    const platformAppDir = path.dirname(platformPath);
    if (fs.existsSync(platformAppDir)) {
        try {
            fs.copyFileSync(gservicesPath, platformPath);
        } catch (e) {
            console.warn('\n' + SEP);
            console.warn('  WARNING: could not copy google-services.json to platform directory: ' + e.message);
            console.warn('  Gradle\'s processDebugGoogleServices task will likely fail.');
            console.warn(SEP + '\n');
        }
    }

    // ── Step 4: warn when placeholder credentials are still in use ───────
    if (json?.project_info?.project_number === PLACEHOLDER_PROJECT_NUMBER) {
        console.warn('\n' + SEP);
        console.warn('  WARNING: google-services.json contains placeholder Firebase credentials.');
        console.warn('  FCM push notifications will NOT work at runtime.');
        console.warn('  Replace applications/Demo/google-services.json with real values from:');
        console.warn('    https://console.firebase.google.com  →  Project settings  →  Download');
        console.warn(SEP + '\n');
    }
};
