#!/usr/bin/env node
// Copyright (C) 2026 Acoustic, L.P. All rights reserved.
//
// Cordova after_prepare hook — iOS Rich Push (NSE + NCE)
// Acoustic Connect plugin.
//
// Responsibilities each prepare cycle:
//   1. Copy NSE/NCE source files from plugin src to platform/ios, substituting
//      the CONNECT_APP_GROUP_IDENTIFIER_PLACEHOLDER token.
//   2. Add ConnectNSE / ConnectNCE Xcode targets (idempotent).
//   3. Ensure the Podfile nests ConnectNSE / ConnectNCE under the App target.
//   4. Ensure the host-app entitlements include the App Group.
//   5. Re-run `pod install` only when the Podfile was changed.

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveAppBundleId(projectRoot) {
    const configXml = path.join(projectRoot, 'config.xml');
    const content   = fs.readFileSync(configXml, 'utf8');
    const m = content.match(/<widget\b[^>]*\sid="([^"]+)"/);
    if (!m) throw new Error('Cannot find widget id in config.xml');
    return m[1];
}

function resolveAppGroupIdentifier(projectRoot) {
    const configPath = path.join(projectRoot, 'ConnectConfig.json');
    const config     = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const val = (config.Connect || config).iOSAppGroupIdentifier;
    if (!val) throw new Error('iOSAppGroupIdentifier not found in ConnectConfig.json');
    return val;
}

function resolveProjectName(iosDir) {
    const entries = fs.readdirSync(iosDir);
    const proj    = entries.find(e => e.endsWith('.xcodeproj'));
    if (!proj) throw new Error('No .xcodeproj found in ' + iosDir);
    return proj.replace('.xcodeproj', '');
}

function resolvePluginRoot(projectRoot) {
    // Walk up from projectRoot to find the plugin's src/ios directory.
    const candidates = [
        path.join(projectRoot, 'plugins', 'cordova-acoustic-mobile-connect-push', 'src', 'ios'),
        path.join(projectRoot, '..', 'plugins', 'cordova-acoustic-mobile-connect-push', 'src', 'ios'),
        path.join(__dirname, '..'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    throw new Error('Cannot locate plugin src/ios directory');
}

function buildExtensions(appBundleId) {
    return [
        {
            name:            'ConnectNSE',
            bundleId:        appBundleId + '.ConnectNSE',
            sourceFile:      'NotificationService.swift',
            extensionType:   'com.apple.usernotifications.service',
            productType:     '"com.apple.product-type.app-extension"',
        },
        {
            name:           'ConnectNCE',
            bundleId:       appBundleId + '.ConnectNCE',
            sourceFile:     'NotificationViewController.swift',
            extensionType:  'com.apple.usernotifications.content-extension',
            productType:    '"com.apple.product-type.app-extension"',
            frameworks:     ['UserNotifications.framework', 'UserNotificationsUI.framework'],
        },
    ];
}

// ---------------------------------------------------------------------------
// Source-file copying
// ---------------------------------------------------------------------------

function copyExtensionSources(pluginIosDir, iosDir, appGroupIdentifier, extensions) {
    for (const ext of extensions) {
        const srcDir = path.join(pluginIosDir, ext.name);
        const dstDir = path.join(iosDir, ext.name);
        if (!fs.existsSync(srcDir)) continue;
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

        for (const file of fs.readdirSync(srcDir)) {
            const src = path.join(srcDir, file);
            const dst = path.join(dstDir, file);
            let content = fs.readFileSync(src, 'utf8');

            // Substitute placeholder in .swift and .entitlements
            if (file.endsWith('.swift') || file.endsWith('.entitlements')) {
                content = content.replace(
                    /CONNECT_APP_GROUP_IDENTIFIER_PLACEHOLDER/g,
                    appGroupIdentifier
                );
            }
            fs.writeFileSync(dst, content, 'utf8');
        }
    }
}

// ---------------------------------------------------------------------------
// Xcode project manipulation
// ---------------------------------------------------------------------------

function targetExistsByName(proj, name) {
    const section = proj.pbxNativeTargetSection();
    return Object.values(section).some(t => {
        if (!t || !t.name) return false;
        return t.name.replace(/"/g, '') === name;
    });
}

function getTargetUuidByName(proj, name) {
    const section = proj.pbxNativeTargetSection();
    for (const [uuid, t] of Object.entries(section)) {
        if (uuid.endsWith('_comment') || !t || !t.name) continue;
        if (t.name.replace(/"/g, '') === name) return uuid;
    }
    return null;
}

// Idempotently ensure the extension target has a Sources build phase and that
// the required swift file is in it.  Creates the phase if absent (xcode npm's
// addTarget for app_extension never creates one).  Skips if the file is already
// present so repeated prepare runs don't duplicate entries.
function ensureExtensionSourceInSources(proj, targetUuid, relPath) {
    const pbx      = proj.hash.project.objects;
    const target   = (pbx.PBXNativeTarget || {})[targetUuid];
    if (!target) return;
    const basename = path.basename(relPath);

    // Find existing Sources phase; create one if missing.
    let sourcesPhaseUuid = null;
    for (const ph of (target.buildPhases || [])) {
        if ((pbx.PBXSourcesBuildPhase || {})[ph.value]) { sourcesPhaseUuid = ph.value; break; }
    }
    if (!sourcesPhaseUuid) {
        const result = proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
        sourcesPhaseUuid = result.uuid;
    }
    const sourcesPhase = pbx.PBXSourcesBuildPhase[sourcesPhaseUuid];

    // Skip if the file is already in the phase.
    const alreadyPresent = (sourcesPhase.files || []).some(f => {
        const bf = (pbx.PBXBuildFile || {})[f.value];
        if (!bf) return false;
        const fr = (pbx.PBXFileReference || {})[bf.fileRef];
        return fr && (fr.path || '').toString().replace(/"/g, '') === relPath;
    });
    if (alreadyPresent) return;

    const fileUuid = proj.generateUuid();
    const bfUuid   = proj.generateUuid();
    pbx.PBXFileReference = pbx.PBXFileReference || {};
    pbx.PBXFileReference[fileUuid] = {
        isa:               'PBXFileReference',
        fileEncoding:      4,
        lastKnownFileType: 'sourcecode.swift',
        path:              relPath,
        sourceTree:        'SOURCE_ROOT',
    };
    pbx.PBXFileReference[fileUuid + '_comment'] = basename;

    pbx.PBXBuildFile = pbx.PBXBuildFile || {};
    pbx.PBXBuildFile[bfUuid] = { isa: 'PBXBuildFile', fileRef: fileUuid, settings: {} };
    pbx.PBXBuildFile[bfUuid + '_comment'] = basename + ' in Sources';

    sourcesPhase.files = sourcesPhase.files || [];
    sourcesPhase.files.push({ value: bfUuid, comment: basename + ' in Sources' });
}

// Link a system framework into a target's PBXFrameworksBuildPhase (idempotent).
// Reuses any existing PBXFileReference for the framework already in the project;
// otherwise creates one pointing to System/Library/Frameworks/<name>.
function addFrameworkToTarget(proj, targetUuid, frameworkName) {
    const pbx = proj.hash.project.objects;

    // Reuse an existing PBXFileReference for this framework if present.
    let fileRefUuid = null;
    for (const [uuid, ref] of Object.entries(pbx.PBXFileReference || {})) {
        if (uuid.endsWith('_comment') || !ref) continue;
        if ((ref.name || '').replace(/"/g, '') === frameworkName) {
            fileRefUuid = uuid;
            break;
        }
    }
    if (!fileRefUuid) {
        fileRefUuid = proj.generateUuid();
        pbx.PBXFileReference = pbx.PBXFileReference || {};
        pbx.PBXFileReference[fileRefUuid] = {
            isa:               'PBXFileReference',
            lastKnownFileType: 'wrapper.framework',
            name:              frameworkName,
            path:              'System/Library/Frameworks/' + frameworkName,
            sourceTree:        'SDKROOT',
        };
        pbx.PBXFileReference[fileRefUuid + '_comment'] = frameworkName;
    }

    const target = (pbx.PBXNativeTarget || {})[targetUuid];
    if (!target) return;

    for (const ph of (target.buildPhases || [])) {
        const fwPhase = (pbx.PBXFrameworksBuildPhase || {})[ph.value];
        if (!fwPhase) continue;

        // Idempotent: skip if already linked.
        const alreadyLinked = (fwPhase.files || []).some(fRef => {
            const bf = (pbx.PBXBuildFile || {})[fRef.value];
            return bf && bf.fileRef === fileRefUuid;
        });
        if (alreadyLinked) return;

        const bfUuid = proj.generateUuid();
        pbx.PBXBuildFile = pbx.PBXBuildFile || {};
        pbx.PBXBuildFile[bfUuid] = { isa: 'PBXBuildFile', fileRef: fileRefUuid, settings: {} };
        pbx.PBXBuildFile[bfUuid + '_comment'] = frameworkName + ' in Frameworks';

        fwPhase.files = fwPhase.files || [];
        fwPhase.files.push({ value: bfUuid, comment: frameworkName + ' in Frameworks' });
        console.log('[after_prepare] addFrameworkToTarget: linked ' + frameworkName + ' → ' + targetUuid);
        return;
    }
}

function setBuildSettingsForTarget(proj, targetUuid, settings) {
    const pbx = proj.hash.project.objects;
    const target = pbx.PBXNativeTarget[targetUuid];
    if (!target) return;
    const cfgList = pbx.XCConfigurationList[target.buildConfigurationList];
    if (!cfgList) return;
    for (const cfgRef of (cfgList.buildConfigurations || [])) {
        const cfg = pbx.XCBuildConfiguration[cfgRef.value];
        if (!cfg) continue;
        cfg.buildSettings = cfg.buildSettings || {};
        Object.assign(cfg.buildSettings, settings);
    }
}

// Serialized wrapper script written by addXcframeworksScriptPhase into NSE/NCE phases.
// Uses atomic mkdir (macOS has no flock) to prevent concurrent rsync race when both
// extension targets run the xcframeworks extraction script in parallel.
const XCFRAMEWORKS_WRAPPER_SCRIPT = [
    '#!/bin/sh',
    'DEST="${PODS_XCFRAMEWORKS_BUILD_DIR}/AcousticConnectDebug/Core"',
    'LOCK="${TMPDIR}/co.acoustic.xcframeworks.lck"',
    'if [ -d "${DEST}/Connect.framework" ] && [ -d "${DEST}/Tealeaf.framework" ] && [ -d "${DEST}/EOCore.framework" ]; then',
    '  exit 0',
    'fi',
    'if mkdir "${LOCK}" 2>/dev/null; then',
    '  "${PODS_ROOT}/Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks.sh"',
    '  rmdir "${LOCK}" 2>/dev/null',
    'else',
    '  I=0',
    '  while [ -d "${LOCK}" ] && [ $I -lt 120 ]; do',
    '    sleep 0.5',
    '    I=$((I + 1))',
    '  done',
    'fi',
    '',
].join('\n');

// Build the pbxproj shellScript literal: newlines → \n, quotes → \"
function encodePbxprojShellScript(script) {
    const body = script.replace(/\n/g, '\\n').replace(/"/g, '\\"');
    return '"' + body + '"';
}

// Raw value the xcode npm package writes for the old single-line invocation.
const XCFRAMEWORKS_OLD_SHELLSCRIPT =
    '"\\\"${PODS_ROOT}/Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks.sh\\\"\\n"';

// After addXcodeTargets writes the pbxproj via xcode npm package, replace any
// single-line xcframeworks shellScript value with the serialized wrapper.
// This is necessary because the xcode package cannot reliably round-trip
// multi-line shell scripts with $ variable references.
function patchXcframeworksScriptPhases(pbxprojPath) {
    let content = fs.readFileSync(pbxprojPath, 'utf8');
    let changed = false;

    // 1. Replace bare xcframeworks.sh shellScript with the serialized locking wrapper.
    //    The xcode npm package cannot reliably round-trip multi-line scripts with
    //    $ variable references, so we do it here as a string replacement.
    const newShellScript = encodePbxprojShellScript(XCFRAMEWORKS_WRAPPER_SCRIPT);
    if (!content.includes(newShellScript)) {
        const patched = content.split(XCFRAMEWORKS_OLD_SHELLSCRIPT).join(newShellScript);
        if (patched !== content) { content = patched; changed = true; }
    }

    // 2. Fix inputFileListPaths: ensure the path is correctly quoted with ${PODS_ROOT} prefix.
    //    Three broken forms can appear after writeSync():
    //      B1 – unquoted with prefix: ${PODS_ROOT}/Target Support Files/...xcfilelist,
    //           (xcode npm omits quotes when the JS value didn't include them)
    //      B2 – Xcode tokenises the unquoted B1 at the first space, so ${PODS_ROOT} alone
    //           becomes the entry and the rest is lost, expanding to /Target Support Files/...
    //      B3 – quoted without prefix: "/Target Support Files/...xcfilelist"
    //    All broken forms are replaced with the single correct form:
    //      "${PODS_ROOT}/Target Support Files/...xcfilelist"
    //    Strategy: use a placeholder to protect already-correct occurrences, fix every
    //    other occurrence, then restore. This avoids broken regexes with literal $ chars.
    const XCFILELIST_SUFFIX =
        'Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks-input-files.xcfilelist';
    const CORRECT_INPUT = '"${PODS_ROOT}/' + XCFILELIST_SUFFIX + '"';
    const PLACEHOLDER = '\x00XCFILELIST\x00';

    let pi = content.split(CORRECT_INPUT).join(PLACEHOLDER);           // protect correct form
    pi = pi.split('${PODS_ROOT}/' + XCFILELIST_SUFFIX).join(PLACEHOLDER); // fix B1 (unquoted)
    // Fix B2/B3: any remaining occurrence of the suffix with optional leading / or quotes
    pi = pi.replace(
        new RegExp('"?/?' + XCFILELIST_SUFFIX.replace(/\//g, '\\/').replace(/\./g, '\\.') + '"?', 'g'),
        PLACEHOLDER
    );
    const fixedInput = pi.split(PLACEHOLDER).join(CORRECT_INPUT);
    if (fixedInput !== content) { content = fixedInput; changed = true; }

    if (changed) {
        fs.writeFileSync(pbxprojPath, content, 'utf8');
    }
}

function addXcframeworksScriptPhase(proj, targetUuid) {
    // xcode package placeholder — patchXcframeworksScriptPhases() rewrites this
    // to the serialized wrapper after writeSync().
    const shellScript =
        '"\\\"${PODS_ROOT}/Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks.sh\\\"\\n"';

    const pbx    = proj.hash.project.objects;
    const target = pbx.PBXNativeTarget[targetUuid];
    if (!target) return;

    // Idempotency check
    const alreadyHas = (target.buildPhases || []).some(ph => {
        const sp = pbx.PBXShellScriptBuildPhase
            ? pbx.PBXShellScriptBuildPhase[ph.value]
            : null;
        return sp && sp.name && sp.name.includes('AcousticConnect xcframeworks');
    });
    if (alreadyHas) return;

    const phaseUuid = proj.generateUuid();
    // Include surrounding quotes so xcode npm writes the quoted form directly.
    // Without quotes xcode npm omits them, Xcode tokenises at the first space and
    // ${PODS_ROOT} is lost, expanding the path to /Target Support Files/... at build time.
    const inputListPath =
        '"${PODS_ROOT}/Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks-input-files.xcfilelist"';

    pbx.PBXShellScriptBuildPhase = pbx.PBXShellScriptBuildPhase || {};
    pbx.PBXShellScriptBuildPhase[phaseUuid] = {
        isa:                  'PBXShellScriptBuildPhase',
        buildActionMask:      2147483647,
        files:                [],
        inputFileListPaths:   [inputListPath],
        inputPaths:           [],
        name:                 '"[CP] Prepare AcousticConnect xcframeworks"',
        outputFileListPaths:  [],
        outputPaths:          [],
        runOnlyForDeploymentPostprocessing: 0,
        shellPath:            '/bin/sh',
        shellScript:          shellScript,
        showEnvVarsInLog:     0,
    };
    pbx.PBXShellScriptBuildPhase[phaseUuid + '_comment'] =
        '[CP] Prepare AcousticConnect xcframeworks';

    // Insert BEFORE Sources phase (index 1 so it's after the CocoaPods manifest check)
    const phases = target.buildPhases || [];
    const sourcesIdx = phases.findIndex(ph => {
        return pbx.PBXSourcesBuildPhase && pbx.PBXSourcesBuildPhase[ph.value];
    });
    const insertAt = sourcesIdx >= 0 ? sourcesIdx : 0;
    phases.splice(insertAt, 0, {
        value:   phaseUuid,
        comment: '[CP] Prepare AcousticConnect xcframeworks',
    });
    target.buildPhases = phases;
}

// Remove non-extension source files Cordova's plugin-add injects into NSE/NCE.
function purgeExtensionSourcesPhase(proj, extName, allowedSwiftBasename) {
    const pbx    = proj.hash.project.objects;
    const target = Object.values(pbx.PBXNativeTarget || {})
        .find(t => t && t.name && t.name.replace(/"/g, '') === extName);
    if (!target) return false;

    let removed = false;
    for (const phRef of (target.buildPhases || [])) {
        const phase = (pbx.PBXSourcesBuildPhase || {})[phRef.value];
        if (!phase) continue;
        const before = (phase.files || []).length;
        phase.files = (phase.files || []).filter(fRef => {
            const bf = (pbx.PBXBuildFile || {})[fRef.value];
            if (!bf) return true;
            const fr = (pbx.PBXFileReference || {})[bf.fileRef];
            if (!fr) return true;
            const filePath = (fr.path || '').replace(/"/g, '');
            const basename = path.basename(filePath);
            // Keep ONLY the single allowed source file for this extension.
            // Remove everything else — Cordova's plugin add injects plugin ObjC
            // and Swift files into ALL targets including NSE/NCE.
            return basename === allowedSwiftBasename;
        });
        if (phase.files.length !== before) removed = true;
    }
    return removed;
}

// Ensure every extension's product (.appex) is embedded in the App target.
//
// xcode npm 3.0.1's addTarget('ConnectNSE', 'app_extension') calls
// addToPbxCopyfilesBuildPhase(productFile) where productFile.target is the
// new EXTENSION uuid. buildPhaseObject() looks for a 'Copy Files' phase in
// the extension's buildPhases; finding none, it falls back to "first 'Copy
// Files' phase in the section" — which is non-deterministic when multiple
// extensions are added.  We fix this by directly verifying and wiring each
// extension product into App's embed phase after writeSync().
function ensureExtensionsEmbeddedInApp(pbxprojPath, extensions) {
    let content = fs.readFileSync(pbxprojPath, 'utf8');
    let changed = false;

    // All helpers work directly on the pbxproj text after writeSync().
    //
    // Layout note: in a PBXNativeTarget block, `buildPhases = (...)` comes
    // BEFORE `name = TargetName;`.  Anchoring by UUID avoids the trap of
    // matching from `name = …` and overshooting into the wrong target.

    // Returns the UUID of the PBXNativeTarget whose header comment matches targetName.
    // Requires `isa = PBXNativeTarget;` immediately inside the block so we never
    // match a PBXGroup that happens to share the same name.
    function findTargetUuid(targetName) {
        const re = new RegExp(
            '([0-9A-F]{24})\\s*\\/\\*\\s*' + targetName + '\\s*\\*\\/\\s*=\\s*\\{[^}]*isa\\s*=\\s*PBXNativeTarget\\s*;'
        );
        const m = content.match(re);
        return m ? m[1] : null;
    }

    // Returns the PBXNativeTarget block content for the given UUID.
    // PBXNativeTarget blocks contain no nested { } so [^}]* is safe.
    function getTargetBlock(targetUuid) {
        const re = new RegExp(
            targetUuid + '\\s*\\/\\*[^*]*\\*\\/\\s*=\\s*\\{([^}]*)\\}'
        );
        const m = content.match(re);
        return m ? m[1] : null;
    }

    // Returns the UUIDs listed in the target's buildPhases = (...).
    function getBuildPhaseUuids(targetBlock) {
        const m = targetBlock.match(/buildPhases\s*=\s*\(([^)]*)\)/);
        if (!m) return [];
        return m[1].match(/[0-9A-F]{24}/g) || [];
    }

    // Returns the productReference UUID for an extension target block.
    function getProductRef(targetBlock) {
        const m = targetBlock.match(/productReference\s*=\s*([0-9A-F]{24})\s*\/\*[^*]*\.appex\s*\*\//);
        return m ? m[1] : null;
    }

    // Returns all PBXCopyFilesBuildPhase UUIDs with dstSubfolderSpec == 13.
    function getCopyFilesPhase13Uuids() {
        const uuids = [];
        // Each phase block has no nested {} so [^}]* is safe.
        const re = /([0-9A-F]{24})\s*\/\*[^*]*Copy Files[^*]*\*\/\s*=\s*\{[^}]*dstSubfolderSpec\s*=\s*13\s*;[^}]*\}/g;
        let m;
        while ((m = re.exec(content)) !== null) uuids.push(m[1]);
        return uuids;
    }

    // Returns true if any PBXBuildFile that references productRefUuid appears
    // inside one of the given Copy Files phases.
    function buildFileExistsForRef(productRefUuid, copyPhaseUuids) {
        for (const phaseUuid of copyPhaseUuids) {
            const phaseRe = new RegExp(phaseUuid + '\\s*\\/\\*[^*]*\\*\\/\\s*=\\s*\\{([^}]*)\\}');
            const phaseMatch = content.match(phaseRe);
            if (!phaseMatch) continue;
            const phaseBlock = phaseMatch[1];
            const fileRefs = phaseBlock.match(/[0-9A-F]{24}(?=\s*\/\*[^*]*in Copy Files)/g) || [];
            for (const bfUuid of fileRefs) {
                // pbxproj format: UUID /* comment */ = {isa = PBXBuildFile; fileRef = UUID /* comment */; ...}
                // Allow optional comment between the fileRef UUID and the semicolon.
                const bfRe = new RegExp(bfUuid + '[^=]*=\\s*\\{[^}]*fileRef\\s*=\\s*' + productRefUuid + '[^;]*;');
                if (bfRe.test(content)) return true;
            }
        }
        return false;
    }

    function generateUuid() {
        let u = '';
        for (let i = 0; i < 24; i++) u += Math.floor(Math.random() * 16).toString(16).toUpperCase();
        return u;
    }

    // Add embedPhaseUuid to App target's buildPhases list.
    function addPhaseToAppTarget(appTargetUuid, embedPhaseUuid) {
        // Locate the App target block by UUID and add the phase UUID to its buildPhases.
        const anchorRe = new RegExp(
            '(' + appTargetUuid + '\\s*\\/\\*[^*]*\\*\\/\\s*=\\s*\\{[^}]*buildPhases\\s*=\\s*\\()[^)]*(\\))'
        );
        content = content.replace(anchorRe, (match, _open, close) =>
            match.replace(close, '\t\t\t\t' + embedPhaseUuid + ' /* Copy Files */,\n\t\t\t' + close)
        );
    }

    // Gather App's embed (dstSubfolderSpec=13) Copy Files phases.
    const appTargetUuid  = findTargetUuid('App');
    if (!appTargetUuid) return; // no App target — nothing to do

    const appBlock       = getTargetBlock(appTargetUuid);
    if (!appBlock) return;

    const appPhaseUuids  = getBuildPhaseUuids(appBlock);
    const allPhase13     = getCopyFilesPhase13Uuids();
    const appPhase13     = allPhase13.filter(u => appPhaseUuids.includes(u));

    for (const ext of extensions) {
        const extTargetUuid = findTargetUuid(ext.name);
        if (!extTargetUuid) continue; // extension not added yet

        const extBlock   = getTargetBlock(extTargetUuid);
        if (!extBlock) continue;

        const productRef = getProductRef(extBlock);
        if (!productRef) continue;

        if (buildFileExistsForRef(productRef, appPhase13)) continue; // already wired ✓

        // Ensure there is at least one dstSubfolderSpec=13 phase in App's buildPhases.
        let embedPhaseUuid = appPhase13[0];
        if (!embedPhaseUuid) {
            embedPhaseUuid = generateUuid();
            const newPhase =
                '\t\t' + embedPhaseUuid + ' /* Copy Files */ = {\n' +
                '\t\t\tisa = PBXCopyFilesBuildPhase;\n' +
                '\t\t\tbuildActionMask = 2147483647;\n' +
                '\t\t\tdstPath = "";\n' +
                '\t\t\tdstSubfolderSpec = 13;\n' +
                '\t\t\tfiles = (\n' +
                '\t\t\t);\n' +
                '\t\t\trunOnlyForDeploymentPostprocessing = 0;\n' +
                '\t\t};\n';
            content = content.replace(
                '/* End PBXCopyFilesBuildPhase section */',
                newPhase + '/* End PBXCopyFilesBuildPhase section */'
            );
            addPhaseToAppTarget(appTargetUuid, embedPhaseUuid);
            appPhase13.push(embedPhaseUuid);
            changed = true;
        }

        // Create a PBXBuildFile entry for the extension product.
        const bfUuid = generateUuid();
        const bfLine =
            '\t\t' + bfUuid + ' /* ' + ext.name + '.appex in Copy Files */ = ' +
            '{isa = PBXBuildFile; fileRef = ' + productRef +
            ' /* ' + ext.name + '.appex */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };\n';
        content = content.replace(
            '/* End PBXBuildFile section */',
            bfLine + '/* End PBXBuildFile section */'
        );

        // Add the build file UUID into the embed phase's files list.
        const phaseRe = new RegExp(
            '(' + embedPhaseUuid + '\\s*\\/\\*[^*]*\\*\\/\\s*=\\s*\\{[^}]*files\\s*=\\s*\\()([^)]*)(\\);)'
        );
        content = content.replace(phaseRe, (_match, open, inner, close) =>
            open + inner + '\t\t\t\t' + bfUuid + ' /* ' + ext.name + '.appex in Copy Files */,\n\t\t\t' + close
        );

        console.log('[after_prepare] ensureExtensionsEmbeddedInApp: wired ' + ext.name + '.appex into App embed phase');
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(pbxprojPath, content, 'utf8');
    }
}

// Remove duplicate .appex entries from any Copy Files phase in App target.
function deduplicateCopyFilesPhases(proj) {
    const pbx     = proj.hash.project.objects;
    const appTgt  = Object.values(pbx.PBXNativeTarget || {})
        .find(t => t && t.name && t.name.replace(/"/g, '') === 'App');
    if (!appTgt) return;

    // Collect all appex Copy Files phases
    const copyPhases = (appTgt.buildPhases || [])
        .map(ph => ({ ref: ph, phase: (pbx.PBXCopyFilesBuildPhase || {})[ph.value] }))
        .filter(p => p.phase && p.phase.dstSubfolderSpec == 13); // 13 = PlugIns

    const seenAppex = new Set();
    for (const { phase } of copyPhases) {
        phase.files = (phase.files || []).filter(fRef => {
            const bf = (pbx.PBXBuildFile || {})[fRef.value];
            if (!bf) return true;
            const fr = (pbx.PBXFileReference || {})[bf.fileRef];
            if (!fr) return true;
            const filePath = (fr.path || '').replace(/"/g, '');
            if (filePath.endsWith('.appex')) {
                if (seenAppex.has(filePath)) return false;
                seenAppex.add(filePath);
            }
            return true;
        });
    }
}

// Ensure ConnectPlugin.swift is compiled by the App target.
//
// On a fresh git checkout Cordova's "already installed" short-circuit means the
// plugin source files are never copied to platforms/ios/App/Plugins/.  This
// function is self-contained: it copies missing files from the plugin src tree,
// creates missing PBXFileReference entries, and adds missing PBXBuildFile entries
// to the App Sources phase — so `cordova prepare ios` always produces a working
// Xcode project regardless of checkout history.
function ensurePluginFilesInAppSources(proj, pluginIosDir, iosDir) {
    const pbx = proj.hash.project.objects;
    const appTarget = Object.values(pbx.PBXNativeTarget || {})
        .find(t => t && t.name && t.name.replace(/"/g, '') === 'App');
    if (!appTarget) return;

    // Find App target's Sources phase
    let sourcesPhase = null;
    for (const ph of (appTarget.buildPhases || [])) {
        const sp = (pbx.PBXSourcesBuildPhase || {})[ph.value];
        if (sp) { sourcesPhase = sp; break; }
    }
    if (!sourcesPhase) return;

    const pluginId  = 'co.acoustic.connect.push';
    const pluginDst = path.join(iosDir, 'App', 'Plugins', pluginId);

    const compileFiles = [
        { name: 'ConnectPlugin.swift', fileType: 'sourcecode.swift' },
    ];
    const allFiles = compileFiles.map(f => f.name);

    // Copy any missing source files from the plugin src tree.
    if (!fs.existsSync(pluginDst)) fs.mkdirSync(pluginDst, { recursive: true });
    for (const fname of allFiles) {
        const src = path.join(pluginIosDir, fname);
        const dst = path.join(pluginDst, fname);
        if (!fs.existsSync(dst) && fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
        }
    }

    let added = false;
    for (const { name, fileType } of compileFiles) {
        // Path as stored in the pbxproj (relative to SRCROOT = platforms/ios/).
        const pbxRelPath = 'App/Plugins/' + pluginId + '/' + name;

        // Find or create PBXFileReference — check by path first, then by name.
        let fileRefUuid = Object.keys(pbx.PBXFileReference || {}).find(k => {
            if (k.endsWith('_comment')) return false;
            const fr = pbx.PBXFileReference[k];
            return fr && (fr.path || '').replace(/"/g, '') === pbxRelPath;
        });
        if (!fileRefUuid) {
            const byName = Object.entries(pbx.PBXFileReference || {}).find(([k, fr]) =>
                !k.endsWith('_comment') && fr && (fr.name || '').replace(/"/g, '') === name
            );
            fileRefUuid = byName ? byName[0] : null;
        }
        if (!fileRefUuid) {
            fileRefUuid = proj.generateUuid();
            pbx.PBXFileReference = pbx.PBXFileReference || {};
            const q = s => /[+\s]/.test(s) ? '"' + s + '"' : s;
            pbx.PBXFileReference[fileRefUuid] = {
                isa:               'PBXFileReference',
                fileEncoding:      4,
                lastKnownFileType: fileType,
                name:              q(name),
                path:              q(pbxRelPath),
                sourceTree:        'SOURCE_ROOT',
            };
            pbx.PBXFileReference[fileRefUuid + '_comment'] = name;
        }

        // Add to Sources phase if not already there.
        const inSources = (sourcesPhase.files || []).some(f => {
            const bf = (pbx.PBXBuildFile || {})[f.value];
            return bf && bf.fileRef === fileRefUuid;
        });
        if (inSources) continue;

        const bfUuid = proj.generateUuid();
        pbx.PBXBuildFile = pbx.PBXBuildFile || {};
        pbx.PBXBuildFile[bfUuid] = { isa: 'PBXBuildFile', fileRef: fileRefUuid, settings: {} };
        pbx.PBXBuildFile[bfUuid + '_comment'] = name + ' in Sources';
        sourcesPhase.files.push({ value: bfUuid, comment: name + ' in Sources' });
        console.log('[after_prepare] ensurePluginFilesInAppSources: added ' + name + ' to App Sources');
        added = true;
    }
    return added;
}

// Verify (and repair) that App has a PBXTargetDependency for each extension.
//
// CocoaPods 1.16+ (Xcodeproj 1.27+) validates host targets by checking
// native_target.dependencies — specifically that App.dependencies contains a
// PBXTargetDependency whose `target` UUID equals the extension's UUID.
// xcode npm's addTargetDependency silently no-ops when the PBXTargetDependency /
// PBXContainerItemProxy sections don't exist in the pbxproj (fresh cordova-ios
// projects omit both sections).  This function adds the entries via text
// manipulation when they are missing, as a belt-and-suspenders safeguard.
function ensureExtensionDependenciesInApp(pbxprojPath, extensions) {
    let content = fs.readFileSync(pbxprojPath, 'utf8');
    let changed = false;

    function generateUuid() {
        let u = '';
        for (let i = 0; i < 24; i++) u += Math.floor(Math.random() * 16).toString(16).toUpperCase();
        return u;
    }

    // Returns the UUID of the PBXNativeTarget (isa=PBXNativeTarget) for the given name.
    function findNativeTargetUuid(name) {
        const re = new RegExp(
            '([0-9A-F]{24})\\s*\\/\\*[^*]*' + name + '[^*]*\\*\\/\\s*=\\s*\\{[^}]*isa\\s*=\\s*PBXNativeTarget\\s*;'
        );
        const m = content.match(re);
        return m ? m[1] : null;
    }

    // Returns the project root UUID (containerPortal for PBXContainerItemProxy).
    function findProjectRootUuid() {
        const m = content.match(/([0-9A-F]{24})\s*\/\*\s*Project object\s*\*\//);
        return m ? m[1] : null;
    }

    // True if App's dependencies list already has a PBXTargetDependency whose
    // `target` field points to extTargetUuid.
    function dependencyExists(appTargetUuid, extTargetUuid) {
        // Get App target block
        const appBlockRe = new RegExp(
            appTargetUuid + '\\s*\\/\\*[^*]*\\*\\/\\s*=\\s*\\{([^}]*)\\}'
        );
        const appBlockMatch = content.match(appBlockRe);
        if (!appBlockMatch) return false;
        const depsMatch = appBlockMatch[1].match(/dependencies\s*=\s*\(([^)]*)\)/);
        if (!depsMatch) return false;
        const depUuids = depsMatch[1].match(/[0-9A-F]{24}/g) || [];
        for (const depUuid of depUuids) {
            // Find the PBXTargetDependency block for this dep UUID
            const depBlockRe = new RegExp(
                depUuid + '\\s*\\/\\*[^*]*\\*\\/\\s*=\\s*\\{[^}]*target\\s*=\\s*' + extTargetUuid + '\\s*[;/]'
            );
            if (depBlockRe.test(content)) return true;
        }
        return false;
    }

    // Ensure section headers exist (so we can insert entries into them).
    function ensureSectionExists(sectionName) {
        if (!content.includes('/* Begin ' + sectionName + ' section */')) {
            // Insert before the first existing section marker
            const firstSection = content.indexOf('/* Begin PBX');
            if (firstSection === -1) return false;
            const sectionBlock =
                '\n/* Begin ' + sectionName + ' section */\n' +
                '/* End ' + sectionName + ' section */\n';
            content = content.slice(0, firstSection) + sectionBlock + content.slice(firstSection);
        }
        return true;
    }

    const appTargetUuid  = findNativeTargetUuid('App');
    const projectRootUuid = findProjectRootUuid();
    if (!appTargetUuid || !projectRootUuid) return;

    for (const ext of extensions) {
        const extTargetUuid = findNativeTargetUuid(ext.name);
        if (!extTargetUuid) continue;
        if (dependencyExists(appTargetUuid, extTargetUuid)) continue; // already wired

        // Ensure both sections exist
        ensureSectionExists('PBXContainerItemProxy');
        ensureSectionExists('PBXTargetDependency');

        const proxyUuid = generateUuid();
        const depUuid   = generateUuid();

        // PBXContainerItemProxy entry
        const proxyEntry =
            '\t\t' + proxyUuid + ' /* PBXContainerItemProxy */ = {\n' +
            '\t\t\tisa = PBXContainerItemProxy;\n' +
            '\t\t\tcontainerPortal = ' + projectRootUuid + ' /* Project object */;\n' +
            '\t\t\tproxyType = 1;\n' +
            '\t\t\tremoteGlobalIDString = ' + extTargetUuid + ';\n' +
            '\t\t\tremoteInfo = "' + ext.name + '";\n' +
            '\t\t};\n';
        content = content.replace(
            '/* End PBXContainerItemProxy section */',
            proxyEntry + '/* End PBXContainerItemProxy section */'
        );

        // PBXTargetDependency entry
        const depEntry =
            '\t\t' + depUuid + ' /* PBXTargetDependency */ = {\n' +
            '\t\t\tisa = PBXTargetDependency;\n' +
            '\t\t\tname = "' + ext.name + '";\n' +
            '\t\t\ttarget = ' + extTargetUuid + ' /* "' + ext.name + '" */;\n' +
            '\t\t\ttargetProxy = ' + proxyUuid + ' /* PBXContainerItemProxy */;\n' +
            '\t\t};\n';
        content = content.replace(
            '/* End PBXTargetDependency section */',
            depEntry + '/* End PBXTargetDependency section */'
        );

        // Add depUuid to App target's dependencies list.
        // Use indexOf (not regex) to locate the exact 'dependencies = (' within
        // the App block and its closing ')' — regex replacement with ')' as the
        // search value would hit the first ')' in buildPhases, not dependencies.
        // Anchor to 'appTargetUuid /* App */ = {' to avoid matching the UUID
        // that also appears in PBXProject.targets (which has no dependencies key).
        const appBlockMarker = appTargetUuid + ' /* App */ = {';
        const appBlockStart = content.indexOf(appBlockMarker);
        const depsStr = 'dependencies = (';
        const depsPos = content.indexOf(depsStr, appBlockStart);
        if (depsPos !== -1) {
            const depsClosePos = content.indexOf(')', depsPos + depsStr.length);
            if (depsClosePos !== -1) {
                const toInsert = '\t\t\t\t' + depUuid + ' /* PBXTargetDependency */,\n\t\t\t';
                content = content.slice(0, depsClosePos) + toInsert + content.slice(depsClosePos);
            }
        }

        console.log('[after_prepare] ensureExtensionDependenciesInApp: added App→' + ext.name + ' target dependency');
        changed = true;
    }

    if (changed) fs.writeFileSync(pbxprojPath, content, 'utf8');
}

function addXcodeTargets(iosDir, projectName, appBundleId, extensions, pluginIosDir) {
    const xcode     = require('xcode');
    const pbxprojPath = path.join(iosDir, projectName + '.xcodeproj', 'project.pbxproj');
    const proj      = xcode.project(pbxprojPath);
    proj.parseSync();

    // Ensure PBXTargetDependency and PBXContainerItemProxy sections exist BEFORE
    // calling addTarget.  A fresh cordova-ios project omits both sections.
    // xcode npm's addTargetDependency checks `if (section && section)` and silently
    // no-ops when either is absent — leaving App.dependencies empty.
    // CocoaPods 1.16+ (Xcodeproj 1.27+) validates host targets by checking
    // native_target.dependencies, NOT the Copy Files embed phase, so an empty
    // dependencies list causes "Unable to find host target(s)" on first prepare.
    const pbxObjects = proj.hash.project.objects;
    if (!pbxObjects.PBXTargetDependency)   pbxObjects.PBXTargetDependency   = {};
    if (!pbxObjects.PBXContainerItemProxy) pbxObjects.PBXContainerItemProxy = {};

    let modified = false;

    // Ensure ConnectPlugin.swift is compiled by App target
    if (ensurePluginFilesInAppSources(proj, pluginIosDir || '', iosDir)) modified = true;

    for (const ext of extensions) {
        // Always run purge and dedup regardless of whether target already exists
        if (purgeExtensionSourcesPhase(proj, ext.name, ext.sourceFile)) modified = true;
        deduplicateCopyFilesPhases(proj);

        let targetUuid;
        if (targetExistsByName(proj, ext.name)) {
            targetUuid = getTargetUuidByName(proj, ext.name);
        } else {
            modified = true;

            // addTarget returns the new target UUID
            const targetResult = proj.addTarget(ext.name, 'app_extension', ext.name);
            targetUuid = targetResult.uuid;

            // Build settings
            setBuildSettingsForTarget(proj, targetUuid, {
                PRODUCT_BUNDLE_IDENTIFIER: '"' + ext.bundleId + '"',
                PRODUCT_NAME:              ext.name,
                SWIFT_VERSION:             '5.0',
                IPHONEOS_DEPLOYMENT_TARGET: '15.1',
                INFOPLIST_FILE:            '"' + ext.name + '/Info.plist"',
                CODE_SIGN_ENTITLEMENTS:    '"' + ext.name + '/' + ext.name + '.entitlements"',
                SKIP_INSTALL:              'YES',
            });

            // Add xcframeworks extraction script before Sources
            addXcframeworksScriptPhase(proj, targetUuid);
        }

        if (targetUuid) {
            // Ensure Sources phase exists and source file is compiled (idempotent).
            // xcode npm's addTarget for app_extension never creates a Sources phase,
            // so this must run for both newly-created and pre-existing targets.
            ensureExtensionSourceInSources(proj, targetUuid, ext.name + '/' + ext.sourceFile);
            // Destination: "Designed for iPad", not Mac Catalyst.
            // xcode npm sets SUPPORTS_MACCATALYST = YES by default on new targets.
            // Run on every prepare so existing targets are corrected too.
            setBuildSettingsForTarget(proj, targetUuid, {
                SUPPORTS_MACCATALYST:                  'NO',
                SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: 'YES',
            });

            // Link required frameworks (idempotent, every prepare).
            for (const fw of (ext.frameworks || [])) {
                addFrameworkToTarget(proj, targetUuid, fw);
            }
        }
    }

    // App target + project level: Designed for iPad, not Mac Catalyst (every prepare).
    // Cordova's platform code sets SUPPORTS_MACCATALYST = YES on both the App target
    // and the project-level build configuration list. Patch both so no target inherits YES.
    const macSettings = {
        SUPPORTS_MACCATALYST:                  'NO',
        SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: 'YES',
    };

    const appTargetUuid = getTargetUuidByName(proj, projectName);
    if (appTargetUuid) {
        setBuildSettingsForTarget(proj, appTargetUuid, macSettings);
    }

    // Project-level configs (PBXProject.buildConfigurationList)
    const pbxProjectSection = pbxObjects.PBXProject || {};
    for (const [pUuid, pbxProj] of Object.entries(pbxProjectSection)) {
        if (pUuid.endsWith('_comment') || !pbxProj || !pbxProj.buildConfigurationList) continue;
        const cfgList = (pbxObjects.XCConfigurationList || {})[pbxProj.buildConfigurationList];
        if (!cfgList) continue;
        for (const cfgRef of (cfgList.buildConfigurations || [])) {
            const cfg = (pbxObjects.XCBuildConfiguration || {})[cfgRef.value];
            if (!cfg) continue;
            cfg.buildSettings = cfg.buildSettings || {};
            Object.assign(cfg.buildSettings, macSettings);
        }
    }

    if (modified) {
        fs.writeFileSync(pbxprojPath, proj.writeSync());
    }

    // Replace plain xcframeworks.sh call with serialized wrapper in NSE/NCE phases.
    // Must run after writeSync() since the xcode package cannot round-trip the script.
    patchXcframeworksScriptPhases(pbxprojPath);

    // Explicitly verify and repair the embed-phase wiring for every extension.
    // xcode npm 3.0.1's addTarget embed logic is unreliable when multiple
    // extensions are added in sequence; this function works directly on the
    // written pbxproj text and is idempotent.
    ensureExtensionsEmbeddedInApp(pbxprojPath, extensions);

    // Belt-and-suspenders: verify PBXTargetDependency entries were written.
    // If the sections were absent and xcode npm silently skipped them, this
    // function adds them via direct text manipulation so CocoaPods validation
    // always finds the host-extension relationship in App.dependencies.
    ensureExtensionDependenciesInApp(pbxprojPath, extensions);
}

// ---------------------------------------------------------------------------
// Podfile
// ---------------------------------------------------------------------------

function podVariantFromPodsJson(iosDir) {
    const podsJsonPath = path.join(iosDir, 'pods.json');
    if (!fs.existsSync(podsJsonPath)) return { name: 'AcousticConnectDebug', spec: '>= 2.1.12' };
    try {
        const libs = (JSON.parse(fs.readFileSync(podsJsonPath, 'utf8')) || {}).libraries || {};
        if (libs['AcousticConnect'])
            return { name: 'AcousticConnect', spec: libs['AcousticConnect'].spec || '~> 2.0' };
        if (libs['AcousticConnectDebug'])
            return { name: 'AcousticConnectDebug', spec: libs['AcousticConnectDebug'].spec || '>= 2.1.12' };
    } catch (_) {}
    return { name: 'AcousticConnectDebug', spec: '>= 2.1.12' };
}


function updatePodfile(iosDir) {
    const podfilePath = path.join(iosDir, 'Podfile');

    // Fresh platform: cordova-ios has not yet generated the Podfile.
    // CocoaPods 1.16+ validates the host-extension embed relationship for
    // NSE/NCE targets, but that validation fails before the Pods infrastructure
    // (xcconfig, xcfilelist files) exists — even though we already added the
    // targets and their embed phase to the pbxproj in addXcodeTargets().
    //
    // Strategy: bootstrap with an App-only Podfile first (no NSE/NCE) so that
    // the Pods directory and xcconfig files are created. Then fall through to
    // the regular update logic below, which adds NSE/NCE targets and returns
    // true. The caller re-runs pod install with the full Podfile; at that point
    // the infrastructure exists and CocoaPods validates NSE/NCE successfully.
    if (!fs.existsSync(podfilePath)) {
        const projectName = resolveProjectName(iosDir);
        const pod = podVariantFromPodsJson(iosDir);
        const bootstrapContent = [
            '# DO NOT MODIFY -- auto-generated by Apache Cordova',
            '',
            "source 'https://cdn.cocoapods.org/'",
            "install! 'cocoapods', :warn_for_unused_master_specs_repo => false",
            "platform :ios, '15.1'",
            'use_frameworks!',
            '',
            `target '${projectName}' do`,
            `\tproject '${projectName}.xcodeproj'`,
            `\tpod '${pod.name}', '${pod.spec}'`,
            'end',
            '',
            'post_install do |installer|',
            '  installer.generated_projects.each do |project|',
            '    project.targets.each do |target|',
            '      target.build_configurations.each do |config|',
            "        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'",
            '      end',
            '    end',
            '  end',
            'end',
            '',
        ].join('\n');

        fs.writeFileSync(podfilePath, bootstrapContent, 'utf8');
        console.log('[after_prepare] Fresh platform — bootstrap pod install (App target only)');
        if (process.env.ACOUSTIC_SKIP_POD_INSTALL === '1') {
            console.log('[after_prepare] ACOUSTIC_SKIP_POD_INSTALL=1 — skipping bootstrap pod install');
        } else {
            try {
                require('child_process').execSync('pod install', { cwd: iosDir, stdio: 'inherit', timeout: 300000 });
            } catch (e) {
                console.warn('[after_prepare] Bootstrap pod install failed:', e.message);
            }
        }
        // Fall through: read the bootstrap Podfile back, add NSE/NCE via the
        // normal path below, and return true so the caller runs a second pod
        // install with the complete Podfile.
    }

    let content = fs.readFileSync(podfilePath, 'utf8');
    let modified = false;

    // Suppress CocoaPods master specs repo warning
    if (!content.includes('warn_for_unused_master_specs_repo')) {
        // Insert after the source line (or platform line as fallback)
        content = content.replace(
            /(source 'https:\/\/cdn\.cocoapods\.org\/')/,
            "$1\ninstall! 'cocoapods', :warn_for_unused_master_specs_repo => false"
        );
        modified = true;
    }

    // Nested extension targets
    const hasNSE = content.includes("target 'ConnectNSE'");
    const hasNCE = content.includes("target 'ConnectNCE'");
    if (!hasNSE || !hasNCE) {
        const insertion = [
            hasNSE ? '' : "\n\ttarget 'ConnectNSE' do\n\t\tinherit! :search_paths\n\tend",
            hasNCE ? '' : "\n\ttarget 'ConnectNCE' do\n\t\tinherit! :search_paths\n\tend",
        ].join('');

        const appBlockEnd = /(\ntarget 'App'[\s\S]*?)(^\s*end\s*$)/m;
        if (appBlockEnd.test(content)) {
            content = content.replace(appBlockEnd, (_, body, end) => body + insertion + '\n' + end);
        } else {
            const lastEnd = content.lastIndexOf('\nend');
            if (lastEnd >= 0) {
                content = content.slice(0, lastEnd) + insertion + content.slice(lastEnd);
            }
        }
        modified = true;
    }

    // post_install block — ensure deployment target is set for all targets
    if (!content.includes('post_install')) {
        content += `
post_install do |installer|
  installer.generated_projects.each do |project|
    project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
      end
    end
  end
end
`;
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(podfilePath, content, 'utf8');
    }
    return modified;
}

// ---------------------------------------------------------------------------
// Ensure plugin JS module is deployed to platforms/ios/www
// ---------------------------------------------------------------------------

// Cordova's "already installed" path skips copying the plugin's www/ JS files
// and regenerating cordova_plugins.js. Without cordova_plugins.js the Cordova
// module loader never defines `window.AcousticConnect`, so all JS-bridge calls
// (logIdentity, etc.) fail silently at runtime.
function ensurePluginJsModule(iosDir, pluginIosDir) {
    const wwwDir      = path.join(iosDir, 'www');
    const pluginId    = 'co.acoustic.connect.push';
    const moduleName  = 'AcousticConnect';
    const srcJs       = path.join(pluginIosDir, '..', '..', 'www', moduleName + '.js');
    const dstDir      = path.join(wwwDir, 'plugins', pluginId, 'www');
    const dstJs       = path.join(dstDir, moduleName + '.js');
    const pluginsFile = path.join(wwwDir, 'cordova_plugins.js');

    // Copy AcousticConnect.js, wrapped in cordova.define() as Cordova's build
    // system normally does. Without the wrapper the top-level require('cordova/exec')
    // in the raw source throws a ReferenceError in the browser context and kills
    // the entire JS runtime before deviceready fires.
    if (!fs.existsSync(dstJs)) {
        if (!fs.existsSync(srcJs)) {
            console.warn('[after_prepare] ensurePluginJsModule: JS source not found at ' + srcJs);
            return;
        }
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
        const raw     = fs.readFileSync(srcJs, 'utf8');
        const moduleId = pluginId + '.' + moduleName;
        const wrapped  = 'cordova.define("' + moduleId + '", function(require, exports, module) {\n' +
                         raw + '\n});\n';
        fs.writeFileSync(dstJs, wrapped, 'utf8');
        console.log('[after_prepare] Deployed ' + moduleName + '.js (cordova.define-wrapped) to platform www/plugins/');
    }

    // The module entry Cordova would normally inject into cordova_plugins.js.
    const moduleEntry = {
        id:       pluginId + '.' + moduleName,
        file:     'plugins/' + pluginId + '/www/' + moduleName + '.js',
        pluginId: pluginId,
        clobbers: [moduleName],
    };

    // Read existing cordova_plugins.js or start with empty list.
    let modules = [];
    let metadata = {};
    if (fs.existsSync(pluginsFile)) {
        const src = fs.readFileSync(pluginsFile, 'utf8');
        // Extract the module.exports array via simple eval in a limited context.
        try {
            const defM = { exports: {} };
            // Strip cordova.define wrapper so we can eval just the body.
            const body = src.replace(/^cordova\.define\([^,]+,\s*function\s*\([^)]*\)\s*\{/, '')
                            .replace(/\}\s*\);\s*$/, '');
            // eslint-disable-next-line no-new-func
            new Function('module', body)(defM);
            modules  = Array.isArray(defM.exports) ? defM.exports : [];
            metadata = defM.exports.metadata || {};
        } catch (_) { /* malformed — overwrite */ }
    }

    // Check if our entry is already present.
    const alreadyPresent = modules.some(m => m.id === moduleEntry.id);
    if (alreadyPresent) return;

    modules.push(moduleEntry);

    // Write the file in Cordova's standard format.
    const pluginsJson = JSON.stringify(modules, null, 2)
        .replace(/"([^"]+)":/g, '$1:');  // unquote keys — matches Cordova output style
    const output = [
        'cordova.define(\'cordova/plugin_list\', function(require, exports, module) {',
        'module.exports = ' + JSON.stringify(modules, null, 2) + ';',
        'module.exports.metadata = ' + JSON.stringify(metadata, null, 2) + ';',
        '});',
    ].join('\n');
    fs.writeFileSync(pluginsFile, output, 'utf8');
    console.log('[after_prepare] Updated cordova_plugins.js with ' + moduleEntry.id);
}

// ---------------------------------------------------------------------------
// Ensure ConnectPlugin <feature> is registered in the platform config.xml
// ---------------------------------------------------------------------------

// Cordova skips config.xml injection when the plugin is already marked installed.
// This ensures the <feature name="ConnectPlugin"> block is always present so
// Cordova's runtime plugin resolver can find the native class.
function ensureConnectPluginFeature(iosDir) {
    const configPath = path.join(iosDir, 'App', 'config.xml');
    if (!fs.existsSync(configPath)) return;

    let xml = fs.readFileSync(configPath, 'utf8');
    if (xml.includes('name="ConnectPlugin"')) return;   // already there

    const featureBlock = [
        '    <feature name="ConnectPlugin">',
        '        <param name="ios-package" value="ConnectPlugin" />',
        '        <param name="onload" value="true" />',
        '    </feature>',
    ].join('\n');

    // Insert before the closing </widget> tag.
    xml = xml.replace('</widget>', featureBlock + '\n</widget>');
    fs.writeFileSync(configPath, xml, 'utf8');
    console.log('[after_prepare] Injected ConnectPlugin feature into platform config.xml');
}

// ---------------------------------------------------------------------------
// App target header search paths (Cordova SPM package public headers)
// ---------------------------------------------------------------------------

// Adds $(SRCROOT)/packages/cordova-ios/CordovaLib/include to the App target's
// HEADER_SEARCH_PATHS so that #import <Cordova/CDVAppDelegate.h> resolves.
// Uses direct string replacement on the pbxproj because the xcode npm package
// strips $(SRCROOT) variable references when round-tripping through writeSync().
function patchAppTargetHeaderSearchPaths(iosDir, projectName) {
    const cordovaIncludePath = '$(SRCROOT)/packages/cordova-ios/CordovaLib/include';
    const pbxprojPath = path.join(iosDir, projectName + '.xcodeproj', 'project.pbxproj');
    let content = fs.readFileSync(pbxprojPath, 'utf8');

    // Guard specifically on HEADER_SEARCH_PATHS having the path. The broader
    // `content.includes(cordovaIncludePath)` would exit early if SWIFT_INCLUDE_PATHS
    // also contains the path, preventing HEADER_SEARCH_PATHS from being injected.
    if (/HEADER_SEARCH_PATHS\s*=\s*\([\s\S]*?packages\/cordova-ios\/CordovaLib\/include/.test(content)) return;

    const insertion = [
        '\t\t\t\tHEADER_SEARCH_PATHS = (',
        '\t\t\t\t\t"$(inherited)",',
        '\t\t\t\t\t"' + cordovaIncludePath + '",',
        '\t\t\t\t);',
    ].join('\n');

    // Inject into every App target build config. HEADER_SEARCH_PATHS (H) sorts
    // before INFOPLIST_KEY (I) so it won't appear in `body`; the top-level guard
    // above handles the idempotency check.
    content = content.replace(
        /(INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents[\s\S]*?)(^\t\t\t};)/mg,
        (match, body, closing) => body + insertion + '\n' + closing
    );

    fs.writeFileSync(pbxprojPath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Swift module path for `import Cordova` in Swift plugins
// ---------------------------------------------------------------------------

// `import Cordova` in ConnectPlugin.swift requires the Swift compiler to find
// the Cordova clang module. CordovaLib is an SPM package whose public-headers
// directory is packages/cordova-ios/CordovaLib/include/. Placing module.modulemap
// there and adding SWIFT_INCLUDE_PATHS (array form) gives swiftc the explicit
// -I flag it needs to locate the module map alongside HEADER_SEARCH_PATHS.
//
// String-format SWIFT_INCLUDE_PATHS ("$(inherited) path") can be silently
// mishandled when there is no inherited value; the array form is unambiguous.
function ensureCordovaSwiftModule(iosDir, projectName) {
    const cordovaIncludeDir = path.join(iosDir, 'packages', 'cordova-ios', 'CordovaLib', 'include');
    if (fs.existsSync(cordovaIncludeDir)) {
        const mapPath = path.join(cordovaIncludeDir, 'module.modulemap');
        if (!fs.existsSync(mapPath)) {
            fs.writeFileSync(mapPath, [
                'module Cordova {',
                '    umbrella header "Cordova/Cordova.h"',
                '    export *',
                '    module * { export * }',
                '}',
                '',
            ].join('\n'));
        }
    }

    const pbxprojPath = path.join(iosDir, projectName + '.xcodeproj', 'project.pbxproj');
    if (!fs.existsSync(pbxprojPath)) return;
    let content = fs.readFileSync(pbxprojPath, 'utf8');

    const swiftIncludePath = '$(SRCROOT)/packages/cordova-ios/CordovaLib/include';

    // Already injected in canonical array format — nothing to do.
    if (/SWIFT_INCLUDE_PATHS\s*=\s*\([\s\S]*?packages\/cordova-ios\/CordovaLib\/include/.test(content)) return;

    // Remove any string-format SWIFT_INCLUDE_PATHS (e.g. manually added in a prior
    // session) before injecting the array form so we never end up with two entries.
    content = content.replace(/^\t+SWIFT_INCLUDE_PATHS\s*=\s*"[^"]*";\n/mg, '');

    const insertion = [
        '\t\t\t\tSWIFT_INCLUDE_PATHS = (',
        '\t\t\t\t\t"$(inherited)",',
        '\t\t\t\t\t"' + swiftIncludePath + '",',
        '\t\t\t\t);',
    ].join('\n');

    content = content.replace(
        /(INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents[\s\S]*?)(^\t\t\t};)/mg,
        (match, body, closing) => {
            if (body.includes('SWIFT_INCLUDE_PATHS')) return match;
            return body + insertion + '\n' + closing;
        }
    );

    fs.writeFileSync(pbxprojPath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// build-extras.xcconfig — Cordova header path for SourceKit / IDE
// ---------------------------------------------------------------------------

// build-extras.xcconfig is the xcconfig Xcode's SourceKit uses for IDE diagnostics.
// Adding HEADER_SEARCH_PATHS here ensures <Cordova/CDVAppDelegate.h> resolves in
// the editor even before a full build, preventing the false-positive IDE error.
// Note: cordova build ios overwrites this file; our hook re-applies it every prepare.
function updateBuildExtrasXcconfig(iosDir) {
    const extrasPath = path.join(iosDir, 'cordova', 'build-extras.xcconfig');
    if (!fs.existsSync(extrasPath)) return;
    let content = fs.readFileSync(extrasPath, 'utf8');
    const line = 'HEADER_SEARCH_PATHS = $(inherited) "$(SRCROOT)/packages/cordova-ios/CordovaLib/include"';
    if (content.includes('packages/cordova-ios/CordovaLib/include')) return;
    content = content.trimEnd() + '\n\n' + line + '\n';
    fs.writeFileSync(extrasPath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Host-app entitlements
// ---------------------------------------------------------------------------

function addAppGroupToEntitlementsFile(filePath, appGroupIdentifier) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes(appGroupIdentifier)) return; // Already present

    const appGroupEntry = `\t<key>com.apple.security.application-groups</key>\n\t<array>\n\t\t<string>${appGroupIdentifier}</string>\n\t</array>`;

    if (content.includes('com.apple.security.application-groups')) {
        // Key exists but identifier not present — add it to the existing array
        content = content.replace(
            /(com\.apple\.security\.application-groups<\/key>\s*<array>)/,
            `$1\n\t\t<string>${appGroupIdentifier}</string>`
        );
    } else {
        // Key absent — insert the whole block before the closing </dict>
        content = content.replace('</dict>', appGroupEntry + '\n</dict>');
    }
    fs.writeFileSync(filePath, content, 'utf8');
}

function addApsEnvironmentToEntitlementsFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('aps-environment')) return; // already present
    const entry = '\t<key>aps-environment</key>\n\t<string>development</string>';
    content = content.replace('</dict>', entry + '\n</dict>');
    fs.writeFileSync(filePath, content, 'utf8');
}

function updateEntitlements(iosDir, projectName, appGroupIdentifier) {
    const appDir = path.join(iosDir, projectName === 'App' ? 'App' : projectName);
    if (!fs.existsSync(appDir)) return;

    // Update every entitlement file in the app directory.
    // Cordova's CODE_SIGN_ENTITLEMENTS points to Entitlements-$(CONFIGURATION).plist,
    // NOT the named .entitlements file — so both sets of files need aps-environment
    // and the App Group or push registration silently fails at code-sign time.
    for (const f of fs.readdirSync(appDir)) {
        if (f.endsWith('.entitlements') || /^Entitlements-.+\.plist$/.test(f)) {
            const p = path.join(appDir, f);
            addAppGroupToEntitlementsFile(p, appGroupIdentifier);
            addApsEnvironmentToEntitlementsFile(p);
        }
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

module.exports = function (context) {
    const platforms = context.opts.platforms || [];
    if (platforms.indexOf('ios') === -1) return;

    const projectRoot = context.opts.projectRoot
        || context.opts.cordova && context.opts.cordova.projectRoot
        || process.cwd();

    const iosDir = path.join(projectRoot, 'platforms', 'ios');
    if (!fs.existsSync(iosDir)) return;

    let appGroupIdentifier;
    let appBundleId;
    try {
        appGroupIdentifier = resolveAppGroupIdentifier(projectRoot);
        appBundleId        = resolveAppBundleId(projectRoot);
    } catch (e) {
        console.warn('[after_prepare] Skipping iOS NSE/NCE setup:', e.message);
        return;
    }

    const projectName  = resolveProjectName(iosDir);
    const pluginIosDir = resolvePluginRoot(projectRoot);
    const extensions   = buildExtensions(appBundleId);

    // 1. Copy source files with placeholder substituted
    copyExtensionSources(pluginIosDir, iosDir, appGroupIdentifier, extensions);

    // 2. Update Xcode project (targets + build phases)
    addXcodeTargets(iosDir, projectName, appBundleId, extensions, pluginIosDir);

    // 2b. Ensure ConnectPlugin feature is in platform config.xml
    ensureConnectPluginFeature(iosDir);

    // 2c. Ensure AcousticConnect.js is in platforms/ios/www and cordova_plugins.js is correct
    ensurePluginJsModule(iosDir, pluginIosDir);

    // 2c. Ensure App target can resolve <Cordova/CDVAppDelegate.h>
    patchAppTargetHeaderSearchPaths(iosDir, projectName);

    // 2d. Ensure `import Cordova` resolves in Swift plugins: create module.modulemap
    //     and inject SWIFT_INCLUDE_PATHS (array form) into App target build configs.
    ensureCordovaSwiftModule(iosDir, projectName);

    // 3. Update Podfile
    const podfileChanged = updatePodfile(iosDir);

    // 4. Update host-app entitlements
    updateEntitlements(iosDir, projectName, appGroupIdentifier);

    // 4b. Add Cordova headers to build-extras.xcconfig so SourceKit resolves them in IDE
    updateBuildExtrasXcconfig(iosDir);

    // 5. Re-run pod install only if Podfile changed
    if (podfileChanged) {
        if (process.env.ACOUSTIC_SKIP_POD_INSTALL === '1') {
            console.log('[after_prepare] ACOUSTIC_SKIP_POD_INSTALL=1 — skipping pod install');
        } else {
            const { execSync } = require('child_process');
            console.log('[after_prepare] Podfile changed — running pod install');
            try {
                execSync('pod install', { cwd: iosDir, stdio: 'inherit', timeout: 300000 });
            } catch (e) {
                console.error('[after_prepare] pod install failed:', e.message);
            }
        }
    }

    // 6. Re-patch xcframeworks inputFileListPaths after all pod installs.
    //    CocoaPods' xcodeproj gem can re-introduce the unquoted broken form
    //    ("${PODS_ROOT}/Target Support Files/..." → "/Target Support Files/...")
    //    for NSE/NCE phases when it writes the project during pod install.
    //    Running the patch here guarantees the correct quoted form is in the
    //    pbxproj regardless of the pod install write order.
    const pbxprojPath = path.join(iosDir, projectName + '.xcodeproj', 'project.pbxproj');
    if (fs.existsSync(pbxprojPath)) {
        patchXcframeworksScriptPhases(pbxprojPath);
    }

    console.log('[after_prepare] iOS NSE/NCE setup complete (' + appGroupIdentifier + ')');
};

// Internal functions exposed for unit tests — not part of the public plugin API.
module.exports._internal = {
    ensureExtensionsEmbeddedInApp,
    ensureExtensionDependenciesInApp,
    updatePodfile,
    patchXcframeworksScriptPhases,
};
