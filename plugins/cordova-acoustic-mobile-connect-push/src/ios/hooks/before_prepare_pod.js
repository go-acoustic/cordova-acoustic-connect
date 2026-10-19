#!/usr/bin/env node

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs at `before_prepare` (iOS).
 *
 * Cordova regenerates the Podfile during prepare by parsing the EXISTING
 * Podfile for pod declarations (not plugin.xml, not pods.json). This hook
 * rewrites the Podfile with the correct static pod declaration BEFORE Cordova
 * reads it, so the generated Podfile carries the right variant into `pod install`.
 *
 * It also updates pods.json so the state stays consistent.
 *
 * The pods of the app's other plugins (Firebase/Messaging of another push plugin, say) are kept: they are
 * read from the existing Podfile (the pod lines of the app target, not the ConnectNSE/ConnectNCE blocks
 * nested in it), and a pod that pods.json lists but the Podfile has already lost is put back. Only the
 * Acoustic pod is replaced. Without that, a project with another plugin that has pods failed to build on
 * iOS ("Module 'Firebase' not found"): every prepare rewrote the Podfile with the Acoustic pod alone.
 *
 *   useRelease: true  (or missing) → AcousticConnect    (>= 2.1.51)
 *   useRelease: false               → AcousticConnectDebug (>= 2.1.51)
 *
 * Connect.iOSVersion optionally pins a different Connect SDK version (mirrors
 * AndroidVersion in build-extras.gradle). Values below MIN_CONNECT_VERSION are
 * rejected. 2.1.51 is the first build with
 * the iOS screen-capture and WebView fixes, and (2.1.13 and later) free of the
 * podspec/duplicate-xcframework bug described below. The plugin's explicit layout
 * capture (ConnectPlugin.swift) is written for these builds.
 */

'use strict';

var fs   = require('fs');
var path = require('path');

var RELEASE_NAME = 'AcousticConnect';
var RELEASE_SPEC = '>= 2.1.51';
var DEBUG_NAME   = 'AcousticConnectDebug';
var DEBUG_SPEC   = '>= 2.1.51';
var MIN_IOS      = '15.1';
var MIN_CONNECT_VERSION = '2.1.51';

// Parses a leading "x.y.z" out of a version string, ignoring any pre-release
// suffix (e.g. "2.1.20-beta" → [2, 1, 20]). Returns null if it doesn't match.
function parseVersion(v) {
    var m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isVersionAtLeast(version, min) {
    for (var i = 0; i < 3; i++) {
        if (version[i] !== min[i]) {
            return version[i] > min[i];
        }
    }
    return true;
}

// Resolve Xcode target/project name from the .xcodeproj directory present
// under platforms/ios. Cordova-iOS 7+ always names it 'App', but derive it
// dynamically so the hook works if the project is renamed.
function resolveProjectName(iosDir) {
    try {
        var entries = fs.readdirSync(iosDir);
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].slice(-10) === '.xcodeproj') {
                return entries[i].slice(0, -10);
            }
        }
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw new Error('[acoustic-connect] before_prepare: cannot read platforms/ios: ' + e.message);
        }
    }
    return 'App';
}

function isAcousticPod(name) {
    return name === RELEASE_NAME || name === DEBUG_NAME ||
        name.indexOf(RELEASE_NAME + '/') === 0 || name.indexOf(DEBUG_NAME + '/') === 0;
}

// The pod declarations other plugins have in the app target of the existing Podfile, as the lines they are written in, in order.
// Only the lines at the level of the target itself: what sits in a nested block (the ConnectNSE/ConnectNCE targets that
// after_prepare.js adds) is not another plugin's, and is added again by that hook. Comments are not declarations.
function otherPodLines(podfileText, projectName) {
    var escapedName = projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var opens = new RegExp('^target\\s+[\'"]' + escapedName + '[\'"]\\s+do\\b');
    var lines = podfileText.split('\n');
    var found = [];
    var inApp = false;
    var depth = 0;
    for (var i = 0; i < lines.length; i++) {
        var code = lines[i].replace(/#.*$/, '').trim();
        if (!inApp) {
            if (opens.test(code)) {
                inApp = true;
                depth = 1;
            }
            continue;
        }
        if (/\bdo(\s*\|[^|]*\|)?\s*$/.test(code)) {
            depth++;
            continue;
        }
        if (/^end\b/.test(code)) {
            depth--;
            if (depth === 0) break;
            continue;
        }
        var pod = depth === 1 ? /^pod\s+['"]([^'"]+)['"]/.exec(code) : null;
        if (pod && !isAcousticPod(pod[1])) {
            found.push({ name: pod[1], line: lines[i].trim() });
        }
    }
    return found;
}

// The pods of other plugins to write: the ones the Podfile has, then the ones pods.json lists that it has lost (a Podfile that an earlier
// run of this hook had already rewritten), as `pod 'name', 'spec'`. Sorted by name for the second group, so the file is the same on every run.
function otherPods(existingPodfile, podsJson, projectName) {
    var kept = otherPodLines(existingPodfile, projectName);
    var names = {};
    kept.forEach(function (p) { names[p.name] = true; });
    var lines = kept.map(function (p) { return p.line; });
    var libs = (podsJson && podsJson.libraries) || {};
    Object.keys(libs).sort().forEach(function (name) {
        if (isAcousticPod(name) || names[name]) return;
        var spec = libs[name] && typeof libs[name].spec === 'string' ? libs[name].spec.trim() : '';
        lines.push("pod '" + name + "'" + (spec ? ", '" + spec + "'" : ''));
    });
    return lines;
}

function buildPodfile(podName, podSpec, deployTarget, projectName, extraPods) {
    var name = projectName || 'App';
    var others = (extraPods || []).map(function (line) { return '\t' + line + '\n'; }).join('');
    return (
        '# DO NOT MODIFY -- auto-generated by Apache Cordova\n' +
        "source 'https://cdn.cocoapods.org/'\n" +
        "source 'https://github.com/CocoaPods/Specs.git'\n" +
        "install! 'cocoapods', :warn_for_unused_master_specs_repo => false\n" +
        "platform :ios, '" + deployTarget + "'\n" +
        'use_frameworks!\n' +
        "target '" + name + "' do\n" +
        "\tproject '" + name + ".xcodeproj'\n" +
        "\tpod '" + podName + "', '" + podSpec + "'\n" +
        others +
        'end\n' +
        '\n' +
        'post_install do |installer|\n' +
        '  installer.generated_projects.each do |project|\n' +
        '    project.targets.each do |target|\n' +
        '      target.build_configurations.each do |config|\n' +
        "        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '" + deployTarget + "'\n" +
        '      end\n' +
        '    end\n' +
        '  end\n' +
        'end\n'
    );
}

module.exports = function (context) {
    var platforms = context.opts.platforms || [];
    if (platforms.length > 0 && platforms.indexOf('ios') === -1) {
        return;
    }

    var projectRoot = context.opts.projectRoot;

    // Read ConnectConfig.json — defaults to release when absent.
    var useRelease  = true;
    var iosVersion  = '';
    var configPath  = path.join(projectRoot, 'ConnectConfig.json');
    if (fs.existsSync(configPath)) {
        try {
            var cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (cfg && cfg.Connect) {
                if (cfg.Connect.useRelease === false) {
                    useRelease = false;
                }
                if (cfg.Connect.iOSVersion) {
                    iosVersion = String(cfg.Connect.iOSVersion).trim();
                }
            }
        } catch (e) {
            console.warn('[acoustic-connect] before_prepare: ConnectConfig.json parse error — ' +
                         e.message + '; defaulting to release variant');
        }
    }

    var podName  = useRelease ? RELEASE_NAME : DEBUG_NAME;
    var podSpec  = useRelease ? RELEASE_SPEC : DEBUG_SPEC;

    // iOSVersion override — validated against MIN_CONNECT_VERSION so a
    // misconfigured pin can't reintroduce the podspec bug the default avoids.
    if (iosVersion) {
        var parsed = parseVersion(iosVersion);
        if (!parsed) {
            console.warn('[acoustic-connect] before_prepare: iOSVersion \'' + iosVersion +
                         '\' is not a valid version string — falling back to ' + podSpec);
        } else if (!isVersionAtLeast(parsed, parseVersion(MIN_CONNECT_VERSION))) {
            console.warn('[acoustic-connect] before_prepare: iOSVersion \'' + iosVersion +
                         '\' is below the minimum supported ' + MIN_CONNECT_VERSION +
                         ' — falling back to ' + podSpec);
        } else {
            podSpec = '= ' + iosVersion;
        }
    }

    var iosDir      = path.join(projectRoot, 'platforms', 'ios');
    var projectName = resolveProjectName(iosDir);

    // Rewrite the Podfile with the correct static pod declaration so that
    // Cordova's Podfile parser picks up the right pod when it runs next.
    var podfilePath = path.join(iosDir, 'Podfile');
    if (fs.existsSync(podfilePath)) {
        var existing   = fs.readFileSync(podfilePath, 'utf8');
        var knownPods  = null;
        try {
            knownPods = JSON.parse(fs.readFileSync(path.join(iosDir, 'pods.json'), 'utf8'));
        } catch (e) {
            // none, or not JSON: the pods.json step below reports a file that is there and malformed
        }
        var newPodfile = buildPodfile(podName, podSpec, MIN_IOS, projectName, otherPods(existing, knownPods, projectName));
        if (existing !== newPodfile) {
            fs.writeFileSync(podfilePath, newPodfile, 'utf8');
            console.log('[acoustic-connect] before_prepare: Podfile → ' +
                        podName + ' ' + podSpec);
        }
    }

    // Keep pods.json in sync so the Cordova/Xcode tooling stays consistent.
    var podsJsonPath = path.join(iosDir, 'pods.json');
    if (fs.existsSync(podsJsonPath)) {
        try {
            var pods = JSON.parse(fs.readFileSync(podsJsonPath, 'utf8'));
            var libs = pods.libraries || {};
            var changed = false;

            // Remove whichever variant is wrong.
            var wrongName = useRelease ? DEBUG_NAME : RELEASE_NAME;
            if (libs[wrongName]) {
                delete libs[wrongName];
                changed = true;
            }

            // Ensure the correct variant is present with count ≥ 1.
            if (!libs[podName] || libs[podName].spec !== podSpec) {
                libs[podName] = { name: podName, spec: podSpec, count: 1 };
                changed = true;
            }

            if (changed) {
                pods.libraries = libs;
                fs.writeFileSync(podsJsonPath, JSON.stringify(pods, null, 4), 'utf8');
                console.log('[acoustic-connect] before_prepare: pods.json → ' +
                            podName + ' ' + podSpec);
            }
        } catch (e) {
            throw new Error('[acoustic-connect] before_prepare: failed to update pods.json: ' + e.message);
        }
    }
};
