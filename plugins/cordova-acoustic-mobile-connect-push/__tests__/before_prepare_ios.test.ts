/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for src/ios/hooks/before_prepare.js
 *
 *   1. Fixes unquoted inputFileListPaths in project.pbxproj.
 *   2. Strips ConnectNSE / ConnectNCE from the Podfile when those targets are
 *      not present in the pbxproj.
 *
 * The hook exposes no `_internal` (unlike after_prepare.js), so this suite
 * exercises it end to end via the public `module.exports` function and
 * inspects the resulting files — the same black-box style used in
 * before_prepare_pod.test.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hook = require('../src/ios/hooks/before_prepare.js') as (ctx: unknown) => void;

function makeContext(projectRoot: string, platforms?: string[]) {
    return { opts: { projectRoot, platforms } };
}

let tmpDir: string;
let iosDir: string;
let pbxprojPath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-ios-before-prepare-'));
    iosDir = path.join(tmpDir, 'platforms', 'ios');
    fs.mkdirSync(path.join(iosDir, 'App.xcodeproj'), { recursive: true });
    pbxprojPath = path.join(iosDir, 'App.xcodeproj', 'project.pbxproj');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePbxproj(content: string): void {
    fs.writeFileSync(pbxprojPath, content, 'utf8');
}

function readPbxproj(): string {
    return fs.readFileSync(pbxprojPath, 'utf8');
}

function writePodfile(content: string): void {
    fs.writeFileSync(path.join(iosDir, 'Podfile'), content, 'utf8');
}

function readPodfile(): string {
    return fs.readFileSync(path.join(iosDir, 'Podfile'), 'utf8');
}

const XCFILELIST_SUFFIX =
    'Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks-input-files.xcfilelist';
const CORRECT_INPUT = '"${PODS_ROOT}/' + XCFILELIST_SUFFIX + '"';

function makePbxprojWithInputPath(inputPath: string): string {
    return [
        '/* Begin PBXShellScriptBuildPhase section */',
        `\t\t\tinputFileListPaths = (\n\t\t\t\t${inputPath},\n\t\t\t);`,
        '/* End PBXShellScriptBuildPhase section */',
        '',
    ].join('\n');
}

describe('platform guard', () => {
    it('skips when platforms excludes ios', () => {
        const broken = makePbxprojWithInputPath('${PODS_ROOT}/' + XCFILELIST_SUFFIX);
        writePbxproj(broken);
        hook(makeContext(tmpDir, ['android']));
        expect(readPbxproj()).toBe(broken);
    });

    it('skips when platforms is not an array (e.g. undefined)', () => {
        const broken = makePbxprojWithInputPath('${PODS_ROOT}/' + XCFILELIST_SUFFIX);
        writePbxproj(broken);
        expect(() => hook({ opts: { projectRoot: tmpDir, platforms: undefined } })).not.toThrow();
        expect(readPbxproj()).toBe(broken);
    });

    it('does nothing when platforms/ios does not exist', () => {
        fs.rmSync(iosDir, { recursive: true, force: true });
        expect(() => hook(makeContext(tmpDir, ['ios']))).not.toThrow();
    });

    it('does nothing when no .xcodeproj directory exists', () => {
        fs.rmSync(path.join(iosDir, 'App.xcodeproj'), { recursive: true, force: true });
        expect(() => hook(makeContext(tmpDir, ['ios']))).not.toThrow();
    });
});

describe('pbxproj inputFileListPaths patching', () => {
    it('fixes an unquoted ${PODS_ROOT} xcfilelist path', () => {
        writePbxproj(makePbxprojWithInputPath('${PODS_ROOT}/' + XCFILELIST_SUFFIX));
        hook(makeContext(tmpDir, ['ios']));
        expect(readPbxproj()).toContain(CORRECT_INPUT);
    });

    it('leaves an already-correct quoted path unchanged', () => {
        const already = makePbxprojWithInputPath(CORRECT_INPUT);
        writePbxproj(already);
        hook(makeContext(tmpDir, ['ios']));
        expect(readPbxproj()).toBe(already);
    });
});

describe('Podfile / pbxproj sync', () => {
    const PODFILE_WITH_BOTH_EXTENSIONS = [
        "target 'App' do",
        "\tproject 'App.xcodeproj'",
        "",
        "\ttarget 'ConnectNSE' do",
        "\t\tinherit! :search_paths",
        "\tend",
        "",
        "\ttarget 'ConnectNCE' do",
        "\t\tinherit! :search_paths",
        "\tend",
        "end",
        "",
    ].join('\n');

    it('does nothing when the Podfile does not exist yet', () => {
        writePbxproj('name = "ConnectNSE";\nname = "ConnectNCE";\n');
        expect(() => hook(makeContext(tmpDir, ['ios']))).not.toThrow();
    });

    it('does nothing when the Podfile has neither NSE nor NCE targets', () => {
        writePbxproj('');
        const clean = "target 'App' do\n\tproject 'App.xcodeproj'\nend\n";
        writePodfile(clean);
        hook(makeContext(tmpDir, ['ios']));
        expect(readPodfile()).toBe(clean);
    });

    it('strips ConnectNSE from the Podfile when absent from the pbxproj, keeping ConnectNCE', () => {
        writePbxproj('name = "ConnectNCE";\n'); // only NCE present in pbxproj
        writePodfile(PODFILE_WITH_BOTH_EXTENSIONS);
        hook(makeContext(tmpDir, ['ios']));
        const result = readPodfile();
        expect(result).not.toContain("target 'ConnectNSE' do");
        expect(result).toContain("target 'ConnectNCE' do");
        expect(result).toContain("target 'App' do");
    });

    it('strips both NSE and NCE from the Podfile when neither is present in the pbxproj', () => {
        writePbxproj(''); // neither target registered
        writePodfile(PODFILE_WITH_BOTH_EXTENSIONS);
        hook(makeContext(tmpDir, ['ios']));
        const result = readPodfile();
        expect(result).not.toContain("target 'ConnectNSE' do");
        expect(result).not.toContain("target 'ConnectNCE' do");
        expect(result).toContain("target 'App' do");
    });

    it('leaves the Podfile untouched when both targets are present in the pbxproj', () => {
        writePbxproj('name = "ConnectNSE";\nname = "ConnectNCE";\n');
        writePodfile(PODFILE_WITH_BOTH_EXTENSIONS);
        hook(makeContext(tmpDir, ['ios']));
        expect(readPodfile()).toBe(PODFILE_WITH_BOTH_EXTENSIONS);
    });
});
