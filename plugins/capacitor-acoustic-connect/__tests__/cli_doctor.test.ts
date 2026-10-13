/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { diagnose, parseArgs } = require('../cli/doctor.cjs');

const CLI = path.join(__dirname, '..', 'cli', 'index.cjs');
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const URL = 'https://collector.example.org/collector/collectorPost';
const GROUP = 'group.co.acoustic.example';
const MAVEN = 'https://raw.githubusercontent.com/go-acoustic/Android_Maven/master';

type Status = 'ok' | 'warn' | 'fail' | 'skip';
interface Check {
  id: string;
  status: Status;
  message: string;
}

/** An app folder with only what the test names. */
function app(files: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-doctor-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}
const block = (over: Record<string, unknown> = {}) => ({
  plugins: { AcousticConnect: { appKey: KEY, postMessageUrl: URL, ...over } },
});
const run = (dir: string, over: Record<string, unknown> = {}) =>
  diagnose({ dir, nodeVersion: '22.1.0', ...over }) as Check[];
const find = (checks: Check[], id: string) => {
  const check = checks.find((c) => c.id === id);
  if (!check) throw new Error(`no check ${id} in ${checks.map((c) => c.id).join(', ')}`);
  return check;
};

const GOOGLE = (pkg: string) => ({
  project_info: {},
  client: [{ client_info: { android_client_info: { package_name: pkg } } }],
});
const PBX = (entitlements?: string) =>
  `// !$*UTF8*$!\nbuildSettings = {\n\tPRODUCT_BUNDLE_IDENTIFIER = co.acoustic.example;\n${entitlements ? `\tCODE_SIGN_ENTITLEMENTS = ${entitlements};\n` : ''}};\n`;
const ENT = (group = GROUP) =>
  `<?xml version="1.0"?><plist version="1.0"><dict><key>aps-environment</key><string>development</string><key>com.apple.security.application-groups</key><array><string>${group}</string></array></dict></plist>`;
const INFO = (modes: string[] = []) =>
  `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleName</key><string>App</string>${
    modes.length
      ? `<key>UIBackgroundModes</key><array>${modes.map((m) => `<string>${m}</string>`).join('')}</array>`
      : ''
  }</dict></plist>`;

describe('parseArgs', () => {
  it('takes the folder and the flags', () => {
    expect(parseArgs(['/app', '--require-push'])).toEqual({ dir: '/app', requirePush: true });
    expect(parseArgs([])).toEqual({ dir: process.cwd(), requirePush: false });
  });
  it.each([[['--bogus']], [['a', 'b']]])('rejects %j', (args) => {
    expect(() => parseArgs(args)).toThrow();
  });
});

describe('the config', () => {
  it('fails when the app has no config the plugin could read, and says to sync', () => {
    const c = find(run(app()), 'config');
    expect(c.status).toBe('fail');
    expect(c.message).toMatch(/cap sync/);
  });

  it('reads the config of the app, or the copy that cap sync leaves in the Android project', () => {
    expect(find(run(app({ 'capacitor.config.json': block() })), 'config').status).toBe('ok');
    expect(find(run(app({ 'android/app/src/main/assets/capacitor.config.json': block() })), 'config').status).toBe(
      'ok',
    );
  });

  it('fails on a config that is not JSON, instead of reading the older copy that cap sync left behind', () => {
    const c = find(
      run(app({ 'capacitor.config.json': '{ nope', 'android/app/src/main/assets/capacitor.config.json': block() })),
      'config',
    );
    expect(c.status).toBe('fail');
    expect(c.message).toMatch(/capacitor\.config\.json/);
    expect(c.message).toMatch(/not valid JSON/);
  });

  it('fails without the AcousticConnect block', () => {
    expect(find(run(app({ 'capacitor.config.json': { appId: 'x' } })), 'config').status).toBe('fail');
  });

  it.each([[''], ['YOUR_CONNECT_APP_KEY_HERE'], ['  ']])('fails for the app key %j', (appKey) => {
    expect(find(run(app({ 'capacitor.config.json': block({ appKey }) })), 'app-key').status).toBe('fail');
  });

  it('accepts a real app key', () => {
    expect(find(run(app({ 'capacitor.config.json': block() })), 'app-key').status).toBe('ok');
  });

  it.each([
    ['', 'fail'],
    ['not a url', 'fail'],
    ['http://collector.example.org/post', 'fail'],
    ['https://collector.example.com/collector/collectorPost', 'fail'],
    ['https://collector.example.org/collector/collectorPost', 'ok'],
    ['http://localhost:9877/collector/collectorPost', 'warn'],
    ['http://10.0.2.2:9877/collector/collectorPost', 'warn'],
  ])('post URL %j is %s', (postMessageUrl, status) => {
    expect(find(run(app({ 'capacitor.config.json': block({ postMessageUrl }) })), 'post-url').status).toBe(status);
  });

  it('wants a https kill switch URL when the kill switch is on', () => {
    expect(find(run(app({ 'capacitor.config.json': block({ killSwitchEnabled: true }) })), 'kill-switch').status).toBe(
      'fail',
    );
    expect(
      find(
        run(
          app({
            'capacitor.config.json': block({
              killSwitchEnabled: true,
              killSwitchUrl: 'https://c.example.org/switch/k',
            }),
          }),
        ),
        'kill-switch',
      ).status,
    ).toBe('ok');
    expect(find(run(app({ 'capacitor.config.json': block() })), 'kill-switch').status).toBe('skip');
  });
});

describe('the Node version', () => {
  it('fails below 22, which the Capacitor 8 toolchain needs', () => {
    const dir = app({ 'capacitor.config.json': block() });
    expect(find(run(dir, { nodeVersion: '20.19.0' }), 'node').status).toBe('fail');
    expect(find(run(dir, { nodeVersion: '22.0.0' }), 'node').status).toBe('ok');
  });
});

describe('the Node version of the run itself', () => {
  it('is named in the message when it is not given', () => {
    const checks = diagnose({ dir: app({ 'capacitor.config.json': block() }) }) as Check[];
    expect(find(checks, 'node').message).toMatch(/^Node \d+\.\d+/);
  });
});

describe('Android', () => {
  const android = (over: Record<string, unknown> = {}) =>
    app({
      'capacitor.config.json': block(),
      'android/variables.gradle': 'ext {\n    minSdkVersion = 26\n}\n',
      'android/build.gradle': `allprojects { repositories { google()\n maven { url "${MAVEN}" } } }`,
      'android/app/build.gradle': 'android { defaultConfig { applicationId "co.acoustic.example" } }',
      ...over,
    });

  it('skips everything about Android when the app has no Android project', () => {
    const checks = run(app({ 'capacitor.config.json': block() }));
    for (const id of ['min-sdk', 'maven', 'application-id']) expect(find(checks, id).status).toBe('skip');
  });

  it.each([
    ['ext { minSdkVersion = 24 }', 'fail'],
    ['ext { minSdkVersion = 26 }', 'ok'],
    ['ext { minSdkVersion = 29 }', 'ok'],
    ['ext { }', 'warn'],
  ])('the minSdkVersion in %j is %s', (gradle, status) => {
    expect(find(run(android({ 'android/variables.gradle': gradle })), 'min-sdk').status).toBe(status);
  });

  it('wants the Connect Maven tree in android/build.gradle, unless useRelease takes Connect from Maven Central', () => {
    expect(find(run(android()), 'maven').status).toBe('ok');
    expect(
      find(run(android({ 'android/build.gradle': 'allprojects { repositories { google() } }' })), 'maven').status,
    ).toBe('fail');
    expect(
      find(
        run(
          android({
            'capacitor.config.json': block({ useRelease: true }),
            'android/build.gradle': 'allprojects { repositories { google() } }',
          }),
        ),
        'maven',
      ).status,
    ).toBe('skip');
  });

  it('reads the application id, and warns when it cannot', () => {
    expect(find(run(android()), 'application-id').message).toContain('co.acoustic.example');
    expect(find(run(android({ 'android/app/build.gradle': 'android { }' })), 'application-id').status).toBe('warn');
  });

  describe('push', () => {
    const push = (over: Record<string, unknown> = {}) =>
      android({ 'capacitor.config.json': block({ pushEnabled: true }), ...over });

    it('is not checked while pushEnabled is off, and is when it is on or asked for', () => {
      expect(find(run(android()), 'google-services').status).toBe('skip');
      expect(find(run(android(), { requirePush: true }), 'google-services').status).toBe('fail');
      expect(find(run(push()), 'google-services').status).toBe('fail');
    });

    it('wants a google-services.json with a client for the application id, and names both when they differ', () => {
      expect(
        find(run(push({ 'android/app/google-services.json': GOOGLE('co.acoustic.example') })), 'google-services')
          .status,
      ).toBe('ok');
      const c = find(run(push({ 'android/app/google-services.json': GOOGLE('co.other.app') })), 'google-services');
      expect(c.status).toBe('fail');
      expect(c.message).toContain('co.other.app');
      expect(c.message).toContain('co.acoustic.example');
    });

    it('fails on a google-services.json that is not JSON', () => {
      expect(find(run(push({ 'android/app/google-services.json': '{ nope' })), 'google-services').status).toBe('fail');
    });
  });
});

describe('the SDK versions of the config', () => {
  const version = (block: Record<string, unknown>, files: Record<string, unknown> = {}) =>
    run(
      app({
        'capacitor.config.json': block
          ? { plugins: { AcousticConnect: { appKey: KEY, postMessageUrl: URL, ...block } } }
          : {},
        ...files,
      }),
    );

  it('skips them when the config names none', () => {
    const checks = version({});
    expect(find(checks, 'android-version').status).toBe('skip');
    expect(find(checks, 'ios-version').status).toBe('skip');
  });

  it.each([
    ['11.1.10-beta', 'ok'],
    ['11.0.24', 'ok'],
    ['10.9.9', 'fail'],
    ['12.0.0', 'fail'],
    ['11.x', 'fail'],
    ['latest', 'fail'],
    ['', 'skip'],
  ])('androidVersion %j is %s: the supported range is 11.0.21 up to 12', (androidVersion, status) => {
    expect(find(version({ androidVersion }), 'android-version').status).toBe(status);
  });

  it('fails a beta androidVersion when useRelease rejects every beta', () => {
    const c = find(version({ androidVersion: '11.1.10-beta', useRelease: true }), 'android-version');
    expect(c.status).toBe('fail');
    expect(c.message).toMatch(/useRelease/);
  });

  it.each([
    ['2.1.18', 'ok'],
    ['2.1.15', 'ok'],
    ['2.1.13', 'fail'],
    ['2.1', 'fail'],
    ['latest', 'fail'],
    ['', 'skip'],
  ])('iosVersion %j is %s: the plugin needs the SDK it pins or newer', (iosVersion, status) => {
    expect(find(version({ iosVersion }), 'ios-version').status).toBe(status);
  });

  it('warns that iosVersion does nothing in a Swift Package Manager app, where the plugin pins the SDK in its Package.swift', () => {
    const spm = find(
      version({ iosVersion: '2.1.18' }, { 'ios/App/App.xcodeproj/project.pbxproj': PBX() }),
      'ios-version',
    );
    expect(spm.status).toBe('warn');
    expect(spm.message).toMatch(/Swift Package Manager/);
    const pods = find(
      version(
        { iosVersion: '2.1.18' },
        { 'ios/App/App.xcodeproj/project.pbxproj': PBX(), 'ios/App/Podfile': "target 'App' do\nend\n" },
      ),
      'ios-version',
    );
    expect(pods.status).toBe('ok');
  });
});

describe('iOS', () => {
  const ios = (over: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}) =>
    app({
      'capacitor.config.json': block(cfg),
      'ios/App/App.xcodeproj/project.pbxproj': PBX('App/App.entitlements') + ' ConnectResources.bundle ',
      'ios/App/App/App.entitlements': ENT(),
      'ios/App/App/Info.plist': INFO(['remote-notification']),
      ...over,
    });

  it('skips everything about iOS when the app has no iOS project', () => {
    const checks = run(app({ 'capacitor.config.json': block() }));
    for (const id of ['ios-entitlements', 'ios-background-mode', 'ios-resources'])
      expect(find(checks, id).status).toBe('skip');
  });

  it('wants, for push, the aps-environment entitlement the project points to', () => {
    expect(find(run(ios({}, { pushEnabled: true })), 'ios-entitlements').status).toBe('ok');
    const none = ios({ 'ios/App/App.xcodeproj/project.pbxproj': PBX() }, { pushEnabled: true });
    expect(find(run(none), 'ios-entitlements').status).toBe('fail');
    const noKey = ios(
      { 'ios/App/App/App.entitlements': '<plist version="1.0"><dict></dict></plist>' },
      { pushEnabled: true },
    );
    expect(find(run(noKey), 'ios-entitlements').status).toBe('fail');
    expect(
      find(
        run(ios({ 'ios/App/App/App.entitlements': '<plist version="1.0"><dict></dict></plist>' })),
        'ios-entitlements',
      ).status,
    ).toBe('skip');
  });

  it("reads the app's own entitlements and Info.plist when the extensions' settings come first in the project file", () => {
    const pbx =
      '// !$*UTF8*$!\nbuildSettings = {\n\tCODE_SIGN_ENTITLEMENTS = ConnectNSE/ConnectNSE.entitlements;\n\tINFOPLIST_FILE = "ConnectNSE/ConnectNSE-Info.plist";\n};\n' +
      'buildSettings = {\n\tCODE_SIGN_ENTITLEMENTS = ConnectNCE/ConnectNCE.entitlements;\n\tINFOPLIST_FILE = ConnectNCE/ConnectNCE-Info.plist;\n};\n' +
      'buildSettings = {\n\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n\tINFOPLIST_FILE = App/Info.plist;\n};\n ConnectResources.bundle';
    const checks = run(
      ios(
        {
          'ios/App/App.xcodeproj/project.pbxproj': pbx,
          'ios/App/ConnectNSE/ConnectNSE.entitlements': '<plist><dict></dict></plist>',
          'ios/App/ConnectNSE/ConnectNSE-Info.plist': INFO(),
        },
        { pushEnabled: true },
      ),
    );
    expect(find(checks, 'ios-entitlements').status).toBe('ok');
    expect(find(checks, 'ios-background-mode').status).toBe('ok');
  });

  it('wants, for push, the remote-notification background mode', () => {
    expect(find(run(ios({}, { pushEnabled: true })), 'ios-background-mode').status).toBe('ok');
    expect(
      find(run(ios({ 'ios/App/App/Info.plist': INFO() }, { pushEnabled: true })), 'ios-background-mode').status,
    ).toBe('fail');
  });

  it('warns when a Swift Package Manager app does not copy ConnectResources.bundle', () => {
    expect(find(run(ios()), 'ios-resources').status).toBe('ok');
    expect(find(run(ios({ 'ios/App/App.xcodeproj/project.pbxproj': PBX() })), 'ios-resources').status).toBe('warn');
  });

  it('does not ask for the bundle of an app that uses CocoaPods, where the pod brings it', () => {
    const pods = ios({ 'ios/App/Podfile': "target 'App' do\nend\n", 'ios/App/App.xcodeproj/project.pbxproj': PBX() });
    expect(find(run(pods), 'ios-resources').status).toBe('skip');
  });

  describe('rich push', () => {
    const extensions = (group = GROUP, over: Record<string, unknown> = {}) => ({
      'ios/App/ConnectNSE/ConnectNSE.entitlements': ENT(group),
      'ios/App/ConnectNSE/NotificationService.swift': `final class NotificationService { override var appGroupIdentifier: String? { "${group}" } }`,
      'ios/App/ConnectNCE/ConnectNCE.entitlements': ENT(group),
      'ios/App/ConnectNCE/NotificationViewController.swift': `final class NotificationViewController { override var appGroupIdentifier: String? { "${group}" } }`,
      ...over,
    });

    it('points to setup-ios-push when push is on and the extensions are missing, as a warning (push works without them)', () => {
      const c = find(run(ios({}, { pushEnabled: true })), 'ios-extensions');
      expect(c.status).toBe('warn');
      expect(c.message).toMatch(/setup-ios-push/);
    });

    it('is satisfied when the extensions and the app share the App Group', () => {
      expect(find(run(ios(extensions(), { pushEnabled: true })), 'ios-extensions').status).toBe('ok');
    });

    it('fails when an extension has another App Group than the app, which would leave the notification without its data', () => {
      const c = find(run(ios(extensions('group.co.other'), { pushEnabled: true })), 'ios-extensions');
      expect(c.status).toBe('fail');
      expect(c.message).toContain('group.co.other');
    });

    it('fails when iosAppGroupIdentifier of the config is not the group of the extensions', () => {
      const c = find(
        run(ios(extensions(), { pushEnabled: true, iosAppGroupIdentifier: 'group.co.config' })),
        'ios-extensions',
      );
      expect(c.status).toBe('fail');
      expect(c.message).toContain('group.co.config');
    });
  });
});

describe('the acoustic-connect doctor command', () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

  it('exits 1 and says what is wrong when a check fails', () => {
    const r = cli('doctor', app({ 'capacitor.config.json': block({ appKey: 'YOUR_KEY' }) }));
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/app-key|app key/i);
  });

  it('exits 0 when nothing fails, whatever it warns about', () => {
    const r = cli(
      'doctor',
      app({ 'capacitor.config.json': block({ postMessageUrl: 'http://localhost:9877/collector/collectorPost' }) }),
    );
    expect(r.status).toBe(0);
  });

  it('is in the usage of the command', () => {
    expect(cli().stderr).toMatch(/doctor/);
  });

  it('is described in the README, with what it checks and that --require-push turns the push checks into failures', () => {
    const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    expect(readme).toContain('npx acoustic-connect doctor');
    expect(readme).toContain('--require-push');
  });
});

export {};
