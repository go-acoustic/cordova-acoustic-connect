/* eslint-disable @typescript-eslint/no-var-requires */
const cordova = require('../../../applications/Demo/e2e/suite.js');
const { buildSuite, PHASES } = require('../../../applications/DemoCapacitor/e2e/suite.js');

type Row = {
  name: string;
  check?: string;
  type?: number;
  path?: string;
  expected?: unknown;
  jsonType?: string;
  nonEmpty?: boolean;
  na?: string;
};

const renamed = (r: Row) => r.name.replace('Cordova Plugin', 'Capacitor Plugin');

describe('wire suite for the Capacitor plugin', () => {
  it('is the Cordova scenario row for row: the calls and the checks cannot drift apart', () => {
    const rows: Row[] = buildSuite({ platform: 'android', layoutExpected: true, pushExpected: true }).filter(
      (r: Row) => !r.name.startsWith('push: '),
    );
    const base: Row[] = cordova.buildSuite({ platform: 'android', phase: 'default' });
    expect(rows).toHaveLength(base.length);
    expect(rows.map((r) => r.name)).toEqual(base.map(renamed));
  });

  it('expects the exception to be named after this plugin', () => {
    const rows: Row[] = buildSuite({ platform: 'android', layoutExpected: true, pushExpected: true });
    const name = rows.find((r) => r.check === 'value' && r.type === 6 && r.path === 'name');
    expect(name?.expected).toBe('Capacitor Plugin');
    expect(JSON.stringify(rows)).not.toContain('Cordova Plugin');
  });

  it('keeps the layout row when layout capture is expected', () => {
    const rows: Row[] = buildSuite({ platform: 'android', layoutExpected: true, pushExpected: true });
    expect(rows.some((r) => r.check === 'layout-controls')).toBe(true);
    expect(rows.some((r) => r.na)).toBe(false);
  });

  it('records the layout row as not applicable, with the reason, when capture is off', () => {
    const rows: Row[] = buildSuite({ platform: 'android', layoutExpected: false, pushExpected: true });
    expect(rows.some((r) => r.check === 'layout-controls')).toBe(false);
    const na = rows.filter((r) => r.na);
    expect(na).toHaveLength(1);
    expect(na[0].name).toMatch(/layout/i);
    expect(na[0].na).toMatch(/11\.1\.10/);
  });

  it('expects the push registration (type 22) when push is on', () => {
    const rows: Row[] = buildSuite({ platform: 'android', layoutExpected: true, pushExpected: true });
    expect(rows.some((r) => r.check === 'type-present' && r.type === 22)).toBe(true);
  });

  it('records the push registration as not applicable, with the reason, when push is off', () => {
    const rows: Row[] = buildSuite({ platform: 'android', layoutExpected: true, pushExpected: false });
    expect(rows.some((r) => r.check === 'type-present' && r.type === 22)).toBe(false);
    const na = rows.filter((r) => r.na && /type 22/.test(r.name));
    expect(na).toHaveLength(1);
    expect(na[0].na).toMatch(/google-services\.json/);
  });

  it('works for iOS too, with the same names', () => {
    const rows: Row[] = buildSuite({ platform: 'ios', layoutExpected: true, pushExpected: true }).filter(
      (r: Row) => !r.name.startsWith('push: '),
    );
    const base: Row[] = cordova.buildSuite({ platform: 'ios', phase: 'default' });
    expect(rows.map((r) => r.name)).toEqual(base.map(renamed));
  });

  it('has the capture phases of the Cordova suite, with the Capacitor config that sets them up', () => {
    expect(Object.keys(PHASES)).toEqual(Object.keys(cordova.PHASES));
    expect(PHASES['screen-capture-off'].connectConfig).toEqual({ screenCaptureEnabled: false });
    expect(PHASES['layout-config-off'].connectConfig).toEqual({
      layoutConfigIos: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } } },
      layoutConfigAndroid: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } } },
    });
    expect(PHASES.default.connectConfig).toEqual({});
  });

  it.each(['screen-capture-off', 'layout-config-off'])(
    '%s expects the screen views and no layout, as in Cordova',
    (phase) => {
      const rows: Row[] = buildSuite({ platform: 'ios', phase });
      const base: Row[] = cordova.buildSuite({ platform: 'ios', phase });
      expect(rows).toEqual(base);
      expect(rows.some((r) => r.check === 'type-absent' && r.type === 10)).toBe(true);
      expect(rows.some((r) => r.na)).toBe(false);
    },
  );

  it('runs the capture-off phases on Android too: the same screen views, no layout', () => {
    const rows: Row[] = buildSuite({ platform: 'android', phase: 'screen-capture-off' });
    const ios: Row[] = buildSuite({ platform: 'ios', phase: 'screen-capture-off' });
    expect(rows.some((r) => r.check === 'type-absent' && r.type === 10)).toBe(true);
    expect(rows.every((r) => r.check === 'screenview-present' || r.check === 'type-absent')).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(ios.map((r) => r.name));
  });

  it('sets up the layout phase for Android as well as iOS', () => {
    expect(PHASES['layout-config-off'].platforms).toEqual(['android', 'ios']);
    expect(PHASES['layout-config-off'].connectConfig.layoutConfigAndroid).toEqual({
      AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } },
    });
  });

  it('rejects an unknown phase', () => {
    expect(() => buildSuite({ platform: 'ios', phase: 'nope' })).toThrow(/phase must be one of/);
  });

  it('rejects an unknown platform', () => {
    expect(() => buildSuite({ platform: 'web', layoutExpected: true })).toThrow(/android or ios/);
  });
});

// What a registration for push has to look like on the wire, which the Cordova scenario only checks for presence.
describe('wire suite: the push registration', () => {
  const push = (platform: string, pushExpected = true): Row[] =>
    buildSuite({ platform, layoutExpected: true, pushExpected }).filter((r: Row) => r.name.startsWith('push: '));

  it('expects the provider of the platform: FCM on Android, APNs on iOS', () => {
    const provider = (platform: string) => push(platform).find((r) => r.path === 'mobileProvider');
    expect(provider('android')).toMatchObject({ check: 'value', type: 22, expected: 'FCM', jsonType: 'string' });
    expect(provider('ios')).toMatchObject({ check: 'value', type: 22, expected: 'APN', jsonType: 'string' });
  });

  it('expects the device token, and that it is not empty (the first registration on iOS goes out without one)', () => {
    for (const platform of ['android', 'ios']) {
      expect(push(platform).find((r) => r.path === 'mobileToken')).toMatchObject({
        check: 'value',
        type: 22,
        jsonType: 'string',
        nonEmpty: true,
      });
    }
  });

  it('expects, on Android, that the notification permission was granted: the run grants it', () => {
    expect(push('android').find((r) => r.path === 'acceptPush')).toMatchObject({
      type: 22,
      expected: true,
      jsonType: 'boolean',
    });
    expect(push('ios').some((r) => r.path === 'acceptPush')).toBe(false); // the iOS registration does not carry it
  });

  it('adds nothing when push is not part of the run', () => {
    expect(push('android', false)).toEqual([]);
    expect(push('ios', false)).toEqual([]);
  });

  it('adds nothing to the capture-off phases, which are about layout', () => {
    expect(
      buildSuite({ platform: 'ios', phase: 'screen-capture-off', pushExpected: true }).some((r: Row) =>
        r.name.startsWith('push: '),
      ),
    ).toBe(false);
  });
});

export {};
