#!/usr/bin/env node
'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs the e2e (release-verification) scenario on one platform and one capture phase:
 *
 *   node e2e/run.js --platform android|ios [--phase default] [--device <serial|udid>]
 *                   [--plugin local|npm] [--skip-build] [--out <dir>] [--device-host <host>]
 *                   [--connect-config '<json>']
 *
 * It starts a local collector sink, prepares the Demo build (e2e/prepare.js), builds,
 * installs and launches the app, lets the scenario run, sends the app through the
 * background so the SDK posts its queue, waits for the sink to stop receiving, runs the
 * assertion engine on what arrived, and writes results-<platform>.md plus the raw evidence.
 * The Demo is put back (prepare.js restore) however the run ends.
 *
 * Exit code: 0 PASS, 1 FAIL, 2 INCONCLUSIVE (the run could not produce evidence).
 *
 * Every side effect goes through `deps`, so the order of the steps and the clean-up are
 * unit-tested with fakes; the real implementations are at the bottom.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const prepareModule = require('./prepare.js');
const suite = require('./suite.js');
const commands = require('./commands.js');
const report = require('./report.js');

const POLL_SEC = 5;
const BUILD_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_SINK_REPO = path.join(process.env.HOME || '', 'AndroidStudioProjects', 'server_tests', 'ac-sdk-mobile-interceptor');

const VALUE_OPTIONS = {
    '--platform': 'platform', '--phase': 'phase', '--plugin': 'plugin', '--device': 'device',
    '--out': 'out', '--sink-repo': 'sinkRepo', '--device-host': 'deviceHost'
};
const NUMBER_OPTIONS = { '--run-wait': 'runWaitSec', '--settle': 'settleSec', '--stable-wait': 'stableWaitSec' };

// Extra `Connect` settings for one run, as a JSON object, merged over the phase's own: try another
// native SDK version ('{"AndroidVersion":"x.y.z"}') or other layout rules. Written to the
// report, so keep credentials out of it.
function parseConnectConfig(text) {
    let value;
    try {
        value = JSON.parse(text);
    } catch (e) {
        throw new Error('--connect-config must be a JSON object (' + (text === undefined ? 'missing value' : e.message) + ')');
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('--connect-config must be a JSON object, not ' + (Array.isArray(value) ? 'an array' : String(value)));
    }
    return value;
}

function parseArgs(argv) {
    const opts = { phase: 'default', plugin: 'local', skipBuild: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--skip-build') {
            opts.skipBuild = true;
        } else if (arg === '--connect-config') {
            opts.connectConfig = parseConnectConfig(argv[i + 1]);
            i += 1;
        } else if (VALUE_OPTIONS[arg]) {
            opts[VALUE_OPTIONS[arg]] = argv[i + 1];
            i += 1;
        } else if (NUMBER_OPTIONS[arg]) {
            const n = Number(argv[i + 1]);
            if (argv[i + 1] === undefined || Number.isNaN(n)) throw new Error(arg + ' must be a number');
            opts[NUMBER_OPTIONS[arg]] = n;
            i += 1;
        } else {
            throw new Error('unknown option ' + arg);
        }
    }
    if (!opts.platform) throw new Error('the --platform option is required (android or ios)');
    if (opts.platform !== 'android' && opts.platform !== 'ios') {
        throw new Error('platform must be android or ios (got ' + JSON.stringify(opts.platform) + ')');
    }
    if (opts.plugin !== 'local' && opts.plugin !== 'npm') throw new Error('--plugin must be local or npm');
    if (opts.runWaitSec === undefined) opts.runWaitSec = opts.platform === 'ios' ? 35 : 30;
    if (opts.settleSec === undefined) opts.settleSec = 10;
    if (opts.stableWaitSec === undefined) opts.stableWaitSec = 60;
    return opts;
}

function tail(text, lines) {
    return String(text || '').trim().split('\n').slice(-lines).join(' | ');
}

// Polls the app log until it says it is done, or the time is up. Where the log cannot be
// read (an iOS WKWebView console usually is not in the system log) the whole time is
// simply waited, which is the fixed wait the scenario needs anyway.
async function waitForDone(readLogs, totalSec, deps) {
    let elapsed = 0;
    for (;;) {
        const logs = await readLogs();
        const done = commands.parseDoneLine(logs);
        if (done || elapsed >= totalSec) return { done: done, logs: logs };
        await deps.sleep(POLL_SEC * 1000);
        elapsed += POLL_SEC;
    }
}

// The SDK posts in batches, so one read can miss late ones: wait until the count has not
// changed for two reads in a row (two flush cycles), or give up and say so.
async function waitForSink(sink, maxSec, deps) {
    let last = -1;
    let stable = 0;
    let elapsed = 0;
    for (;;) {
        const messages = await sink.messages();
        if (messages.length === last) stable += 1; else { stable = 0; last = messages.length; }
        if (stable >= 2) return { messages: messages, settled: true };
        if (elapsed >= maxSec) return { messages: messages, settled: false };
        await deps.sleep(POLL_SEC * 1000);
        elapsed += POLL_SEC;
    }
}

async function runStep(deps, label, command, options) {
    const result = await deps.exec(command[0], command[1], options);
    if (result.code !== 0) {
        const error = new Error(label + ' failed: exit ' + result.code + ': ' + tail(result.stderr || result.stdout, 3));
        error.step = label;
        throw error;
    }
    return result;
}

async function runE2E(opts, deps) {
    const platform = opts.platform;
    const phase = opts.phase;
    const root = opts.root;
    const outDir = opts.outDir;

    // Everything that can be rejected is rejected before anything is touched.
    const manifest = suite.buildSuite({ platform: platform, phase: phase });
    if (!deps.exists(opts.sinkRepo)) {
        throw new Error('collector sink checkout not found at ' + opts.sinkRepo + ' (set --sink-repo)');
    }
    if (platform === 'ios' && !opts.device) {
        throw new Error('--device <simulator udid> is required for iOS');
    }

    const startedAt = deps.now().toISOString();
    deps.mkdirp(outDir);
    const notes = [];
    let reverted = [];
    let messages = [];
    let evaluation = null;
    let done = null;
    let nativeSdk = 'unknown';
    let device = platform === 'ios' ? 'iOS simulator ' + opts.device : 'unknown';
    let configKeysDiffering = [];
    let cmd = null;

    const sink = await deps.startSink({ outDir: path.join(outDir, 'captures') });
    const sinkUrl = 'http://localhost:' + sink.port;
    let prepared = false;

    try {
        deps.prepare({
            root: root, platform: platform, sink: sinkUrl, deviceHost: opts.deviceHost,
            connectOverrides: prepareModule.deepMerge(suite.PHASES[phase].connectConfig, opts.connectConfig || {})
        });
        prepared = true;

        const configXml = deps.readFile(path.join(root, 'config.xml'));
        const appId = commands.readAppId(configXml);

        // names of the Connect keys that differ from the example - never the values
        try {
            configKeysDiffering = commands.diffConfigKeys(
                JSON.parse(deps.readFile(path.join(root, 'ConnectConfig.json'))),
                JSON.parse(deps.readFile(path.join(root, 'ConnectConfig.example.json')))
            );
        } catch (_) { notes.push('could not compare ConnectConfig.json with the example'); }

        let readLogs;
        if (platform === 'android') {
            const devices = await deps.exec('adb', ['devices']);
            const serial = commands.pickAndroidSerial(devices.stdout, opts.device);
            cmd = commands.androidCommands({
                serial: serial, appId: appId,
                apk: path.join(root, 'platforms', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
            });
            readLogs = async function () { return (await deps.exec(cmd.logs[0], cmd.logs[1])).stdout; };
            const model = (await deps.exec(cmd.model[0], cmd.model[1])).stdout.trim();
            const release = (await deps.exec(cmd.release[0], cmd.release[1])).stdout.trim();
            device = model + ', Android ' + release + ' (' + serial + ')';
        } else {
            const name = commands.readAppName(configXml) || 'App';
            cmd = commands.iosCommands({
                udid: opts.device, appId: appId,
                appPath: path.join(root, 'platforms', 'ios', 'build', 'Debug-iphonesimulator', name + '.app')
            });
            readLogs = async function () { return (await deps.exec(cmd.logs[0], cmd.logs[1])).stdout; };
        }

        if (!opts.skipBuild) {
            const pluginDir = path.resolve(root, '..', '..', 'plugins', 'cordova-acoustic-mobile-connect-push');
            const [remove, add] = commands.pluginCommands({ mode: opts.plugin, pluginDir: pluginDir });
            await deps.exec(remove[0], remove[1], { cwd: root });     // fine if it was not installed
            await runStep(deps, 'plugin install', add, { cwd: root });
            await runStep(deps, 'build', cmd.build, { cwd: root, timeoutMs: BUILD_TIMEOUT_MS });
        }

        if (platform === 'ios') {
            await deps.exec(cmd.boot[0], cmd.boot[1]);                // non-zero when already booted
        }
        await runStep(deps, 'install', cmd.install);
        if (platform === 'android') {
            await deps.exec(cmd.stop[0], cmd.stop[1]);
            await deps.exec(cmd.clearLog[0], cmd.clearLog[1]);
        }
        await sink.reset();                                           // earlier traffic must not count

        await runStep(deps, 'launch', cmd.launch);
        const waited = await waitForDone(readLogs, opts.runWaitSec, deps);
        done = waited.done;

        // the SDK posts its queue when the app goes to the background
        await deps.exec(cmd.home[0], cmd.home[1]);
        await deps.sleep(opts.settleSec * 1000);
        await deps.exec(cmd.launch[0], cmd.launch[1]);
        await deps.sleep(opts.settleSec * 1000);
        await deps.exec(cmd.home[0], cmd.home[1]);
        await deps.sleep(opts.settleSec * 1000);

        const collected = await waitForSink(sink, opts.stableWaitSec, deps);
        messages = collected.messages;
        if (!collected.settled) notes.push('the message count did not settle within ' + opts.stableWaitSec + 's, so late batches may be missing');

        const finalLogs = await readLogs();
        if (!done) done = commands.parseDoneLine(finalLogs);
        commands.problemSteps(commands.parseResultLine(finalLogs || waited.logs)).forEach(function (line) {
            notes.push('app step ' + line);
        });
        const day = startedAt.slice(0, 10);
        if (platform === 'android') {
            const v = commands.parseAndroidSdkVersion(finalLogs || waited.logs);
            nativeSdk = (v || 'unknown (not found in logcat)') + ' (resolved ' + day + ')';
        } else {
            const pod = commands.parseIosPod(deps.readFile(path.join(root, 'platforms', 'ios', 'Podfile.lock')));
            nativeSdk = (pod ? pod.pod + ' ' + pod.version : 'unknown (not found in Podfile.lock)') + ' (resolved ' + day + ')';
        }

        deps.writeFile(path.join(outDir, 'messages.json'), JSON.stringify(messages, null, 2));
        deps.writeFile(path.join(outDir, 'suite.json'), JSON.stringify(manifest, null, 2));
        if (messages.length > 0) {
            const raw = await deps.evaluate(manifest, messages, { platform: platform });
            evaluation = {
                pass: raw.pass, counts: raw.counts,
                entries: raw.entries.map(function (e) {
                    return { name: e.name, status: e.status, reason: e.reason, detail: e.detail || (e.result && e.result.detail) };
                })
            };
        } else {
            notes.push('nothing reached the collector sink, so there is no evidence to assert on');
        }
    } catch (error) {
        notes.push(error.message);
    } finally {
        // however the run ended, the app and the Demo are put back
        if (cmd) {
            const stop = platform === 'android' ? cmd.stop : cmd.terminate;
            try { await deps.exec(stop[0], stop[1]); } catch (_) { /* best effort */ }
        }
        if (prepared) {
            try {
                reverted = deps.restore({ root: root }).reverted;
            } catch (error) {
                notes.push('RESTORE FAILED: ' + error.message + ' - run `node e2e/prepare.js restore`');
            }
        }
        try { await sink.stop(); } catch (_) { /* best effort */ }
    }

    const verdict = report.overallVerdict({ evaluation: evaluation, messageCount: messages.length, done: done });
    const fileName = phase === 'default' ? 'results-' + platform + '.md' : 'results-' + platform + '-' + phase + '.md';
    const reportPath = path.join(outDir, fileName);
    const pluginInfo = deps.pluginInfo({ mode: opts.plugin, root: root }) || {};
    deps.writeFile(reportPath, report.buildReport({
        platform: platform, phase: phase, verdict: verdict, startedAt: startedAt,
        env: {
            repoCommit: await deps.gitHead(),
            pluginVersion: pluginInfo.version || 'unknown',
            pluginMode: opts.plugin,
            nativeSdk: nativeSdk, device: device, sinkUrl: sinkUrl,
            configKeysDiffering: configKeysDiffering,
            extraConnectConfig: opts.connectConfig
        },
        done: done, evaluation: evaluation, messageCount: messages.length, reverted: reverted, notes: notes
    }));

    return { verdict: verdict, exitCode: report.exitCodeFor(verdict), outDir: outDir, reportPath: reportPath };
}

// ── real dependencies ──────────────────────────────────────────────────────────────────

function execReal(cmd, args, options) {
    const o = options || {};
    return new Promise(function (resolve) {
        const child = spawn(cmd, args, { cwd: o.cwd, env: process.env });
        let stdout = '';
        let stderr = '';
        const timer = o.timeoutMs ? setTimeout(function () { child.kill('SIGKILL'); }, o.timeoutMs) : null;
        child.stdout.on('data', function (d) { stdout += d; });
        child.stderr.on('data', function (d) { stderr += d; });
        child.on('error', function (e) { if (timer) clearTimeout(timer); resolve({ code: 127, stdout: stdout, stderr: String(e.message) }); });
        child.on('close', function (code) { if (timer) clearTimeout(timer); resolve({ code: code === null ? 124 : code, stdout: stdout, stderr: stderr }); });
    });
}

function realDeps(opts) {
    const repoRoot = path.resolve(opts.root, '..', '..');
    return {
        exec: execReal,
        sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
        now: function () { return new Date(); },
        exists: function (p) { return fs.existsSync(p); },
        readFile: function (p) { return fs.readFileSync(p, 'utf8'); },
        writeFile: function (p, data) { fs.writeFileSync(p, data); },
        mkdirp: function (p) { fs.mkdirSync(p, { recursive: true }); },
        prepare: prepareModule.prepare,
        restore: prepareModule.restore,
        startSink: async function (o) {
            const { createSink } = await import(pathToFileURL(path.join(opts.sinkRepo, 'src', 'sink.mjs')).href);
            const sink = createSink({ outDir: o.outDir, silent: true });
            await new Promise(function (resolve) { sink.server.listen(0, resolve); });
            const port = sink.server.address().port;
            const base = 'http://localhost:' + port;
            return {
                port: port,
                messages: async function () { return (await (await fetch(base + '/__sink/messages')).json()).messages; },
                reset: async function () {
                    await fetch(base + '/__sink/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"clearFiles":true}' });
                },
                stop: function () { return new Promise(function (resolve) { sink.server.close(resolve); }); }
            };
        },
        evaluate: async function (manifest, messages, o) {
            const engine = await import(pathToFileURL(path.join(repoRoot, '.claude', 'skills', 'release-verification', 'scripts', 'assert-messages.mjs')).href);
            return engine.evaluateManifest(manifest, messages, o);
        },
        gitHead: async function () { return (await execReal('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot })).stdout.trim() || 'unknown'; },
        pluginInfo: function (o) {
            const file = o.mode === 'local'
                ? path.join(repoRoot, 'plugins', 'cordova-acoustic-mobile-connect-push', 'package.json')
                : path.join(o.root, 'plugins', commands.PLUGIN_ID, 'package.json');
            try { return { version: JSON.parse(fs.readFileSync(file, 'utf8')).version }; } catch (_) { return {}; }
        }
    };
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error('ERROR: ' + error.message);
        process.exit(2);
    }
    opts.root = path.resolve(__dirname, '..');
    opts.sinkRepo = opts.sinkRepo || process.env.AC_SINK_DIR || DEFAULT_SINK_REPO;
    opts.outDir = path.resolve(opts.out || path.join(opts.root, 'e2e', 'evidence',
        new Date().toISOString().replace(/[:.]/g, '-') + '-' + opts.platform + '-' + opts.phase));
    try {
        const result = await runE2E(opts, realDeps(opts));
        console.log('Verdict: ' + result.verdict);
        console.log('Report:  ' + result.reportPath);
        process.exit(result.exitCode);
    } catch (error) {
        console.error('ERROR: ' + error.message);
        process.exit(2);
    }
}

module.exports = { parseArgs, runE2E, waitForDone, waitForSink };

if (require.main === module) {
    main();
}
