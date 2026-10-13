'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The example app's own iOS project uses Swift Package Manager. To check the CocoaPods route too, this builds
 * a CocoaPods app outside the repository from the example app's sources:
 *
 *   node e2e/ios-host.js <dir>
 *
 * and e2e/run.js --platform ios --ios-host <dir> builds and runs it.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const exampleRoot = path.resolve(__dirname, '..');                   // applications/DemoCapacitor
const pluginRoot = path.resolve(exampleRoot, '..', '..', 'plugins', 'capacitor-acoustic-connect');
const MIN_IOS = '15.1';

/** The Capacitor template targets iOS 15.0; the Connect SDK needs 15.1. */
function patchPodfile(text) {
    return text.replace(/platform :ios, '15\.0'/, "platform :ios, '" + MIN_IOS + "'");
}

function patchProject(text) {
    return text.replace(/IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/g, 'IPHONEOS_DEPLOYMENT_TARGET = ' + MIN_IOS + ';');
}

function run(command, args, cwd, options) {
    const r = spawnSync(command, args, { cwd: cwd, stdio: 'inherit', env: process.env });
    if (r.status !== 0 && !(options && options.allowFailure)) {
        throw new Error(command + ' ' + args.join(' ') + ' failed (exit ' + r.status + ')');
    }
    return r.status;
}

function patchFile(file, change) {
    fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8')));
}

function prepareIosHost(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    ['src', 'vite.config.ts'].forEach(function (name) {
        fs.cpSync(path.join(exampleRoot, name), path.join(dir, name), { recursive: true });
    });

    const pkg = JSON.parse(fs.readFileSync(path.join(exampleRoot, 'package.json'), 'utf8'));
    pkg.dependencies['capacitor-acoustic-connect-beta'] = 'file:' + pluginRoot;
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
    fs.copyFileSync(path.join(exampleRoot, 'capacitor.config.json'), path.join(dir, 'capacitor.config.json'));

    // the scenario is imported by a path relative to the example app; the host sits elsewhere
    const scenario = path.resolve(exampleRoot, '..', 'Demo', 'www', 'js', 'e2e', 'scenario.js');
    patchFile(path.join(dir, 'src', 'js', 'e2e.js'), function (text) {
        return text.replace(/'\.\.\/\.\.\/\.\.\/Demo\/www\/js\/e2e\/scenario\.js'/, JSON.stringify(scenario));
    });

    run('npm', ['install'], dir);
    run('npx', ['vite', 'build'], dir);
    // `cap add` ends with a pod install that fails on the template's iOS 15.0; the project is there
    // by then, so patch it and sync again.
    run('npx', ['cap', 'add', 'ios', '--packagemanager', 'CocoaPods'], dir, { allowFailure: true });
    const app = path.join(dir, 'ios', 'App');
    if (!fs.existsSync(path.join(app, 'Podfile'))) throw new Error('cap add ios did not create the project');
    patchFile(path.join(app, 'Podfile'), patchPodfile);
    patchFile(path.join(app, 'App.xcodeproj', 'project.pbxproj'), patchProject);
    run('npx', ['cap', 'sync', 'ios'], dir);
}

module.exports = { patchPodfile, patchProject, prepareIosHost, MIN_IOS };

if (require.main === module) {
    const dir = process.argv[2];
    if (!dir) {
        console.error('usage: node e2e/ios-host.js <dir>');
        process.exit(2);
    }
    prepareIosHost(path.resolve(dir));
}
