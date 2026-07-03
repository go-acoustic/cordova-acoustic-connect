/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for src/android/hooks/after_prepare.js
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hook = require('../src/android/hooks/after_prepare.js') as (ctx: unknown) => void;

function makeContext(projectRoot: string, platforms: string[]) {
    return { opts: { projectRoot, platforms } };
}

let tmpDir: string;
let appDir: string;
let assetsDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-android-after-prepare-'));
    appDir = path.join(tmpDir, 'platforms', 'android', 'app');
    assetsDir = path.join(appDir, 'src', 'main', 'assets');
    // Mimic the directory cordova-android's own prepare step would have
    // already created before this hook runs.
    fs.mkdirSync(appDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeGoogleServices(): void {
    fs.writeFileSync(path.join(tmpDir, 'google-services.json'), '{"project_info":{}}', 'utf8');
}

function writeConnectBasicConfig(): void {
    fs.writeFileSync(path.join(tmpDir, 'ConnectBasicConfig.properties'), 'AppKey=k\n', 'utf8');
}

describe('platform guard', () => {
    it('does nothing when platforms excludes android', () => {
        writeGoogleServices();
        hook(makeContext(tmpDir, ['ios']));
        expect(fs.existsSync(path.join(appDir, 'google-services.json'))).toBe(false);
        expect(fs.existsSync(assetsDir)).toBe(false);
    });

    it('runs when platforms includes android', () => {
        writeGoogleServices();
        hook(makeContext(tmpDir, ['android']));
        expect(fs.existsSync(path.join(appDir, 'google-services.json'))).toBe(true);
    });

    it('does nothing when platforms is missing entirely', () => {
        writeGoogleServices();
        hook({ opts: { projectRoot: tmpDir } });
        expect(fs.existsSync(path.join(appDir, 'google-services.json'))).toBe(false);
    });
});

describe('google-services.json', () => {
    it('copies google-services.json into platforms/android/app when present', () => {
        writeGoogleServices();
        hook(makeContext(tmpDir, ['android']));
        expect(fs.readFileSync(path.join(appDir, 'google-services.json'), 'utf8')).toBe(
            '{"project_info":{}}'
        );
    });

    it('warns and does not throw when google-services.json is missing', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => hook(makeContext(tmpDir, ['android']))).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('google-services.json not found'));
        expect(fs.existsSync(path.join(appDir, 'google-services.json'))).toBe(false);
        warn.mockRestore();
    });
});

describe('assets directory', () => {
    it('always creates src/main/assets, even without google-services.json', () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        hook(makeContext(tmpDir, ['android']));
        expect(fs.existsSync(assetsDir)).toBe(true);
        jest.restoreAllMocks();
    });

    it('copies ConnectBasicConfig.properties into assets when present', () => {
        writeGoogleServices();
        writeConnectBasicConfig();
        hook(makeContext(tmpDir, ['android']));
        expect(fs.readFileSync(path.join(assetsDir, 'ConnectBasicConfig.properties'), 'utf8')).toBe(
            'AppKey=k\n'
        );
    });

    it('does not create ConnectBasicConfig.properties in assets when absent', () => {
        writeGoogleServices();
        hook(makeContext(tmpDir, ['android']));
        expect(fs.existsSync(path.join(assetsDir, 'ConnectBasicConfig.properties'))).toBe(false);
    });
});
