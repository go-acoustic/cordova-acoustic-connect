/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The Ruby script behind `acoustic-connect setup-ios-push` edits an Xcode project, so it is run on a copy of the project of a Capacitor
// app (the template's, as DemoCapacitor had it before it got push) and the result is read back with the same gem. It needs ruby and the
// xcodeproj gem, which CocoaPods brings: without them these tests are skipped.

const CLI = path.join(__dirname, '..', 'cli', 'index.cjs');
const FIXTURE = path.join(__dirname, 'fixtures', 'ios-app');
const GROUP = 'group.co.acoustic.example';

const hasXcodeproj = spawnSync('ruby', ['-rxcodeproj', '-e', '1']).status === 0;
const describeIfXcodeproj = hasXcodeproj ? describe : describe.skip;

function copyApp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-ext-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function setup(dir: string, ...extra: string[]) {
  const r = spawnSync(process.execPath, [CLI, 'setup-ios-push', dir, '--app-group', GROUP, ...extra], {
    encoding: 'utf8',
  });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

interface Target {
  name: string;
  type: string;
  settings: Record<string, string>;
  sources: string[];
  products: string[];
  dependencies: string[];
  embedded: string[];
}
interface Result {
  targets: Record<string, Target>;
  packages: { url: string; kind: string; version: string }[];
  embedPhases: number;
}

/** What the project says now, as JSON, by the same gem the script uses. */
function inspect(dir: string): Result {
  const code = `
    require 'xcodeproj'; require 'json'
    project = Xcodeproj::Project.open(ARGV[0])
    out = { targets: {}, packages: [], embedPhases: 0 }
    project.native_targets.each do |t|
      cfg = t.build_configurations.find { |c| c.name == 'Debug' }
      out[:targets][t.name] = {
        name: t.name, type: t.product_type.to_s,
        settings: cfg.build_settings.transform_values { |v| v.is_a?(Array) ? v.join(' ') : v.to_s },
        sources: t.source_build_phase.files.map { |f| f.file_ref ? f.file_ref.path.to_s : '' },
        products: t.package_product_dependencies.map { |d| d.product_name },
        dependencies: t.dependencies.map { |d| d.target ? d.target.name : '' },
        embedded: t.copy_files_build_phases.flat_map { |p| p.files.map { |f| f.file_ref ? f.file_ref.path.to_s : '' } }
      }
      out[:embedPhases] += t.copy_files_build_phases.count { |p| p.name == 'Embed Foundation Extensions' }
    end
    project.root_object.package_references.each do |r|
      next unless r.respond_to?(:repositoryURL)
      out[:packages] << { url: r.repositoryURL, kind: r.requirement['kind'], version: (r.requirement['minimumVersion'] || r.requirement['version']).to_s }
    end
    puts JSON.generate(out)
  `;
  const r = spawnSync('ruby', ['-e', code, path.join(dir, 'ios', 'App', 'App.xcodeproj')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

const plist = (file: string) => spawnSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }).stdout;

describeIfXcodeproj('setup-ios-push on the Xcode project of a Capacitor app', () => {
  jest.setTimeout(120000);

  it('adds the two extension targets, with their sources, Info.plist and entitlements', () => {
    const dir = copyApp();
    expect(setup(dir).status).toBe(0);
    const { targets } = inspect(dir);
    for (const [name, source] of [
      ['ConnectNSE', 'NotificationService.swift'],
      ['ConnectNCE', 'NotificationViewController.swift'],
    ]) {
      const t = targets[name];
      expect(t.type).toBe('com.apple.product-type.app-extension');
      expect(t.sources).toContain(source);
      expect(t.settings.PRODUCT_BUNDLE_IDENTIFIER).toBe(`${targets.App.settings.PRODUCT_BUNDLE_IDENTIFIER}.${name}`);
      expect(t.settings.INFOPLIST_FILE).toBe(`${name}/${name}-Info.plist`);
      expect(t.settings.CODE_SIGN_ENTITLEMENTS).toBe(`${name}/${name}.entitlements`);
      expect(t.settings.SKIP_INSTALL).toBe('YES');
      expect(t.settings.IPHONEOS_DEPLOYMENT_TARGET).toBe(targets.App.settings.IPHONEOS_DEPLOYMENT_TARGET);
      expect(t.settings.APPLICATION_EXTENSION_API_ONLY).toBe('YES');
    }
  });

  it("gives the extensions the app's version, which the App Store requires of an app and its extensions", () => {
    const dir = copyApp();
    setup(dir);
    const { targets } = inspect(dir);
    for (const name of ['ConnectNSE', 'ConnectNCE']) {
      expect(targets[name].settings.MARKETING_VERSION).toBe(targets.App.settings.MARKETING_VERSION);
      expect(targets[name].settings.CURRENT_PROJECT_VERSION).toBe(targets.App.settings.CURRENT_PROJECT_VERSION);
    }
  });

  it('links the Connect SDK into both extensions through Swift Package Manager, from the version the plugin requires', () => {
    const dir = copyApp();
    setup(dir);
    const { targets, packages } = inspect(dir);
    const pin = /Connect-SP[^\n]*(?:exact|from):\s*"([\d.]+)"/.exec(
      fs.readFileSync(path.join(__dirname, '..', 'Package.swift'), 'utf8'),
    )?.[1];
    expect(packages.filter((p) => /Connect-SP/.test(p.url))).toEqual([
      { url: 'https://github.com/go-acoustic/Connect-SP.git', kind: 'upToNextMajorVersion', version: pin },
    ]);
    expect(targets.ConnectNSE.products).toEqual(['Connect']);
    expect(targets.ConnectNCE.products).toEqual(['Connect']);
  });

  it('makes the app depend on the extensions and embed them', () => {
    const dir = copyApp();
    setup(dir);
    const { targets, embedPhases } = inspect(dir);
    expect(targets.App.dependencies).toEqual(expect.arrayContaining(['ConnectNSE', 'ConnectNCE']));
    expect(targets.App.embedded).toEqual(expect.arrayContaining(['ConnectNSE.appex', 'ConnectNCE.appex']));
    expect(embedPhases).toBe(1);
  });

  it('gives the app the push entitlement and the App Group, and the background mode, when it has none of them', () => {
    const dir = copyApp();
    setup(dir);
    const { targets } = inspect(dir);
    expect(targets.App.settings.CODE_SIGN_ENTITLEMENTS).toBe('App/App.entitlements');
    const entitlements = JSON.parse(plist(path.join(dir, 'ios', 'App', 'App', 'App.entitlements')));
    expect(entitlements['aps-environment']).toBe('development');
    expect(entitlements['com.apple.security.application-groups']).toEqual([GROUP]);
    const info = JSON.parse(plist(path.join(dir, 'ios', 'App', 'App', 'Info.plist')));
    expect(info.UIBackgroundModes).toContain('remote-notification');
  });

  it("keeps what the app's entitlements and background modes already have", () => {
    const dir = copyApp();
    fs.writeFileSync(
      path.join(dir, 'ios', 'App', 'App', 'App.entitlements'),
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
        '<plist version="1.0"><dict><key>aps-environment</key><string>production</string><key>com.apple.security.application-groups</key>' +
        '<array><string>group.other</string></array></dict></plist>',
    );
    spawnSync('/usr/libexec/PlistBuddy', [
      '-c',
      'Add :UIBackgroundModes array',
      '-c',
      'Add :UIBackgroundModes:0 string fetch',
      path.join(dir, 'ios', 'App', 'App', 'Info.plist'),
    ]);
    setup(dir);
    const entitlements = JSON.parse(plist(path.join(dir, 'ios', 'App', 'App', 'App.entitlements')));
    expect(entitlements['aps-environment']).toBe('production');
    expect(entitlements['com.apple.security.application-groups']).toEqual(['group.other', GROUP]);
    expect(JSON.parse(plist(path.join(dir, 'ios', 'App', 'App', 'Info.plist'))).UIBackgroundModes).toEqual([
      'fetch',
      'remote-notification',
    ]);
  });

  it('puts the development team on the app and the extensions when given one', () => {
    const dir = copyApp();
    setup(dir, '--team', 'ABCDE12345');
    const { targets } = inspect(dir);
    for (const name of ['App', 'ConnectNSE', 'ConnectNCE'])
      expect(targets[name].settings.DEVELOPMENT_TEAM).toBe('ABCDE12345');
  });

  it('is safe to run again: nothing is added twice', () => {
    const dir = copyApp();
    setup(dir);
    const once = inspect(dir);
    const again = setup(dir);
    expect(again.status).toBe(0);
    const twice = inspect(dir);
    expect(twice).toEqual(once);
    expect(Object.keys(twice.targets).filter((n) => n.startsWith('Connect'))).toEqual(['ConnectNSE', 'ConnectNCE']);
    const entitlements = JSON.parse(plist(path.join(dir, 'ios', 'App', 'App', 'App.entitlements')));
    expect(entitlements['com.apple.security.application-groups']).toEqual([GROUP]);
  });
});

export {};
