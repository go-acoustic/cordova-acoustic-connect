#!/usr/bin/env node
'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * `npx acoustic-connect <command>`: helpers that set up the native side of an app that uses capacitor-acoustic-connect.
 */

const setup = require('./setup-ios-push.cjs');
const doctor = require('./doctor.cjs');

const USAGE = [
    'Usage: acoustic-connect <command> [options]',
    '',
    'Commands:',
    '  doctor [dir] [--require-push]',
    '      Checks the config, the Android and iOS projects of the app in dir for what the plugin needs; changes nothing.',
    '  setup-ios-push [dir] [--app-group group.x] [--team ID] [--dry-run]',
    '      Adds the rich-push extensions (ConnectNSE, ConnectNCE) to the iOS project of the app in dir.'
].join('\n');

function main(argv) {
    const command = argv[0];
    if (command === 'doctor') {
        try {
            return doctor.runDoctor(argv.slice(1));
        } catch (error) {
            process.stderr.write('ERROR: ' + error.message + '\n');
            return 1;
        }
    }
    if (command !== 'setup-ios-push') {
        process.stderr.write((command ? 'Unknown command "' + command + '".\n\n' : '') + USAGE + '\n');
        return 2;
    }
    try {
        const options = setup.parseArgs(argv.slice(1));
        options.appGroup = setup.appGroupFor(options);
        options.team = setup.teamFor(options);
        const report = setup.setupIosPush(options);
        const verb = options.dryRun ? 'would write' : 'wrote';
        report.written.forEach(function (file) { process.stdout.write(verb + ' ios/App/' + file + '\n'); });
        report.kept.forEach(function (file) { process.stdout.write('kept  ios/App/' + file + ' (already there)\n'); });
        if (options.team) process.stdout.write((options.dryRun ? 'would set' : 'set') + ' team ' + options.team + ' on the app and the extensions\n');
        if (!options.dryRun) process.stdout.write('Added the ConnectNSE and ConnectNCE targets to the Xcode project (Connect-SP ' + report.sdkVersion + ').\n');
        return 0;
    } catch (error) {
        process.stderr.write('ERROR: ' + error.message + '\n');
        return 1;
    }
}

process.exitCode = main(process.argv.slice(2));
