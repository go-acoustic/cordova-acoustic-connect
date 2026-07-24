/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for scripts/before_prepare_connect_config.js
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hook = require('../scripts/before_prepare_connect_config.js') as (ctx: unknown) => void;

function makeContext(projectRoot: string): unknown {
    return { opts: { projectRoot } };
}

function writeConfig(projectRoot: string, config: unknown): void {
    fs.writeFileSync(path.join(projectRoot, 'ConnectConfig.json'), JSON.stringify(config));
}

function readProperties(projectRoot: string): string {
    return fs.readFileSync(path.join(projectRoot, 'ConnectBasicConfig.properties'), 'utf8');
}

function readNativeConfig(projectRoot: string): {
    useRelease: boolean;
    killSwitchEnabled: boolean;
    killSwitchUrl: string | null;
} {
    return JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'www', 'AcousticConnectNativeConfig.json'), 'utf8')
    );
}

function readJsConfig(projectRoot: string): string {
    return fs.readFileSync(path.join(projectRoot, 'www', 'js', 'connect-config.js'), 'utf8');
}

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-hook-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const VALID_CONFIG = {
    Connect: {
        AppKey: 'testkey123',
        PostMessageUrl: 'https://example.com/collector/collectorPost',
    },
};

describe('missing / malformed ConnectConfig.json', () => {
    it('throws when ConnectConfig.json does not exist', () => {
        expect(() => hook(makeContext(tmpDir))).toThrow('ConnectConfig.json not found');
    });

    it('throws when ConnectConfig.json is not valid JSON', () => {
        fs.writeFileSync(path.join(tmpDir, 'ConnectConfig.json'), '{bad json}');
        expect(() => hook(makeContext(tmpDir))).toThrow('Failed to parse ConnectConfig.json');
    });
});

describe('required field validation', () => {
    it('throws when AppKey is missing', () => {
        writeConfig(tmpDir, { Connect: { PostMessageUrl: 'https://example.com' } });
        expect(() => hook(makeContext(tmpDir))).toThrow('Connect.AppKey is required');
    });

    it('throws when AppKey is an empty string', () => {
        writeConfig(tmpDir, { Connect: { AppKey: '', PostMessageUrl: 'https://example.com' } });
        expect(() => hook(makeContext(tmpDir))).toThrow('Connect.AppKey is required');
    });

    it('throws when PostMessageUrl is missing', () => {
        writeConfig(tmpDir, { Connect: { AppKey: 'key' } });
        expect(() => hook(makeContext(tmpDir))).toThrow('Connect.PostMessageUrl is required');
    });

    it('throws when PostMessageUrl is an empty string', () => {
        writeConfig(tmpDir, { Connect: { AppKey: 'key', PostMessageUrl: '' } });
        expect(() => hook(makeContext(tmpDir))).toThrow('Connect.PostMessageUrl is required');
    });
});

describe('ConnectBasicConfig.properties generation', () => {
    it('writes AppKey and PostMessageUrl', () => {
        writeConfig(tmpDir, VALID_CONFIG);
        hook(makeContext(tmpDir));
        const props = readProperties(tmpDir);
        expect(props).toContain('AppKey=testkey123');
        expect(props).toContain('PostMessageUrl=https://example.com/collector/collectorPost');
    });

    it('writes KillSwitchUrl from config when provided', () => {
        writeConfig(tmpDir, {
            Connect: {
                ...VALID_CONFIG.Connect,
                KillSwitchUrl: 'https://example.com/collector/switch/testkey123',
            },
        });
        hook(makeContext(tmpDir));
        const props = readProperties(tmpDir);
        expect(props).toContain('KillSwitchUrl=https://example.com/collector/switch/testkey123');
    });

    it('writes empty KillSwitchUrl when not in config', () => {
        writeConfig(tmpDir, VALID_CONFIG);
        hook(makeContext(tmpDir));
        const props = readProperties(tmpDir);
        expect(props).toContain('KillSwitchUrl=\n');
    });

    it('ends with a trailing newline', () => {
        writeConfig(tmpDir, VALID_CONFIG);
        hook(makeContext(tmpDir));
        const props = readProperties(tmpDir);
        expect(props.endsWith('\n')).toBe(true);
    });

    it('writes GoogleWebViewEnabled=false to disable Analytics WebView injection', () => {
        writeConfig(tmpDir, VALID_CONFIG);
        hook(makeContext(tmpDir));
        const props = readProperties(tmpDir);
        expect(props).toContain('GoogleWebViewEnabled=false');
    });
});

describe('escapeValue — special characters in property values', () => {
    it('escapes backslashes', () => {
        writeConfig(tmpDir, { Connect: { AppKey: 'key\\path', PostMessageUrl: 'https://x.com' } });
        hook(makeContext(tmpDir));
        expect(readProperties(tmpDir)).toContain('AppKey=key\\\\path');
    });

    it('does not escape colons (valid in values when = is the separator)', () => {
        writeConfig(tmpDir, { Connect: { AppKey: 'key:val', PostMessageUrl: 'https://x.com' } });
        hook(makeContext(tmpDir));
        expect(readProperties(tmpDir)).toContain('AppKey=key:val');
    });

    it('escapes newlines', () => {
        writeConfig(tmpDir, { Connect: { AppKey: 'key\nval', PostMessageUrl: 'https://x.com' } });
        hook(makeContext(tmpDir));
        expect(readProperties(tmpDir)).toContain('AppKey=key\\nval');
    });

    it('escapes carriage returns', () => {
        writeConfig(tmpDir, { Connect: { AppKey: 'key\rval', PostMessageUrl: 'https://x.com' } });
        hook(makeContext(tmpDir));
        expect(readProperties(tmpDir)).toContain('AppKey=key\\rval');
    });

    it('escapes tabs', () => {
        writeConfig(tmpDir, { Connect: { AppKey: 'key\tval', PostMessageUrl: 'https://x.com' } });
        hook(makeContext(tmpDir));
        expect(readProperties(tmpDir)).toContain('AppKey=key\\tval');
    });
});

describe('AcousticConnectNativeConfig.json generation (useRelease, both platforms)', () => {
    it('defaults useRelease to false when omitted', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).useRelease).toBe(false);
    });

    it('writes useRelease=false explicitly', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, useRelease: false } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).useRelease).toBe(false);
    });

    it('writes useRelease=true', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, useRelease: true } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).useRelease).toBe(true);
    });

    it('throws when useRelease is not a boolean', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, useRelease: 'true' } });
        expect(() => hook(makeContext(tmpDir))).toThrow('Connect.useRelease must be a boolean');
    });
});

describe('AcousticConnectNativeConfig.json generation (kill switch, both platforms)', () => {
    it('defaults killSwitchEnabled to false and killSwitchUrl to null when omitted', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect } });
        hook(makeContext(tmpDir));
        const config = readNativeConfig(tmpDir);
        expect(config.killSwitchEnabled).toBe(false);
        expect(config.killSwitchUrl).toBeNull();
    });

    it('writes killSwitchEnabled=true and killSwitchUrl when configured', () => {
        writeConfig(tmpDir, {
            Connect: {
                ...VALID_CONFIG.Connect,
                KillSwitchEnabled: true,
                KillSwitchUrl: 'https://example.com/collector/switch/testkey123',
            },
        });
        hook(makeContext(tmpDir));
        const config = readNativeConfig(tmpDir);
        expect(config.killSwitchEnabled).toBe(true);
        expect(config.killSwitchUrl).toBe('https://example.com/collector/switch/testkey123');
    });

    it('throws when KillSwitchEnabled is not a boolean', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, KillSwitchEnabled: 'true' } });
        expect(() => hook(makeContext(tmpDir))).toThrow('Connect.KillSwitchEnabled must be a boolean');
    });
});

describe('ConnectBasicConfig.properties — KillSwitchEnabled (Android)', () => {
    it('writes KillSwitchEnabled=false by default', () => {
        writeConfig(tmpDir, VALID_CONFIG);
        hook(makeContext(tmpDir));
        expect(readProperties(tmpDir)).toContain('KillSwitchEnabled=false');
    });

    it('writes KillSwitchEnabled=true when configured', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, KillSwitchEnabled: true } });
        hook(makeContext(tmpDir));
        expect(readProperties(tmpDir)).toContain('KillSwitchEnabled=true');
    });
});

describe('connect-config.js generation', () => {
    it('writes window.ConnectBasicConfig with correct fields', () => {
        writeConfig(tmpDir, {
            Connect: {
                AppKey: 'mykey',
                PostMessageUrl: 'https://example.com/post',
                iOSPushMode: 'manual',
                iOSAppGroupIdentifier: 'group.com.example',
                AndroidNotificationIconResName: 'ic_notif',
            },
        });
        hook(makeContext(tmpDir));
        const js = readJsConfig(tmpDir);
        const match = js.match(/window\.ConnectBasicConfig\s*=\s*Object\.freeze\((\{[\s\S]*?\})\);/);
        expect(match).not.toBeNull();
        const obj = JSON.parse(match![1]);
        expect(obj.AppKey).toBe('mykey');
        expect(obj.PostMessageUrl).toBe('https://example.com/post');
        expect(obj.iOSPushMode).toBe('manual');
        expect(obj.iOSAppGroupIdentifier).toBe('group.com.example');
        expect(obj.AndroidIconResName).toBe('ic_notif');
    });

    it('defaults iOSPushMode to automatic when not set', () => {
        writeConfig(tmpDir, VALID_CONFIG);
        hook(makeContext(tmpDir));
        const js = readJsConfig(tmpDir);
        expect(js).toContain('"iOSPushMode": "automatic"');
    });
});
