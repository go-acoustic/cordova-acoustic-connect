/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for the e2e runner (applications/Demo/e2e/{commands,report,run}.js).
 *
 * The runner drives a real build, a device and a collector sink, so every side effect goes
 * through an injected dependency. These tests use fakes: they pin the order of the steps,
 * that the app is always put back after a failure, and what the report says.
 */

import { join } from 'path';

const E2E = join(__dirname, '..', '..', '..', 'applications', 'Demo', 'e2e');

/* eslint-disable @typescript-eslint/no-var-requires */
const commands = require(join(E2E, 'commands.js'));
const report = require(join(E2E, 'report.js'));
const runner = require(join(E2E, 'run.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

// ── commands ────────────────────────────────────────────────────────────────────────────

describe('readAppId', () => {
    it('reads the widget id', () => {
        expect(commands.readAppId('<widget id="co.acoustic.connect.cordova.demo" version="1.0.0">'))
            .toBe('co.acoustic.connect.cordova.demo');
    });

    it('fails when there is none', () => {
        expect(() => commands.readAppId('<widget version="1">')).toThrow('widget id');
    });
});

describe('androidCommands', () => {
    const c = commands.androidCommands({ serial: 'emulator-5554', appId: 'co.x.app', apk: '/p/app-debug.apk' });

    it('scopes every adb call to one serial', () => {
        for (const [cmd, args] of Object.values(c).filter((v: any) => v[0] === 'adb') as Array<[string, string[]]>) {
            expect(cmd).toBe('adb');
            expect(args.slice(0, 2)).toEqual(['-s', 'emulator-5554']);
        }
    });

    it('builds, installs over the existing app, launches and backgrounds', () => {
        expect(c.build).toEqual(['cordova', ['build', 'android']]);
        expect(c.install[1]).toEqual(['-s', 'emulator-5554', 'install', '-r', '/p/app-debug.apk']);
        expect(c.launch[1]).toEqual(['-s', 'emulator-5554', 'shell', 'am', 'start', '-n', 'co.x.app/.MainActivity']);
        expect(c.home[1]).toEqual(['-s', 'emulator-5554', 'shell', 'input', 'keyevent', 'KEYCODE_HOME']);
        expect(c.stop[1]).toEqual(['-s', 'emulator-5554', 'shell', 'am', 'force-stop', 'co.x.app']);
    });

    it('refuses to build commands without a serial', () => {
        expect(() => commands.androidCommands({ appId: 'x', apk: 'y' })).toThrow('serial');
    });
});

describe('iosCommands', () => {
    const c = commands.iosCommands({ udid: 'UDID-1', appId: 'co.x.app', appPath: '/p/App.app' });

    it('uses the simulator tools only', () => {
        expect(c.build).toEqual(['cordova', ['build', 'ios', '--emulator']]);
        expect(c.install).toEqual(['xcrun', ['simctl', 'install', 'UDID-1', '/p/App.app']]);
        expect(c.launch).toEqual(['xcrun', ['simctl', 'launch', 'UDID-1', 'co.x.app']]);
        expect(c.terminate).toEqual(['xcrun', ['simctl', 'terminate', 'UDID-1', 'co.x.app']]);
    });

    it('sends the app to the background by opening another app', () => {
        expect(c.home).toEqual(['xcrun', ['simctl', 'launch', 'UDID-1', 'com.apple.Preferences']]);
    });

    it('boots the simulator', () => {
        expect(c.boot).toEqual(['xcrun', ['simctl', 'boot', 'UDID-1']]);
    });
});

describe('pluginCommands', () => {
    it('local: removes the installed plugin and links the source in this repo', () => {
        const c = commands.pluginCommands({ mode: 'local', pluginDir: '/repo/plugins/p' });
        expect(c).toEqual([
            ['cordova', ['plugin', 'rm', 'co.acoustic.connect.push', '--nosave']],
            ['cordova', ['plugin', 'add', '/repo/plugins/p', '--link', '--nosave']],
        ]);
    });

    it('npm: removes the installed plugin and adds the published package', () => {
        const c = commands.pluginCommands({ mode: 'npm' });
        expect(c).toEqual([
            ['cordova', ['plugin', 'rm', 'co.acoustic.connect.push', '--nosave']],
            ['cordova', ['plugin', 'add', 'cordova-acoustic-connect', '--nosave']],
        ]);
    });

    it.each(['local', 'npm'])('%s: never writes the plugin into the Demo\'s package.json or lock file', (mode) => {
        // Cordova saves a plugin into package.json unless told not to: a run once left a
        // file: dependency and re-ordered keys in tracked files.
        for (const [, args] of commands.pluginCommands({ mode, pluginDir: '/p' })) {
            expect(args).toContain('--nosave');
        }
    });

    it('rejects an unknown mode, and local without a directory', () => {
        expect(() => commands.pluginCommands({ mode: 'git' })).toThrow('mode');
        expect(() => commands.pluginCommands({ mode: 'local' })).toThrow('pluginDir');
    });
});

describe('parseResultLine', () => {
    const result = { ok: false, failed: 1, unavailable: 0, results: [
        { id: 'screen-load', status: 'ok' },
        { id: 'screen-layout', status: 'failed', error: 'ACOUSTIC_INTERNAL_ERROR: logScreenLayout returned false' },
    ] };

    it('reads the steps from a plain line', () => {
        expect(commands.parseResultLine('E2E_RESULT ' + JSON.stringify(result))).toEqual(result);
    });

    it('reads the steps from a console line, where the quotes are escaped and text follows', () => {
        const escaped = JSON.stringify(result).replace(/"/g, '\\"');
        const line = '10-02 11:39:53 I chromium: [INFO:CONSOLE(33)] "E2E_RESULT ' + escaped + '", source: https://localhost/js/e2e/e2e.js (33)';
        expect(commands.parseResultLine(line)).toEqual(result);
    });

    it('takes the last one and returns null when there is none or it is cut off', () => {
        const first = 'E2E_RESULT ' + JSON.stringify({ ok: true, failed: 0, unavailable: 0, results: [] });
        expect(commands.parseResultLine(first + '\nnoise\nE2E_RESULT ' + JSON.stringify(result))).toEqual(result);
        expect(commands.parseResultLine('nothing here')).toBeNull();
        expect(commands.parseResultLine('E2E_RESULT {"ok":fal')).toBeNull();
    });

    it('lists the steps that did not pass, with the reason', () => {
        expect(commands.problemSteps(result)).toEqual(['screen-layout failed: ACOUSTIC_INTERNAL_ERROR: logScreenLayout returned false']);
        expect(commands.problemSteps(null)).toEqual([]);
        expect(commands.problemSteps({ results: [{ id: 'a', status: 'unavailable', error: 'plugin has no x()' }] })).toEqual(['a unavailable: plugin has no x()']);
    });
});

describe('parsers', () => {
    it('finds the last E2E_DONE line, even inside console noise', () => {
        const log = [
            '10-01 11:39:53 I chromium: [INFO:CONSOLE(15)] "E2E_DONE status=fail steps=9 failed=1 unavailable=0", source: x',
            '10-01 11:40:53 I chromium: [INFO:CONSOLE(15)] "E2E_DONE status=pass steps=9 failed=0 unavailable=0", source: x',
        ].join('\n');
        expect(commands.parseDoneLine(log)).toEqual({ status: 'pass', steps: 9, failed: 0, unavailable: 0 });
    });

    it('returns null when the app never said it was done', () => {
        expect(commands.parseDoneLine('nothing here')).toBeNull();
    });

    it('reads the sdk-timeout and no-plugin statuses', () => {
        expect(commands.parseDoneLine('E2E_DONE status=sdk-timeout steps=0 failed=0 unavailable=0').status).toBe('sdk-timeout');
        expect(commands.parseDoneLine('E2E_DONE status=no-plugin steps=0 failed=0 unavailable=0').status).toBe('no-plugin');
    });

    it('reads the Android SDK version from logcat', () => {
        expect(commands.parseAndroidSdkVersion('I EOCore  : LibraryVersion:11.1.10-beta\nI EOCore  : x'))
            .toBe('11.1.10-beta');
        expect(commands.parseAndroidSdkVersion('nothing')).toBeNull();
    });

    it('reads the iOS pod and version from Podfile.lock', () => {
        const lock = 'PODS:\n  - AcousticConnectDebug (2.1.13):\n    - AcousticConnectDebug/Core (= 2.1.13)\n';
        expect(commands.parseIosPod(lock)).toEqual({ pod: 'AcousticConnectDebug', version: '2.1.13' });
        expect(commands.parseIosPod('PODS:\n  - Other (1.0)\n')).toBeNull();
    });
});

describe('pickAndroidSerial', () => {
    const out = (...lines: string[]) => 'List of devices attached\n' + lines.join('\n') + '\n\n';

    it('takes the only device', () => {
        expect(commands.pickAndroidSerial(out('emulator-5554\tdevice'))).toBe('emulator-5554');
    });

    it('takes the requested one among several', () => {
        expect(commands.pickAndroidSerial(out('emulator-5554\tdevice', 'ABC123\tdevice'), 'ABC123')).toBe('ABC123');
    });

    it('refuses to guess among several devices (a shared machine may have emulators that are not yours)', () => {
        expect(() => commands.pickAndroidSerial(out('emulator-5554\tdevice', 'ABC123\tdevice'))).toThrow('--device');
    });

    it('fails when there is no device', () => {
        expect(() => commands.pickAndroidSerial(out())).toThrow('no Android device');
    });

    it('does not use an unauthorized device', () => {
        expect(() => commands.pickAndroidSerial(out('ABC123\tunauthorized'))).toThrow('no Android device');
    });

    it('fails when the requested device is not there', () => {
        expect(() => commands.pickAndroidSerial(out('emulator-5554\tdevice'), 'ZZZ')).toThrow('ZZZ');
    });
});

describe('diffConfigKeys', () => {
    it('lists only the names of keys that differ from the example, never their values', () => {
        const keys = commands.diffConfigKeys(
            { Connect: { AppKey: 'secret-1', PostMessageUrl: 'http://x', useRelease: false, Extra: 1 } },
            { Connect: { AppKey: 'YOUR_KEY', PostMessageUrl: 'http://x', useRelease: false } }
        );
        expect(keys).toEqual(['AppKey', 'Extra']);
        expect(JSON.stringify(keys)).not.toContain('secret-1');
    });
});

// ── report ──────────────────────────────────────────────────────────────────────────────

const PASSING = {
    pass: true, counts: { pass: 2, fail: 0, na: 1 },
    entries: [
        { name: 'a: thing', status: 'PASS', detail: 'ok' },
        { name: 'b: other', status: 'PASS', detail: 'ok' },
        { name: 'c: layout', status: 'N/A', reason: 'no layout on Android' },
    ],
};
const FAILING = {
    pass: false, counts: { pass: 1, fail: 1, na: 0 },
    entries: [
        { name: 'a: thing', status: 'PASS', detail: 'ok' },
        { name: 'b: other', status: 'FAIL', detail: 'qty: expected (string) "2", got (undefined) undefined' },
    ],
};
const DONE_PASS = { status: 'pass', steps: 9, failed: 0, unavailable: 0 };

describe('overallVerdict', () => {
    it.each([
        ['passes', { evaluation: PASSING, messageCount: 12, done: DONE_PASS }, 'PASS'],
        ['passes when the app log cannot be read at all', { evaluation: PASSING, messageCount: 12, done: null }, 'PASS'],
        ['fails when a check fails', { evaluation: FAILING, messageCount: 12, done: DONE_PASS }, 'FAIL'],
        ['fails when the app itself reports a failed step', { evaluation: PASSING, messageCount: 12, done: { ...DONE_PASS, status: 'fail', failed: 1 } }, 'FAIL'],
        ['is inconclusive when the app says the SDK never came up', { evaluation: PASSING, messageCount: 12, done: { ...DONE_PASS, status: 'sdk-timeout' } }, 'INCONCLUSIVE'],
        ['is inconclusive when nothing reached the sink', { evaluation: FAILING, messageCount: 0, done: DONE_PASS }, 'INCONCLUSIVE'],
        ['is inconclusive without an evaluation', { evaluation: null, messageCount: 0, done: null }, 'INCONCLUSIVE'],
    ])('%s', (_label, args, expected) => {
        expect(report.overallVerdict(args)).toBe(expected);
    });

    it.each([['PASS', 0], ['FAIL', 1], ['INCONCLUSIVE', 2]])('exit code for %s is %i', (v, code) => {
        expect(report.exitCodeFor(v)).toBe(code);
    });
});

describe('buildReport', () => {
    const base = {
        platform: 'android', phase: 'default', verdict: 'PASS', startedAt: '2026-10-01T10:00:00.000Z',
        env: {
            repoCommit: 'abc1234', pluginVersion: '1.0.19', pluginMode: 'local',
            nativeSdk: '11.1.10-beta (resolved 2026-10-01)', device: 'sdk_gphone64_arm64, Android 15',
            sinkUrl: 'http://localhost:9877', configKeysDiffering: ['AppKey', 'Extra'],
        },
        done: DONE_PASS, evaluation: PASSING, messageCount: 12, reverted: ['ConnectConfig.json: original content written back'],
        notes: [],
    };

    it('has the sections a reader needs to reproduce and trust the verdict', () => {
        const md = report.buildReport(base);
        expect(md).toContain('Verdict: PASS');
        for (const h of ['## Environment', '## Verdict table', '## Not applicable', '## What was reverted']) {
            expect(md).toContain(h);
        }
    });

    it('records the environment, including which config keys differ (names only)', () => {
        const md = report.buildReport(base);
        expect(md).toContain('abc1234');
        expect(md).toContain('1.0.19');
        expect(md).toContain('local');
        expect(md).toContain('11.1.10-beta (resolved 2026-10-01)');
        expect(md).toContain('http://localhost:9877');
        expect(md).toContain('AppKey, Extra');
    });

    it('lists every row with its status, and gives the reason of N/A rows', () => {
        const md = report.buildReport(base);
        expect(md).toContain('| PASS | a: thing |');
        expect(md).toContain('| N/A | c: layout |');
        expect(md).toContain('no layout on Android');
    });

    it('quotes the evidence of a failing row', () => {
        const md = report.buildReport({ ...base, verdict: 'FAIL', evaluation: FAILING });
        expect(md).toContain('| FAIL | b: other |');
        expect(md).toContain('qty: expected (string) "2", got (undefined) undefined');
    });

    it('says what was reverted', () => {
        expect(report.buildReport(base)).toContain('ConnectConfig.json: original content written back');
    });

    it('explains an inconclusive run instead of showing an empty table', () => {
        const md = report.buildReport({ ...base, verdict: 'INCONCLUSIVE', evaluation: null, messageCount: 0, notes: ['build failed: exit 1'] });
        expect(md).toContain('Verdict: INCONCLUSIVE');
        expect(md).toContain('build failed: exit 1');
    });

    it('reports whether the app said it was done', () => {
        expect(report.buildReport(base)).toContain('E2E_DONE status=pass');
        expect(report.buildReport({ ...base, done: null })).toContain('not observed');
    });
});

// ── runner ──────────────────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
    it('reads the options with their defaults', () => {
        expect(runner.parseArgs(['--platform', 'android'])).toMatchObject({
            platform: 'android', phase: 'default', plugin: 'local', skipBuild: false,
        });
    });

    it('reads --device-host, for a physical device that reaches the sink over the LAN', () => {
        expect(runner.parseArgs(['--platform', 'android', '--device-host', '192.168.1.20']).deviceHost).toBe('192.168.1.20');
    });

    it('reads the flags and numbers', () => {
        const o = runner.parseArgs(['--platform', 'ios', '--phase', 'screen-capture-off', '--skip-build', '--device', 'UDID', '--run-wait', '40']);
        expect(o).toMatchObject({ platform: 'ios', phase: 'screen-capture-off', skipBuild: true, device: 'UDID', runWaitSec: 40 });
    });

    it('reads --connect-config as a JSON object', () => {
        const o = runner.parseArgs(['--platform', 'android', '--connect-config', '{"AndroidVersion":"11.1.10-beta"}']);
        expect(o.connectConfig).toEqual({ AndroidVersion: '11.1.10-beta' });
    });

    it.each([
        [[], '--platform'],
        [['--platform', 'ios', '--connect-config', 'not json'], '--connect-config'],
        [['--platform', 'ios', '--connect-config', '[1]'], '--connect-config'],
        [['--platform', 'ios', '--connect-config', 'null'], '--connect-config'],
        [['--platform', 'ios', '--connect-config'], '--connect-config'],
        [['--platform', 'windows'], 'platform must be'],
        [['--platform', 'ios', '--plugin', 'git'], '--plugin'],
        [['--platform', 'ios', '--bogus', 'x'], '--bogus'],
        [['--platform', 'ios', '--run-wait', 'soon'], '--run-wait'],
    ])('rejects %j', (argv, message) => {
        expect(() => runner.parseArgs(argv)).toThrow(message);
    });
});

type Call = string;

function makeDeps(over: Record<string, any> = {}) {
    const calls: Call[] = [];
    const files: Record<string, string> = {};
    const logcat = [
        'I EOCore  : LibraryVersion:11.1.10-beta',
        'I chromium: [INFO:CONSOLE(1)] "E2E_DONE status=pass steps=9 failed=0 unavailable=0", source: x',
    ].join('\n');
    const exec = jest.fn(async (cmd: string, args: string[]) => {
        const line = [cmd, ...args].join(' ');
        calls.push(line);
        if (line.startsWith('adb devices')) return { code: 0, stdout: 'List of devices attached\nemulator-5554\tdevice\n\n', stderr: '' };
        if (line.includes('logcat -d')) return { code: 0, stdout: logcat, stderr: '' };
        if (line.includes('getprop')) return { code: 0, stdout: 'sdk_gphone64_arm64\n', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
    });
    const sink = {
        port: 9877,
        reads: 0,
        messages: jest.fn(async () => Array(8).fill({ type: 5, message: {} })),
        reset: jest.fn(async () => { calls.push('sink.reset'); }),
        stop: jest.fn(async () => { calls.push('sink.stop'); }),
    };
    const deps = {
        exec,
        sleep: jest.fn(async () => undefined),
        now: () => new Date('2026-10-01T10:00:00.000Z'),
        exists: jest.fn(() => true),
        readFile: jest.fn((p: string) => {
            if (p.endsWith('config.xml')) return '<widget id="co.x.app" version="1">';
            if (p.endsWith('ConnectConfig.json')) return JSON.stringify({ Connect: { AppKey: 'k', PostMessageUrl: 'p' } });
            if (p.endsWith('ConnectConfig.example.json')) return JSON.stringify({ Connect: { AppKey: 'YOUR', PostMessageUrl: 'p' } });
            if (p.endsWith('Podfile.lock')) return '  - AcousticConnectDebug (2.1.13):\n';
            return '{}';
        }),
        writeFile: jest.fn((p: string, data: string) => { files[p] = data; }),
        mkdirp: jest.fn(),
        startSink: jest.fn(async () => { calls.push('sink.start'); return sink; }),
        prepare: jest.fn((o: any) => { calls.push('prepare'); return { deviceBase: 'http://10.0.2.2:9877', changes: [] }; }),
        restore: jest.fn(() => { calls.push('restore'); return { reverted: ['ConnectConfig.json: original content written back'] }; }),
        evaluate: jest.fn(async () => PASSING),
        gitHead: jest.fn(async () => 'abc1234'),
        pluginInfo: jest.fn(() => ({ version: '1.0.19' })),
        ...over,
    };
    return { deps, calls, files, sink };
}

const RUN_OPTS = {
    root: '/demo', platform: 'android', phase: 'default', plugin: 'local', skipBuild: false,
    outDir: '/out', sinkRepo: '/sink', runWaitSec: 0, settleSec: 0, stableWaitSec: 60, device: undefined,
};

function inOrder(calls: string[], parts: string[]) {
    let at = -1;
    for (const part of parts) {
        const next = calls.findIndex((c, i) => i > at && c.includes(part));
        if (next === -1) return `missing or out of order: "${part}" (after index ${at}) in:\n${calls.join('\n')}`;
        at = next;
    }
    return 'ok';
}

describe('runE2E on Android', () => {
    it('starts the sink, prepares, builds, installs, launches, flushes through the background, then restores and stops the sink', async () => {
        const { deps, calls } = makeDeps();
        const result = await runner.runE2E(RUN_OPTS, deps);

        expect(inOrder(calls, [
            'sink.start', 'prepare', 'cordova build android', 'install -r', 'am start', 'KEYCODE_HOME',
            'am start', 'KEYCODE_HOME', 'restore', 'sink.stop',
        ])).toBe('ok');
        expect(result.verdict).toBe('PASS');
        expect(result.exitCode).toBe(0);
    });

    it('prepares for the device as the Android emulator sees the host', async () => {
        const { deps } = makeDeps();
        await runner.runE2E(RUN_OPTS, deps);
        expect(deps.prepare).toHaveBeenCalledWith(expect.objectContaining({
            root: '/demo', platform: 'android', sink: 'http://localhost:9877', connectOverrides: {},
        }));
    });

    it('merges --connect-config over the settings of the phase, so a run can try another SDK version or layout rules', async () => {
        const { deps } = makeDeps();
        await runner.runE2E({
            ...RUN_OPTS, platform: 'ios', device: 'UDID', phase: 'screen-capture-off',
            connectConfig: { ScreenCaptureEnabled: true, AndroidVersion: '11.1.10-beta', layoutConfigAndroid: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 2 } } } },
        }, deps);
        expect(deps.prepare).toHaveBeenCalledWith(expect.objectContaining({
            connectOverrides: {
                ScreenCaptureEnabled: true, AndroidVersion: '11.1.10-beta',
                layoutConfigAndroid: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 2 } } },
            },
        }));
    });

    it('names the extra settings in the report, so a result is not mistaken for a default run', async () => {
        const { deps, files } = makeDeps();
        await runner.runE2E({ ...RUN_OPTS, connectConfig: { AndroidVersion: '11.1.10-beta' } }, deps);
        const report = Object.entries(files).map(([, v]) => String(v)).find((v) => v.includes('# E2E verification')) || '';
        expect(report).toContain('--connect-config');
        expect(report).toContain('AndroidVersion');
    });

    it('puts the steps the app reports as failed, with their reason, into the report notes', async () => {
        const result = { ok: false, failed: 1, unavailable: 0, results: [
            { id: 'screen-load', status: 'ok' },
            { id: 'screen-layout', status: 'failed', error: 'ACOUSTIC_INTERNAL_ERROR: logScreenLayout returned false' },
        ] };
        const { deps, files } = makeDeps();
        const base = deps.exec;
        deps.exec = jest.fn(async (cmd: string, args: string[]) => {
            const out = await base(cmd, args);
            return [cmd, ...args].join(' ').includes('logcat -d')
                ? { ...out, stdout: out.stdout + '\nI chromium: [INFO:CONSOLE(33)] "E2E_RESULT ' + JSON.stringify(result).replace(/"/g, '\\"') + '", source: x' }
                : out;
        }) as any;
        await runner.runE2E(RUN_OPTS, deps);
        const report = Object.values(files).map(String).find((v) => v.includes('# E2E verification')) || '';
        expect(report).toContain('app step screen-layout failed: ACOUSTIC_INTERNAL_ERROR: logScreenLayout returned false');
    });

    it('hands the device host to prepare so a physical device can reach the sink', async () => {
        const { deps } = makeDeps();
        await runner.runE2E({ ...RUN_OPTS, deviceHost: '192.168.1.20' }, deps);
        expect(deps.prepare).toHaveBeenCalledWith(expect.objectContaining({ deviceHost: '192.168.1.20' }));
    });

    it('skips the build when asked', async () => {
        const { deps, calls } = makeDeps();
        await runner.runE2E({ ...RUN_OPTS, skipBuild: true }, deps);
        expect(calls.some((c) => c.includes('cordova build'))).toBe(false);
        expect(calls.some((c) => c.includes('install -r'))).toBe(true);
    });

    it('switches to the plugin under test before the build, and not when the build is skipped', async () => {
        const { deps, calls } = makeDeps();
        await runner.runE2E(RUN_OPTS, deps);
        expect(inOrder(calls, ['prepare', 'cordova plugin rm', 'cordova plugin add', 'cordova build android'])).toBe('ok');
        expect(calls.some((c) => c.startsWith('cordova plugin add') && c.includes('--link') && c.includes('--nosave'))).toBe(true);

        const skipped = makeDeps();
        await runner.runE2E({ ...RUN_OPTS, skipBuild: true }, skipped.deps);
        expect(skipped.calls.some((c) => c.includes('cordova plugin'))).toBe(false);
    });

    it('tests the published package when asked, and records that in the report', async () => {
        const { deps, calls, files } = makeDeps();
        await runner.runE2E({ ...RUN_OPTS, plugin: 'npm' }, deps);
        expect(calls.some((c) => c.includes('cordova plugin add cordova-acoustic-connect'))).toBe(true);
        expect(calls.some((c) => c.includes('--link'))).toBe(false);
        expect(files['/out/results-android.md']).toContain('npm');
    });

    it('writes the evidence: messages, the suite, and the report', async () => {
        const { deps, files } = makeDeps();
        await runner.runE2E(RUN_OPTS, deps);
        expect(Object.keys(files)).toEqual(expect.arrayContaining(['/out/messages.json', '/out/suite.json', '/out/results-android.md']));
        expect(files['/out/results-android.md']).toContain('Verdict: PASS');
        expect(files['/out/results-android.md']).toContain('ConnectConfig.json: original content written back');
        expect(files['/out/results-android.md']).toContain('11.1.10-beta');
    });

    it('never puts the app key into the report, in any form', async () => {
        const SECRET_KEY = 'APPKEY-0123456789-abcdef';
        const { deps, files } = makeDeps();
        const base = deps.readFile;
        deps.readFile = jest.fn((p: string) => p.endsWith('ConnectConfig.json')
            ? JSON.stringify({ Connect: { AppKey: SECRET_KEY, PostMessageUrl: 'p' } })
            : base(p)) as any;
        await runner.runE2E(RUN_OPTS, deps);
        for (const [file, text] of Object.entries(files)) {
            if (file.endsWith('.md')) expect(text).not.toContain(SECRET_KEY);
        }
        expect(files['/out/results-android.md']).toContain('AppKey');   // as a differing key NAME
    });

    it('resets the sink after the install so earlier traffic cannot count', async () => {
        const { deps, calls } = makeDeps();
        await runner.runE2E(RUN_OPTS, deps);
        expect(inOrder(calls, ['install -r', 'sink.reset', 'am start'])).toBe('ok');
    });

    it('waits for the app to say it is done, polling the log', async () => {
        let n = 0;
        const { deps } = makeDeps();
        const base = deps.exec;
        deps.exec = jest.fn(async (cmd: string, args: string[]) => {
            const line = [cmd, ...args].join(' ');
            if (line.includes('logcat -d')) {
                n += 1;
                return { code: 0, stdout: n < 3 ? 'I EOCore  : LibraryVersion:11.1.10-beta' : 'E2E_DONE status=pass steps=9 failed=0 unavailable=0', stderr: '' };
            }
            return base(cmd, args);
        });
        const result = await runner.runE2E({ ...RUN_OPTS, runWaitSec: 30 }, deps);
        expect(result.verdict).toBe('PASS');
        // reads 1 and 2 do not say it is done, read 3 does and ends the wait; one more is the final read for the report
        expect(n).toBe(4);
    });

    it('fails the run when the app reports a failed step', async () => {
        const { deps } = makeDeps();
        const base = deps.exec;
        deps.exec = jest.fn(async (cmd: string, args: string[]) => {
            if ([cmd, ...args].join(' ').includes('logcat -d')) {
                return { code: 0, stdout: 'E2E_DONE status=fail steps=9 failed=1 unavailable=0', stderr: '' };
            }
            return base(cmd, args);
        });
        const result = await runner.runE2E(RUN_OPTS, deps);
        expect(result.verdict).toBe('FAIL');
        expect(result.exitCode).toBe(1);
    });

    it('stops polling the sink once the message count is stable twice', async () => {
        const counts = [3, 5, 5, 5, 9, 9];
        let i = 0;
        const { deps, sink, files } = makeDeps();
        sink.messages = jest.fn(async () => Array(counts[Math.min(i++, counts.length - 1)]).fill({ type: 5, message: {} }));
        const result = await runner.runE2E(RUN_OPTS, deps);
        // reads: 3, 5 (changed), 5 (stable once), 5 (stable twice) -> stops at the 4th read, which is also
        // the one the evidence is taken from. Stopping at the first repeat would be 3 reads.
        expect((sink.messages as jest.Mock).mock.calls.length).toBe(4);
        expect(JSON.parse(files['/out/messages.json'])).toHaveLength(5);
        expect(result.verdict).toBeDefined();
    });

    it('gives up waiting for a stable count and says so', async () => {
        let i = 0;
        const { deps, sink, files } = makeDeps();
        sink.messages = jest.fn(async () => Array(++i).fill({ type: 5, message: {} }));
        await runner.runE2E({ ...RUN_OPTS, stableWaitSec: 10 }, deps);
        expect(files['/out/results-android.md']).toContain('did not settle');
    });
});

describe('runE2E failure handling', () => {
    it('always restores the app and stops the sink when the build fails, and the run is inconclusive', async () => {
        const { deps, calls, files } = makeDeps();
        const base = deps.exec;
        deps.exec = jest.fn(async (cmd: string, args: string[]) => {
            if ([cmd, ...args].join(' ').startsWith('cordova build')) return { code: 1, stdout: '', stderr: 'gradle failed' };
            return base(cmd, args);
        });
        const result = await runner.runE2E(RUN_OPTS, deps);

        expect(result.verdict).toBe('INCONCLUSIVE');
        expect(result.exitCode).toBe(2);
        expect(calls).toEqual(expect.arrayContaining(['restore', 'sink.stop']));
        expect(files['/out/results-android.md']).toContain('build failed');
    });

    it('restores even when a step throws', async () => {
        const { deps, calls } = makeDeps();
        const base = deps.exec;
        deps.exec = jest.fn(async (cmd: string, args: string[]) => {
            if ([cmd, ...args].join(' ').includes('install -r')) throw new Error('adb exploded');
            return base(cmd, args);
        });
        const result = await runner.runE2E(RUN_OPTS, deps);
        expect(result.verdict).toBe('INCONCLUSIVE');
        expect(calls).toEqual(expect.arrayContaining(['restore', 'sink.stop']));
    });

    it('is inconclusive when nothing reached the sink', async () => {
        const { deps, sink } = makeDeps();
        sink.messages = jest.fn(async () => []);
        const result = await runner.runE2E(RUN_OPTS, deps);
        expect(result.verdict).toBe('INCONCLUSIVE');
    });

    it('touches nothing when the phase does not apply to the platform', async () => {
        const { deps, calls } = makeDeps();
        await expect(runner.runE2E({ ...RUN_OPTS, phase: 'screen-capture-off' }, deps)).rejects.toThrow('not run on Android');
        expect(calls).toEqual([]);
        expect(deps.mkdirp).not.toHaveBeenCalled();
        expect(deps.writeFile).not.toHaveBeenCalled();
        expect(deps.startSink).not.toHaveBeenCalled();
        expect(deps.prepare).not.toHaveBeenCalled();
    });

    it('touches nothing when the sink checkout is missing', async () => {
        const { deps, calls } = makeDeps({ exists: jest.fn((p: string) => p !== '/sink') });
        await expect(runner.runE2E(RUN_OPTS, deps)).rejects.toThrow('sink');
        expect(calls).toEqual([]);
        expect(deps.mkdirp).not.toHaveBeenCalled();
        expect(deps.writeFile).not.toHaveBeenCalled();
        expect(deps.startSink).not.toHaveBeenCalled();
        expect(deps.prepare).not.toHaveBeenCalled();
    });
});

describe('runE2E on iOS', () => {
    const IOS = { ...RUN_OPTS, platform: 'ios', device: 'UDID-1' };

    it('boots the simulator, installs, launches, goes through another app to flush, and never uses adb', async () => {
        const { deps, calls } = makeDeps();
        const result = await runner.runE2E(IOS, deps);

        expect(inOrder(calls, [
            'sink.start', 'prepare', 'cordova build ios --emulator', 'simctl boot UDID-1', 'simctl install UDID-1',
            'sink.reset', 'simctl launch UDID-1 co.x.app', 'simctl launch UDID-1 com.apple.Preferences', 'restore', 'sink.stop',
        ])).toBe('ok');
        expect(calls.some((c) => c.startsWith('adb '))).toBe(false);
        expect(result.exitCode).toBe(0);
    });

    it('applies the capture settings of the phase', async () => {
        const { deps } = makeDeps();
        await runner.runE2E({ ...IOS, phase: 'screen-capture-off' }, deps);
        expect(deps.prepare).toHaveBeenCalledWith(expect.objectContaining({
            platform: 'ios', connectOverrides: { ScreenCaptureEnabled: false },
        }));
    });

    it('does not fail a run only because the iOS console cannot be read: it waits instead and says the line was not observed', async () => {
        const { deps, files } = makeDeps();
        const result = await runner.runE2E({ ...IOS, runWaitSec: 12 }, deps);
        expect(result.verdict).toBe('PASS');
        expect(files['/out/results-ios.md']).toContain('not observed');
        const slept = (deps.sleep as jest.Mock).mock.calls.reduce((sum: number, c: number[]) => sum + c[0], 0);
        expect(slept).toBeGreaterThanOrEqual(12000);   // the whole wait, since the log never says it is done
    });

    it('needs a simulator to be named', async () => {
        const { deps, calls } = makeDeps();
        await expect(runner.runE2E({ ...IOS, device: undefined }, deps)).rejects.toThrow('--device');
        expect(calls).toEqual([]);
    });
});

describe('evidence', () => {
    it('keeps the raw captures out of git', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ignore = require('fs').readFileSync(join(E2E, '..', '.gitignore'), 'utf8');
        expect(ignore).toContain('/e2e/evidence/');
    });
});
