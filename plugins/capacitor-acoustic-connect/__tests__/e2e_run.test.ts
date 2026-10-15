/* eslint-disable @typescript-eslint/no-var-requires */
const {
  parseArgs,
  layoutExpected,
  androidApplicationId,
  androidLaunchComponent,
  webBuildCommand,
} = require('../../../applications/DemoCapacitor/e2e/run.js');

describe('e2e runner options', () => {
  it('defaults to Android on the port the example config points at', () => {
    const o = parseArgs([]);
    expect(o).toMatchObject({ platform: 'android', port: 9877, layout: 'auto', skipBuild: false });
  });

  it('reads values and numbers', () => {
    const o = parseArgs(['--device', 'emulator-5554', '--port', '9000', '--skip-build', '--layout', 'off']);
    expect(o).toMatchObject({ device: 'emulator-5554', port: 9000, skipBuild: true, layout: 'off' });
  });

  it.each([[['--bogus']], [['--port', 'x']], [['--platform', 'web']], [['--layout', 'maybe']]])(
    'rejects %j',
    (args) => {
      expect(() => parseArgs(args)).toThrow();
    },
  );
});

describe('e2e runner phases', () => {
  it('runs the default phase unless told otherwise', () => {
    expect(parseArgs([]).phase).toBe('default');
  });

  it('takes a phase', () => {
    expect(parseArgs(['--platform', 'ios', '--phase', 'screen-capture-off']).phase).toBe('screen-capture-off');
  });

  it('rejects a phase that does not exist', () => {
    expect(() => parseArgs(['--phase', 'nope'])).toThrow(/phase must be one of/);
  });

  // On a Connect Android SDK before 11.1.10 the plugin already turns layout capture off, so "no layout" would pass
  // without the setting doing anything.
  it('needs an Android SDK that captures layout for a capture-off phase', () => {
    expect(() => parseArgs(['--phase', 'screen-capture-off'])).toThrow(/--sdk-version/);
    expect(() => parseArgs(['--phase', 'layout-config-off', '--sdk-version', '11.0.21-beta'])).toThrow(/11\.1\.10/);
    expect(parseArgs(['--phase', 'layout-config-off', '--sdk-version', '11.1.10-beta']).phase).toBe(
      'layout-config-off',
    );
  });
});

describe('e2e runner on iOS', () => {
  it('runs the example app (Swift Package Manager) unless a CocoaPods host is given', () => {
    expect(parseArgs(['--platform', 'ios']).iosHost).toBeUndefined();
  });

  it('accepts iOS and an iOS host directory', () => {
    const o = parseArgs(['--platform', 'ios', '--ios-host', '/tmp/host', '--device', 'UDID']);
    expect(o).toMatchObject({ platform: 'ios', iosHost: '/tmp/host', device: 'UDID' });
  });

  it('always expects a layout from the iOS SDK unless told otherwise', () => {
    expect(layoutExpected('auto', null, 'ios')).toBe(true);
    expect(layoutExpected('off', null, 'ios')).toBe(false);
  });
});

describe('layout expectation', () => {
  it('follows the flag when it is not auto', () => {
    expect(layoutExpected('expected', '11.0.21-beta')).toBe(true);
    expect(layoutExpected('off', '11.1.10-beta')).toBe(false);
  });

  it('auto expects a layout from the SDK that can finish a WebView layout', () => {
    expect(layoutExpected('auto', '11.0.21-beta')).toBe(false);
    expect(layoutExpected('auto', '11.1.9')).toBe(false);
    expect(layoutExpected('auto', '11.1.10-beta')).toBe(true);
    expect(layoutExpected('auto', '12.0.0')).toBe(true);
  });

  it('auto does not expect one when the version is unknown', () => {
    expect(layoutExpected('auto', null)).toBe(false);
  });
});

// The id of an Android app is the one in its Gradle file, which can differ from `appId` in capacitor.config.json (the iOS bundle
// id is separate again), so the runner reads it from there to install, clear and launch the right package.
describe('the Android application id', () => {
  it('is read from the Gradle file of the app', () => {
    const gradle =
      'android {\n    namespace = "co.acoustic.a"\n    defaultConfig {\n        applicationId "co.acoustic.b"\n    }\n}';
    expect(androidApplicationId(gradle)).toBe('co.acoustic.b');
  });

  it('accepts the Kotlin DSL and single quotes too', () => {
    expect(androidApplicationId("applicationId = 'co.acoustic.c'")).toBe('co.acoustic.c');
    expect(androidApplicationId('applicationId = "co.acoustic.d"')).toBe('co.acoustic.d');
  });

  it('is not the namespace', () => {
    expect(androidApplicationId('namespace = "co.acoustic.a"')).toBeNull();
  });
});

// The activity lives in the namespace of the app, which is not its application id when the two differ, so `appId/.MainActivity` would
// name a class that is not there.
describe('the Android launch component', () => {
  it('names the activity of the namespace under the application id', () => {
    const gradle = 'namespace = "co.acoustic.a"\ndefaultConfig {\n applicationId "co.acoustic.b"\n}';
    expect(androidLaunchComponent(gradle)).toBe('co.acoustic.b/co.acoustic.a.MainActivity');
  });

  it('is null when the Gradle file names no namespace or no id', () => {
    expect(androidLaunchComponent('applicationId "co.acoustic.b"')).toBeNull();
    expect(androidLaunchComponent('namespace = "co.acoustic.a"')).toBeNull();
  });
});

describe('the app under test', () => {
  it('takes the app directory with --app', () => {
    expect(parseArgs(['--app', '../DemoCapacitorAngular']).app).toBe('../DemoCapacitorAngular');
  });

  it('is DemoCapacitor unless told otherwise', () => {
    expect(parseArgs([]).app).toBeUndefined();
  });
});

describe('the web build of the app', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = (files: string[]) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-app-'));
    files.forEach((f) => fs.writeFileSync(path.join(d, f), '{}'));
    return d;
  };

  it('is a Vite build with VITE_E2E for an app without angular.json', () => {
    const d = dir(['vite.config.ts']);
    expect(webBuildCommand(d, true)).toEqual({ command: 'npx', args: ['vite', 'build'], env: { VITE_E2E: '1' } });
    expect(webBuildCommand(d, false)).toEqual({ command: 'npx', args: ['vite', 'build'], env: {} });
  });

  it('is an ng build with the E2E_BUILD define for an Angular app', () => {
    const d = dir(['angular.json']);
    expect(webBuildCommand(d, true)).toEqual({
      command: 'npx',
      args: ['ng', 'build', '--define', 'E2E_BUILD=true'],
      env: {},
    });
    expect(webBuildCommand(d, false)).toEqual({ command: 'npx', args: ['ng', 'build'], env: {} });
  });
});
