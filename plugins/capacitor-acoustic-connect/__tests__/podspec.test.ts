/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The podspec reads `iosVersion` of the plugin block of the app's config when `pod install` evaluates it, as the RN podspec reads
// iOSVersion of ConnectConfig.json: the pin of the Connect iOS SDK then is the app's, with the plugin's pin as the floor.
// The spec is evaluated with `pod ipc spec`; without CocoaPods these tests are skipped.

// Named for the package: with the beta name in the private repo, with the release name in the public one.
const PODSPEC = path.join(
  __dirname,
  '..',
  fs.readdirSync(path.join(__dirname, '..')).find((f: string) => f.endsWith('.podspec')) as string,
);
const hasPod = spawnSync('pod', ['--version']).status === 0;
const describeIfPod = hasPod ? describe : describe.skip;

function dependencyOf(block: Record<string, unknown> | null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-podspec-'));
  const env = { ...process.env, LANG: 'en_US.UTF-8' } as Record<string, string>;
  if (block !== null) {
    const file = path.join(dir, 'capacitor.config.json');
    fs.writeFileSync(file, JSON.stringify({ plugins: { AcousticConnect: block } }));
    env.ACOUSTIC_APP_CONFIG = file;
  } else {
    env.ACOUSTIC_APP_CONFIG = path.join(dir, 'there-is-no-such-file.json');
  }
  const r = spawnSync('pod', ['ipc', 'spec', PODSPEC], { encoding: 'utf8', env });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) return { error: `${r.stdout}\n${r.stderr}` };
  return { requirement: JSON.parse(r.stdout).dependencies.AcousticConnect as string[] };
}

describeIfPod('the podspec and iosVersion', () => {
  jest.setTimeout(120000);
  const pin = /Connect-SP[^\n]*exact:\s*"([\d.]+)"/.exec(
    fs.readFileSync(path.join(__dirname, '..', 'Package.swift'), 'utf8'),
  )?.[1];

  it('pins the SDK of the plugin when the app names no version, or no config', () => {
    expect(dependencyOf(null)).toEqual({ requirement: [pin] });
    expect(dependencyOf({ appKey: 'k' })).toEqual({ requirement: [pin] });
    expect(dependencyOf({ iosVersion: '' })).toEqual({ requirement: [pin] });
    expect(dependencyOf({ iosVersion: '  ' })).toEqual({ requirement: [pin] });
  });

  it('takes the version of the app, with the pin of the plugin as the floor', () => {
    expect(dependencyOf({ iosVersion: '2.1.18' })).toEqual({ requirement: [`>= ${pin}`, '= 2.1.18'] });
    expect(dependencyOf({ iosVersion: ' 2.1.18 ' })).toEqual({ requirement: [`>= ${pin}`, '= 2.1.18'] });
  });

  it.each([['latest'], ['2.1'], ['2.x'], ['2.1.18.1'], [2], [true]])(
    'stops, naming iosVersion, for %j',
    (iosVersion) => {
      const r = dependencyOf({ iosVersion });
      expect(r.error).toMatch(/iosVersion/);
    },
  );

  it('stays the pin of the plugin when the config cannot be read', () => {
    // a config that is not JSON is the app's problem to see elsewhere; the SDK version is then the plugin's
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-podspec-'));
    const file = path.join(dir, 'capacitor.config.json');
    fs.writeFileSync(file, '{ nope');
    const r = spawnSync('pod', ['ipc', 'spec', PODSPEC], {
      encoding: 'utf8',
      env: { ...process.env, ACOUSTIC_APP_CONFIG: file },
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(JSON.parse(r.stdout).dependencies.AcousticConnect).toEqual([pin]);
  });
});

describeIfPod('the podspec outside of pod install', () => {
  jest.setTimeout(120000);

  it('still evaluates when CocoaPods has no installation root to give', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-podspec-'));
    const prelude = path.join(dir, 'no_root.rb');
    // loaded into the pod process with RUBYOPT, after CocoaPods itself
    fs.writeFileSync(
      prelude,
      "require 'cocoapods'\nPod::Config.instance.define_singleton_method(:installation_root) { raise NoMethodError, 'no root' }\n",
    );
    const env = { ...process.env, LANG: 'en_US.UTF-8', RUBYOPT: `-r${prelude}` } as Record<string, string>;
    delete env.ACOUSTIC_APP_CONFIG;
    const r = spawnSync('pod', ['ipc', 'spec', PODSPEC], { encoding: 'utf8', env });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.stderr).not.toMatch(/no root/);
    expect(r.status).toBe(0);
  });
});

export {};

describe('the SDK pin of the podspec', () => {
  // Plain text comparison, so that drift is caught on CI without CocoaPods too.
  it('is the exact version of Package.swift', () => {
    const swift = /Connect-SP[^\n]*exact:\s*"([\d.]+)"/.exec(
      fs.readFileSync(path.join(__dirname, '..', 'Package.swift'), 'utf8'),
    )?.[1];
    const ruby = /^SDK_PIN\s*=\s*'([\d.]+)'/m.exec(fs.readFileSync(PODSPEC, 'utf8'))?.[1];
    expect(swift).toBeDefined();
    expect(ruby).toBe(swift);
  });
});
