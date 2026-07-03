/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for src/android/hooks/add_tools_namespace.js
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hook = require('../src/android/hooks/add_tools_namespace.js') as (ctx: unknown) => void;

const TOOLS_ATTR = 'xmlns:tools="http://schemas.android.com/tools"';

function makeContext(projectRoot: string) {
    return { opts: { projectRoot } };
}

let tmpDir: string;
let manifestPath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-tools-ns-'));
    manifestPath = path.join(tmpDir, 'platforms', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeManifest(content: string): void {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, content, 'utf8');
}

function readManifest(): string {
    return fs.readFileSync(manifestPath, 'utf8');
}

const BASE_MANIFEST = [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
    '    package="com.example.app">',
    '    <application></application>',
    '</manifest>',
    '',
].join('\n');

describe('add_tools_namespace', () => {
    it('does nothing when AndroidManifest.xml does not exist', () => {
        expect(() => hook(makeContext(tmpDir))).not.toThrow();
        expect(fs.existsSync(manifestPath)).toBe(false);
    });

    it('adds the tools namespace when absent', () => {
        writeManifest(BASE_MANIFEST);
        hook(makeContext(tmpDir));
        expect(readManifest()).toContain(TOOLS_ATTR);
    });

    it('inserts the attribute immediately after the opening <manifest tag', () => {
        writeManifest(BASE_MANIFEST);
        hook(makeContext(tmpDir));
        expect(readManifest().startsWith('<manifest ' + TOOLS_ATTR)).toBe(true);
    });

    it('preserves the rest of the manifest content', () => {
        writeManifest(BASE_MANIFEST);
        hook(makeContext(tmpDir));
        const result = readManifest();
        expect(result).toContain('xmlns:android="http://schemas.android.com/apk/res/android"');
        expect(result).toContain('package="com.example.app"');
        expect(result).toContain('<application></application>');
    });

    it('is idempotent — does not duplicate the attribute on a second run', () => {
        writeManifest(BASE_MANIFEST);
        hook(makeContext(tmpDir));
        const once = readManifest();
        hook(makeContext(tmpDir));
        expect(readManifest()).toBe(once);
        expect((readManifest().match(new RegExp(TOOLS_ATTR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length).toBe(1);
    });

    it('does not rewrite the file when the tools namespace is already present', () => {
        writeManifest(BASE_MANIFEST.replace('<manifest ', '<manifest ' + TOOLS_ATTR + ' '));
        const before = readManifest();
        hook(makeContext(tmpDir));
        expect(readManifest()).toBe(before);
    });
});
