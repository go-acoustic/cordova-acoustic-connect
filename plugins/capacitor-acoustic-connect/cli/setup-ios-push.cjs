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

/** A setting of the plugin block of the app's capacitor.config.json; undefined when there is none or the file cannot be read. */
function pluginSetting(dir, key) {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(dir, 'capacitor.config.json'), 'utf8'));
        const block = config.plugins && config.plugins.AcousticConnect;
        return block ? block[key] : undefined;
    } catch (_) {
        return undefined;
    }
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

/** The Connect-SP version the plugin pins, which the extensions have to use as well. */
function sdkVersionFrom(packageSwift) {
    const match = /Connect-SP[^\n]*exact:\s*"(\d+\.\d+\.\d+)"/.exec(packageSwift);
    return match ? match[1] : null;
}

function runRuby(args) {
    const env = Object.assign({}, process.env, {
        ACOUSTIC_PROJECT_PATH: args.project,
        ACOUSTIC_APP_GROUP: args.appGroup,
        ACOUSTIC_SDK_VERSION: args.sdkVersion,
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
    if (fs.existsSync(path.join(iosDir, 'Podfile'))) {
        throw new Error('this app uses CocoaPods (ios/App/Podfile), and the extensions are linked to the Connect SDK through Swift Package Manager, ' +
            'so the SDK would be in the app twice. Add the extensions by hand for now: the CocoaPods set-up is described in the README, ' +
            'or move the app to Swift Package Manager.');
    }
    const sdkVersion = sdkVersionFrom(fs.readFileSync(PACKAGE_SWIFT, 'utf8'));
    if (!sdkVersion) throw new Error('the plugin pins no Connect-SP version in its Package.swift');

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

    if (!options.dryRun) {
        const result = (options.ruby || runRuby)({ project: project, appGroup: options.appGroup, sdkVersion: sdkVersion, team: options.team });
        if (result.status !== 0) {
            throw new Error('adding the targets to the Xcode project failed (needs ruby and the xcodeproj gem: `gem install xcodeproj`):\n' + result.output);
        }
    }
    return { written: written, kept: kept, sdkVersion: sdkVersion };
}

module.exports = { parseArgs, appGroupFor, teamFor, sdkVersionFrom, setupIosPush, runRuby, PLACEHOLDER };
