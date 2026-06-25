/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Fixture-based unit tests for the critical pbxproj / Podfile manipulation
 * helpers in src/ios/hooks/after_prepare.js.
 *
 * The three functions under test perform regex-based text manipulation on
 * pbxproj and Podfile content. Any format change from the xcode npm package
 * or Xcode itself would silently break extension embedding for all consumers,
 * so these tests use representative fixture strings to catch regressions early.
 *
 * Functions are exposed via module.exports._internal — not part of the public API.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Suppress console noise from the helpers under test.
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    jest.restoreAllMocks();
});

const hook = require('../src/ios/hooks/after_prepare.js');
const {
    ensureExtensionsEmbeddedInApp,
    ensureExtensionDependenciesInApp,
    updatePodfile,
    patchXcframeworksScriptPhases,
} = hook._internal as {
    ensureExtensionsEmbeddedInApp:    (p: string, exts: ReadonlyArray<{ name: string }>) => void;
    ensureExtensionDependenciesInApp: (p: string, exts: ReadonlyArray<{ name: string }>) => void;
    updatePodfile:                    (iosDir: string) => boolean;
    patchXcframeworksScriptPhases:    (p: string) => void;
};

// ---------------------------------------------------------------------------
// Fixture UUIDs  (24 uppercase hex chars — matches [0-9A-F]{24})
// ---------------------------------------------------------------------------

const APP_UUID  = 'A1A1A1A1A1A1A1A1A1A1A1A1'; // App native target
const NSE_UUID  = 'B2B2B2B2B2B2B2B2B2B2B2B2'; // ConnectNSE native target
const NCE_UUID  = 'C3C3C3C3C3C3C3C3C3C3C3C3'; // ConnectNCE native target
const NSE_PROD  = 'D4D4D4D4D4D4D4D4D4D4D4D4'; // ConnectNSE.appex productReference
const NCE_PROD  = 'E5E5E5E5E5E5E5E5E5E5E5E5'; // ConnectNCE.appex productReference
const PROJ_UUID = 'F6F6F6F6F6F6F6F6F6F6F6F6'; // Project object (containerPortal)

const EXTENSIONS = [
    { name: 'ConnectNSE' },
    { name: 'ConnectNCE' },
] as const;

// ---------------------------------------------------------------------------
// Minimal pbxproj fixture
//
// Contains App + ConnectNSE + ConnectNCE PBXNativeTarget blocks, empty
// PBXBuildFile and PBXCopyFilesBuildPhase sections, and the PBXProject block.
// This is the "before" state: no embed phase, no target dependencies.
// ---------------------------------------------------------------------------

function makeMinimalPbxproj(): string {
    return [
        '// !$*UTF8*$!',
        '{',
        '\tarchiveVersion = 1;',
        '\tclasses = {',
        '\t};',
        '\tobjectVersion = 56;',
        '\tobjects = {',
        '',
        '/* Begin PBXBuildFile section */',
        '/* End PBXBuildFile section */',
        '',
        '/* Begin PBXCopyFilesBuildPhase section */',
        '/* End PBXCopyFilesBuildPhase section */',
        '',
        '/* Begin PBXNativeTarget section */',
        // App target — no embed phases, empty dependencies
        `\t\t${APP_UUID} /* App */ = {`,
        '\t\t\tisa = PBXNativeTarget;',
        '\t\t\tbuildConfigurationList = A0A0A0A0A0A0A0A0A0A0A0A0;',
        '\t\t\tbuildPhases = (',
        '\t\t\t);',
        '\t\t\tdependencies = (',
        '\t\t\t);',
        '\t\t\tname = App;',
        '\t\t\tproductName = App;',
        '\t\t\tproductReference = A0A0A0A0A0A0A0A0A0A0A0A1 /* App.app */;',
        '\t\t\tproductType = "com.apple.product-type.application";',
        '\t\t};',
        // ConnectNSE extension target
        `\t\t${NSE_UUID} /* ConnectNSE */ = {`,
        '\t\t\tisa = PBXNativeTarget;',
        '\t\t\tbuildConfigurationList = B0B0B0B0B0B0B0B0B0B0B0B0;',
        '\t\t\tbuildPhases = (',
        '\t\t\t);',
        '\t\t\tdependencies = (',
        '\t\t\t);',
        '\t\t\tname = ConnectNSE;',
        '\t\t\tproductName = ConnectNSE;',
        `\t\t\tproductReference = ${NSE_PROD} /* ConnectNSE.appex */;`,
        '\t\t\tproductType = "com.apple.product-type.app-extension";',
        '\t\t};',
        // ConnectNCE extension target
        `\t\t${NCE_UUID} /* ConnectNCE */ = {`,
        '\t\t\tisa = PBXNativeTarget;',
        '\t\t\tbuildConfigurationList = C0C0C0C0C0C0C0C0C0C0C0C0;',
        '\t\t\tbuildPhases = (',
        '\t\t\t);',
        '\t\t\tdependencies = (',
        '\t\t\t);',
        '\t\t\tname = ConnectNCE;',
        '\t\t\tproductName = ConnectNCE;',
        `\t\t\tproductReference = ${NCE_PROD} /* ConnectNCE.appex */;`,
        '\t\t\tproductType = "com.apple.product-type.app-extension";',
        '\t\t};',
        '/* End PBXNativeTarget section */',
        '',
        // PBXProject block — provides the project root UUID used as containerPortal
        '/* Begin PBXProject section */',
        `\t\t${PROJ_UUID} /* Project object */ = {`,
        '\t\t\tisa = PBXProject;',
        '\t\t\tbuildConfigurationList = F0F0F0F0F0F0F0F0F0F0F0F0;',
        '\t\t\ttargets = (',
        `\t\t\t\t${APP_UUID} /* App */,`,
        `\t\t\t\t${NSE_UUID} /* ConnectNSE */,`,
        `\t\t\t\t${NCE_UUID} /* ConnectNCE */,`,
        '\t\t\t);',
        '\t\t};',
        '/* End PBXProject section */',
        '',
        '\t};',
        `\trootObject = ${PROJ_UUID} /* Project object */;`,
        '}',
        '',
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Per-test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let pbxprojPath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-after-prepare-'));
    pbxprojPath = path.join(tmpDir, 'project.pbxproj');
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

// ---------------------------------------------------------------------------
// ensureExtensionsEmbeddedInApp
// ---------------------------------------------------------------------------

describe('ensureExtensionsEmbeddedInApp', () => {
    it('creates a dstSubfolderSpec=13 embed phase when none exists', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionsEmbeddedInApp(pbxprojPath, EXTENSIONS);
        expect(readPbxproj()).toContain('dstSubfolderSpec = 13;');
    });

    it('wires ConnectNSE.appex as a PBXBuildFile in the embed phase', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionsEmbeddedInApp(pbxprojPath, EXTENSIONS);
        const result = readPbxproj();
        expect(result).toContain(`fileRef = ${NSE_PROD}`);
        expect(result).toContain('ConnectNSE.appex in Copy Files');
    });

    it('wires ConnectNCE.appex as a PBXBuildFile in the embed phase', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionsEmbeddedInApp(pbxprojPath, EXTENSIONS);
        const result = readPbxproj();
        expect(result).toContain(`fileRef = ${NCE_PROD}`);
        expect(result).toContain('ConnectNCE.appex in Copy Files');
    });

    it('sets ATTRIBUTES = (RemoveHeadersOnCopy) on the embedded appex build files', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionsEmbeddedInApp(pbxprojPath, EXTENSIONS);
        expect(readPbxproj()).toContain('RemoveHeadersOnCopy');
    });

    it('is idempotent — content unchanged on second run', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionsEmbeddedInApp(pbxprojPath, EXTENSIONS);
        const after1 = readPbxproj();
        ensureExtensionsEmbeddedInApp(pbxprojPath, EXTENSIONS);
        // File must not be rewritten (i.e. content is byte-for-byte identical)
        expect(readPbxproj()).toBe(after1);
    });

    it('no-ops and does not throw when the project has no App target', () => {
        writePbxproj('// empty\n');
        expect(() => ensureExtensionsEmbeddedInApp(pbxprojPath, EXTENSIONS)).not.toThrow();
        // No embed phase injected into a file with no targets
        expect(readPbxproj()).not.toContain('dstSubfolderSpec');
    });
});

// ---------------------------------------------------------------------------
// ensureExtensionDependenciesInApp
// ---------------------------------------------------------------------------

describe('ensureExtensionDependenciesInApp', () => {
    it('creates PBXTargetDependency section and adds App→ConnectNSE dependency', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionDependenciesInApp(pbxprojPath, EXTENSIONS);
        const result = readPbxproj();
        expect(result).toContain('/* Begin PBXTargetDependency section */');
        // The dependency entry must reference the ConnectNSE target UUID
        expect(result).toContain(`target = ${NSE_UUID}`);
        expect(result).toContain('"ConnectNSE"');
    });

    it('adds App→ConnectNCE dependency', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionDependenciesInApp(pbxprojPath, EXTENSIONS);
        const result = readPbxproj();
        expect(result).toContain(`target = ${NCE_UUID}`);
        expect(result).toContain('"ConnectNCE"');
    });

    it('creates PBXContainerItemProxy entries with the project root as containerPortal', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionDependenciesInApp(pbxprojPath, EXTENSIONS);
        const result = readPbxproj();
        expect(result).toContain('/* Begin PBXContainerItemProxy section */');
        expect(result).toContain(`containerPortal = ${PROJ_UUID}`);
    });

    it('injects dependency UUIDs into the App target dependencies list', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionDependenciesInApp(pbxprojPath, EXTENSIONS);
        const result = readPbxproj();

        // Extract the App target block (no nested {} so [^}]* is safe)
        const appBlockMatch = result.match(
            new RegExp(APP_UUID + '\\s*/\\*[^*]*\\*/\\s*=\\s*\\{([^}]*)\\}')
        );
        expect(appBlockMatch).not.toBeNull();
        const appBlock = appBlockMatch![1];

        const depsMatch = appBlock.match(/dependencies\s*=\s*\(([^)]*)\)/);
        expect(depsMatch).not.toBeNull();
        const depUuids = depsMatch![1].match(/[0-9A-F]{24}/g) || [];
        // One PBXTargetDependency UUID per extension must appear in App.dependencies
        expect(depUuids.length).toBeGreaterThanOrEqual(2);
    });

    it('is idempotent — no duplicate dependencies on second run', () => {
        writePbxproj(makeMinimalPbxproj());
        ensureExtensionDependenciesInApp(pbxprojPath, EXTENSIONS);
        const after1 = readPbxproj();
        ensureExtensionDependenciesInApp(pbxprojPath, EXTENSIONS);
        expect(readPbxproj()).toBe(after1);
    });

    it('no-ops and does not throw when the project has no App target', () => {
        writePbxproj('// empty\n');
        expect(() => ensureExtensionDependenciesInApp(pbxprojPath, EXTENSIONS)).not.toThrow();
        expect(readPbxproj()).not.toContain('PBXTargetDependency');
    });
});

// ---------------------------------------------------------------------------
// updatePodfile — NSE / NCE target insertion
//
// Tests the Podfile mutation logic that nests ConnectNSE / ConnectNCE as
// sub-targets of the App target so CocoaPods resolves the host-extension
// relationship correctly.
// ---------------------------------------------------------------------------

describe('updatePodfile — NSE/NCE target insertion', () => {
    function writePodfile(content: string): void {
        fs.writeFileSync(path.join(tmpDir, 'Podfile'), content, 'utf8');
    }

    function readPodfile(): string {
        return fs.readFileSync(path.join(tmpDir, 'Podfile'), 'utf8');
    }

    // Representative Podfile that cordova-ios generates: App target only.
    const BASE_PODFILE = [
        "# DO NOT MODIFY -- auto-generated by Apache Cordova",
        "source 'https://cdn.cocoapods.org/'",
        "install! 'cocoapods', :warn_for_unused_master_specs_repo => false",
        "platform :ios, '15.1'",
        "use_frameworks!",
        "target 'App' do",
        "\tproject 'App.xcodeproj'",
        "\tpod 'AcousticConnectDebug', '>= 2.1.12'",
        "end",
        "",
        "post_install do |installer|",
        "  installer.generated_projects.each do |project|",
        "    project.targets.each do |target|",
        "      target.build_configurations.each do |config|",
        "        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'",
        "      end",
        "    end",
        "  end",
        "end",
        "",
    ].join('\n');

    it("inserts a nested ConnectNSE target inside the App block", () => {
        writePodfile(BASE_PODFILE);
        updatePodfile(tmpDir);
        expect(readPodfile()).toContain("target 'ConnectNSE' do");
    });

    it("inserts a nested ConnectNCE target inside the App block", () => {
        writePodfile(BASE_PODFILE);
        updatePodfile(tmpDir);
        expect(readPodfile()).toContain("target 'ConnectNCE' do");
    });

    it('sets inherit! :search_paths for each extension target', () => {
        writePodfile(BASE_PODFILE);
        updatePodfile(tmpDir);
        const result = readPodfile();
        // Two search_paths declarations — one per extension
        const matches = result.match(/inherit! :search_paths/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('positions NSE/NCE targets after the App target opener and before the outer end', () => {
        writePodfile(BASE_PODFILE);
        updatePodfile(tmpDir);
        const result = readPodfile();
        const posApp = result.indexOf("target 'App' do");
        const posNSE = result.indexOf("target 'ConnectNSE'");
        const posNCE = result.indexOf("target 'ConnectNCE'");
        expect(posNSE).toBeGreaterThan(posApp);
        expect(posNCE).toBeGreaterThan(posApp);
        expect(posNSE).toBeLessThan(posNCE);
    });

    it('returns true when the Podfile was modified', () => {
        writePodfile(BASE_PODFILE);
        expect(updatePodfile(tmpDir)).toBe(true);
    });

    it('is idempotent — returns false and content unchanged on second run', () => {
        writePodfile(BASE_PODFILE);
        updatePodfile(tmpDir);
        const after1 = readPodfile();
        const changed = updatePodfile(tmpDir);
        expect(changed).toBe(false);
        expect(readPodfile()).toBe(after1);
    });
});

// ---------------------------------------------------------------------------
// patchXcframeworksScriptPhases
// ---------------------------------------------------------------------------

describe('patchXcframeworksScriptPhases', () => {
    // The literal string xcode npm writes for the old single-call form.
    const OLD_SCRIPT =
        '"\\\"${PODS_ROOT}/Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks.sh\\\"\\n"';

    const XCFILELIST_SUFFIX =
        'Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks-input-files.xcfilelist';
    const CORRECT_INPUT = '"${PODS_ROOT}/' + XCFILELIST_SUFFIX + '"';

    // Minimal pbxproj snippet with a script build phase.
    function makeScriptPhasePbxproj(shellScript: string, inputPath: string): string {
        return [
            '/* Begin PBXShellScriptBuildPhase section */',
            '\t\tAAAAAAAAAAAAAAAAAAAAAAAA /* [CP] Prepare AcousticConnect xcframeworks */ = {',
            '\t\t\tisa = PBXShellScriptBuildPhase;',
            `\t\t\tinputFileListPaths = (\n\t\t\t\t${inputPath},\n\t\t\t);`,
            `\t\t\tshellScript = ${shellScript};`,
            '\t\t};',
            '/* End PBXShellScriptBuildPhase section */',
            '',
        ].join('\n');
    }

    it('replaces the old single-line shellScript invocation with the locking wrapper', () => {
        writePbxproj(makeScriptPhasePbxproj(OLD_SCRIPT, CORRECT_INPUT));
        patchXcframeworksScriptPhases(pbxprojPath);
        const result = readPbxproj();
        expect(result).not.toContain(OLD_SCRIPT);
        // The wrapper script contains the acoustic locking sentinel
        expect(result).toContain('co.acoustic.xcframeworks.lck');
    });

    it('fixes B1 — unquoted ${PODS_ROOT} xcfilelist path', () => {
        const brokenB1 = '${PODS_ROOT}/' + XCFILELIST_SUFFIX;
        writePbxproj(makeScriptPhasePbxproj(OLD_SCRIPT, brokenB1));
        patchXcframeworksScriptPhases(pbxprojPath);
        const result = readPbxproj();
        expect(result).toContain(CORRECT_INPUT);
        // Unquoted form must be gone (the comma after it is part of the list entry)
        expect(result).not.toContain(brokenB1 + ',');
    });

    it('fixes B3 — quoted path missing the ${PODS_ROOT} prefix', () => {
        const brokenB3 = '"/' + XCFILELIST_SUFFIX + '"';
        writePbxproj(makeScriptPhasePbxproj(OLD_SCRIPT, brokenB3));
        patchXcframeworksScriptPhases(pbxprojPath);
        const result = readPbxproj();
        expect(result).toContain(CORRECT_INPUT);
        expect(result).not.toContain(brokenB3);
    });

    it('is idempotent — no change when shellScript and xcfilelist are already correct', () => {
        // A pbxproj that already has the correct input path and a non-old shellScript.
        // patchXcframeworksScriptPhases should not rewrite the file.
        const already = makeScriptPhasePbxproj('"already-patched-wrapper"', CORRECT_INPUT);
        writePbxproj(already);
        patchXcframeworksScriptPhases(pbxprojPath);
        expect(readPbxproj()).toBe(already);
    });
});
