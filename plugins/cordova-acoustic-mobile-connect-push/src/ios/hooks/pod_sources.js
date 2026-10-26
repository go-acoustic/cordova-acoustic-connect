/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The CocoaPods sources the iOS hooks write into the Podfile, and the `pod install` they run. Not a hook itself: before_prepare_pod.js
 * and after_prepare.js require it, so both write the same list. plugin.xml declares the same sources for cordova-ios; a test checks that
 * its <source> entries are this list, in this order.
 */

'use strict';

// go-acoustic/PodSpecs first: CocoaPods trunk is read-only from 2 December 2026 and gets no later Connect SDK versions, which are published
// there instead. The CDN and the git Specs repo follow, for every other pod. CocoaPods takes versions from every source, so a version that
// is only on trunk still resolves.
var ACOUSTIC_POD_SOURCES = [
    'https://github.com/go-acoustic/PodSpecs.git',
    'https://cdn.cocoapods.org/',
    'https://github.com/CocoaPods/Specs.git'
];

var SOURCE_LINE = /^[ \t]*source[ \t]+(['"])([^'"]+)\1/gm;

// The sources the app already uses: the active `source` lines of its Podfile (comments do not count), then those pods.json lists, which
// cordova-ios fills from the <source> entries of every plugin. Rewriting the Podfile must not drop another plugin's private spec repo.
function existingSources(podfileText, podsJson) {
    var found = [];
    var add = function (url) { if (url && found.indexOf(url) === -1) found.push(url); };
    var match;
    SOURCE_LINE.lastIndex = 0;
    while ((match = SOURCE_LINE.exec(podfileText || '')) !== null) add(match[2]);
    Object.keys((podsJson && podsJson.sources) || {}).forEach(add);
    return found;
}

// The `source` lines to write: the Acoustic list, then every other source once, in the order given.
function sourceLines(others) {
    var urls = ACOUSTIC_POD_SOURCES.slice();
    (others || []).forEach(function (url) { if (urls.indexOf(url) === -1) urls.push(url); });
    return urls.map(function (url) { return "source '" + url + "'"; });
}

// `pod install`, then once more with --repo-update when it fails. A git spec repo such as PodSpecs is cloned once and not refreshed by a
// plain install (unlike the CDN), so an iOSVersion published after the local copy was made is not found until the repo is updated.
// `exec(command, iosDir)` runs a command in iosDir; tests inject it, the hooks use the default.
function runPodInstall(iosDir, exec, log) {
    var run = exec || function (cmd, cwd) { require('child_process').execSync(cmd, { cwd: cwd, stdio: 'inherit', timeout: 300000 }); };
    var say = log || console.log;
    try {
        run('pod install', iosDir);
    } catch (e) {
        say('[acoustic-connect] pod install failed; retrying once with --repo-update to refresh the spec repos');
        run('pod install --repo-update', iosDir);
    }
}

module.exports = { ACOUSTIC_POD_SOURCES: ACOUSTIC_POD_SOURCES, existingSources: existingSources, sourceLines: sourceLines, runPodInstall: runPodInstall };
