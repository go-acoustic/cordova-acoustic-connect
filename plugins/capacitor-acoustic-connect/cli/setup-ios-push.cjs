'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * `npx acoustic-connect setup-ios-push [dir] [--app-group group.x] [--team ID] [--dry-run]`  (the team and the App Group default to iosDevelopmentTeam
 * and iosAppGroupIdentifier of the plugin block)
 *
 * Adds the two iOS extensions of rich push (a Notification Service Extension, which downloads the media and records that the
 * notification was received, and a Notification Content Extension, which draws the expanded notification) to the iOS project of a
 * Capacitor app: it writes their sources from templates, with the App Group in them, and has a Ruby script (cli/add_ios_extensions.rb,
 * the `xcodeproj` gem that CocoaPods brings) add the targets to the Xcode project. Running it again is safe: it never overwrites a file
 * that is there, and the project edits are idempotent.
 *
 * Both ways of linking the plugin are covered, and the extensions always get the SDK build the plugin links. In a Swift Package Manager app
 * they get the Connect SDK as a Swift package of the Xcode project, the one the plugin's Package.swift links: ConnectDebug-SP in the beta npm
 * package, Connect-SP in the public one. In a CocoaPods app (ios/App/Podfile) they get it as the pod of the plugin's podspec (AcousticConnect
 * with useRelease, else AcousticConnectDebug): the command adds a target block for each extension to the Podfile, with the same version
 * requirement as the podspec, and `pod install` (or `npx cap sync ios`) then links it. The SDK is never linked to an extension by both ways.
 * Both SDK builds vend the module Connect, so an app cannot link both: an extension an earlier run linked to the other one (by another npm
 * package or version of the plugin, or before a change of useRelease) is moved to the plugin's.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLACEHOLDER = 'CONNECT_APP_GROUP_IDENTIFIER_PLACEHOLDER';
const TEMPLATES = path.join(__dirname, 'templates');
const SCRIPT = path.join(__dirname, 'add_ios_extensions.rb');
const PACKAGE_SWIFT = path.join(__dirname, '..', 'Package.swift');
const EXTENSIONS = ['ConnectNSE', 'ConnectNCE'];
const APP_GROUP = /^group\.[A-Za-z0-9.-]+[A-Za-z0-9]$/;
/** The floor of the release pod and of an iosVersion the app names: SDK_FLOOR of the podspec. */
const RELEASE_FLOOR = '2.1.51';
/** The floor of the beta pod: WEB_CAPTURE_FLOOR of the podspec. */
const DEBUG_FLOOR = '2.2.35';

function parseArgs(argv) {
    const options = { dir: undefined, appGroup: undefined, team: undefined, dryRun: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--app-group' || arg === '--team') {
            const value = argv[i + 1];
            if (value === undefined || value.indexOf('--') === 0) throw new Error(arg + ' needs a value');
            options[arg === '--team' ? 'team' : 'appGroup'] = value;
            i += 1;
        } else if (arg.indexOf('--') === 0) {
            throw new Error('unknown option ' + arg);
        } else if (options.dir === undefined) {
            options.dir = arg;
        } else {
            throw new Error('more than one folder given: ' + options.dir + ' and ' + arg);
        }
    }
    if (options.dir === undefined) options.dir = process.cwd();
    return options;
}

/**
 * A setting of the plugin block of the app's capacitor.config.json, else of the copy `npx cap sync` leaves in ios/App/App/ (an app with a
 * capacitor.config.ts has only that one), the order the podspec reads them in; undefined when neither has the block or can be read.
 */
function pluginSetting(dir, key) {
    const files = [path.join(dir, 'capacitor.config.json'), path.join(dir, 'ios', 'App', 'App', 'capacitor.config.json')];
    for (let i = 0; i < files.length; i += 1) {
        try {
            const config = JSON.parse(fs.readFileSync(files[i], 'utf8'));
            const block = config.plugins && config.plugins.AcousticConnect;
            if (block) return block[key];
        } catch (_) {
            // not there or not JSON: the next file
        }
    }
    return undefined;
}

const TEAM_ID = /^[A-Z0-9]{10}$/;

/**
 * The development team for the app and the extensions: the option, else iosDevelopmentTeam of the plugin block (what the Cordova hook read
 * from iOSDevelopmentTeam). It is optional, and the placeholder of the example config counts as none; written wrongly it stops the command.
 */
function teamFor(options) {
    const value = options.team !== undefined ? options.team : pluginSetting(options.dir, 'iosDevelopmentTeam');
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && (!value.trim() || /^YOUR_/i.test(value.trim()))) return undefined;
    if (typeof value !== 'string' || !TEAM_ID.test(value.trim())) {
        throw new Error('"' + value + '" is not a development team ID: it is ten capital letters and digits (the Team ID of your Apple developer account)');
    }
    return value.trim();
}

/** The App Group: the option, else iosAppGroupIdentifier of the plugin block in the app's capacitor.config.json. */
function appGroupFor(options) {
    let group = options.appGroup;
    if (group === undefined) group = pluginSetting(options.dir, 'iosAppGroupIdentifier');
    if (!group) {
        throw new Error('no App Group: pass --app-group group.<your.reverse.dns> or set iosAppGroupIdentifier in the AcousticConnect ' +
            'block of capacitor.config.json');
    }
    if (!APP_GROUP.test(group)) {
        throw new Error('"' + group + '" is not an App Group identifier: it starts with "group." and has letters, digits, dots and dashes');
    }
    return group;
}

/**
 * The version of the Connect package `name` (ConnectDebug-SP by default, or Connect-SP) the plugin requires at least (`from:` in Package.swift;
 * `exact:` is read too), which the extensions use as their floor; the one of ConnectDebug-SP is also the floor of the beta pod.
 */
function sdkVersionFrom(packageSwift, name) {
    const match = new RegExp('/' + (name || 'ConnectDebug-SP') + '(?:\\.git)?"[^\\n]*(?:exact|from):\\s*"(\\d+\\.\\d+\\.\\d+)"').exec(packageSwift);
    return match ? match[1] : null;
}

/** The Connect package the plugin's Package.swift links: ConnectDebug-SP (the beta npm package) or Connect-SP (the public one); null for neither. */
function spmPackageFrom(packageSwift) {
    const match = /\.product\(name:\s*"Connect",\s*package:\s*"(Connect(?:Debug)?-SP)"\)/.exec(packageSwift || '');
    return match ? match[1] : null;
}

/** The Connect pod of the plugin's podspec: AcousticConnect when useRelease is true, else AcousticConnectDebug. */
function podNameFor(useRelease) {
    return useRelease === true ? 'AcousticConnect' : 'AcousticConnectDebug';
}

/**
 * The Connect pod and its version requirement, as the plugin's podspec states them: the release pod from the plugin floor with useRelease, else
 * the beta pod from its floor; with an iosVersion the app names, that version, from the plugin floor.
 */
function sdkPod(dir) {
    const value = pluginSetting(dir, 'iosVersion');
    const pinned = typeof value === 'string' ? value.trim() : '';
    if (pinned && !/^\d+\.\d+\.\d+$/.test(pinned)) {
        throw new Error('iosVersion "' + value + '" in the plugin block is not a version: write it as x.y.z');
    }
    const name = podNameFor(pluginSetting(dir, 'useRelease'));
    const floor = name === 'AcousticConnect' ? RELEASE_FLOOR : DEBUG_FLOOR;
    return { name: name, requirements: pinned ? ['>= ' + RELEASE_FLOOR, '= ' + pinned] : ['>= ' + floor] };
}

const PODSPECS_SOURCE = "source 'https://github.com/go-acoustic/PodSpecs.git'";
const CDN_SOURCE = "source 'https://cdn.cocoapods.org/'";
// Only active lines count: a commented-out source names nothing. Either quote style, with or without .git.
const PODSPECS_LINE = /^[ \t]*source[ \t]+(['"])https:\/\/github\.com\/go-acoustic\/PodSpecs(?:\.git)?\1/m;
const FIRST_SOURCE = /^[ \t]*source[ \t]+['"]/m;

/** True when the Podfile has an active `source` line for the Acoustic spec repo. */
function hasPodSpecsSource(text) {
    return PODSPECS_LINE.test(text);
}

/**
 * Returns the Podfile text with the Acoustic spec repo as its first source. CocoaPods trunk becomes read-only on 2 December 2026 and gets no
 * later AcousticConnect versions; they are published to go-acoustic/PodSpecs, and a pod cannot name its source, so the Podfile has to. The repo
 * goes on its own line just before the first active source the Podfile names; when it names none, the CocoaPods CDN is added after it, because
 * declaring any source turns off the CDN default. CocoaPods takes versions from every source, so a version that is only on trunk still resolves.
 * A Podfile that already names the repo is returned as it is.
 */
function addPodSpecsSource(text) {
    if (hasPodSpecsSource(text)) return text;
    const firstSource = FIRST_SOURCE.exec(text);
    if (firstSource) return text.slice(0, firstSource.index) + PODSPECS_SOURCE + '\n' + text.slice(firstSource.index);
    return PODSPECS_SOURCE + '\n' + CDN_SOURCE + '\n' + text;
}

/**
 * Adds the Acoustic spec repo to the Podfile of a CocoaPods app, for apps that do not run setup-ios-push. Returns whether the app uses CocoaPods
 * and whether the source was (or, in a dry run, would be) added.
 */
function setupIosPods(options) {
    const podfile = path.join(options.dir, 'ios', 'App', 'Podfile');
    if (!fs.existsSync(podfile)) return { usesPods: false, podfileSource: false };
    const text = fs.readFileSync(podfile, 'utf8');
    const updated = addPodSpecsSource(text);
    if (updated !== text && !options.dryRun) fs.writeFileSync(podfile, updated);
    return { usesPods: true, podfileSource: updated !== text };
}

function podLine(pod) {
    return "pod '" + pod.name + "', " + pod.requirements.map(function (r) { return "'" + r + "'"; }).join(', ');
}

/**
 * Returns the Podfile text with the Connect pod of each extension's target block that names the other Connect pod (AcousticConnect for
 * AcousticConnectDebug, or the other way round) replaced by `pod`, and the names of those extensions. A block that has the plugin's pod, or no
 * Connect pod, is left as it is.
 */
function moveConnectPods(text, pod) {
    const moved = [];
    EXTENSIONS.forEach(function (extension) {
        const block = new RegExp('^[ \\t]*target[ \\t]+[\'"]' + extension + '[\'"][ \\t]+do\\b[\\s\\S]*?^[ \\t]*end\\b', 'm').exec(text);
        if (!block) return;
        const line = /^([ \t]*)pod[ \t]+(['"])(AcousticConnect(?:Debug)?)\2[^\n]*$/m.exec(block[0]);
        if (!line || line[3] === pod.name) return;
        moved.push(extension);
        const rewritten = block[0].replace(line[0], line[1] + podLine(pod));
        text = text.slice(0, block.index) + rewritten + text.slice(block.index + block[0].length);
    });
    return { text: text, moved: moved };
}

/**
 * Adds a target block with the plugin's Connect pod to the Podfile for each extension that has none, and moves a block that names the other
 * Connect pod to the plugin's (moveConnectPods); returns the names it added and moved. Any other block is left as it is, so running the command
 * again changes nothing. The blocks go at the end of the file, outside the target of the app. The Acoustic spec repo is added as a source as
 * well (addPodSpecsSource).
 */
function addPodfileTargets(podfile, pod, dryRun) {
    const original = fs.readFileSync(podfile, 'utf8');
    const move = moveConnectPods(addPodSpecsSource(original), pod);
    let text = move.text;
    const added = [];
    EXTENSIONS.forEach(function (extension) {
        if (new RegExp('^\\s*target\\s+[\'"]' + extension + '[\'"]', 'm').test(text)) return;
        added.push(extension);
        text = text.replace(/\s*$/, '\n') + '\ntarget \'' + extension + '\' do\n  ' + podLine(pod) + '\nend\n';
    });
    if (text !== original && !dryRun) fs.writeFileSync(podfile, text);
    return { added: added, moved: move.moved };
}

function runRuby(args) {
    const env = Object.assign({}, process.env, {
        ACOUSTIC_PROJECT_PATH: args.project,
        ACOUSTIC_APP_GROUP: args.appGroup,
        ACOUSTIC_SDK_PACKAGE: args.sdkPackage,
        ACOUSTIC_SDK_VERSION: args.sdkVersion,
        ACOUSTIC_LINK_SDK: args.linkSdk,
        ACOUSTIC_DEVELOPMENT_TEAM: args.team || ''
    });
    const result = spawnSync('ruby', [SCRIPT], { env: env, encoding: 'utf8' });
    return { status: result.error ? 127 : result.status, output: (result.stdout || '') + (result.stderr || '') + (result.error ? String(result.error.message) : '') };
}

function setupIosPush(options) {
    const iosDir = path.join(options.dir, 'ios', 'App');
    const project = path.join(iosDir, 'App.xcodeproj');
    if (!fs.existsSync(project)) {
        throw new Error('no iOS project at ' + path.join('ios', 'App', 'App.xcodeproj') + ' in ' + options.dir + ': run `npx cap add ios` first');
    }
    const podfile = path.join(iosDir, 'Podfile');
    const usesPods = fs.existsSync(podfile);
    const packageSwift = fs.readFileSync(PACKAGE_SWIFT, 'utf8');
    const sdkPackage = spmPackageFrom(packageSwift);
    const sdkVersion = sdkPackage && sdkVersionFrom(packageSwift, sdkPackage);
    if (!sdkVersion) throw new Error('the plugin pins no Connect-SP or ConnectDebug-SP version in its Package.swift');

    const written = [];
    const kept = [];
    EXTENSIONS.forEach(function (extension) {
        fs.readdirSync(path.join(TEMPLATES, extension)).forEach(function (file) {
            const relative = extension + '/' + file;
            const target = path.join(iosDir, extension, file);
            if (fs.existsSync(target)) {
                kept.push(relative);
                return;
            }
            written.push(relative);
            if (options.dryRun) return;
            const text = fs.readFileSync(path.join(TEMPLATES, extension, file), 'utf8').split(PLACEHOLDER).join(options.appGroup);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, text);
        });
    });

    const podfileSource = usesPods && !hasPodSpecsSource(fs.readFileSync(podfile, 'utf8'));
    const pod = usesPods ? sdkPod(options.dir) : null;
    const pods = usesPods ? addPodfileTargets(podfile, pod, options.dryRun) : { added: [], moved: [] };

    if (!options.dryRun) {
        const result = (options.ruby || runRuby)({
            project: project, appGroup: options.appGroup, sdkPackage: sdkPackage, sdkVersion: sdkVersion, team: options.team,
            linkSdk: usesPods ? 'pods' : 'spm'
        });
        if (result.status !== 0) {
            throw new Error('adding the targets to the Xcode project failed (needs ruby and the xcodeproj gem: `gem install xcodeproj`):\n' + result.output);
        }
    }
    return {
        written: written, kept: kept, sdkPackage: sdkPackage, sdkVersion: sdkVersion, usesPods: usesPods, pod: pod && pod.name,
        podfileTargets: pods.added, podfileMoved: pods.moved, podfileSource: podfileSource
    };
}

module.exports = {
    parseArgs, appGroupFor, teamFor, pluginSetting, sdkVersionFrom, spmPackageFrom, podNameFor, sdkPod, hasPodSpecsSource, addPodSpecsSource, moveConnectPods, setupIosPods,
    addPodfileTargets, setupIosPush, runRuby, PLACEHOLDER, RELEASE_FLOOR, DEBUG_FLOOR
};
