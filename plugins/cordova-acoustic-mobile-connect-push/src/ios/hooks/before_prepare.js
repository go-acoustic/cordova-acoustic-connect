#!/usr/bin/env node
'use strict';

// Runs BEFORE cordova-ios platform prepare (which itself calls `pod install`).
//
// Two jobs:
//  1. Fix unquoted inputFileListPaths in project.pbxproj so Nanaimo parses it.
//     The xcode npm writeSync() strips quotes from paths that contain spaces
//     ("${PODS_ROOT}/Target Support Files/..."), causing "Array missing ','".
//
//  2. Strip ConnectNSE / ConnectNCE from the Podfile if those targets are not
//     present in the pbxproj.  On a fresh platform (or after plugin re-add) the
//     Podfile from a previous prepare still has the NSE/NCE targets, but the
//     pbxproj has been reset.  cordova-ios then runs `pod install` and CocoaPods
//     1.16.2 fails with "Unable to find host target(s) for ConnectNSE, ConnectNCE"
//     because it cannot validate the host-extension relationship.
//     after_prepare.js will add the targets back to the pbxproj and re-run
//     `pod install` with the full Podfile.

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. Fix unquoted inputFileListPaths
// ---------------------------------------------------------------------------

const XCFILELIST_SUFFIX =
    'Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks-input-files.xcfilelist';
const CORRECT_INPUT = '"${PODS_ROOT}/' + XCFILELIST_SUFFIX + '"';
const PLACEHOLDER   = '\x00XCFILELIST\x00';

function patchPbxproj(pbxprojPath) {
    let content = fs.readFileSync(pbxprojPath, 'utf8');

    let pi = content.split(CORRECT_INPUT).join(PLACEHOLDER);              // protect correct form
    pi = pi.split('${PODS_ROOT}/' + XCFILELIST_SUFFIX).join(PLACEHOLDER); // fix B1 (unquoted)
    pi = pi.replace(
        new RegExp('"?/?' + XCFILELIST_SUFFIX.replace(/\//g, '\\/').replace(/\./g, '\\.') + '"?', 'g'),
        PLACEHOLDER
    );
    const fixed = pi.split(PLACEHOLDER).join(CORRECT_INPUT);

    if (fixed !== content) {
        fs.writeFileSync(pbxprojPath, fixed, 'utf8');
        console.log('[acoustic-connect] before_prepare: fixed unquoted inputFileListPaths in project.pbxproj');
    }
}

// ---------------------------------------------------------------------------
// 2. Strip NSE/NCE from Podfile when targets are absent from pbxproj
// ---------------------------------------------------------------------------

// Removes one named target block from content, tracking do/end depth so nested
// do…end blocks (e.g. script_phase, post_install) don't truncate the match early.
// Returns the modified string, or the original if the target was not found.
function stripTargetBlock(content, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const openRe  = new RegExp('(\\n?)[\\t ]*target\\s+\'' + escaped + '\'\\s+do[^\\n]*\\n');
    const match   = openRe.exec(content);
    if (!match) return content;

    let depth = 1;
    let pos   = match.index + match[0].length;

    while (pos < content.length && depth > 0) {
        const nlIdx  = content.indexOf('\n', pos);
        const lineEnd = nlIdx === -1 ? content.length : nlIdx + 1;
        // Strip inline Ruby comments before keyword matching.
        const line   = content.slice(pos, lineEnd).replace(/#.*$/, '').trim();

        // A line ending with `do` or `do |params|` opens a new block.
        if (/\bdo(\s*\|[^|]*\|)?\s*$/.test(line)) depth++;
        if (/^end\b/.test(line)) {
            depth--;
            if (depth === 0) { pos = lineEnd; break; }
        }
        pos = lineEnd;
    }

    return content.slice(0, match.index) + '\n' + content.slice(pos);
}

function stripExtensionTargetsFromPodfile(podfilePath, targetNames) {
    let content = fs.readFileSync(podfilePath, 'utf8');
    let changed = false;

    for (const name of targetNames) {
        const next = stripTargetBlock(content, name);
        if (next !== content) { content = next; changed = true; }
    }

    if (changed) {
        fs.writeFileSync(podfilePath, content, 'utf8');
        console.log('[acoustic-connect] before_prepare: stripped missing NSE/NCE targets from Podfile (will be re-added by after_prepare)');
    }
}

function syncPodfileWithPbxproj(iosDir, pbxprojPath) {
    const podfilePath = path.join(iosDir, 'Podfile');
    if (!fs.existsSync(podfilePath)) return; // no Podfile yet — nothing to strip

    const content = fs.readFileSync(podfilePath, 'utf8');
    const hasNSE   = content.includes("target 'ConnectNSE'");
    const hasNCE   = content.includes("target 'ConnectNCE'");
    if (!hasNSE && !hasNCE) return; // already clean

    // Strip whichever targets are absent from the pbxproj
    const toStrip = [];
    const pbxContent = fs.readFileSync(pbxprojPath, 'utf8');
    if (hasNSE && !/name\s*=\s*"?ConnectNSE"?\s*;/.test(pbxContent)) toStrip.push('ConnectNSE');
    if (hasNCE && !/name\s*=\s*"?ConnectNCE"?\s*;/.test(pbxContent)) toStrip.push('ConnectNCE');

    if (toStrip.length > 0) {
        stripExtensionTargetsFromPodfile(podfilePath, toStrip);
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

module.exports = function (context) {
    const platforms = context.opts && context.opts.platforms;
    if (!Array.isArray(platforms) || !platforms.includes('ios')) return;

    const projectRoot = context.opts.projectRoot
        || (context.opts.cordova && context.opts.cordova.projectRoot)
        || process.cwd();

    const iosDir = path.join(projectRoot, 'platforms', 'ios');
    if (!fs.existsSync(iosDir)) return;

    const xcodeprojDir = fs.readdirSync(iosDir).find(e => e.endsWith('.xcodeproj'));
    if (!xcodeprojDir) return;

    const pbxprojPath = path.join(iosDir, xcodeprojDir, 'project.pbxproj');
    if (!fs.existsSync(pbxprojPath)) return;

    patchPbxproj(pbxprojPath);
    syncPodfileWithPbxproj(iosDir, pbxprojPath);
};
