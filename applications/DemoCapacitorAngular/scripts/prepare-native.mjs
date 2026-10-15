#!/usr/bin/env node
// Builds the web app, adds the Android and iOS projects when they are missing, and applies the plugin's manual steps:
//   Android: minSdkVersion 26 and the Connect Maven repository.
//   iOS:     the Run Script phase that copies ConnectResources.bundle to the app root (Swift Package Manager).
// Usage: node scripts/prepare-native.mjs [--android] [--ios]     (both when neither is given)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const wantAndroid = args.includes('--android') || !args.includes('--ios');
const wantIos = args.includes('--ios') || !args.includes('--android');

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...opts });
  if (r.error) {
    // The command could not be started at all (not installed, not on PATH), so there is no exit status to report.
    console.error(`${cmd} could not be run: ${r.error.message}`);
    process.exit(1);
  }
  if (r.signal) {
    console.error(`${cmd} ${cmdArgs.join(' ')} was stopped by ${r.signal}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`${cmd} ${cmdArgs.join(' ')} failed`);
    process.exit(r.status ?? 1);
  }
}

if (!fs.existsSync(path.join(root, 'capacitor.config.json'))) {
  console.error('capacitor.config.json is missing: cp capacitor.config.example.json capacitor.config.json, then put your appKey and postMessageUrl in it.');
  process.exit(1);
}

run('npx', ['ng', 'build']);

function patchAndroid() {
  const dir = path.join(root, 'android');
  if (!fs.existsSync(dir)) run('npx', ['cap', 'add', 'android']);

  // Each edit is checked afterwards: a Capacitor template that no longer matches must stop the script, not print "set".
  const vars = path.join(dir, 'variables.gradle');
  const varsText = fs.readFileSync(vars, 'utf8').replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 26');
  if (!/minSdkVersion\s*=\s*26\b/.test(varsText)) {
    console.error(`android: could not set minSdkVersion 26 in ${vars} (no "minSdkVersion = <number>" line found). Set it by hand, see the plugin README.`);
    process.exit(1);
  }
  fs.writeFileSync(vars, varsText);

  const gradle = path.join(dir, 'build.gradle');
  let text = fs.readFileSync(gradle, 'utf8');
  if (!text.includes('go-acoustic/Android_Maven')) {
    text = text.replace(
      /(allprojects\s*\{\s*repositories\s*\{)/,
      `$1
        maven {
            url "https://raw.githubusercontent.com/go-acoustic/Android_Maven/master"
            content { includeGroup "io.github.go-acoustic" }
        }`
    );
    if (!text.includes('go-acoustic/Android_Maven')) {
      console.error(`android: could not add the Connect Maven repository to ${gradle} (no "allprojects { repositories {" block found). Add it by hand, see the plugin README.`);
      process.exit(1);
    }
    fs.writeFileSync(gradle, text);
  }
  console.log('android: minSdkVersion 26 and the Connect Maven repository are set');
}

const RUBY = `
require 'xcodeproj'
proj = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = proj.targets.find { |t| t.name == 'App' }
name = 'Copy ConnectResources.bundle'
if target.build_phases.any? { |p| p.display_name == name }
  puts 'ios: the ConnectResources.bundle phase is already there'
else
  phase = target.new_shell_script_build_phase(name)
  phase.shell_script = <<~SH
    SRC="\${TARGET_BUILD_DIR}/\${FRAMEWORKS_FOLDER_PATH}/Connect.framework/ConnectResources.bundle"
    DEST="\${TARGET_BUILD_DIR}/\${UNLOCALIZED_RESOURCES_FOLDER_PATH}/ConnectResources.bundle"
    if [ -d "$SRC" ]; then rm -rf "$DEST"; cp -R "$SRC" "$DEST"; fi
  SH
  phase.input_paths = ['\${TARGET_BUILD_DIR}/\${FRAMEWORKS_FOLDER_PATH}/Connect.framework/ConnectResources.bundle']
  phase.output_paths = ['\${TARGET_BUILD_DIR}/\${UNLOCALIZED_RESOURCES_FOLDER_PATH}/ConnectResources.bundle']
  proj.save
  puts 'ios: added the ConnectResources.bundle Run Script phase'
end
`;

function patchIos() {
  // The Run Script phase is added with the xcodeproj gem (it ships with CocoaPods), so check for it before touching anything.
  if (process.platform !== 'darwin') {
    if (args.includes('--ios')) {
      console.error('ios: the iOS project can only be prepared on macOS.');
      process.exit(1);
    }
    console.warn('ios: skipped, the iOS project can only be prepared on macOS.');
    return;
  }
  const gem = spawnSync('ruby', ['-e', "require 'xcodeproj'"], { cwd: root, stdio: 'pipe' });
  if (gem.error || gem.status !== 0) {
    console.error("ios: Ruby with the xcodeproj gem is needed to add the ConnectResources.bundle phase. Install it with 'gem install xcodeproj' (or 'brew install cocoapods'), then run this again.");
    process.exit(1);
  }
  if (!fs.existsSync(path.join(root, 'ios'))) run('npx', ['cap', 'add', 'ios']);
  run('ruby', ['-e', RUBY]);
}

if (wantAndroid) patchAndroid();
if (wantIos) patchIos();
run('npx', ['cap', 'sync']);
console.log('\nDone. Run it with:  npx cap run android   or   npx cap run ios   (or open android/ or ios/App in the IDE)');
