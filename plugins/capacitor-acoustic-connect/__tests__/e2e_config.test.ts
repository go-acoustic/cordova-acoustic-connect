/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildRunConfig,
  prepareConfig,
  restoreConfig,
  STATE_FILE,
} = require('../../../applications/DemoCapacitor/e2e/config.js');

// The sample app keeps a placeholder config in git (capacitor.config.example.json) and the developer's own,
// untracked capacitor.config.json next to it. A wire run has to point the SDK at the local sink without losing
// either, so it swaps the config in and puts the original back.

const EXAMPLE = {
  appId: 'co.acoustic.connect.capacitor.demo',
  appName: 'DemoCapacitor',
  webDir: 'dist',
  plugins: {
    SplashScreen: { launchAutoHide: false },
    AcousticConnect: {
      appKey: 'YOUR_KEY',
      postMessageUrl: 'https://collector.example.com/post',
      killSwitchEnabled: false,
    },
  },
};

function appDir(files: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-capacitor-'));
  fs.mkdirSync(path.join(dir, 'e2e'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(content));
  return dir;
}
const read = (dir: string, name = 'capacitor.config.json') => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

describe('buildRunConfig', () => {
  it('points the SDK at the sink and keeps everything else', () => {
    const run = buildRunConfig(EXAMPLE, { port: 9000 });
    expect(run.plugins.AcousticConnect.postMessageUrl).toBe('http://localhost:9000/collector/collectorPost');
    expect(run.plugins.AcousticConnect.appKey).toBe('YOUR_KEY');
    expect(run.plugins.SplashScreen).toEqual({ launchAutoHide: false });
    expect(run.appId).toBe('co.acoustic.connect.capacitor.demo');
  });

  it('does not change what it was given', () => {
    const copy = JSON.parse(JSON.stringify(EXAMPLE));
    buildRunConfig(EXAMPLE, { port: 9000 });
    expect(EXAMPLE).toEqual(copy);
  });

  it('starts the SDK from the config, which the scenario waits for', () => {
    const base = { plugins: { AcousticConnect: { appKey: 'k', autoEnable: false } } };
    expect(buildRunConfig(base, { port: 1 }).plugins.AcousticConnect.autoEnable).toBe(true);
  });

  it('sends a kill switch the developer turned on to the sink too', () => {
    const base = {
      plugins: { AcousticConnect: { appKey: 'k', killSwitchEnabled: true, killSwitchUrl: 'https://real/switch/k' } },
    };
    expect(buildRunConfig(base, { port: 9000 }).plugins.AcousticConnect.killSwitchUrl).toBe(
      'http://localhost:9000/collector/switch/k',
    );
  });

  it('merges the settings of a phase over the plugin block, deeply', () => {
    const base = { plugins: { AcousticConnect: { appKey: 'k', layoutConfigIos: { AutoLayout: { Other: 1 } } } } };
    const run = buildRunConfig(base, {
      port: 9000,
      overrides: {
        screenCaptureEnabled: false,
        layoutConfigIos: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 } } },
      },
    });
    expect(run.plugins.AcousticConnect.screenCaptureEnabled).toBe(false);
    expect(run.plugins.AcousticConnect.layoutConfigIos).toEqual({
      AutoLayout: { Other: 1, GlobalScreenSettings: { CaptureLayoutOn: 0 } },
    });
    expect(run.plugins.AcousticConnect.appKey).toBe('k');
    expect(base.plugins.AcousticConnect).not.toHaveProperty('screenCaptureEnabled');
  });

  it('keeps the sink for the SDK whatever a phase sets', () => {
    const run = buildRunConfig(EXAMPLE, { port: 9000, overrides: { postMessageUrl: 'https://real/post' } });
    expect(run.plugins.AcousticConnect.postMessageUrl).toBe('http://localhost:9000/collector/collectorPost');
  });

  it('adds the plugin block when the config has none', () => {
    expect(buildRunConfig({ appId: 'a' }, { port: 9000 }).plugins.AcousticConnect.postMessageUrl).toMatch(
      /localhost:9000/,
    );
  });
});

describe('prepareConfig and restoreConfig', () => {
  it("swaps the developer's config for the run and puts it back byte for byte", () => {
    const dir = appDir({ 'capacitor.config.example.json': EXAMPLE });
    const own =
      '{\n  "appId": "co.acoustic.connect.capacitor.demo",\n  "plugins": {"AcousticConnect": {"appKey": "REAL-KEY", "postMessageUrl": "https://real/post"}}\n}\n';
    fs.writeFileSync(path.join(dir, 'capacitor.config.json'), own);
    prepareConfig({ root: dir, port: 9000 });
    expect(read(dir).plugins.AcousticConnect.appKey).toBe('REAL-KEY');
    expect(read(dir).plugins.AcousticConnect.postMessageUrl).toMatch(/localhost:9000/);
    restoreConfig({ root: dir });
    expect(fs.readFileSync(path.join(dir, 'capacitor.config.json'), 'utf8')).toBe(own);
    expect(fs.existsSync(path.join(dir, 'e2e', STATE_FILE))).toBe(false);
  });

  it('starts from the example when the developer has no config, and removes the file afterwards', () => {
    const dir = appDir({ 'capacitor.config.example.json': EXAMPLE });
    prepareConfig({ root: dir, port: 9000 });
    expect(read(dir).plugins.AcousticConnect.appKey).toBe('YOUR_KEY');
    restoreConfig({ root: dir });
    expect(fs.existsSync(path.join(dir, 'capacitor.config.json'))).toBe(false);
  });

  it('writes the settings of a phase into the config of the run', () => {
    const dir = appDir({ 'capacitor.config.example.json': EXAMPLE });
    prepareConfig({ root: dir, port: 9000, overrides: { screenCaptureEnabled: false } });
    expect(read(dir).plugins.AcousticConnect.screenCaptureEnabled).toBe(false);
    restoreConfig({ root: dir });
  });

  it('refuses to prepare twice, so the saved original is not overwritten', () => {
    const dir = appDir({ 'capacitor.config.example.json': EXAMPLE });
    prepareConfig({ root: dir, port: 9000 });
    expect(() => prepareConfig({ root: dir, port: 9000 })).toThrow(/already prepared/);
  });

  it('restoring when nothing was prepared does nothing', () => {
    const dir = appDir({ 'capacitor.config.example.json': EXAMPLE });
    expect(restoreConfig({ root: dir })).toEqual({ restored: false });
  });

  it('says when there is neither a config nor an example', () => {
    const dir = appDir({});
    expect(() => prepareConfig({ root: dir, port: 9000 })).toThrow(/capacitor\.config\.example\.json/);
  });

  it('keeps the state file out of git', () => {
    const ignore = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'applications', 'DemoCapacitor', '.gitignore'),
      'utf8',
    );
    expect(ignore).toMatch(/e2e\/\.prepare-state\.json/);
    expect(ignore).toMatch(/^\/capacitor\.config\.json$/m);
    // it holds the credentials of a Firebase project
    expect(ignore).toMatch(/^\/android\/app\/google-services\.json$/m);
    // the SDK's own settings file, which holds the app key and the collector URL of whoever generated it, as in the Cordova demo
    expect(ignore).toMatch(/^\/ConnectBasicConfig\.properties$/m);
  });
});

// The tracked template of the app's config shows every setting of the kill switch, as the Cordova demo's example does.
describe('capacitor.config.example.json', () => {
  const example = () =>
    JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', '..', '..', 'applications', 'DemoCapacitor', 'capacitor.config.example.json'),
        'utf8',
      ),
    ).plugins.AcousticConnect;

  it('has the kill switch off, with the URL it would use written out, key and host as placeholders', () => {
    expect(example().killSwitchEnabled).toBe(false);
    expect(example().killSwitchUrl).toBe('https://collector.example.com/collector/switch/YOUR_CONNECT_APP_KEY_HERE');
  });

  it("shows the push settings of the Cordova demo's example, in the plugin's spelling, with placeholders for what is yours", () => {
    expect(example()).toMatchObject({
      iosPushMode: 'automatic',
      iosAppGroupIdentifier: 'YOUR_APP_GROUP_ID_HERE',
      iosDevelopmentTeam: 'YOUR_TEAM_ID',
      androidNotificationIconResName: 'ic_notification',
    });
  });

  it("shows the SDK version pins, empty, as the Cordova demo's example does", () => {
    expect(example().androidVersion).toBe('');
    expect(example().iosVersion).toBe('');
  });
});

// As in the Cordova demo: a template of the Firebase file is tracked and the real one is not.
describe('google-services.json of DemoCapacitor', () => {
  const app = path.join(__dirname, '..', '..', '..', 'applications', 'DemoCapacitor');
  const example = () =>
    JSON.parse(fs.readFileSync(path.join(app, 'android', 'app', 'google-services.json.example'), 'utf8'));

  it('has a template next to where the real file goes, with placeholders and the instructions', () => {
    const t = example();
    expect(t.project_info.project_id).toBe('your-firebase-project-id');
    expect(JSON.stringify(t)).toMatch(/AIzaPlaceholder/);
    expect(t._instructions.join('\n')).toMatch(/android\/app/);
  });

  it("is for the package of the Capacitor demo's own app", () => {
    expect(example().client[0].client_info.android_client_info.package_name).toBe('co.acoustic.connect.capacitor.demo');
  });

  it('is not the file Gradle reads, so it does not start the Google services plugin', () => {
    expect(fs.existsSync(path.join(app, 'android', 'app', 'google-services.json.example'))).toBe(true);
    expect('google-services.json.example').not.toBe('google-services.json');
  });

  it('is not ignored, while the real file is', () => {
    const ignore = fs.readFileSync(path.join(app, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\/android\/app\/google-services\.json$/m);
    expect(ignore).not.toMatch(/google-services\.json\.example/);
  });

  it('is named by the README of the demo', () => {
    expect(fs.readFileSync(path.join(app, 'README.md'), 'utf8')).toContain('google-services.json.example');
  });
});

export {};
