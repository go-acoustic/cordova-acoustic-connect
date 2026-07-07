/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for the main exported function (module.exports) of
 * src/ios/hooks/after_prepare.js — the internal helpers already have
 * dedicated coverage in after_prepare_helpers.test.ts.
 *
 * Per that file's own header, the pbxproj surgery this hook delegates to
 * add_ios_push_extensions.rb (via `ruby`) plus `pod install` are "tested via
 * integration," not unit-tested — reaching that point requires a full fake
 * Xcode project. This suite instead covers what's cheaply and deterministically
 * testable: the JS-level guards that run BEFORE any shell-out happens
 * (platform check, iosDir existence, and the ConnectConfig.json / config.xml
 * resolution that gates the rest of the hook). `child_process.execSync` is
 * mocked throughout so a broken guard can never accidentally invoke a real
 * `ruby` / `pod install` process during the test run.
 */

jest.mock('child_process', () => ({
    execSync: jest.fn(),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hook = require('../src/ios/hooks/after_prepare.js') as (ctx: unknown) => void;

function makeContext(projectRoot: string, platforms: string[] = ['ios']) {
    return { opts: { projectRoot, platforms } };
}

let tmpDir: string;
let iosDir: string;

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-after-prepare-main-'));
    iosDir = path.join(tmpDir, 'platforms', 'ios');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
});

function writeConfig(cfg: unknown): void {
    fs.writeFileSync(path.join(tmpDir, 'ConnectConfig.json'), JSON.stringify(cfg));
}

function writeConfigXml(widgetId: string | null): void {
    fs.writeFileSync(
        path.join(tmpDir, 'config.xml'),
        widgetId ? `<widget id="${widgetId}"></widget>` : '<widget></widget>'
    );
}

describe('platform / directory guards', () => {
    it('does nothing when platforms excludes ios', () => {
        hook(makeContext(tmpDir, ['android']));
        expect(execSync).not.toHaveBeenCalled();
    });

    it('does nothing when platforms is empty', () => {
        hook(makeContext(tmpDir, []));
        expect(execSync).not.toHaveBeenCalled();
    });

    it('does nothing when platforms/ios does not exist yet', () => {
        hook(makeContext(tmpDir, ['ios']));
        expect(execSync).not.toHaveBeenCalled();
    });
});

describe('ConnectConfig.json / config.xml resolution guard', () => {
    it('warns and skips (without shelling out) when ConnectConfig.json is missing', () => {
        fs.mkdirSync(iosDir, { recursive: true });
        hook(makeContext(tmpDir, ['ios']));

        expect(console.warn).toHaveBeenCalledWith(
            '[after_prepare] Skipping iOS NSE/NCE setup:',
            expect.stringContaining('ConnectConfig.json not found')
        );
        expect(execSync).not.toHaveBeenCalled();
    });

    it('warns and skips when ConnectConfig.json has no iOSAppGroupIdentifier', () => {
        fs.mkdirSync(iosDir, { recursive: true });
        writeConfig({ Connect: { AppKey: 'k' } });
        hook(makeContext(tmpDir, ['ios']));

        expect(console.warn).toHaveBeenCalledWith(
            '[after_prepare] Skipping iOS NSE/NCE setup:',
            expect.stringContaining('iOSAppGroupIdentifier not found')
        );
        expect(execSync).not.toHaveBeenCalled();
    });

    it('warns and skips when config.xml has no widget id, even with a valid ConnectConfig.json', () => {
        fs.mkdirSync(iosDir, { recursive: true });
        writeConfig({ Connect: { iOSAppGroupIdentifier: 'group.com.example.app' } });
        writeConfigXml(null);
        hook(makeContext(tmpDir, ['ios']));

        expect(console.warn).toHaveBeenCalledWith(
            '[after_prepare] Skipping iOS NSE/NCE setup:',
            expect.stringContaining('Cannot find widget id')
        );
        expect(execSync).not.toHaveBeenCalled();
    });

    it('warns and skips when config.xml is entirely missing', () => {
        fs.mkdirSync(iosDir, { recursive: true });
        writeConfig({ Connect: { iOSAppGroupIdentifier: 'group.com.example.app' } });
        hook(makeContext(tmpDir, ['ios']));

        expect(console.warn).toHaveBeenCalledWith(
            '[after_prepare] Skipping iOS NSE/NCE setup:',
            expect.any(String)
        );
        expect(execSync).not.toHaveBeenCalled();
    });
});

describe('project resolution guard', () => {
    it('throws when platforms/ios exists and config resolves, but no .xcodeproj is present', () => {
        fs.mkdirSync(iosDir, { recursive: true });
        writeConfig({ Connect: { iOSAppGroupIdentifier: 'group.com.example.app' } });
        writeConfigXml('com.example.app');

        expect(() => hook(makeContext(tmpDir, ['ios']))).toThrow('No .xcodeproj found');
        expect(execSync).not.toHaveBeenCalled();
    });

    it('logs the resolved iOSDevelopmentTeam before failing later in the setup', () => {
        fs.mkdirSync(iosDir, { recursive: true });
        writeConfig({
            Connect: {
                iOSAppGroupIdentifier: 'group.com.example.app',
                iOSDevelopmentTeam: 'ABCD1234EF',
            },
        });
        writeConfigXml('com.example.app');

        expect(() => hook(makeContext(tmpDir, ['ios']))).toThrow('No .xcodeproj found');
        expect(console.log).toHaveBeenCalledWith('[after_prepare] iOSDevelopmentTeam: ABCD1234EF');
        expect(execSync).not.toHaveBeenCalled();
    });
});
