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
    locationLoggingEnabled: boolean | null;
    screenCaptureEnabled: boolean | null;
    layoutConfigIos: Record<string, unknown> | null;
    layoutConfigAndroid: Record<string, unknown> | null;
} {
    return JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'www', 'AcousticConnectNativeConfig.json'), 'utf8')
    );
}

function layoutFile(projectRoot: string): string {
    return path.join(projectRoot, 'ConnectLayoutConfig.json');
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
    // The generated file replaces the SDK's own ConnectBasicConfig.properties (an app asset wins
    // over a library asset of the same name), so a key left out of it is lost. Without the
    // capture keys below the Android SDK refused every layout capture (Connect.logScreenLayout
    // returned false and no type 10 was ever sent); with them and an SDK that publishes a WebView
    // layout (11.1.10-beta, CA-157701) the layout arrives. Values are the SDK's defaults.
    it('keeps the SDK default capture settings that the file would otherwise drop', () => {
        writeConfig(tmpDir, VALID_CONFIG);
        hook(makeContext(tmpDir));
        const props = readProperties(tmpDir);
        for (const line of [
            'PrintScreen=3', 'Connection=3', 'MaxStringsLength=300',
            'UseWhiteList=true', 'WhiteListParam=id', 'UseRandomSample=false', 'RandomSampleParam=',
            'ScreenshotFormat=JPG', 'PercentOfScreenshotsSize=40', 'PercentToCompressImage=80',
            'ScreenShotPixelDensity=1.5', 'LogViewLayoutOnScreenTransition=true',
            'GetImageDataOnScreenLayout=false', 'SetGestureDetector=true', 'CaptureNativeGesturesOnWebview=false',
        ]) {
            expect(props).toContain(line + '\n');
        }
    });

    it('does not write the SDK sample values for cookies or location, which would override the plugin and the app', () => {
        writeConfig(tmpDir, VALID_CONFIG);
        hook(makeContext(tmpDir));
        const props = readProperties(tmpDir);
        expect(props).not.toMatch(/^Cookie/m);
        expect(props).not.toMatch(/^LogLocation/m);
    });

    it('writes each key once, so no later line silently overrides an earlier one', () => {
        writeConfig(tmpDir, VALID_CONFIG);
        hook(makeContext(tmpDir));
        const keys = readProperties(tmpDir).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('=')[0]);
        expect(new Set(keys).size).toBe(keys.length);
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

describe('AcousticConnectNativeConfig.json generation (locationLoggingEnabled, both platforms)', () => {
    it('defaults locationLoggingEnabled to null when omitted — plugin does not decide for the app', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).locationLoggingEnabled).toBeNull();
    });

    it('writes locationLoggingEnabled=false when explicitly opted out', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, LocationLoggingEnabled: false } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).locationLoggingEnabled).toBe(false);
    });

    it('writes locationLoggingEnabled=true when explicitly opted in', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, LocationLoggingEnabled: true } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).locationLoggingEnabled).toBe(true);
    });

    it('throws when LocationLoggingEnabled is not a boolean', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, LocationLoggingEnabled: 'false' } });
        expect(() => hook(makeContext(tmpDir))).toThrow('Connect.LocationLoggingEnabled must be a boolean');
    });
});

describe('AcousticConnectNativeConfig.json generation (screenCaptureEnabled, both platforms)', () => {
    it('defaults screenCaptureEnabled to null when omitted — plugin does not decide for the app', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).screenCaptureEnabled).toBeNull();
    });

    it('writes screenCaptureEnabled=false when explicitly opted out', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, ScreenCaptureEnabled: false } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).screenCaptureEnabled).toBe(false);
    });

    it('writes screenCaptureEnabled=true when explicitly opted in', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, ScreenCaptureEnabled: true } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).screenCaptureEnabled).toBe(true);
    });

    it('treats an explicit null as not configured', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, ScreenCaptureEnabled: null } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).screenCaptureEnabled).toBeNull();
    });

    it('throws when ScreenCaptureEnabled is not a boolean', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, ScreenCaptureEnabled: 'false' } });
        expect(() => hook(makeContext(tmpDir))).toThrow('Connect.ScreenCaptureEnabled must be a boolean');
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

describe('layout config (layoutConfig / layoutConfigIos / layoutConfigAndroid)', () => {
    const AUTO = { GlobalScreenSettings: { CaptureLayoutOn: 0, CaptureLayoutDelay: 500 } };

    it('writes null for both platforms when no layout block is configured', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect } });
        hook(makeContext(tmpDir));
        const cfg = readNativeConfig(tmpDir);
        expect(cfg.layoutConfigIos).toBeNull();
        expect(cfg.layoutConfigAndroid).toBeNull();
        expect(fs.existsSync(layoutFile(tmpDir))).toBe(false);
    });

    it('gives both platforms the shared layoutConfig', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, layoutConfig: { AutoLayout: AUTO } } });
        hook(makeContext(tmpDir));
        const cfg = readNativeConfig(tmpDir);
        expect(cfg.layoutConfigIos).toEqual({ AutoLayout: AUTO });
        expect(cfg.layoutConfigAndroid).toEqual({ AutoLayout: AUTO });
    });

    it('gives only the matching platform its own block', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, layoutConfigIos: { AutoLayout: AUTO } } });
        hook(makeContext(tmpDir));
        const cfg = readNativeConfig(tmpDir);
        expect(cfg.layoutConfigIos).toEqual({ AutoLayout: AUTO });
        expect(cfg.layoutConfigAndroid).toBeNull();
    });

    it('deep-merges the platform block over the shared one, replacing arrays outright', () => {
        writeConfig(tmpDir, {
            Connect: {
                ...VALID_CONFIG.Connect,
                layoutConfig: {
                    AutoLayout: {
                        GlobalScreenSettings: {
                            CaptureLayoutDelay: 500,
                            Masking: { MaskIdList: ['a', 'b'], HasMasking: true },
                        },
                    },
                },
                layoutConfigIos: {
                    AutoLayout: {
                        GlobalScreenSettings: {
                            CaptureLayoutDelay: 100,
                            Masking: { MaskIdList: ['c'] },
                        },
                    },
                },
            },
        });
        hook(makeContext(tmpDir));
        const cfg = readNativeConfig(tmpDir);
        expect(cfg.layoutConfigIos).toEqual({
            AutoLayout: {
                GlobalScreenSettings: {
                    CaptureLayoutDelay: 100,
                    Masking: { MaskIdList: ['c'], HasMasking: true },
                },
            },
        });
        // Android has no override: it keeps the shared baseline untouched.
        expect(cfg.layoutConfigAndroid).toEqual({
            AutoLayout: {
                GlobalScreenSettings: {
                    CaptureLayoutDelay: 500,
                    Masking: { MaskIdList: ['a', 'b'], HasMasking: true },
                },
            },
        });
    });

    it('keeps only AutoLayout and AppendMapIds and warns about anything else', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        writeConfig(tmpDir, {
            Connect: {
                ...VALID_CONFIG.Connect,
                layoutConfig: { AutoLayout: AUTO, AppendMapIds: { x: { mid: 'y' } }, Bogus: 1 },
            },
        });
        hook(makeContext(tmpDir));
        const cfg = readNativeConfig(tmpDir);
        expect(cfg.layoutConfigIos).toEqual({ AutoLayout: AUTO, AppendMapIds: { x: { mid: 'y' } } });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Bogus'));
        warn.mockRestore();
    });

    it('treats an explicit null block as not configured', () => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, layoutConfig: null, layoutConfigIos: null } });
        hook(makeContext(tmpDir));
        expect(readNativeConfig(tmpDir).layoutConfigIos).toBeNull();
    });

    it.each([
        ['layoutConfig', 'a string', 'x'],
        ['layoutConfigIos', 'an array', [1]],
        ['layoutConfigAndroid', 'a number', 5],
    ])('throws when %s is %s', (key, _what, value) => {
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, [key]: value } });
        expect(() => hook(makeContext(tmpDir))).toThrow('Connect.' + key + ' must be a JSON object');
    });

    it('does not mutate nested values shared between platforms', () => {
        writeConfig(tmpDir, {
            Connect: {
                ...VALID_CONFIG.Connect,
                layoutConfig: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutDelay: 500 } } },
                layoutConfigAndroid: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutDelay: 1 } } },
            },
        });
        hook(makeContext(tmpDir));
        const cfg = readNativeConfig(tmpDir);
        expect(cfg.layoutConfigIos).toEqual({ AutoLayout: { GlobalScreenSettings: { CaptureLayoutDelay: 500 } } });
        expect(cfg.layoutConfigAndroid).toEqual({ AutoLayout: { GlobalScreenSettings: { CaptureLayoutDelay: 1 } } });
    });

    it('writes the merged Android block to ConnectLayoutConfig.json for the Android asset copy', () => {
        writeConfig(tmpDir, {
            Connect: {
                ...VALID_CONFIG.Connect,
                layoutConfig: { AutoLayout: AUTO },
                layoutConfigAndroid: { AppendMapIds: { x: { mid: 'y' } } },
            },
        });
        hook(makeContext(tmpDir));
        expect(JSON.parse(fs.readFileSync(layoutFile(tmpDir), 'utf8'))).toEqual({
            AutoLayout: AUTO,
            AppendMapIds: { x: { mid: 'y' } },
        });
    });

    it('removes a stale ConnectLayoutConfig.json when the Android block is no longer configured', () => {
        fs.writeFileSync(layoutFile(tmpDir), '{"AutoLayout":{}}');
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect } });
        hook(makeContext(tmpDir));
        expect(fs.existsSync(layoutFile(tmpDir))).toBe(false);
    });

    it('warns that the Android file replaces the SDK layout config when GlobalScreenSettings is missing', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        writeConfig(tmpDir, {
            Connect: { ...VALID_CONFIG.Connect, layoutConfigAndroid: { AppendMapIds: { x: { mid: 'y' } } } },
        });
        hook(makeContext(tmpDir));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('replaces the Android SDK'));
        warn.mockRestore();
    });

    it('does not warn about replacement when the Android block carries GlobalScreenSettings', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        writeConfig(tmpDir, {
            Connect: { ...VALID_CONFIG.Connect, layoutConfigAndroid: { AutoLayout: AUTO } },
        });
        hook(makeContext(tmpDir));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('replaces the Android SDK'));
        warn.mockRestore();
    });

    it('does not warn about replacement when no Android block is configured', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        writeConfig(tmpDir, { Connect: { ...VALID_CONFIG.Connect, layoutConfigIos: { AutoLayout: AUTO } } });
        hook(makeContext(tmpDir));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('replaces the Android SDK'));
        warn.mockRestore();
    });
});
