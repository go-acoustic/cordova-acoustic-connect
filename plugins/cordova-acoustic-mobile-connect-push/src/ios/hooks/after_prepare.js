#!/usr/bin/env node
// Copyright (C) 2026 Acoustic, L.P. All rights reserved.
//
// Cordova after_prepare hook — iOS Rich Push (NSE + NCE)
// Acoustic Connect plugin.
//
// Responsibilities each prepare cycle:
//   1. Copy NSE/NCE source files from plugin src to platform/ios, substituting
//      the CONNECT_APP_GROUP_IDENTIFIER_PLACEHOLDER token.
//   2. Invoke add_ios_push_extensions.rb (xcodeproj gem) for all pbxproj surgery:
//      NSE/NCE targets, embed phase, target dependencies, frameworks, xcframeworks
//      script phase, Mac Catalyst settings.
//   3. Ensure the Podfile nests ConnectNSE / ConnectNCE under the App target.
//   4. Ensure the host-app entitlements include the App Group.
//   5. Re-run `pod install` only when the Podfile was changed.
//   6. Re-patch xcframeworks inputFileListPaths after pod install (CocoaPods
//      can garble the quoted ${PODS_ROOT} prefix during its project write).

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

function resolveConnectConfigPath(projectRoot) {
    const configPath = path.join(projectRoot, 'ConnectConfig.json');
    if (fs.existsSync(configPath)) return configPath;
    const examplePath = path.join(projectRoot, 'ConnectConfig.example.json');
    if (fs.existsSync(examplePath)) return examplePath;
    throw new Error('ConnectConfig.json not found');
}

function resolveAppGroupIdentifier(projectRoot) {
    const configPath = resolveConnectConfigPath(projectRoot);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const val = (config.Connect || config).iOSAppGroupIdentifier;
    if (!val) throw new Error('iOSAppGroupIdentifier not found in ConnectConfig.json');
    return val;
}

function resolveIosDevelopmentTeam(projectRoot) {
    let configPath;
    try {
        configPath = resolveConnectConfigPath(projectRoot);
    } catch (_) {
        return null; // config file genuinely absent
    }
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return (config.Connect || config).iOSDevelopmentTeam || null;
    } catch (e) {
        if (e instanceof SyntaxError) {
            throw new Error('[after_prepare] ConnectConfig.json is malformed JSON: ' + e.message);
        }
        return null;
    }
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

// Copy plugin source files to platforms/ios so they exist on disk before Ruby
// registers them in the pbxproj. Cordova's "already installed" short-circuit
// may skip this copy on repeated prepares; this function ensures it happens
// every time so the platform copy never drifts from the plugin src/ios source.
function copyPluginSourceFiles(pluginIosDir, iosDir) {
    const pluginId  = 'co.acoustic.connect.push';
    const pluginDst = path.join(iosDir, 'App', 'Plugins', pluginId);
    const files     = ['ConnectPlugin.swift'];

    if (!fs.existsSync(pluginDst)) fs.mkdirSync(pluginDst, { recursive: true });
    for (const fname of files) {
        const src = path.join(pluginIosDir, fname);
        const dst = path.join(pluginDst, fname);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
        }
    }
}

// ---------------------------------------------------------------------------
// xcframeworks script phase — backward compatibility patch
//
// These constants are retained so patchXcframeworksScriptPhases can still
// repair pbxproj files that were written by earlier versions of this hook
// using the xcode npm package (which serialised only the bare xcframeworks.sh
// call as the shellScript value).
// ---------------------------------------------------------------------------

// Build the locking wrapper script for a given SDK variant.
function buildXcframeworksWrapperScript(variant) {
    return [
        '#!/bin/sh',
        'DEST="${PODS_XCFRAMEWORKS_BUILD_DIR}/' + variant + '/Core"',
        'LOCK="${TMPDIR}/co.acoustic.xcframeworks.lck"',
        'if [ -d "${DEST}/Connect.framework" ] && [ -d "${DEST}/Tealeaf.framework" ] && [ -d "${DEST}/EOCore.framework" ]; then',
        '  exit 0',
        'fi',
        'if mkdir "${LOCK}" 2>/dev/null; then',
        '  "${PODS_ROOT}/Target Support Files/' + variant + '/' + variant + '-xcframeworks.sh"',
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
}

// Build the pbxproj shellScript literal: newlines → \n, quotes → \"
function encodePbxprojShellScript(script) {
    const body = script.replace(/\n/g, '\\n').replace(/"/g, '\\"');
    return '"' + body + '"';
}

// Raw values the xcode npm package wrote for the old single-line invocation, one per
// SDK variant. Only the debug variant was ever used in practice; both are checked for
// completeness.
const XCFRAMEWORKS_OLD_SHELLSCRIPTS = [
    '"\\\"${PODS_ROOT}/Target Support Files/AcousticConnectDebug/AcousticConnectDebug-xcframeworks.sh\\\"\\n"',
    '"\\\"${PODS_ROOT}/Target Support Files/AcousticConnect/AcousticConnect-xcframeworks.sh\\\"\\n"',
];

// After pod install, CocoaPods' xcodeproj gem can re-introduce broken forms for
// inputFileListPaths in the NSE/NCE xcframeworks script phases, and legacy
// pbxproj files from xcode-npm builds may still have the old bare shellScript.
// This function fixes both.
//
// variant — SDK pod name ('AcousticConnectDebug' or 'AcousticConnect')
function patchXcframeworksScriptPhases(pbxprojPath, variant) {
    if (!variant) variant = 'AcousticConnectDebug';
    let content = fs.readFileSync(pbxprojPath, 'utf8');
    let changed = false;

    // 1. Replace bare xcframeworks.sh shellScript with the serialized locking wrapper.
    //    Repairs pbxproj files written by earlier xcode-npm based versions of this hook.
    //    This is a no-op when the Ruby script has already written the correct wrapper.
    const newShellScript = encodePbxprojShellScript(buildXcframeworksWrapperScript(variant));
    if (!content.includes(newShellScript)) {
        for (const oldScript of XCFRAMEWORKS_OLD_SHELLSCRIPTS) {
            const patched = content.split(oldScript).join(newShellScript);
            if (patched !== content) { content = patched; changed = true; break; }
        }
    }

    // 2. Fix inputFileListPaths: ensure the path is correctly quoted with ${PODS_ROOT} prefix.
    //    Three broken forms can appear after pod install (CocoaPods xcodeproj write):
    //      B1 – unquoted with prefix: ${PODS_ROOT}/Target Support Files/...xcfilelist,
    //      B2 – Xcode tokenises the unquoted B1 at the first space, yielding ${PODS_ROOT}
    //           alone; the rest (/Target Support Files/...) is lost.
    //      B3 – quoted without prefix: "/Target Support Files/...xcfilelist"
    //    All broken forms are replaced with the single correct form:
    //      "${PODS_ROOT}/Target Support Files/...xcfilelist"
    //    Strategy: use a placeholder to protect already-correct occurrences, fix every
    //    other occurrence, then restore. This avoids broken regexes with literal $ chars.
    const XCFILELIST_SUFFIX =
        'Target Support Files/' + variant + '/' + variant + '-xcframeworks-input-files.xcfilelist';
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
    // targets and their embed phase to the pbxproj in add_ios_push_extensions.rb.
    //
    // Strategy: bootstrap with an App-only Podfile first (no NSE/NCE) so that
    // the Pods directory and xcconfig files are created. Then fall through to
    // the regular update logic below, which adds NSE/NCE targets and returns
    // true. The caller re-runs pod install with the full Podfile; at that point
    // the infrastructure exists and CocoaPods validates NSE/NCE successfully.
    if (!fs.existsSync(podfilePath)) {
        const projectName = resolveProjectName(iosDir);
        const pod = podVariantFromPodsJson(iosDir);
        const bootstrapLines = [
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
        ];
        bootstrapLines.push(
            'post_install do |installer|',
            '  installer.generated_projects.each do |project|',
            '    project.targets.each do |target|',
            '      target.build_configurations.each do |config|',
            "        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'",
            '      end',
            '    end',
            '  end',
            'end',
            ''
        );
        const bootstrapContent = bootstrapLines.join('\n');

        fs.writeFileSync(podfilePath, bootstrapContent, 'utf8');
        console.log('[after_prepare] Fresh platform — bootstrap pod install (App target only)');
        if (process.env.ACOUSTIC_SKIP_POD_INSTALL === '1') {
            console.log('[after_prepare] ACOUSTIC_SKIP_POD_INSTALL=1 — skipping bootstrap pod install');
        } else {
            try {
                require('child_process').execSync('pod install', { cwd: iosDir, stdio: 'inherit', timeout: 300000 });
            } catch (e) {
                throw new Error('[after_prepare] Bootstrap pod install failed — see CocoaPods output above: ' + e.message);
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
// Uses direct string replacement on the pbxproj after xcodeproj has saved it.
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

    content = content.replace(
        /(INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents[\s\S]*?)(^\t\t\t};)/mg,
        (match, body, closing) => body + insertion + '\n' + closing
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

    const developmentTeam = resolveIosDevelopmentTeam(projectRoot);
    if (developmentTeam) {
        console.log('[after_prepare] iOSDevelopmentTeam: ' + developmentTeam);
    }

    const projectName  = resolveProjectName(iosDir);
    const pluginIosDir = resolvePluginRoot(projectRoot);
    const extensions   = buildExtensions(appBundleId);
    const pod          = podVariantFromPodsJson(iosDir);

    // 1. Copy NSE/NCE source files with placeholder substituted
    copyExtensionSources(pluginIosDir, iosDir, appGroupIdentifier, extensions);

    // 2. Copy plugin source files to platforms/ios (pbxproj registration is done by Ruby)
    copyPluginSourceFiles(pluginIosDir, iosDir);

    // 3. pbxproj surgery via xcodeproj Ruby gem — creates/repairs NSE/NCE targets,
    //    embed phase, target dependencies, system frameworks, xcframeworks script phase,
    //    Mac Catalyst settings, ConnectPlugin.swift in App Compile Sources.
    const { execSync } = require('child_process');
    const rubyScript = path.join(__dirname, '..', 'add_ios_push_extensions.rb');
    if (!fs.existsSync(rubyScript)) {
        throw new Error('[after_prepare] Ruby script not found: ' + rubyScript +
            ' — ensure add_ios_push_extensions.rb is included in the plugin package.');
    }
    const rubyEnv = Object.assign({}, process.env, {
        ACOUSTIC_PROJECT_PATH:  path.join(iosDir, projectName + '.xcodeproj'),
        ACOUSTIC_APP_TARGET:    projectName,
        ACOUSTIC_APP_BUNDLE_ID: appBundleId,
        ACOUSTIC_SDK_VARIANT:   pod.name,
    });
    if (developmentTeam) rubyEnv.ACOUSTIC_DEVELOPMENT_TEAM = developmentTeam;
    execSync('ruby "' + rubyScript + '"', { cwd: iosDir, stdio: 'inherit', env: rubyEnv });

    // 3b. Ensure ConnectPlugin feature is in platform config.xml
    ensureConnectPluginFeature(iosDir);

    // 3c. Ensure AcousticConnect.js is in platforms/ios/www and cordova_plugins.js is correct
    ensurePluginJsModule(iosDir, pluginIosDir);

    // 3d. Ensure App target can resolve <Cordova/CDVAppDelegate.h>
    patchAppTargetHeaderSearchPaths(iosDir, projectName);

    // 4. Update Podfile
    const podfileChanged = updatePodfile(iosDir);

    // 5. Update host-app entitlements
    updateEntitlements(iosDir, projectName, appGroupIdentifier);

    // 5b. Add Cordova headers to build-extras.xcconfig so SourceKit resolves them in IDE
    updateBuildExtrasXcconfig(iosDir);

    // 6. Re-run pod install only if Podfile changed
    if (podfileChanged) {
        if (process.env.ACOUSTIC_SKIP_POD_INSTALL === '1') {
            console.log('[after_prepare] ACOUSTIC_SKIP_POD_INSTALL=1 — skipping pod install');
        } else {
            console.log('[after_prepare] Podfile changed — running pod install');
            try {
                execSync('pod install', { cwd: iosDir, stdio: 'inherit', timeout: 300000 });
            } catch (e) {
                throw new Error('[after_prepare] pod install failed — see CocoaPods output above: ' + e.message);
            }
        }
    }

    // 7. Re-patch xcframeworks inputFileListPaths after all pod installs.
    //    CocoaPods' xcodeproj gem can re-introduce the unquoted broken form
    //    ("${PODS_ROOT}/Target Support Files/..." → "/Target Support Files/...")
    //    for NSE/NCE phases when it writes the project during pod install.
    //    Running the patch here guarantees the correct quoted form is in the
    //    pbxproj regardless of the pod install write order.
    const pbxprojPath = path.join(iosDir, projectName + '.xcodeproj', 'project.pbxproj');
    if (fs.existsSync(pbxprojPath)) {
        patchXcframeworksScriptPhases(pbxprojPath, pod.name);
    }

    console.log('[after_prepare] iOS NSE/NCE setup complete (' + appGroupIdentifier + ')');
};

// Internal functions exposed for unit tests — not part of the public plugin API.
module.exports._internal = {
    updatePodfile,
    patchXcframeworksScriptPhases,
    resolveConnectConfigPath,
    resolveIosDevelopmentTeam,
};
