/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The Android SDK takes its screen-capture rules from a ConnectLayoutConfig.json asset that replaces its own.
// The plugin's build script writes that file from `layoutConfig` and `layoutConfigAndroid` of the plugin block;
// these tests run the generating task on a config file and read what it wrote.

const androidDir = path.resolve(__dirname, '..', 'android');
// Run on its own the plugin builds into build/standalone; included in an app it builds into build/, which is the app's.
const generated = path.join(
  androidDir,
  'build',
  'standalone',
  'generated',
  'acousticConnect',
  'assets',
  'ConnectLayoutConfig.json',
);
const appsBuild = path.join(androidDir, 'build', 'generated', 'acousticConnect', 'assets');
const appAssets = path.join(androidDir, 'app', 'src', 'main', 'assets');

function javaHome(): string | undefined {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const r = spawnSync('/usr/libexec/java_home', ['-v', '21'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

const java = javaHome();
const describeIfJava = java && fs.existsSync(path.join(androidDir, 'gradlew')) ? describe : describe.skip;

function run(block: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-layout-'));
  const file = path.join(dir, 'capacitor.config.json');
  fs.writeFileSync(file, JSON.stringify({ plugins: { AcousticConnect: block } }));
  const r = spawnSync(
    './gradlew',
    ['--console=plain', `-PacousticConfigFile=${file}`, 'generateAcousticLayoutConfig'],
    {
      cwd: androidDir,
      encoding: 'utf8',
      env: { ...process.env, JAVA_HOME: java },
    },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  const written = fs.existsSync(generated) ? JSON.parse(fs.readFileSync(generated, 'utf8')) : null;
  return { status: r.status, output: `${r.stdout}\n${r.stderr}`, written };
}

const SCREENS = { GlobalScreenSettings: { ScreenChange: true, CaptureLayoutOn: 1, ScreenShot: true } };

describeIfJava('ConnectLayoutConfig.json generated for Android', () => {
  jest.setTimeout(180000);

  afterAll(() => {
    fs.rmSync(path.join(androidDir, 'app'), { recursive: true, force: true });
  });

  it('writes nothing when the block has no layout rules, and removes an earlier file', () => {
    expect(run({ layoutConfigAndroid: { AutoLayout: SCREENS } }).written).not.toBeNull();
    const r = run({ appKey: 'k' });
    expect(r.status).toBe(0);
    expect(r.written).toBeNull();
  });

  it('writes the Android block as it is', () => {
    const r = run({ layoutConfigAndroid: { AutoLayout: SCREENS, AppendMapIds: { a: { mid: 'x' } } } });
    expect(r.status).toBe(0);
    expect(r.written).toEqual({ AutoLayout: SCREENS, AppendMapIds: { a: { mid: 'x' } } });
  });

  it('merges the Android block over the shared one: objects merge, arrays and scalars are replaced', () => {
    const r = run({
      layoutConfig: {
        AutoLayout: { GlobalScreenSettings: { ScreenChange: true, CaptureLayoutOn: 1 }, MaskIdList: ['a', 'b'] },
      },
      layoutConfigAndroid: { AutoLayout: { GlobalScreenSettings: { CaptureLayoutOn: 0 }, MaskIdList: ['c'] } },
    });
    expect(r.written).toEqual({
      AutoLayout: { GlobalScreenSettings: { ScreenChange: true, CaptureLayoutOn: 0 }, MaskIdList: ['c'] },
    });
  });

  it('uses the shared block alone when there is no Android block, and never the iOS one', () => {
    const r = run({ layoutConfig: { AutoLayout: SCREENS }, layoutConfigIos: { AutoLayout: { Other: 1 } } });
    expect(r.written).toEqual({ AutoLayout: SCREENS });
  });

  it('drops keys the SDK does not read, with a warning', () => {
    const r = run({ layoutConfigAndroid: { AutoLayout: SCREENS, Bogus: {} } });
    expect(r.written).toEqual({ AutoLayout: SCREENS });
    expect(r.output).toMatch(/layoutConfigAndroid\.Bogus is not a recognised layout key/);
  });

  it("warns that a block without GlobalScreenSettings drops the SDK's own screen rules", () => {
    const r = run({ layoutConfigAndroid: { AppendMapIds: { a: { mid: 'x' } } } });
    expect(r.written).toEqual({ AppendMapIds: { a: { mid: 'x' } } });
    expect(r.output).toMatch(/replaces the Android SDK's whole layout config/);
  });

  it('rejects a layout block that is not an object', () => {
    const r = run({ layoutConfigAndroid: [1] });
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/layoutConfigAndroid must be a JSON object/);
  });

  it('warns when the app has its own ConnectLayoutConfig.json, which takes priority', () => {
    fs.mkdirSync(appAssets, { recursive: true });
    fs.writeFileSync(path.join(appAssets, 'ConnectLayoutConfig.json'), '{}');
    try {
      const r = run({ layoutConfigAndroid: { AutoLayout: SCREENS } });
      expect(r.output).toMatch(/will NOT take effect/);
    } finally {
      fs.rmSync(path.join(androidDir, 'app'), { recursive: true, force: true });
    }
  });
});

// A module of its own: the requires above would otherwise share one scope with the other test files.
export {};

// The plugin's own Gradle runs (its tests, with no app config, so no layout asset) used to write into the folder an app build
// reuses: the app then packed the SDK's own layout config, which made the SDK log "No value for DisplayName" for every screen and
// capture no layout.
describeIfJava('a run of the plugin on its own', () => {
  jest.setTimeout(180000);

  it('leaves the build folder an app uses alone', () => {
    fs.mkdirSync(appsBuild, { recursive: true });
    const marker = path.join(appsBuild, 'ConnectLayoutConfig.json');
    const before = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null;
    fs.writeFileSync(marker, '{"marker":"the app\'s"}');
    try {
      run({});
      expect(fs.readFileSync(marker, 'utf8')).toBe('{"marker":"the app\'s"}');
    } finally {
      if (before === null) fs.rmSync(marker, { force: true });
      else fs.writeFileSync(marker, before);
    }
  });
});
