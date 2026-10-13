#!/usr/bin/env node
'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Wire verification of the Capacitor plugin on an Android device or emulator, or an iOS simulator:
 *
 *   node e2e/run.js --platform android|ios [--device <serial|udid>] [--out <dir>] [--skip-build]
 *                   [--port 9877] [--app <dir>] [--sink-repo <dir>] [--phase default|screen-capture-off|layout-config-off] [--layout expected|off|auto] [--sdk-version <x.y.z[-beta]>]
 *                   [--ios-host <dir>]   (iOS: a CocoaPods app, built by e2e/ios-host.js; without it the example app, on Swift Package Manager)
 *
 * It starts a local collector sink on --port (the example app's capacitor.config points the SDK at
 * 10.0.2.2:9877), builds the example app with the scenario switched on (VITE_E2E=1), installs and
 * launches it, waits for the app's E2E_DONE line, sends the app through the background so the SDK
 * posts its queue, waits for the sink to settle, and runs the release-verification assertion engine
 * on what arrived. The scenario and the checks are the Cordova ones (e2e/suite.js).
 *
 * The app's capacitor.config.json is swapped for the run (the SDK pointed at the sink) and put back afterwards, see
 * e2e/config.js; `node e2e/run.js restore` puts it back after a run that was killed.
 *
 * Exit code: 0 PASS, 1 FAIL, 2 INCONCLUSIVE.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const defaultAppRoot = path.resolve(__dirname, '..');                // applications/DemoCapacitor
const repoRoot = path.resolve(defaultAppRoot, '..', '..');
const pluginRoot = path.join(repoRoot, 'plugins', 'capacitor-acoustic-connect');
// The app under test: DemoCapacitor unless --app names another one (applications/DemoCapacitorAngular runs this same file).
let appRoot = defaultAppRoot;
let exampleRoot = appRoot;

function setApp(dir) {
    appRoot = path.resolve(dir);
    exampleRoot = appRoot;
}

/**
 * How the app's web assets are built. The scenario is switched on in the build: `VITE_E2E=1` for a Vite app, and for an Angular
 * app (it has an angular.json) the `E2E_BUILD` define of its angular.json set to true.
 */
function webBuildCommand(root, e2e) {
    if (fs.existsSync(path.join(root, 'angular.json'))) {
        return { command: 'npx', args: ['ng', 'build'].concat(e2e ? ['--define', 'E2E_BUILD=true'] : []), env: {} };
    }
    return { command: 'npx', args: ['vite', 'build'], env: e2e ? { VITE_E2E: '1' } : {} };
}
const demoE2e = path.join(repoRoot, 'applications', 'Demo', 'e2e');
const commands = require(path.join(demoE2e, 'commands.js'));
const report = require(path.join(demoE2e, 'report.js'));
const cordovaRun = require(path.join(demoE2e, 'run.js'));
const suite = require('./suite.js');
const appConfig = require('./config.js');
const iosHost = require('./ios-host.js');

const DEFAULT_SINK_REPO = path.join(process.env.HOME || '', 'AndroidStudioProjects', 'server_tests', 'ac-sdk-mobile-interceptor');
const BUILD_TIMEOUT_MS = 20 * 60 * 1000;
const LAYOUT_FIXED_IN = [11, 1, 10];

/** Whether the example app's config turns push on (the iOS host copies the same config). */
function pushConfigured() {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(exampleRoot, 'capacitor.config.json'), 'utf8'));
        return Boolean(config.plugins && config.plugins.AcousticConnect && config.plugins.AcousticConnect.pushEnabled === true);
    } catch (_) {
        return false;
    }
}

function parseArgs(argv) {
    const opts = { platform: 'android', phase: 'default', port: 9877, layout: 'auto', skipBuild: false, runWaitSec: 45, settleSec: 10, stableWaitSec: 60 };
    const value = {
        '--platform': 'platform', '--device': 'device', '--out': 'out', '--sink-repo': 'sinkRepo', '--layout': 'layout',
        '--sdk-version': 'sdkVersion', '--phase': 'phase', '--ios-host': 'iosHost', '--app': 'app'
    };
    const number = { '--port': 'port', '--run-wait': 'runWaitSec', '--settle': 'settleSec', '--stable-wait': 'stableWaitSec' };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--skip-build') {
            opts.skipBuild = true;
        } else if (value[arg]) {
            opts[value[arg]] = argv[i + 1];
            i += 1;
        } else if (number[arg]) {
            const n = Number(argv[i + 1]);
            if (argv[i + 1] === undefined || Number.isNaN(n)) throw new Error(arg + ' must be a number');
            opts[number[arg]] = n;
            i += 1;
        } else {
            throw new Error('unknown option ' + arg);
        }
    }
    if (opts.platform !== 'android' && opts.platform !== 'ios') throw new Error('--platform must be android or ios');
    if (['expected', 'off', 'auto'].indexOf(opts.layout) === -1) throw new Error('--layout must be expected, off or auto');
    if (!suite.PHASES[opts.phase]) throw new Error('phase must be one of ' + Object.keys(suite.PHASES).join(', ') + ' (got ' + opts.phase + ')');
    if (opts.phase !== 'default' && opts.platform === 'android') {
        // before 11.1.10 the plugin already turns layout capture off, so the phase would pass without testing anything
        if (!opts.sdkVersion) throw new Error('an Android capture-off phase needs --sdk-version 11.1.10-beta or later');
        if (!layoutExpected('auto', opts.sdkVersion, 'android')) {
            throw new Error('an Android capture-off phase needs Connect Android 11.1.10 or later, which captures layout by default (got ' + opts.sdkVersion + ')');
        }
    }
    return opts;
}

/** Layout capture is expected from the SDK that finishes a WebView layout; `auto` reads the version from the log. */
function layoutExpected(layout, sdkVersion, platform) {
    if (layout === 'expected') return true;
    if (layout === 'off') return false;
    if (platform === 'ios') return true;
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(sdkVersion || '');
    if (!m) return false;
    const have = [Number(m[1]), Number(m[2]), Number(m[3])];
    for (let i = 0; i < 3; i += 1) {
        if (have[i] !== LAYOUT_FIXED_IN[i]) return have[i] > LAYOUT_FIXED_IN[i];
    }
    return true;
}

function exec(cmd, args, options) {
    const o = options || {};
    return new Promise(function (resolve) {
        const child = spawn(cmd, args, { cwd: o.cwd, env: Object.assign({}, process.env, o.env || {}) });
        let stdout = '';
        let stderr = '';
        const timer = o.timeoutMs ? setTimeout(function () { child.kill('SIGKILL'); }, o.timeoutMs) : null;
        child.stdout.on('data', function (d) { stdout += d; });
        child.stderr.on('data', function (d) { stderr += d; });
        child.on('error', function (e) { if (timer) clearTimeout(timer); resolve({ code: 127, stdout: stdout, stderr: String(e.message) }); });
        child.on('close', function (code) { if (timer) clearTimeout(timer); resolve({ code: code === null ? 124 : code, stdout: stdout, stderr: stderr }); });
    });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function step(label, command, args, options) {
    const result = await exec(command, args, options);
    if (result.code !== 0) {
        const tail = String(result.stderr || result.stdout).trim().split('\n').slice(-4).join(' | ');
        throw new Error(label + ' failed: exit ' + result.code + ': ' + tail);
    }
    return result;
}

async function javaHome() {
    if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
    const r = await exec('/usr/libexec/java_home', ['-v', '21']);
    return r.code === 0 ? r.stdout.trim() : undefined;
}

async function startSink(opts, outDir) {
    const { createSink } = await import(pathToFileURL(path.join(opts.sinkRepo, 'src', 'sink.mjs')).href);
    const sink = createSink({ outDir: path.join(outDir, 'captures'), silent: true });
    await new Promise(function (resolve, reject) {
        sink.server.once('error', reject);
        sink.server.listen(opts.port, resolve);
    });
    const base = 'http://localhost:' + opts.port;
    return {
        url: base,
        messages: async function () { return (await (await fetch(base + '/__sink/messages')).json()).messages; },
        reset: async function () {
            await fetch(base + '/__sink/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"clearFiles":true}' });
        },
        stop: function () { return new Promise(function (resolve) { sink.server.close(resolve); }); }
    };
}

/**
 * The application id of the Android app, from its Gradle file: it is not always the `appId` of capacitor.config.json (the iOS
 * bundle id is separate again). Null when the file names none.
 */
function androidApplicationId(gradle) {
    const match = /\bapplicationId\s*=?\s*["']([^"']+)["']/.exec(gradle);
    return match ? match[1] : null;
}

/** The activity to start: it lives in the namespace of the app, which is not its application id when the two differ. */
function androidLaunchComponent(gradle) {
    const appId = androidApplicationId(gradle);
    const namespace = /\bnamespace\s*=?\s*["']([^"']+)["']/.exec(gradle);
    return appId && namespace ? appId + '/' + namespace[1] + '.MainActivity' : null;
}

/** Everything that differs between the platforms: the commands, the build, how to read the SDK version. */
async function androidTarget(opts) {
    const gradle = fs.readFileSync(path.join(exampleRoot, 'android', 'app', 'build.gradle'), 'utf8');
    const appId = androidApplicationId(gradle);
    const component = androidLaunchComponent(gradle);
    if (!appId || !component) throw new Error('no applicationId and namespace in android/app/build.gradle');
    const apk = path.join(exampleRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    const devices = await exec('adb', ['devices']);
    const serial = commands.pickAndroidSerial(devices.stdout, opts.device);
    const cmd = commands.androidCommands({ serial: serial, appId: appId, apk: apk });
    cmd.launch = ['adb', ['-s', serial, 'shell', 'am', 'start', '-n', component]];
    const model = (await exec(cmd.model[0], cmd.model[1])).stdout.trim();
    const release = (await exec(cmd.release[0], cmd.release[1])).stdout.trim();
    return {
        cmd: cmd,
        stop: cmd.stop,
        device: model + ', Android ' + release + ' (' + serial + ')',
        readLogs: async function () { return (await exec(cmd.logs[0], cmd.logs[1])).stdout; },
        pushExpected: pushConfigured() && fs.existsSync(path.join(exampleRoot, 'android', 'app', 'google-services.json')),
        build: async function () {
            const web = webBuildCommand(exampleRoot, true);
            const env = Object.assign({}, web.env, { JAVA_HOME: await javaHome() });
            await step('web build', web.command, web.args, { cwd: exampleRoot, env: env });
            await step('cap sync', 'npx', ['cap', 'sync', 'android'], { cwd: exampleRoot });
            const versionArgs = opts.sdkVersion ? ['-PconnectSdkVersion=' + opts.sdkVersion] : [];
            await step('android build', './gradlew', ['--no-daemon', '-q'].concat(versionArgs, ['assembleDebug']),
                { cwd: path.join(exampleRoot, 'android'), env: env, timeoutMs: BUILD_TIMEOUT_MS });
        },
        prepareDevice: async function () {
            // an app of this id that is already there (the Cordova demo has the same one while the Firebase project is shared) can
            // be a newer version or signed by another key, which makes the install fail
            await exec('adb', ['-s', serial, 'uninstall', appId]);
            await step('install', cmd.install[0], cmd.install[1]);
            await exec(cmd.stop[0], cmd.stop[1]);
            await exec('adb', ['-s', serial, 'shell', 'pm', 'clear', appId]);     // clears the permissions too, so the grant follows it
            // Android 13 asks for the notification permission in a dialog that a script cannot answer; with push on, grant it, so
            // the registration says acceptPush (before Android 13 there is nothing to grant, and the command's failure does not matter)
            if (pushConfigured()) await exec('adb', ['-s', serial, 'shell', 'pm', 'grant', appId, 'android.permission.POST_NOTIFICATIONS']);
            // the example's config posts to localhost; on the emulator that has to reach this machine
            await step('adb reverse', 'adb', ['-s', serial, 'reverse', 'tcp:' + opts.port, 'tcp:' + opts.port]);
            await exec(cmd.clearLog[0], cmd.clearLog[1]);
        },
        sdkVersion: function (logs) { return commands.parseAndroidSdkVersion(logs); }
    };
}

async function iosTarget(opts) {
    // With --ios-host: a CocoaPods app built from the example's sources. Without: the example app itself,
    // whose iOS project uses Swift Package Manager.
    const cocoapods = Boolean(opts.iosHost);
    const host = cocoapods ? path.resolve(opts.iosHost) : exampleRoot;
    // Not in the system temp directory: macOS clears old files from there, which leaves a half-empty package cache
    // ("There is no Info.plist found at ...xcframework") and a build that fails for no reason in the code.
    const derivedData = cocoapods ? path.join(host, 'dd') : path.join(host, 'ios', 'App', 'build', 'e2e-derived-data');
    let udid = opts.device;
    if (!udid) {
        const booted = await exec('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
        const all = [].concat.apply([], Object.values(JSON.parse(booted.stdout || '{"devices":{}}').devices));
        const phone = all.filter(function (d) { return /iPhone/.test(d.name); })[0];
        if (!phone) throw new Error('no booted iPhone simulator: boot one or pass --device <udid>');
        udid = phone.udid;
    }
    const appPath = path.join(derivedData, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');
    const appId = function () { return JSON.parse(fs.readFileSync(path.join(host, 'capacitor.config.json'), 'utf8')).appId; };
    const cmd = function () { return commands.iosCommands({ udid: udid, appId: appId(), appPath: appPath }); };
    const version = (await exec('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'])).stdout.trim();
    return {
        get cmd() { return cmd(); },
        get stop() { return cmd().terminate; },
        device: 'iOS simulator ' + udid + ' (SDK ' + version + ')' + (cocoapods ? ', CocoaPods' : ', Swift Package Manager'),
        // a WKWebView console is usually not in the system log, so the app's end is simply waited for
        readLogs: async function () { return ''; },
        pushExpected: pushConfigured(),
        build: async function () {
            if (cocoapods && !fs.existsSync(path.join(host, 'ios', 'App', 'Podfile'))) iosHost.prepareIosHost(host);
            // the host keeps its own copy of the app's config, which is the one this run swapped
            if (cocoapods) fs.copyFileSync(path.join(exampleRoot, 'capacitor.config.json'), path.join(host, 'capacitor.config.json'));
            const web = webBuildCommand(host, true);
            await step('web build', web.command, web.args, { cwd: host, env: web.env });
            await step('cap sync', 'npx', ['cap', 'sync', 'ios'], { cwd: host });
            const project = cocoapods ? ['-workspace', 'App.xcworkspace'] : ['-project', 'App.xcodeproj'];
            const build = function () {
                return step('ios build', 'xcodebuild', project.concat(['-scheme', 'App', '-sdk', 'iphonesimulator',
                    '-destination', 'id=' + udid, '-derivedDataPath', derivedData, 'build']),
                { cwd: path.join(host, 'ios', 'App'), timeoutMs: BUILD_TIMEOUT_MS });
            };
            try {
                await build();
            } catch (error) {
                // a damaged derived-data cache is the usual cause: start again from an empty one, once
                fs.rmSync(derivedData, { recursive: true, force: true });
                await build();
            }
        },
        prepareDevice: async function () {
            const c = cmd();
            await exec(c.boot[0], c.boot[1]);                        // non-zero when already booted
            await exec(c.terminate[0], c.terminate[1]);
            await exec('xcrun', ['simctl', 'uninstall', udid, appId()]);
            await step('install', c.install[0], c.install[1]);
        },
        sdkVersion: function () {
            try {
                if (cocoapods) {
                    const pod = commands.parseIosPod(fs.readFileSync(path.join(host, 'ios', 'App', 'Podfile.lock'), 'utf8'));
                    return pod ? pod.pod + ' ' + pod.version : null;
                }
                // Swift Package Manager: the version Connect-SP resolved to, from its checkout's `version` file
                const checkout = path.join(derivedData, 'SourcePackages', 'checkouts', 'Connect-SP', 'version');
                return 'Connect-SP ' + fs.readFileSync(checkout, 'utf8').trim();
            } catch (_) { return null; }
        }
    };
}

async function runPrepared(opts) {
    if (!fs.existsSync(opts.sinkRepo)) throw new Error('collector sink checkout not found at ' + opts.sinkRepo + ' (set --sink-repo)');
    const outDir = path.resolve(opts.out || path.join(appRoot, 'e2e', 'evidence',
        new Date().toISOString().replace(/[:.]/g, '-') + '-' + opts.platform + '-' + opts.phase));
    fs.mkdirSync(outDir, { recursive: true });
    const startedAt = new Date().toISOString();
    const notes = [];
    const target = opts.platform === 'ios' ? await iosTarget(opts) : await androidTarget(opts);

    const sink = await startSink(opts, outDir);
    let messages = [];
    let evaluation = null;
    let done = null;
    let nativeSdk = 'unknown';
    try {
        if (!opts.skipBuild) await target.build();
        await target.prepareDevice();
        await sink.reset();

        await step('launch', target.cmd.launch[0], target.cmd.launch[1]);
        const waited = await cordovaRun.waitForDone(target.readLogs, opts.runWaitSec, { sleep: sleep });
        done = waited.done;

        // the SDK posts its queue when the app goes to the background
        await exec(target.cmd.home[0], target.cmd.home[1]);
        await sleep(opts.settleSec * 1000);
        await exec(target.cmd.launch[0], target.cmd.launch[1]);
        await sleep(opts.settleSec * 1000);
        await exec(target.cmd.home[0], target.cmd.home[1]);
        await sleep(opts.settleSec * 1000);

        const collected = await cordovaRun.waitForSink(sink, opts.stableWaitSec, { sleep: sleep });
        messages = collected.messages;
        if (!collected.settled) notes.push('the message count did not settle within ' + opts.stableWaitSec + 's, so late batches may be missing');

        const logs = await target.readLogs();
        if (!done) done = commands.parseDoneLine(logs);
        commands.problemSteps(commands.parseResultLine(logs)).forEach(function (line) { notes.push('app step ' + line); });
        const sdkVersion = target.sdkVersion(logs);
        nativeSdk = (sdkVersion || 'unknown') + ' (resolved ' + startedAt.slice(0, 10) + ')';

        const manifest = suite.buildSuite({
            platform: opts.platform,
            phase: opts.phase,
            layoutExpected: layoutExpected(opts.layout, sdkVersion, opts.platform),
            pushExpected: target.pushExpected
        });
        fs.writeFileSync(path.join(outDir, 'messages.json'), JSON.stringify(messages, null, 2));
        fs.writeFileSync(path.join(outDir, 'suite.json'), JSON.stringify(manifest, null, 2));
        if (messages.length > 0) {
            const engine = await import(pathToFileURL(path.join(repoRoot, '.claude', 'skills', 'release-verification', 'scripts', 'assert-messages.mjs')).href);
            const raw = engine.evaluateManifest(manifest, messages, { platform: opts.platform });
            evaluation = {
                pass: raw.pass, counts: raw.counts,
                entries: raw.entries.map(function (e) {
                    return { name: e.name, status: e.status, reason: e.reason, detail: e.detail || (e.result && e.result.detail) };
                })
            };
        } else {
            notes.push('nothing reached the collector sink, so there is no evidence to assert on');
        }
        if (opts.platform === 'ios' && !done) {
            notes.push('the iOS app log cannot be read, so the app-side E2E_DONE line was not observed; the wire checks decide');
        }
    } catch (error) {
        notes.push(error.message);
    } finally {
        try { await exec(target.stop[0], target.stop[1]); } catch (_) { /* best effort */ }
        try { await sink.stop(); } catch (_) { /* best effort */ }
    }

    // iOS cannot report E2E_DONE; without that line the wire evidence alone decides
    const doneForVerdict = opts.platform === 'ios' && !done ? { status: 'pass', steps: 0, failed: 0, unavailable: 0 } : done;
    const verdict = report.overallVerdict({ evaluation: evaluation, messageCount: messages.length, done: doneForVerdict });
    const reportPath = path.join(outDir, opts.phase === 'default' ? 'results-' + opts.platform + '.md' : 'results-' + opts.platform + '-' + opts.phase + '.md');
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
    const head = (await exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot })).stdout.trim() || 'unknown';
    fs.writeFileSync(reportPath, report.buildReport({
        platform: opts.platform, phase: opts.phase, verdict: verdict, startedAt: startedAt,
        env: {
            repoCommit: head, pluginVersion: pkg.version, pluginMode: 'local (example-app)', nativeSdk: nativeSdk,
            device: target.device, sinkUrl: sink.url, configKeysDiffering: []
        },
        done: done, evaluation: evaluation, messageCount: messages.length, reverted: [], notes: notes
    }));
    return { verdict: verdict, exitCode: report.exitCodeFor(verdict), reportPath: reportPath };
}

/**
 * Runs with the app's config pointed at the sink, and however the run ends puts the developer's config back and
 * rebuilds the web assets and the synced native copies from it, so the IDE does not open on the sink's config.
 */
async function run(opts) {
    appConfig.restoreConfig({ root: appRoot });      // a run that was killed left its swap behind
    appConfig.prepareConfig({ root: appRoot, port: opts.port, overrides: suite.PHASES[opts.phase].connectConfig });
    try {
        return await runPrepared(opts);
    } finally {
        const { restored } = appConfig.restoreConfig({ root: appRoot });
        if (restored && fs.existsSync(path.join(appRoot, 'capacitor.config.json'))) {
            const web = webBuildCommand(appRoot, false);
            await exec(web.command, web.args, { cwd: appRoot, env: web.env });
            await exec('npx', ['cap', 'sync'], { cwd: appRoot });
        }
    }
}

async function main() {
    if (process.argv[2] === 'restore') {
        const appFlag = process.argv.indexOf('--app');
        if (appFlag !== -1 && process.argv[appFlag + 1]) setApp(process.argv[appFlag + 1]);
        const { restored } = appConfig.restoreConfig({ root: appRoot });
        console.log(restored ? 'capacitor.config.json restored' : 'nothing to restore');
        process.exit(0);
    }
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error('ERROR: ' + error.message);
        process.exit(2);
    }
    opts.sinkRepo = opts.sinkRepo || process.env.AC_SINK_DIR || DEFAULT_SINK_REPO;
    if (opts.app) setApp(opts.app);
    try {
        const result = await run(opts);
        console.log('Verdict: ' + result.verdict);
        console.log('Report:  ' + result.reportPath);
        process.exit(result.exitCode);
    } catch (error) {
        console.error('ERROR: ' + error.message);
        process.exit(2);
    }
}

module.exports = { parseArgs, layoutExpected, androidApplicationId, androidLaunchComponent, webBuildCommand };

if (require.main === module) {
    main();
}
