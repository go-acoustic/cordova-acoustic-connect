/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for src/ios/hooks/select_sdk_variant.js
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hookModule = require('../src/ios/hooks/select_sdk_variant.js') as ((ctx: unknown) => void) & {
    versions: { RELEASE_NAME: string; RELEASE_SPEC: string; DEBUG_NAME: string; DEBUG_SPEC: string };
};
const hook = hookModule;
const { RELEASE_NAME, RELEASE_SPEC, DEBUG_NAME, DEBUG_SPEC } = hookModule.versions;

function makeContext(projectRoot: string, pluginDir?: string) {
    return { opts: { projectRoot, plugin: pluginDir ? { dir: pluginDir } : undefined } };
}

let tmpDir: string;
let pluginDir: string;
let pluginXmlPath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-sdk-variant-'));
    pluginDir = path.join(tmpDir, 'plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    pluginXmlPath = path.join(pluginDir, 'plugin.xml');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeConfig(cfg: unknown): void {
    fs.writeFileSync(path.join(tmpDir, 'ConnectConfig.json'), JSON.stringify(cfg));
}

function writePluginXml(podLine: string): void {
    fs.writeFileSync(
        pluginXmlPath,
        `<plugin>\n    ${podLine}\n</plugin>\n`,
        'utf8'
    );
}

function readPluginXml(): string {
    return fs.readFileSync(pluginXmlPath, 'utf8');
}

// Derived from the hook's own exported constants (not hardcoded) so this
// suite can't silently diverge if RELEASE_SPEC / DEBUG_SPEC change in
// select_sdk_variant.js — see the module-level comment there.
const DEBUG_POD = `<pod name="${DEBUG_NAME}" spec="${DEBUG_SPEC}" />`;
const RELEASE_POD = `<pod name="${RELEASE_NAME}" spec="${RELEASE_SPEC}" />`;

describe('missing plugin dir', () => {
    it('returns without throwing when context.opts.plugin.dir is absent', () => {
        writeConfig({ Connect: { useRelease: true } });
        expect(() => hook(makeContext(tmpDir))).not.toThrow();
    });
});

describe('variant selection', () => {
    it('defaults to debug when ConnectConfig.json is absent', () => {
        writePluginXml(RELEASE_POD);
        hook(makeContext(tmpDir, pluginDir));
        expect(readPluginXml()).toContain(DEBUG_POD);
    });

    it('selects release when useRelease is true', () => {
        writeConfig({ Connect: { useRelease: true } });
        writePluginXml(DEBUG_POD);
        hook(makeContext(tmpDir, pluginDir));
        expect(readPluginXml()).toContain(RELEASE_POD);
    });

    it('selects debug when useRelease is false', () => {
        writeConfig({ Connect: { useRelease: false } });
        writePluginXml(RELEASE_POD);
        hook(makeContext(tmpDir, pluginDir));
        expect(readPluginXml()).toContain(DEBUG_POD);
    });

    it('defaults to debug when useRelease is null', () => {
        writeConfig({ Connect: { useRelease: null } });
        writePluginXml(RELEASE_POD);
        hook(makeContext(tmpDir, pluginDir));
        expect(readPluginXml()).toContain(DEBUG_POD);
    });

    it('defaults to debug when useRelease is absent from the Connect block', () => {
        writeConfig({ Connect: { AppKey: 'k' } });
        writePluginXml(RELEASE_POD);
        hook(makeContext(tmpDir, pluginDir));
        expect(readPluginXml()).toContain(DEBUG_POD);
    });

    it('throws a descriptive error when ConnectConfig.json is malformed', () => {
        fs.writeFileSync(path.join(tmpDir, 'ConnectConfig.json'), '{ not valid json');
        writePluginXml(DEBUG_POD);
        expect(() => hook(makeContext(tmpDir, pluginDir))).toThrow('malformed JSON');
    });
});

describe('idempotency and no-op writes', () => {
    it('does not rewrite plugin.xml when the variant already matches', () => {
        writeConfig({ Connect: { useRelease: false } });
        writePluginXml(DEBUG_POD);
        const before = readPluginXml();
        hook(makeContext(tmpDir, pluginDir));
        expect(readPluginXml()).toBe(before);
    });

    it('produces identical output on repeated runs', () => {
        writeConfig({ Connect: { useRelease: true } });
        writePluginXml(DEBUG_POD);
        hook(makeContext(tmpDir, pluginDir));
        const once = readPluginXml();
        hook(makeContext(tmpDir, pluginDir));
        expect(readPluginXml()).toBe(once);
    });
});
