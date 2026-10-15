import type { CapacitorConfig } from '@capacitor/cli';

import type { AcousticConnectConfig } from '../src/definitions';

// These tests are checked by the compiler: a key that is not in the config type fails `npm test`.

describe('capacitor.config plugin block', () => {
  it('accepts every documented key under plugins.AcousticConnect', () => {
    const full: AcousticConnectConfig = {
      appKey: 'key',
      postMessageUrl: 'https://collector.example.com/collector/collectorPost',
      autoEnable: true,
      useRelease: false,
      killSwitchEnabled: false,
      killSwitchUrl: 'https://collector.example.com/collector/switch/key',
      locationLoggingEnabled: null,
      screenCaptureEnabled: true,
      androidNotificationIconResName: 'ic_notification',
      pushEnabled: true,
      iosPushMode: 'automatic',
      iosAppGroupIdentifier: 'group.com.example',
      layoutConfig: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 1 } } },
      layoutConfigIos: { AppendMapIds: {} },
      layoutConfigAndroid: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } } },
    };
    const config: CapacitorConfig = {
      appId: 'com.example',
      appName: 'Example',
      webDir: 'dist',
      plugins: { AcousticConnect: full },
    };
    expect(config.plugins?.AcousticConnect?.appKey).toBe('key');
  });

  it('is optional and every key is optional', () => {
    const config: CapacitorConfig = { appId: 'a', appName: 'b', webDir: 'c', plugins: { AcousticConnect: {} } };
    expect(config.plugins?.AcousticConnect).toEqual({});
  });

  it('rejects a key it does not know and a wrong type', () => {
    const config: CapacitorConfig = {
      appId: 'a',
      appName: 'b',
      webDir: 'c',
      plugins: {
        // @ts-expect-error appKey is a string
        AcousticConnect: { appKey: 5 },
      },
    };
    const typo: AcousticConnectConfig = {
      // @ts-expect-error not a config key
      appkey: 'k',
    };
    expect(config).toBeDefined();
    expect(typo).toBeDefined();
  });
});
