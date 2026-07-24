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
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.15'");
    });

    it('selects debug when useRelease is false', () => {
        writeConfig(DEBUG_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnectDebug', '= 2.1.13'");
    });

    it('selects release when useRelease is true', () => {
        writeConfig(RELEASE_CONFIG);
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.15'");
    });

    it('defaults to release and warns when ConnectConfig.json is malformed', () => {
        fs.writeFileSync(path.join(tmpDir, 'ConnectConfig.json'), '{bad json}');
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.15'");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('parse error'));
        warn.mockRestore();
    });
});

// ── iOSVersion override ───────────────────────────────────────────────────────

describe('iOSVersion override', () => {
    it('pins the exact version when iOSVersion meets the minimum', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: '2.1.20' } });
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.20'");
    });

    it('applies the override to the debug variant too', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: false, iOSVersion: '2.1.14' } });
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnectDebug', '= 2.1.14'");
    });

    it('falls back to the default spec and warns when iOSVersion is below the minimum', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: '2.1.12' } });
        writePodfile('OLD');
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.15'");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('below the minimum supported'));
        warn.mockRestore();
    });

    it('falls back to the default spec and warns when iOSVersion is not a valid version string', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: 'latest' } });
        writePodfile('OLD');
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.15'");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('is not a valid version string'));
        warn.mockRestore();
    });

    it('ignores an empty iOSVersion and uses the default spec', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: '' } });
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.15'");
    });

    it('accepts a version exactly at the minimum', () => {
        writeConfig({ Connect: { AppKey: 'k', PostMessageUrl: 'u', useRelease: true, iOSVersion: '2.1.13' } });
        writePodfile('OLD');
        hook(makeContext(tmpDir));
        expect(readPodfile()).toContain("pod 'AcousticConnect', '= 2.1.13'");
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
            name: 'AcousticConnectDebug', spec: '= 2.1.13', count: 1,
        });
        expect(libs['AcousticConnect']).toBeUndefined();
    });

    it('sets the release pod entry in pods.json', () => {
        writeConfig(RELEASE_CONFIG);
        writePodsJson({ libraries: {} });
        hook(makeContext(tmpDir));
        const libs = (readPodsJson() as any).libraries;
        expect(libs['AcousticConnect']).toEqual({
            name: 'AcousticConnect', spec: '= 2.1.15', count: 1,
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
