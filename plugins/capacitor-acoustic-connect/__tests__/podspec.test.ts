/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { RELEASE_FLOOR, DEBUG_FLOOR } = require('../cli/setup-ios-push.cjs');

// The podspec reads `useRelease` and `iosVersion` of the plugin block of the app's config when `pod install` evaluates it, as the RN
// podspec reads ConnectConfig.json: the pod is the beta SDK (AcousticConnectDebug) unless useRelease is true, and the pin of the Connect
// iOS SDK then is the app's, with the plugin's floor. The spec is evaluated with `pod ipc spec`; without CocoaPods these tests are skipped.

// Named for the package: with the beta name in the private repo, with the release name in the public one.
const PODSPEC = path.join(
  __dirname,
  '..',
  fs.readdirSync(path.join(__dirname, '..')).find((f: string) => f.endsWith('.podspec')) as string,
);
const hasPod = spawnSync('pod', ['--version']).status === 0;
const describeIfPod = hasPod ? describe : describe.skip;

const podspecText = fs.readFileSync(PODSPEC, 'utf8');
const SDK_FLOOR = /^SDK_FLOOR\s*=\s*'([\d.]+)'/m.exec(podspecText)?.[1];
const WEB_CAPTURE_FLOOR = /^WEB_CAPTURE_FLOOR\s*=\s*'([\d.]+)'/m.exec(podspecText)?.[1];
const WEB_CAPTURE = { SWIFT_ACTIVE_COMPILATION_CONDITIONS: '$(inherited) CONNECT_WEB_CAPTURE' };

/** The Connect pod the spec asks for, its requirement and the build settings of the plugin's pod. */
interface Connect {
  pod?: string;
  requirement?: string[];
  xcconfig?: unknown;
  error?: string;
}

function connectOf(block: Record<string, unknown> | null): Connect {
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
  return specParts(r.stdout);
}

function specParts(json: string): Connect {
  const spec = JSON.parse(json);
  const pods = Object.keys(spec.dependencies).filter((name) => name !== 'Capacitor');
  expect(pods).toHaveLength(1);
  return { pod: pods[0], requirement: spec.dependencies[pods[0]] as string[], xcconfig: spec.pod_target_xcconfig };
}

describeIfPod('the podspec, useRelease and iosVersion', () => {
  jest.setTimeout(120000);
  const debug = (requirement: string[], xcconfig?: unknown) => ({ pod: 'AcousticConnectDebug', requirement, xcconfig });
  const release = (requirement: string[], xcconfig?: unknown) => ({ pod: 'AcousticConnect', requirement, xcconfig });

  it('takes the beta SDK from the first version with the web capture functions, and compiles them, when the app names nothing', () => {
    const expected = debug([`>= ${WEB_CAPTURE_FLOOR}`], WEB_CAPTURE);
    expect(connectOf(null)).toEqual(expected);
    expect(connectOf({ appKey: 'k' })).toEqual(expected);
    expect(connectOf({ iosVersion: '' })).toEqual(expected);
    expect(connectOf({ iosVersion: '  ' })).toEqual(expected);
  });

  it('takes the release SDK from the plugin floor, without the web capture functions, when useRelease is true', () => {
    expect(connectOf({ useRelease: true })).toEqual(release([`>= ${SDK_FLOOR}`]));
  });

  it.each([[false], ['true'], [1], [null]])(
    'keeps the beta SDK for useRelease %j, as anything but true is false',
    (useRelease) => {
      expect(connectOf({ useRelease })).toEqual(debug([`>= ${WEB_CAPTURE_FLOOR}`], WEB_CAPTURE));
    },
  );

  it('takes the version of the app on either pod, with the plugin floor, and compiles the web capture functions only from 2.2.35', () => {
    expect(connectOf({ iosVersion: '2.2.40' })).toEqual(debug([`>= ${SDK_FLOOR}`, '= 2.2.40'], WEB_CAPTURE));
    expect(connectOf({ iosVersion: ' 2.2.35 ' })).toEqual(debug([`>= ${SDK_FLOOR}`, '= 2.2.35'], WEB_CAPTURE));
    expect(connectOf({ iosVersion: '2.10.0' })).toEqual(debug([`>= ${SDK_FLOOR}`, '= 2.10.0'], WEB_CAPTURE));
    expect(connectOf({ iosVersion: '2.2.30' })).toEqual(debug([`>= ${SDK_FLOOR}`, '= 2.2.30']));
    expect(connectOf({ useRelease: true, iosVersion: '2.2.35' })).toEqual(
      release([`>= ${SDK_FLOOR}`, '= 2.2.35'], WEB_CAPTURE),
    );
    expect(connectOf({ useRelease: true, iosVersion: '2.1.60' })).toEqual(release([`>= ${SDK_FLOOR}`, '= 2.1.60']));
  });

  it.each([['latest'], ['2.1'], ['2.x'], ['2.1.18.1'], [2], [true]])(
    'stops, naming iosVersion, for %j',
    (iosVersion) => {
      const r = connectOf({ iosVersion });
      expect(r.error).toMatch(/iosVersion/);
    },
  );

  it('stays the default of the plugin when the config cannot be read', () => {
    // a config that is not JSON is the app's problem to see elsewhere; the SDK is then the plugin's
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-podspec-'));
    const file = path.join(dir, 'capacitor.config.json');
    fs.writeFileSync(file, '{ nope');
    const r = spawnSync('pod', ['ipc', 'spec', PODSPEC], {
      encoding: 'utf8',
      env: { ...process.env, ACOUSTIC_APP_CONFIG: file },
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(specParts(r.stdout)).toEqual(debug([`>= ${WEB_CAPTURE_FLOOR}`], WEB_CAPTURE));
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

// The public package's Package.swift links Connect-SP (the release step rewrites it); capacitor_release.test.ts checks that one.
const describeBeta = require('../package.json').name.endsWith('-beta') ? describe : describe.skip;

describeBeta('the Package.swift of the beta package', () => {
  // Read as text, so that drift is caught on CI without a Swift toolchain too. The public package's Package.swift is checked in
  // capacitor_release.test.ts, after the release step made it.
  const swift = fs.readFileSync(path.join(__dirname, '..', 'Package.swift'), 'utf8');

  it('links the beta SDK from the floor of the beta pod, and compiles the web capture code', () => {
    expect(swift).toContain(
      `.package(url: "https://github.com/go-acoustic/ConnectDebug-SP.git", from: "${WEB_CAPTURE_FLOOR}")`,
    );
    expect(swift).toContain('.product(name: "Connect", package: "ConnectDebug-SP")');
    expect(swift).toContain('swiftSettings: [.define("CONNECT_WEB_CAPTURE")]');
    expect(swift).not.toContain('Connect-SP.git');
  });

  it('asks ConnectDebug-SP for the floor of the beta pod', () => {
    expect(/ConnectDebug-SP[^\n]*(?:exact|from):\s*"([\d.]+)"/.exec(swift)?.[1]).toBe(WEB_CAPTURE_FLOOR);
  });
});

describe('the SDK floors of the podspec', () => {
  // Plain text comparison, so that drift is caught on CI without CocoaPods too.
  it('takes the beta SDK from the version Package.swift asks of ConnectDebug-SP, and the release SDK from the floor the CLI uses', () => {
    expect(WEB_CAPTURE_FLOOR).toBe('2.2.35');
    expect(SDK_FLOOR).toBe('2.1.51');
    expect(SDK_FLOOR).toBe(RELEASE_FLOOR);
    expect(WEB_CAPTURE_FLOOR).toBe(DEBUG_FLOOR);
  });
});

/** Evaluates the podspec with ACOUSTIC_PODFILE pointing at a Podfile holding `podfile`; returns what CocoaPods printed on stderr. */
function warningsFor(podfile: string | null, block: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-podspec-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ plugins: { AcousticConnect: block } }));
  const env = { ...process.env, LANG: 'en_US.UTF-8', ACOUSTIC_APP_CONFIG: path.join(dir, 'config.json') } as Record<
    string,
    string
  >;
  env.ACOUSTIC_PODFILE = path.join(dir, 'Podfile');
  if (podfile !== null) fs.writeFileSync(env.ACOUSTIC_PODFILE, podfile);
  const r = spawnSync('pod', ['ipc', 'spec', PODSPEC], { encoding: 'utf8', env });
  fs.rmSync(dir, { recursive: true, force: true });
  expect(r.status).toBe(0);
  JSON.parse(r.stdout);
  return r.stderr;
}

describeIfPod('the podspec and the CocoaPods sources of the app', () => {
  jest.setTimeout(120000);
  const PODSPECS = "source 'https://github.com/go-acoustic/PodSpecs.git'";

  it('warns during pod install when the Podfile does not name the Acoustic spec repo, and says how to add it', () => {
    for (const podfile of ["platform :ios, '15.1'\n", `# ${PODSPECS}\nsource 'https://cdn.cocoapods.org/'\n`]) {
      const stderr = warningsFor(podfile);
      expect(stderr).toMatch(/go-acoustic\/PodSpecs/);
      expect(stderr).toMatch(/setup-ios-pods/);
    }
  });

  it('says that the beta pod is only there, or with useRelease that later release versions are', () => {
    const podfile = "platform :ios, '15.1'\n";
    expect(warningsFor(podfile)).toMatch(/AcousticConnectDebug pod, 2\.2\.35 .* only there/);
    const release = warningsFor(podfile, { useRelease: true });
    expect(release).toMatch(/2 December 2026/);
    expect(release).not.toMatch(/AcousticConnectDebug/);
  });

  it('says nothing when the Podfile names it, or when there is no Podfile to read', () => {
    expect(warningsFor(`${PODSPECS}\nsource 'https://cdn.cocoapods.org/'\n`)).not.toMatch(/PodSpecs/);
    expect(warningsFor(null)).not.toMatch(/PodSpecs/);
  });
});
