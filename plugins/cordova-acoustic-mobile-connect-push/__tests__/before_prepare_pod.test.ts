/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for src/ios/hooks/before_prepare_pod.js
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hook = require('../src/ios/hooks/before_prepare_pod.js') as (ctx: unknown) => void;

interface Context {
    opts: { projectRoot: string; platforms?: string[] };
}

function makeContext(projectRoot: string, platforms?: string[]): Context {
    return { opts: { projectRoot, platforms } };
}

let tmpDir: string;
let iosDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-pod-hook-'));
    iosDir = path.join(tmpDir, 'platforms', 'ios');
    fs.mkdirSync(iosDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(cfg: unknown): void {
    fs.writeFileSync(path.join(tmpDir, 'ConnectConfig.json'), JSON.stringify(cfg));
}

function writePodfile(content: string): void {
    fs.writeFileSync(path.join(iosDir, 'Podfile'), content);
}

function readPodfile(): string {
    return fs.readFileSync(path.join(iosDir, 'Podfile'), 'utf8');
}

function writePodsJson(obj: unknown): void {
    fs.writeFileSync(path.join(iosDir, 'pods.json'), JSON.stringify(obj, null, 4));
}

function readPodsJson(): unknown {
    return JSON.parse(fs.readFileSync(path.join(iosDir, 'pods.json'), 'utf8'));
}

function touchXcodeproj(name: string): void {
    fs.mkdirSync(path.join(iosDir, name + '.xcodeproj'), { recursive: true });
}

const DEBUG_CONFIG   = { Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: false } };
const RELEASE_CONFIG = { Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true  } };

// ── platform guard ────────────────────────────────────────────────────────────

describe('platform guard', () => {
    it('skips when platforms list excludes ios', () => {
        writePodfile('ORIGINAL');
        hook(makeContext(tmpDir, ['android']));
        expect(readPodfile()).toBe('ORIGINAL');
    });

    it('runs when platforms list includes ios', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir, ['ios']));
        expect(readPodfile()).not.toBe('OLD');
    });

    it('runs when platforms list is empty (prepare all)', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir, []));
        expect(readPodfile()).not.toBe('OLD');
    });
});

// ── variant selection ─────────────────────────────────────────────────────────

describe('variant selection', () => {
    it('defaults to release when ConnectConfig.json is absent', () => {
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '>= 2.1.51'");
    });

    it('selects debug when useRelease is false', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnectDebug', '>= 2.1.51'");
    });

    it('selects release when useRelease is true', () => {
        writeConfig(RELEASE_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '>= 2.1.51'");
    });

    it('defaults to release and warns when ConnectConfig.json is malformed', () => {
        fs.writeFileSync(path.join(tmpDir, 'ConnectConfig.json'), '{bad json}');
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '>= 2.1.51'");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('parse error'));
        warn.mockRestore();
    });
});

// ── iOSVersion override ───────────────────────────────────────────────────────

describe('iOSVersion override', () => {
    it('pins the exact version when iOSVersion meets the minimum', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: '2.1.60' } });
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.60'");
    });

    it('applies the override to the debug variant too', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: false, iOSVersion: '2.1.52' } });
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnectDebug', '= 2.1.52'");
    });

    it('falls back to the default spec and warns when iOSVersion is below the minimum', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: '2.1.50' } });
        writePodfile('OLD');
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '>= 2.1.51'");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the minimum supported'));
        warn.mockRestore();
    });

    it('falls back to the default spec and warns when iOSVersion is not a valid version string', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: 'latest' } });
        writePodfile('OLD');
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '>= 2.1.51'");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('is not a valid version string'));
        warn.mockRestore();
    });

    it('ignores an empty iOSVersion and uses the default spec', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: '' } });
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '>= 2.1.51'");
    });

    it('accepts a version exactly at the minimum', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: '2.1.51' } });
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.51'");
    });
});

// ── Podfile generation ────────────────────────────────────────────────────────

describe('Podfile generation', () => {
    it('does nothing when Podfile does not exist', () => {
        writeConfig(DEBUG_CONFIG);
        // No Podfile written — hook should not throw
        expect(() => hook(makeContext(tmpDir))).not.toThrow();
    });

    it('writes platform and deployment target', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        const pf = readPodfile();
        expect(pf).toContain("platform :ios, '15.1'");
        expect(pf).toContain("IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'");
    });

    it('declares both the CDN and git Specs sources, and suppresses the master specs warning', () => {
        // The git Specs repo receives new pod versions before they propagate
        // to the CDN — both sources must be listed, and declaring any source
        // disables the implicit CDN default, so install! must suppress the
        // resulting "master specs repo" warning.
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        const pf = readPodfile();
        expect(pf).toContain("source 'https://cdn.cocoapods.org/'");
        expect(pf).toContain("source 'https://github.com/CocoaPods/Specs.git'");
        expect(pf).toContain("install! 'cocoapods', :warn_for_unused_master_specs_repo => false");
    });

    it('lists the Acoustic PodSpecs repo first, ahead of the CocoaPods sources', () => {
        // CocoaPods trunk is read-only from 2 December 2026; later Connect SDK
        // versions are only published to go-acoustic/PodSpecs.
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        const pf = readPodfile();
        const podSpecs = pf.indexOf("source 'https://github.com/go-acoustic/PodSpecs.git'");
        expect(podSpecs).toBeGreaterThan(-1);
        expect(podSpecs).toBeLessThan(pf.indexOf("source 'https://cdn.cocoapods.org/'"));
        expect(podSpecs).toBeLessThan(pf.indexOf("source 'https://github.com/CocoaPods/Specs.git'"));
    });

    it('uses project name from .xcodeproj directory', () => {
        writeConfig(DEBUG_CONFIG);
        touchXcodeproj('MyApp');
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        const pf = readPodfile();
        expect(pf).toContain("target 'MyApp' do");
        expect(pf).toContain("project 'MyApp.xcodeproj'");
    });

    it('falls back to App when no .xcodeproj exists', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("target 'App' do");
    });

    // chmod has no effect on Windows or when running as root (Docker CI).
    // Use it.skip so Jest reports SKIPPED rather than silently PASSED.
    const itWithPermissions =
        process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it;

    itWithPermissions('throws when iosDir exists but is not readable (EPERM)', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        fs.chmodSync(iosDir, 0o000);
        try {
            expect(() => hook(makeContext(tmpDir))).toThrow('cannot read platforms/ios');
        } finally {
            fs.chmodSync(iosDir, 0o755); // restore so afterEach cleanup can delete it
        }
    });

    it('produces identical Podfile content on repeated runs', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        const canonical = readPodfile();
        hook(makeContext(tmpDir));
        expect(readPodfile()).toBe(canonical);
    });
});

// ── pods of other plugins ─────────────────────────────────────────────────────

describe("the pods of the app's other plugins", () => {
    // What cordova-ios writes after another plugin (a push plugin with Firebase) was added next to this one.
    const WITH_FIREBASE = [
        '# DO NOT MODIFY -- auto-generated by Apache Cordova',
        "source 'https://cdn.cocoapods.org/'",
        "platform :ios, '15.1'",
        'use_frameworks!',
        "target 'App' do",
        "\tproject 'App.xcodeproj'",
        "\tpod 'AcousticConnectDebug', '>= 2.1.51'",
        "\tpod 'Firebase/Messaging', '11.8.0'",
        "\tpod 'SomeOtherPod', :git => 'https://example.com/some.git', :tag => '1.2.3'",
        '\t# pod \'Commented\', \'1.0\'',
        "\ttarget 'ConnectNSE' do",
        '\t\tinherit! :search_paths',
        "\t\tpod 'InsideNested', '1.0'",
        '\tend',
        'end',
        '',
    ].join('\n');

    const podLines = (text: string): string[] =>
        text.split('\n').filter((l) => /^\tpod /.test(l));

    it('keeps them, in order, next to the Acoustic pod', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile(WITH_FIREBASE);
        hook(makeContext(tmpDir));
        expect(podLines(readPodfile())).toEqual([
            "\tpod 'AcousticConnectDebug', '>= 2.1.51'",
            "\tpod 'Firebase/Messaging', '11.8.0'",
            "\tpod 'SomeOtherPod', :git => 'https://example.com/some.git', :tag => '1.2.3'",
        ]);
    });

    it('does not keep what only after_prepare.js adds or what is a comment: the nested extension blocks and commented pods', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile(WITH_FIREBASE);
        hook(makeContext(tmpDir));
        const pf = readPodfile();
        expect(pf).not.toContain('InsideNested');
        expect(pf).not.toContain('ConnectNSE');
        expect(pf).not.toContain('Commented');
    });

    it('replaces only the Acoustic pod when the variant or the version changes', () => {
        writeConfig({ Connect: { useRelease: true, iOSVersion: '2.2.2' } });
        writePodfile(WITH_FIREBASE);
        hook(makeContext(tmpDir));
        const pods = podLines(readPodfile());
        expect(pods[0]).toBe("\tpod 'AcousticConnect', '= 2.2.2'");
        expect(pods).toContain("\tpod 'Firebase/Messaging', '11.8.0'");
        expect(readPodfile()).not.toContain('AcousticConnectDebug');
    });

    it('keeps a source another plugin declared in the Podfile, after the Acoustic ones', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile("source 'https://specs.example.com/mirror.git'\nplatform :ios, '15.1'\n");
        hook(makeContext(tmpDir));
        const pf = readPodfile();
        expect(pf).toContain("source 'https://specs.example.com/mirror.git'");
        expect(pf.indexOf("source 'https://github.com/CocoaPods/Specs.git'"))
            .toBeLessThan(pf.indexOf("source 'https://specs.example.com/mirror.git'"));
    });

    it('keeps a source that pods.json lists, once, and the same Podfile on every run', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        writePodsJson({ sources: { 'https://specs.example.com/mirror.git': { source: 'https://specs.example.com/mirror.git', count: 1 } } });
        hook(makeContext(tmpDir));
        const once = readPodfile();
        expect(once.split("source 'https://specs.example.com/mirror.git'")).toHaveLength(2);
        hook(makeContext(tmpDir));
        expect(readPodfile()).toBe(once);
    });

    it('puts back a pod that pods.json lists and the Podfile has already lost', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile("target 'App' do\n\tproject 'App.xcodeproj'\n\tpod 'AcousticConnectDebug', '>= 2.1.51'\nend\n");
        writePodsJson({
            libraries: {
                'Firebase/Messaging': { name: 'Firebase/Messaging', spec: '11.8.0', count: 1 },
                AcousticConnectDebug: { name: 'AcousticConnectDebug', spec: '>= 2.1.51', count: 1 },
                NoSpec: { name: 'NoSpec', spec: '', count: 1 },
            },
        });
        hook(makeContext(tmpDir));
        expect(podLines(readPodfile())).toEqual([
            "\tpod 'AcousticConnectDebug', '>= 2.1.51'",
            "\tpod 'Firebase/Messaging', '11.8.0'",
            "\tpod 'NoSpec'",
        ]);
    });

    it('does not write a pod twice when the Podfile and pods.json both have it', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile(WITH_FIREBASE);
        writePodsJson({ libraries: { 'Firebase/Messaging': { name: 'Firebase/Messaging', spec: '11.8.0', count: 1 } } });
        hook(makeContext(tmpDir));
        expect(readPodfile().match(/Firebase\/Messaging/g)).toHaveLength(1);
    });

    it('writes the same Podfile on every run, whether the pod came from the Podfile or from pods.json', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile(WITH_FIREBASE);
        hook(makeContext(tmpDir));
        const canonical = readPodfile();
        hook(makeContext(tmpDir));
        expect(readPodfile()).toBe(canonical);
        writePodfile('OLD');
        writePodsJson({ libraries: { 'Firebase/Messaging': { name: 'Firebase/Messaging', spec: '11.8.0', count: 1 } } });
        hook(makeContext(tmpDir));
        const fromJson = readPodfile();
        hook(makeContext(tmpDir));
        expect(readPodfile()).toBe(fromJson);
    });

    it('leaves a Podfile with no other pods exactly as it was generated before (the Acoustic pod alone)', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(podLines(readPodfile())).toEqual(["\tpod 'AcousticConnectDebug', '>= 2.1.51'"]);
    });

    it('finds the pods of the app target whatever it is named', () => {
        writeConfig(DEBUG_CONFIG);
        touchXcodeproj('MyApp');
        writePodfile("target 'MyApp' do\n\tproject 'MyApp.xcodeproj'\n\tpod 'Other', '2.0'\nend\n");
        hook(makeContext(tmpDir));
        expect(podLines(readPodfile())).toContain("\tpod 'Other', '2.0'");
    });
});

// ── pods.json sync ────────────────────────────────────────────────────────────

describe('pods.json sync', () => {
    it('does nothing when pods.json does not exist', () => {
        writeConfig(DEBUG_CONFIG);
        expect(() => hook(makeContext(tmpDir))).not.toThrow();
    });

    it('sets the debug pod entry in pods.json', () => {
        writeConfig(DEBUG_CONFIG);
        writePodsJson({ libraries: {} });
        hook(makeContext(tmpDir));
        const libs = (readPodsJson() as any).libraries;
        expect(libs['AcousticConnectDebug']).toEqual({
            name: 'AcousticConnectDebug', spec: '>= 2.1.51', count: 1,
        });
        expect(libs['AcousticConnect']).toBeUndefined();
    });

    it('sets the release pod entry in pods.json', () => {
        writeConfig(RELEASE_CONFIG);
        writePodsJson({ libraries: {} });
        hook(makeContext(tmpDir));
        const libs = (readPodsJson() as any).libraries;
        expect(libs['AcousticConnect']).toEqual({
            name: 'AcousticConnect', spec: '>= 2.1.51', count: 1,
        });
        expect(libs['AcousticConnectDebug']).toBeUndefined();
    });

    it('removes the wrong variant from pods.json', () => {
        writeConfig(RELEASE_CONFIG);
        writePodsJson({ libraries: { AcousticConnectDebug: { name: 'AcousticConnectDebug', spec: '= 2.1.13', count: 1 } } });
        hook(makeContext(tmpDir));
        const libs = (readPodsJson() as any).libraries;
        expect(libs['AcousticConnectDebug']).toBeUndefined();
        expect(libs['AcousticConnect']).toBeDefined();
    });

    it('throws when pods.json is malformed', () => {
        writeConfig(DEBUG_CONFIG);
        fs.writeFileSync(path.join(iosDir, 'pods.json'), '{bad json}');
        expect(() => hook(makeContext(tmpDir))).toThrow('failed to update pods.json');
    });
});
