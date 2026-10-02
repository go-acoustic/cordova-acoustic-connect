/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for the Demo app's e2e build preparation:
 *   applications/Demo/e2e/prepare.js         (config + e2e switch, backup / restore)
 *   applications/Demo/e2e/patches.js         (Android cleartext, iOS ATS)
 *   applications/Demo/hooks/after_prepare_e2e.js
 *
 * The sink is plain http, so an e2e build needs cleartext traffic allowed. That must
 * never leak into the normal Demo: everything is reversible and the state needed to
 * undo it lives in a gitignored file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';

const DEMO = path.join(__dirname, '..', '..', '..', 'applications', 'Demo');

/* eslint-disable @typescript-eslint/no-var-requires */
const prep = require(path.join(DEMO, 'e2e', 'prepare.js'));
const patches = require(path.join(DEMO, 'e2e', 'patches.js'));
const hook = require(path.join(DEMO, 'hooks', 'after_prepare_e2e.js')) as (ctx: unknown) => void;
/* eslint-enable @typescript-eslint/no-var-requires */

const E2E_CONFIG_ORIGINAL = '/* default */\nwindow.E2E_CONFIG = { enabled: false };\n';
const EXAMPLE = {
    Connect: { AppKey: 'YOUR_CONNECT_APP_KEY_HERE', PostMessageUrl: 'https://collector.example.com/collector/collectorPost', iOSPushMode: 'automatic' },
};
const REAL = {
    Connect: { AppKey: 'realkey0123456789', PostMessageUrl: 'https://real.collector.test/collector/collectorPost', iOSAppGroupIdentifier: 'group.real', useRelease: false },
};

let root: string;

function write(rel: string, content: string): void {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
}
function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}
// Runs a generated e2e-config.js the way the app does and returns window.E2E_CONFIG.
function e2eConfigOf(source: string): Record<string, unknown> {
    const ctx: { window: Record<string, unknown> } = { window: {} };
    vm.runInNewContext(source, ctx);
    return ctx.window.E2E_CONFIG as Record<string, unknown>;
}
function exists(rel: string): boolean {
    return fs.existsSync(path.join(root, rel));
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-e2e-prepare-'));
    write('www/js/e2e-config.js', E2E_CONFIG_ORIGINAL);
    write('ConnectConfig.example.json', JSON.stringify(EXAMPLE));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('deviceBaseUrl', () => {
    it.each([
        ['android', 'http://localhost:9877', 'http://10.0.2.2:9877'],
        ['android', 'http://127.0.0.1:9877', 'http://10.0.2.2:9877'],
        ['ios', 'http://localhost:9877', 'http://localhost:9877'],
        ['ios', 'http://127.0.0.1:9877', 'http://127.0.0.1:9877'],
    ])('%s: %s -> %s', (platform, sink, expected) => {
        expect(prep.deviceBaseUrl({ platform, sink })).toBe(expected);
    });

    it('an explicit device host wins, for a physical device on the LAN', () => {
        expect(prep.deviceBaseUrl({ platform: 'android', sink: 'http://localhost:9877', deviceHost: '192.168.1.20' }))
            .toBe('http://192.168.1.20:9877');
    });

    it('keeps a sink that is not on the host loopback as it is', () => {
        expect(prep.deviceBaseUrl({ platform: 'android', sink: 'http://192.168.1.5:9877' })).toBe('http://192.168.1.5:9877');
    });

    it.each([
        ['an unknown platform', { platform: 'windows', sink: 'http://localhost:9877' }, 'platform must be'],
        ['a non-http scheme', { platform: 'ios', sink: 'ftp://localhost:9877' }, 'http'],
        ['a malformed url', { platform: 'ios', sink: 'not a url' }, 'sink'],
        ['a missing sink', { platform: 'ios' }, 'sink'],
    ])('rejects %s', (_label, args, message) => {
        expect(() => prep.deviceBaseUrl(args)).toThrow(message);
    });
});

describe('buildConnectConfig', () => {
    it('keeps the existing settings and points the collector urls at the sink', () => {
        const cfg = prep.buildConnectConfig(REAL, 'http://10.0.2.2:9877');
        expect(cfg.Connect.AppKey).toBe('realkey0123456789');
        expect(cfg.Connect.iOSAppGroupIdentifier).toBe('group.real');
        expect(cfg.Connect.PostMessageUrl).toBe('http://10.0.2.2:9877/collector/collectorPost');
        expect(cfg.Connect.KillSwitchUrl).toBe('http://10.0.2.2:9877/collector/switch/realkey0123456789');
    });

    it('does not mutate its input', () => {
        const copy = JSON.parse(JSON.stringify(REAL));
        prep.buildConnectConfig(REAL, 'http://10.0.2.2:9877');
        expect(REAL).toEqual(copy);
    });

    it('rejects a config without an AppKey', () => {
        expect(() => prep.buildConnectConfig({ Connect: {} }, 'http://10.0.2.2:9877')).toThrow('AppKey');
    });
});

describe('deepMerge', () => {
    it('merges nested objects and lets the override replace scalars and arrays', () => {
        const merged = prep.deepMerge(
            { a: { b: 1, c: [1, 2] }, keep: true },
            { a: { b: 2, c: [3] }, added: { x: 1 } }
        );
        expect(merged).toEqual({ a: { b: 2, c: [3] }, keep: true, added: { x: 1 } });
    });

    it('does not mutate either input', () => {
        const base = { a: { b: 1 } };
        const over = { a: { c: 2 } };
        prep.deepMerge(base, over);
        expect(base).toEqual({ a: { b: 1 } });
        expect(over).toEqual({ a: { c: 2 } });
    });
});

describe('buildE2EConfigFile', () => {
    function evaluate(source: string): Record<string, unknown> {
        const ctx: { window: Record<string, unknown> } = { window: {} };
        vm.runInNewContext(source, ctx);
        return ctx.window.E2E_CONFIG as Record<string, unknown>;
    }

    it('enables the scenario with the default timings', () => {
        expect(evaluate(prep.buildE2EConfigFile({}))).toEqual({ enabled: true, settleMs: 2000, sdkMaxTries: 30, sdkIntervalMs: 1000 });
    });

    it('takes overrides', () => {
        expect(evaluate(prep.buildE2EConfigFile({ settleMs: 500 })).settleMs).toBe(500);
    });
});

describe('patchAndroidManifest', () => {
    const MANIFEST = '<?xml version="1.0"?>\n<manifest>\n    <application android:hardwareAccelerated="true" android:label="@string/app_name">\n        <activity android:name="A"/>\n    </application>\n</manifest>\n';

    it('allows cleartext traffic on the application element', () => {
        expect(patches.patchAndroidManifest(MANIFEST)).toContain('<application android:usesCleartextTraffic="true" android:hardwareAccelerated="true"');
    });

    it('is idempotent', () => {
        const once = patches.patchAndroidManifest(MANIFEST);
        expect(patches.patchAndroidManifest(once)).toBe(once);
    });

    it('turns an explicit false into true', () => {
        const withFalse = MANIFEST.replace('<application ', '<application android:usesCleartextTraffic="false" ');
        const out = patches.patchAndroidManifest(withFalse);
        expect(out).toContain('android:usesCleartextTraffic="true"');
        expect(out).not.toContain('android:usesCleartextTraffic="false"');
    });

    it('changes nothing else', () => {
        const out = patches.patchAndroidManifest(MANIFEST);
        expect(out.replace(' android:usesCleartextTraffic="true"', '')).toBe(MANIFEST);
    });

    it('fails clearly when there is no application element', () => {
        expect(() => patches.patchAndroidManifest('<manifest/>')).toThrow('<application');
    });
});

describe('Android cleartext: read and reverse', () => {
    const MANIFEST = '<manifest>\n    <application android:hardwareAccelerated="true">\n    </application>\n</manifest>\n';

    it('reads that the attribute was absent', () => {
        expect(patches.readAndroidCleartext(MANIFEST)).toEqual({ present: false });
    });

    it('reads an existing value', () => {
        expect(patches.readAndroidCleartext(MANIFEST.replace('<application ', '<application android:usesCleartextTraffic="false" ')))
            .toEqual({ present: true, value: 'false' });
    });

    it('removes the attribute it added, leaving the manifest exactly as it was', () => {
        const patched = patches.patchAndroidManifest(MANIFEST);
        expect(patches.unpatchAndroidManifest(patched, { present: false })).toBe(MANIFEST);
    });

    it('puts an existing value back', () => {
        const original = MANIFEST.replace('<application ', '<application android:usesCleartextTraffic="false" ');
        const patched = patches.patchAndroidManifest(original);
        expect(patches.unpatchAndroidManifest(patched, { present: true, value: 'false' })).toBe(original);
    });

    it('is harmless on a manifest that was never patched', () => {
        expect(patches.unpatchAndroidManifest(MANIFEST, { present: false })).toBe(MANIFEST);
    });
});

describe('patchInfoPlist', () => {
    const plist = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const parse = (xml: string) => require('plist').parse(xml) as Record<string, any>;

    it('adds an App Transport Security exception that allows the http sink', () => {
        const out = parse(patches.patchInfoPlist(plist('<key>CFBundleName</key><string>App</string>')));
        expect(out.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(true);
        expect(out.CFBundleName).toBe('App');
    });

    it('adds the key to an existing App Transport Security dictionary', () => {
        const out = parse(patches.patchInfoPlist(plist('<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>')));
        expect(out.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(true);
        expect(out.NSAppTransportSecurity.NSAllowsLocalNetworking).toBe(true);
    });

    it('turns an explicit false into true', () => {
        const out = parse(patches.patchInfoPlist(plist('<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><false/></dict>')));
        expect(out.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(true);
    });

    it('is idempotent', () => {
        const once = patches.patchInfoPlist(plist('<key>CFBundleName</key><string>App</string>'));
        expect(parse(patches.patchInfoPlist(once))).toEqual(parse(once));
    });
});

describe('iOS App Transport Security: read and reverse', () => {
    const plist = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const parse = (xml: string) => require('plist').parse(xml) as Record<string, any>;

    it('reads that App Transport Security was absent', () => {
        expect(patches.readAts(plist('<key>CFBundleName</key><string>App</string>'))).toEqual({ present: false });
    });

    it('reads an existing dictionary and the arbitrary-loads value', () => {
        expect(patches.readAts(plist('<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><false/></dict>')))
            .toEqual({ present: true, arbitraryLoads: false });
        expect(patches.readAts(plist('<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>')))
            .toEqual({ present: true });
    });

    it('removes the whole dictionary it created', () => {
        const original = plist('<key>CFBundleName</key><string>App</string>');
        const out = parse(patches.unpatchInfoPlist(patches.patchInfoPlist(original), { present: false }));
        expect(out).toEqual(parse(original));
    });

    it('removes only the key it added from a dictionary that was already there', () => {
        const original = plist('<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>');
        const out = parse(patches.unpatchInfoPlist(patches.patchInfoPlist(original), { present: true }));
        expect(out).toEqual(parse(original));
    });

    it('puts an existing arbitrary-loads value back', () => {
        const original = plist('<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><false/></dict>');
        const out = parse(patches.unpatchInfoPlist(patches.patchInfoPlist(original), { present: true, arbitraryLoads: false }));
        expect(out.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBe(false);
    });
});

describe('prepare / restore', () => {
    const OPTS = () => ({ root, platform: 'android', sink: 'http://localhost:9877' });

    it('writes the sink config and enables the scenario', () => {
        write('ConnectConfig.json', JSON.stringify(REAL));
        const result = prep.prepare(OPTS());

        const cfg = JSON.parse(read('ConnectConfig.json'));
        expect(cfg.Connect.PostMessageUrl).toBe('http://10.0.2.2:9877/collector/collectorPost');
        expect(cfg.Connect.AppKey).toBe('realkey0123456789');
        expect(e2eConfigOf(read('www/js/e2e-config.js')).enabled).toBe(true);
        expect(result.deviceBase).toBe('http://10.0.2.2:9877');
    });

    it('starts from the example config when there is no ConnectConfig.json', () => {
        prep.prepare(OPTS());
        expect(JSON.parse(read('ConnectConfig.json')).Connect.AppKey).toBe('YOUR_CONNECT_APP_KEY_HERE');
    });

    it('fails when neither ConnectConfig.json nor the example exists', () => {
        fs.rmSync(path.join(root, 'ConnectConfig.example.json'));
        expect(() => prep.prepare(OPTS())).toThrow('ConnectConfig');
    });

    it('records what it changed and never prints the app key', () => {
        write('ConnectConfig.json', JSON.stringify(REAL));
        const result = prep.prepare(OPTS());
        expect(result.changes.length).toBeGreaterThanOrEqual(2);
        expect(JSON.stringify(result.changes)).not.toContain('realkey0123456789');
    });

    it('refuses to prepare twice, so the backup of the originals is never overwritten', () => {
        prep.prepare(OPTS());
        expect(() => prep.prepare(OPTS())).toThrow('restore');
    });

    it('restores the original files byte for byte', () => {
        write('ConnectConfig.json', JSON.stringify(REAL));
        prep.prepare(OPTS());
        const result = prep.restore({ root });

        expect(read('ConnectConfig.json')).toBe(JSON.stringify(REAL));
        expect(read('www/js/e2e-config.js')).toBe(E2E_CONFIG_ORIGINAL);
        expect(result.reverted.length).toBeGreaterThanOrEqual(2);
        expect(exists('e2e/.prepare-state.json')).toBe(false);
    });

    it('removes a ConnectConfig.json that did not exist before', () => {
        prep.prepare(OPTS());
        prep.restore({ root });
        expect(exists('ConnectConfig.json')).toBe(false);
    });

    it('restore without a prepare changes nothing and says so', () => {
        const result = prep.restore({ root });
        expect(result.reverted).toEqual([]);
        expect(read('www/js/e2e-config.js')).toBe(E2E_CONFIG_ORIGINAL);
    });

    it('status reports whether the project is prepared', () => {
        expect(prep.status({ root })).toEqual({ prepared: false });
        prep.prepare(OPTS());
        expect(prep.status({ root })).toMatchObject({ prepared: true, platform: 'android', deviceBase: 'http://10.0.2.2:9877' });
    });

    it('applies the capture settings of a phase on top of the sink settings', () => {
        write('ConnectConfig.json', JSON.stringify(REAL));
        prep.prepare({
            ...OPTS(),
            connectOverrides: { ScreenCaptureEnabled: false, layoutConfigIos: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } } } },
        });
        const connect = JSON.parse(read('ConnectConfig.json')).Connect;
        expect(connect.ScreenCaptureEnabled).toBe(false);
        expect(connect.layoutConfigIos.AutoLayout.GlobalScreenSettings.CaptureLayoutOn).toBe(0);
        expect(connect.PostMessageUrl).toBe('http://10.0.2.2:9877/collector/collectorPost');
        expect(connect.AppKey).toBe('realkey0123456789');
    });

    it('does not let an override replace the sink urls', () => {
        prep.prepare({ ...OPTS(), connectOverrides: { PostMessageUrl: 'https://elsewhere.test' } });
        expect(JSON.parse(read('ConnectConfig.json')).Connect.PostMessageUrl).toBe('http://10.0.2.2:9877/collector/collectorPost');
    });

    it('puts back or removes the ConnectLayoutConfig.json that the build generates from layoutConfigAndroid', () => {
        write('ConnectConfig.json', JSON.stringify(REAL));
        prep.prepare(OPTS());
        write('ConnectLayoutConfig.json', '{"generated":true}');     // the before_prepare hook writes it during the build
        const result = prep.restore({ root });
        expect(exists('ConnectLayoutConfig.json')).toBe(false);
        expect(result.reverted.join('\n')).toContain('ConnectLayoutConfig.json');
    });

    it('restores a ConnectLayoutConfig.json that existed before byte for byte', () => {
        write('ConnectConfig.json', JSON.stringify(REAL));
        write('ConnectLayoutConfig.json', '{"mine":1}');
        prep.prepare(OPTS());
        write('ConnectLayoutConfig.json', '{"generated":true}');
        prep.restore({ root });
        expect(read('ConnectLayoutConfig.json')).toBe('{"mine":1}');
    });

    it('puts everything back and leaves no state file when a write fails half way', () => {
        write('ConnectConfig.json', JSON.stringify(REAL));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodeFs = require('fs');   // the module object itself: `import * as fs` cannot be spied on
        const real = nodeFs.writeFileSync;
        let failed = false;
        const spy = jest.spyOn(nodeFs, 'writeFileSync').mockImplementation(((file: any, ...rest: any[]) => {
            // the e2e config is written after ConnectConfig.json; fail it once, let the restore write it back
            if (!failed && String(file).endsWith('e2e-config.js')) { failed = true; throw new Error('disk full'); }
            return (real as any)(file, ...rest);
        }) as any);
        try {
            expect(() => prep.prepare(OPTS())).toThrow('disk full');
        } finally {
            spy.mockRestore();
        }
        expect(failed).toBe(true);
        expect(read('ConnectConfig.json')).toBe(JSON.stringify(REAL));
        expect(read('www/js/e2e-config.js')).toBe(E2E_CONFIG_ORIGINAL);
        expect(prep.status({ root })).toEqual({ prepared: false });
        expect(exists('e2e/.prepare-state.json')).toBe(false);
    });

    it('does not touch a stale state file when it refuses to prepare twice', () => {
        prep.prepare(OPTS());
        const before = read('e2e/.prepare-state.json');
        expect(() => prep.prepare(OPTS())).toThrow('restore');
        expect(read('e2e/.prepare-state.json')).toBe(before);
    });

    it('keeps the generated layout config out of git, like ConnectBasicConfig.properties', () => {
        expect(fs.readFileSync(path.join(DEMO, '.gitignore'), 'utf8')).toMatch(/^\/ConnectLayoutConfig\.json$/m);
        expect(fs.readFileSync(path.join(DEMO, '..', '..', '.gitignore'), 'utf8')).toMatch(/applications\/Demo\/ConnectLayoutConfig\.json/);
    });

    it('keeps the state file out of git', () => {
        expect(fs.readFileSync(path.join(DEMO, '.gitignore'), 'utf8')).toContain('/e2e/.prepare-state.json');
    });
});

describe('after_prepare_e2e hook', () => {
    const MANIFEST = '<manifest>\n<application android:label="x">\n</application>\n</manifest>\n';
    const PLIST = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n<key>CFBundleName</key><string>App</string>\n</dict>\n</plist>\n';
    const ctx = (platforms: string[]) => ({ opts: { projectRoot: root, platforms } });

    beforeEach(() => {
        write('platforms/android/app/src/main/AndroidManifest.xml', MANIFEST);
        write('platforms/ios/App/App-Info.plist', PLIST);
    });

    it('does nothing for a normal build (no e2e state)', () => {
        hook(ctx(['android', 'ios']));
        expect(read('platforms/android/app/src/main/AndroidManifest.xml')).toBe(MANIFEST);
        expect(read('platforms/ios/App/App-Info.plist')).toBe(PLIST);
    });

    it('allows cleartext on Android after an e2e prepare', () => {
        prep.prepare({ root, platform: 'android', sink: 'http://localhost:9877' });
        hook(ctx(['android']));
        expect(read('platforms/android/app/src/main/AndroidManifest.xml')).toContain('android:usesCleartextTraffic="true"');
        expect(read('platforms/ios/App/App-Info.plist')).toBe(PLIST);
    });

    it('allows http through ATS on iOS after an e2e prepare', () => {
        prep.prepare({ root, platform: 'ios', sink: 'http://localhost:9877' });
        hook(ctx(['ios']));
        expect(read('platforms/ios/App/App-Info.plist')).toContain('NSAllowsArbitraryLoads');
        expect(read('platforms/android/app/src/main/AndroidManifest.xml')).toBe(MANIFEST);
    });

    it('only patches the platform the e2e run was prepared for', () => {
        prep.prepare({ root, platform: 'ios', sink: 'http://localhost:9877' });
        hook(ctx(['android', 'ios']));
        expect(read('platforms/android/app/src/main/AndroidManifest.xml')).toBe(MANIFEST);
    });

    it('skips a platform that has not been added instead of failing', () => {
        fs.rmSync(path.join(root, 'platforms'), { recursive: true });
        prep.prepare({ root, platform: 'android', sink: 'http://localhost:9877' });
        expect(() => hook(ctx(['android']))).not.toThrow();
    });
});

describe('restore undoes the platform patches too', () => {
    const MANIFEST = '<manifest>\n<application android:label="x">\n</application>\n</manifest>\n';
    const PLIST = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n<key>CFBundleName</key><string>App</string>\n</dict>\n</plist>\n';
    const ctx = (platforms: string[]) => ({ opts: { projectRoot: root, platforms } });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const parse = (xml: string) => require('plist').parse(xml) as Record<string, any>;

    beforeEach(() => {
        write('platforms/android/app/src/main/AndroidManifest.xml', MANIFEST);
        write('platforms/ios/App/App-Info.plist', PLIST);
    });

    it('gives the Android manifest back byte for byte', () => {
        prep.prepare({ root, platform: 'android', sink: 'http://localhost:9877' });
        hook(ctx(['android']));
        expect(read('platforms/android/app/src/main/AndroidManifest.xml')).not.toBe(MANIFEST);
        const result = prep.restore({ root });
        expect(read('platforms/android/app/src/main/AndroidManifest.xml')).toBe(MANIFEST);
        expect(result.reverted.join('\n')).toContain('AndroidManifest.xml');
    });

    it('gives the iOS Info.plist back byte for byte', () => {
        prep.prepare({ root, platform: 'ios', sink: 'http://localhost:9877' });
        hook(ctx(['ios']));
        expect(read('platforms/ios/App/App-Info.plist')).not.toBe(PLIST);
        prep.restore({ root });
        expect(read('platforms/ios/App/App-Info.plist')).toBe(PLIST);
    });

    it('keeps the originals when the hook runs on every prepare, not only the first', () => {
        prep.prepare({ root, platform: 'android', sink: 'http://localhost:9877' });
        hook(ctx(['android']));
        hook(ctx(['android']));
        prep.restore({ root });
        expect(read('platforms/android/app/src/main/AndroidManifest.xml')).toBe(MANIFEST);
    });

    it('undoes only the patch when the platform file changed after it was patched', () => {
        prep.prepare({ root, platform: 'android', sink: 'http://localhost:9877' });
        hook(ctx(['android']));
        // a later cordova prepare edits the manifest for an unrelated reason
        write('platforms/android/app/src/main/AndroidManifest.xml',
            read('platforms/android/app/src/main/AndroidManifest.xml').replace('android:label="x"', 'android:label="renamed"'));
        prep.restore({ root });
        const out = read('platforms/android/app/src/main/AndroidManifest.xml');
        expect(out).toContain('android:label="renamed"');
        expect(out).not.toContain('usesCleartextTraffic');
    });

    it('undoes only the patch on an iOS plist that changed afterwards', () => {
        prep.prepare({ root, platform: 'ios', sink: 'http://localhost:9877' });
        hook(ctx(['ios']));
        write('platforms/ios/App/App-Info.plist', read('platforms/ios/App/App-Info.plist').replace('<string>App</string>', '<string>Renamed</string>'));
        prep.restore({ root });
        const out = parse(read('platforms/ios/App/App-Info.plist'));
        expect(out.CFBundleName).toBe('Renamed');
        expect(out.NSAppTransportSecurity).toBeUndefined();
    });

    it('does not fail when the platform file is gone by the time of restore', () => {
        prep.prepare({ root, platform: 'android', sink: 'http://localhost:9877' });
        hook(ctx(['android']));
        fs.rmSync(path.join(root, 'platforms'), { recursive: true });
        expect(() => prep.restore({ root })).not.toThrow();
    });
});

describe('hook registration in the Demo config.xml', () => {
    const configXml = fs.readFileSync(path.join(DEMO, 'config.xml'), 'utf8');

    it('registers the e2e hook for every platform, not inside a <platform> block', () => {
        // Inside <platform name="android"> it ran only for Android: an iOS run silently never
        // patched Info.plist and never recorded it for restore.
        const outsidePlatformBlocks = configXml.replace(/<platform\b[\s\S]*?<\/platform>/g, '');
        expect(outsidePlatformBlocks).toMatch(/<hook type="after_prepare" src="hooks\/after_prepare_e2e\.js"\s*\/>/);
    });

    it('registers it only once', () => {
        expect(configXml.match(/after_prepare_e2e\.js/g)).toHaveLength(1);
    });
});
