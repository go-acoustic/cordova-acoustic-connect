'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * `npx acoustic-connect doctor [dir] [--require-push]`
 *
 * Checks the things of an integration that otherwise go wrong late and confusingly, at build time or on the device: the plugin block of
 * the config (key, collector URL), the Android project (minSdk, the Connect Maven tree, the Firebase file for the app's package) and the iOS
 * project (the push entitlement, the background mode, the resources of the SDK, the rich-push extensions and their App Group). Nothing is
 * changed. The push checks fail only when pushEnabled is on, or with --require-push; without push they are skipped. A failed check makes
 * the exit code 1, a warning does not, so it can gate a build.
 */

const fs = require('fs');
const path = require('path');
const { sdkVersionFrom, hasPodSpecsSource } = require('./setup-ios-push.cjs');

const PLACEHOLDER_HOSTS = /(^|\.)example\.com$/i;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '10.0.2.2'];
const MIN_SDK = 26;
const MIN_NODE = 22;
const MAVEN = 'go-acoustic/Android_Maven';
const ANDROID_RANGE = { min: [11, 0, 21], maxExclusive: [12, 0, 0] };

function parseArgs(argv) {
    const options = { dir: undefined, requirePush: false };
    argv.forEach(function (arg) {
        if (arg === '--require-push') {
            options.requirePush = true;
        } else if (arg.indexOf('--') === 0) {
            throw new Error('unknown option ' + arg);
        } else if (options.dir === undefined) {
            options.dir = arg;
        } else {
            throw new Error('more than one folder given: ' + options.dir + ' and ' + arg);
        }
    });
    if (options.dir === undefined) options.dir = process.cwd();
    return options;
}

function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (_) {
        return null;
    }
}

function readJson(file) {
    const text = readText(file);
    if (text === null) return undefined;
    try {
        return JSON.parse(text);
    } catch (_) {
        return null;
    }
}

/**
 * The plugin block of the config: the app's own file, else a copy that `cap sync` left in a native project. A file that is there but is not
 * JSON is not skipped for the next one, which may be an older copy: it comes back as `malformed`.
 */
function loadConfig(dir) {
    const candidates = [
        path.join(dir, 'capacitor.config.json'),
        path.join(dir, 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json'),
        path.join(dir, 'ios', 'App', 'App', 'capacitor.config.json')
    ];
    for (let i = 0; i < candidates.length; i += 1) {
        const config = readJson(candidates[i]);
        if (config === null) return { file: candidates[i], malformed: true };
        if (config) return { file: candidates[i], block: config.plugins && config.plugins.AcousticConnect };
    }
    return null;
}

/**
 * A setting of the app's target out of the project file. The file has the same key for every target (the rich-push extensions have their own
 * entitlements and Info.plist), so the values under the extensions' folders are left out and the first of the rest is the app's.
 */
function appSetting(pbxproj, key) {
    const values = [...pbxproj.matchAll(new RegExp(key + '\\s*=\\s*"?([^";]+)"?;', 'g'))].map(function (m) { return m[1]; });
    const own = values.filter(function (value) { return !/^(ConnectNSE|ConnectNCE)\//.test(value); });
    return own.length ? own[0] : null;
}

function groupsOf(entitlements) {
    const section = /<key>com\.apple\.security\.application-groups<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(entitlements || '');
    return section ? [...section[1].matchAll(/<string>([^<]+)<\/string>/g)].map(function (m) { return m[1]; }) : [];
}

function diagnose(options) {
    const dir = options.dir;
    const checks = [];
    const add = function (id, status, message) { checks.push({ id: id, status: status, message: message }); };

    // --- Node ---------------------------------------------------------------------------------------------------------------------------
    const nodeVersion = options.nodeVersion || process.versions.node;
    const major = Number(String(nodeVersion).split('.')[0]);
    add('node', major >= MIN_NODE ? 'ok' : 'fail',
        major >= MIN_NODE ? 'Node ' + nodeVersion : 'Node ' + nodeVersion + ' is too old: Capacitor 8 and this plugin need Node ' + MIN_NODE + ' or newer');

    // --- the config -----------------------------------------------------------------------------------------------------------------------
    const found = loadConfig(dir);
    const block = found && found.block;
    if (found && found.malformed) {
        add('config', 'fail', path.relative(dir, found.file) + ' is not valid JSON: fix it, the plugin block cannot be read');
    } else if (!found) {
        add('config', 'fail', 'no capacitor.config.json (and no copy from `npx cap sync` in android/ or ios/): the plugin block cannot be read');
    } else if (!block) {
        add('config', 'fail', path.relative(dir, found.file) + ' has no plugins.AcousticConnect block');
    } else {
        add('config', 'ok', 'plugins.AcousticConnect in ' + path.relative(dir, found.file));
    }
    const config = block || {};
    const push = config.pushEnabled === true || options.requirePush === true;

    const appKey = typeof config.appKey === 'string' ? config.appKey.trim() : '';
    if (!block) {
        add('app-key', 'skip', 'no plugin block');
    } else if (!appKey || /^YOUR_/i.test(appKey)) {
        add('app-key', 'fail', 'appKey is ' + (appKey ? 'the placeholder' : 'empty') + ': put the key of your Connect application in the plugin block');
    } else {
        add('app-key', 'ok', 'appKey is set');
    }

    add.apply(null, ['post-url'].concat(urlCheck('postMessageUrl', config.postMessageUrl, block)));
    if (block && config.killSwitchEnabled === true) {
        add.apply(null, ['kill-switch'].concat(urlCheck('killSwitchUrl', config.killSwitchUrl, block, true)));
    } else {
        add('kill-switch', 'skip', 'the kill switch is off');
    }

    // --- the SDK versions the config pins ----------------------------------------------------------------------------------------------
    add.apply(null, ['android-version'].concat(androidVersionCheck(config)));
    const hasIosProject = fs.existsSync(path.join(dir, 'ios', 'App', 'App.xcodeproj'));
    const usesPods = fs.existsSync(path.join(dir, 'ios', 'App', 'Podfile'));
    add.apply(null, ['ios-version'].concat(iosVersionCheck(config, hasIosProject, usesPods)));

    // --- Android ------------------------------------------------------------------------------------------------------------------------
    const androidDir = path.join(dir, 'android');
    const hasAndroid = fs.existsSync(androidDir);
    if (!hasAndroid) {
        ['min-sdk', 'maven', 'application-id', 'google-services'].forEach(function (id) { add(id, 'skip', 'no Android project'); });
    } else {
        const variables = readText(path.join(androidDir, 'variables.gradle'));
        const sdk = variables ? /minSdkVersion\s*=\s*(\d+)/.exec(variables) : null;
        if (!sdk) {
            add('min-sdk', 'warn', 'no minSdkVersion found in android/variables.gradle: the SDK needs ' + MIN_SDK + ' (the Capacitor template has 24)');
        } else if (Number(sdk[1]) < MIN_SDK) {
            add('min-sdk', 'fail', 'minSdkVersion is ' + sdk[1] + ' in android/variables.gradle: the SDK needs ' + MIN_SDK);
        } else {
            add('min-sdk', 'ok', 'minSdkVersion ' + sdk[1]);
        }

        if (config.useRelease === true) {
            add('maven', 'skip', 'useRelease takes Connect from Maven Central');
        } else if ((readText(path.join(androidDir, 'build.gradle')) || '').indexOf(MAVEN) !== -1) {
            add('maven', 'ok', 'the Connect Maven tree is in android/build.gradle');
        } else {
            add('maven', 'fail', 'android/build.gradle does not list the Connect Maven tree (' + MAVEN + ') in allprojects.repositories');
        }

        const gradle = readText(path.join(androidDir, 'app', 'build.gradle')) || '';
        const idMatch = /applicationId\s*=?\s*["']([^"']+)["']/.exec(gradle);
        const applicationId = idMatch ? idMatch[1] : null;
        add('application-id', applicationId ? 'ok' : 'warn', applicationId ? 'applicationId ' + applicationId : 'no applicationId found in android/app/build.gradle');

        if (!push) {
            add('google-services', 'skip', 'push is off');
        } else {
            const file = path.join(androidDir, 'app', 'google-services.json');
            const services = readJson(file);
            if (services === undefined) {
                add('google-services', 'fail', 'push is on but android/app/google-services.json is missing: add the Firebase file of the app\'s package');
            } else if (services === null) {
                add('google-services', 'fail', 'android/app/google-services.json is not valid JSON');
            } else {
                const packages = (services.client || []).map(function (c) {
                    return c && c.client_info && c.client_info.android_client_info && c.client_info.android_client_info.package_name;
                }).filter(Boolean);
                if (applicationId && packages.indexOf(applicationId) === -1) {
                    add('google-services', 'fail', 'google-services.json has clients for ' + (packages.join(', ') || 'no package') +
                        ', not for the applicationId ' + applicationId);
                } else {
                    add('google-services', 'ok', 'google-services.json has a client for ' + (applicationId || packages.join(', ')));
                }
            }
        }
    }

    // --- iOS ----------------------------------------------------------------------------------------------------------------------------
    const iosDir = path.join(dir, 'ios', 'App');
    const pbxproj = readText(path.join(iosDir, 'App.xcodeproj', 'project.pbxproj'));
    const iosIds = ['ios-entitlements', 'ios-background-mode', 'ios-resources', 'ios-extensions', 'ios-pod-sources'];
    if (pbxproj === null) {
        iosIds.forEach(function (id) { add(id, 'skip', 'no iOS project'); });
    } else {
        const entitlementsFile = appSetting(pbxproj, 'CODE_SIGN_ENTITLEMENTS');
        const entitlements = entitlementsFile ? readText(path.join(iosDir, entitlementsFile)) : null;
        if (!push) {
            add('ios-entitlements', 'skip', 'push is off');
            add('ios-background-mode', 'skip', 'push is off');
            add('ios-extensions', 'skip', 'push is off');
        } else {
            if (!entitlementsFile) {
                add('ios-entitlements', 'fail', 'push is on but the app has no entitlements file (CODE_SIGN_ENTITLEMENTS): add the Push Notifications capability, ' +
                    'or run `npx acoustic-connect setup-ios-push`');
            } else if (entitlements === null || entitlements.indexOf('<key>aps-environment</key>') === -1) {
                add('ios-entitlements', 'fail', entitlementsFile + ' has no aps-environment: the device registers with an empty token');
            } else {
                add('ios-entitlements', 'ok', 'aps-environment in ' + entitlementsFile);
            }

            const infoFile = appSetting(pbxproj, 'INFOPLIST_FILE');
            const info = readText(path.join(iosDir, infoFile || 'App/Info.plist')) || '';
            const modes = /<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(info);
            if (modes && modes[1].indexOf('<string>remote-notification</string>') !== -1) {
                add('ios-background-mode', 'ok', 'remote-notification is a background mode');
            } else {
                add('ios-background-mode', 'fail', 'Info.plist has no remote-notification background mode');
            }
            add.apply(null, ['ios-extensions'].concat(extensionsCheck(iosDir, groupsOf(entitlements), config.iosAppGroupIdentifier)));
        }

        // CocoaPods trunk is read-only from 2 December 2026: later AcousticConnect versions are only in the Acoustic spec repo, which the
        // Podfile has to name. Without it the app keeps working on the last trunk version, and an iosVersion only on PodSpecs fails pod install.
        const podfileText = readText(path.join(iosDir, 'Podfile'));
        if (podfileText === null) {
            add('ios-pod-sources', 'skip', 'the app does not use CocoaPods');
        } else if (hasPodSpecsSource(podfileText)) {
            add('ios-pod-sources', 'ok', 'ios/App/Podfile names the go-acoustic/PodSpecs source');
        } else {
            add('ios-pod-sources', 'warn', 'ios/App/Podfile does not name the go-acoustic/PodSpecs source, so CocoaPods cannot find Connect SDK ' +
                'versions released after 2 December 2026: run `npx acoustic-connect setup-ios-pods`');
        }

        if (fs.existsSync(path.join(iosDir, 'Podfile'))) {
            add('ios-resources', 'skip', 'the app uses CocoaPods, where the pod brings the SDK\'s resources');
        } else if (pbxproj.indexOf('ConnectResources') !== -1) {
            add('ios-resources', 'ok', 'the project copies ConnectResources.bundle');
        } else {
            add('ios-resources', 'warn', 'the project does not copy ConnectResources.bundle to the app root (a Run Script phase): with Swift Package Manager the SDK ' +
                'then starts without its default settings (see the README)');
        }
    }
    return checks;
}

function compareVersions(a, b) {
    for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
}

/** androidVersion: x.y.z[-beta], in the range the plugin has been run against, and not a beta under useRelease. */
function androidVersionCheck(config) {
    const value = config.androidVersion;
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return ['skip', 'androidVersion is not set: the plugin\'s default is used'];
    const text = typeof value === 'string' ? value.trim() : '';
    const match = /^(\d+)\.(\d+)\.(\d+)(-beta)?$/.exec(text);
    if (!match) return ['fail', 'androidVersion ' + JSON.stringify(value) + ' is not a version: write it as x.y.z or x.y.z-beta'];
    const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (compareVersions(parts, ANDROID_RANGE.min) < 0 || compareVersions(parts, ANDROID_RANGE.maxExclusive) >= 0) {
        return ['fail', 'androidVersion ' + text + ' is outside the supported Connect Android range 11.0.21 up to 12'];
    }
    if (config.useRelease === true && match[4]) return ['fail', 'androidVersion ' + text + ' is a beta, which useRelease always rejects: name a release version'];
    return ['ok', 'androidVersion ' + text];
}

/** iosVersion: x.y.z, not below the SDK floor of the plugin; it takes effect for CocoaPods only. */
function iosVersionCheck(config, hasIosProject, usesPods) {
    const value = config.iosVersion;
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return ['skip', 'iosVersion is not set: the plugin\'s pin is used'];
    const text = typeof value === 'string' ? value.trim() : '';
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
    if (!match) return ['fail', 'iosVersion ' + JSON.stringify(value) + ' is not a version: write it as x.y.z'];
    const pin = sdkVersionFrom(readText(path.join(__dirname, '..', 'Package.swift')) || '');
    const floor = pin ? pin.split('.').map(Number) : [0, 0, 0];
    if (compareVersions([Number(match[1]), Number(match[2]), Number(match[3])], floor) < 0) {
        return ['fail', 'iosVersion ' + text + ' is below the ' + pin + ' that the plugin is built against: `pod install` cannot give it'];
    }
    if (hasIosProject && !usesPods) {
        return ['warn', 'iosVersion ' + text + ' has no effect in a Swift Package Manager app: the plugin\'s Package.swift takes the newest 2.x from ' + pin +
            '. It applies to an app that uses CocoaPods'];
    }
    return ['ok', 'iosVersion ' + text];
}

/** A URL setting: https, and not the placeholder of the example config; http is only for a collector on the same machine. */
function urlCheck(name, value, block, required) {
    if (!block) return ['skip', 'no plugin block'];
    if (typeof value !== 'string' || !value.trim()) return ['fail', name + ' is empty' + (required ? ' while the kill switch is on' : '')];
    let url;
    try {
        url = new URL(value.trim());
    } catch (_) {
        return ['fail', name + ' is not a URL: ' + value];
    }
    if (PLACEHOLDER_HOSTS.test(url.hostname)) return ['fail', name + ' is still the placeholder host ' + url.hostname];
    if (url.protocol === 'https:') return ['ok', name + ' ' + url.origin];
    if (url.protocol === 'http:' && LOCAL_HOSTS.indexOf(url.hostname) !== -1) return ['warn', name + ' is plain http to ' + url.hostname + ' (a local collector, fine for a test)'];
    return ['fail', name + ' must be https (got ' + url.protocol + '//' + url.hostname + ')'];
}

/** The rich-push extensions, and that they and the app share one App Group (the extension writes into it what the app then sends). */
function extensionsCheck(iosDir, appGroups, configGroup) {
    const names = ['ConnectNSE', 'ConnectNCE'];
    const present = names.filter(function (name) { return fs.existsSync(path.join(iosDir, name)); });
    if (present.length === 0) {
        return ['warn', 'no rich-push extensions (ConnectNSE, ConnectNCE): push works without them, but not images and expanded notifications. ' +
            'Add them with `npx acoustic-connect setup-ios-push`'];
    }
    if (present.length < names.length) {
        return ['fail', 'only ' + present.join(', ') + ' is there: rich push needs both extensions (`npx acoustic-connect setup-ios-push` adds the missing one)'];
    }
    const problems = [];
    names.forEach(function (name) {
        const groups = groupsOf(readText(path.join(iosDir, name, name + '.entitlements')));
        const source = readText(path.join(iosDir, name, name === 'ConnectNSE' ? 'NotificationService.swift' : 'NotificationViewController.swift')) || '';
        const literal = /appGroupIdentifier[^{]*\{\s*(?:return\s*)?"([^"]+)"/.exec(source);
        const used = literal ? literal[1] : null;
        groups.concat(used ? [used] : []).forEach(function (group) {
            if (appGroups.indexOf(group) === -1) problems.push(name + ' uses ' + group + ', which is not an App Group of the app (' + (appGroups.join(', ') || 'none') + ')');
        });
        if (configGroup && used && used !== configGroup) problems.push(name + ' uses ' + used + ' but iosAppGroupIdentifier of the config is ' + configGroup);
        if (configGroup && groups.length && groups.indexOf(configGroup) === -1) problems.push(name + ' entitlements have ' + groups.join(', ') + ', not iosAppGroupIdentifier ' + configGroup);
    });
    return problems.length ? ['fail', problems.join('; ')] : ['ok', 'both extensions are there and share the App Group of the app'];
}

const SYMBOLS = { ok: '✔', warn: '!', fail: '✖', skip: '-' };

function runDoctor(argv) {
    const options = parseArgs(argv);
    const checks = diagnose({ dir: options.dir, requirePush: options.requirePush });
    checks.forEach(function (check) { process.stdout.write(SYMBOLS[check.status] + ' ' + check.id + ': ' + check.message + '\n'); });
    const failed = checks.filter(function (c) { return c.status === 'fail'; }).length;
    const warned = checks.filter(function (c) { return c.status === 'warn'; }).length;
    process.stdout.write('\n' + (failed ? failed + ' failed' : 'nothing failed') + (warned ? ', ' + warned + ' to look at' : '') + '\n');
    return failed ? 1 : 0;
}

module.exports = { diagnose, parseArgs, runDoctor };
