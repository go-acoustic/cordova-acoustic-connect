/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// These run Gradle on the plugin's own build script (configuration only, nothing is downloaded), because
// what the script does with `useRelease`, `pushEnabled` and the version pins can only be seen there.

const androidDir = path.resolve(__dirname, '..', 'android');

function javaHome(): string | undefined {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
  const r = spawnSync('/usr/libexec/java_home', ['-v', '21'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

const java = javaHome();
const describeIfJava = java && fs.existsSync(path.join(androidDir, 'gradlew')) ? describe : describe.skip;

function gradle(args: string[]) {
  return spawnSync('./gradlew', ['-q', '--console=plain', ...args, 'help'], {
    cwd: androidDir,
    encoding: 'utf8',
    env: { ...process.env, JAVA_HOME: java },
  });
}

/** Like `gradle`, but at the default log level, where configuration warnings are shown. */
function gradleWarnings(args: string[]) {
  const r = spawnSync('./gradlew', ['--console=plain', ...args, 'help'], {
    cwd: androidDir,
    encoding: 'utf8',
    env: { ...process.env, JAVA_HOME: java },
  });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

describeIfJava('android/build.gradle configuration', () => {
  jest.setTimeout(180000);

  it('configures with the defaults: the pinned beta, push off, useRelease off', () => {
    const r = gradle([]);
    expect(r.status).toBe(0);
  });

  it('refuses a beta SDK when useRelease is on, and says what to do', () => {
    const r = gradle(['-PacousticUseRelease=true']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/useRelease is true/);
    // the version it names is the plugin's default pin
    expect(r.stderr).toMatch(/11\.1\.10-beta/);
    expect(r.stderr).toMatch(/connectSdkVersion/);
  });

  it('accepts useRelease with a release version', () => {
    const r = gradle(['-PacousticUseRelease=true', '-PconnectSdkVersion=11.0.24']);
    expect(r.status).toBe(0);
  });

  it('rejects a beta pin while useRelease is on, however the pin is given', () => {
    const r = gradle(['-PacousticUseRelease=true', '-PconnectSdkVersion=11.1.10-beta']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/11\.1\.10-beta/);
  });

  it('takes the Firebase BOM version from firebaseBomVersion', () => {
    const r = spawnSync(
      './gradlew',
      [
        '-q',
        '--console=plain',
        '-PacousticPushEnabled=true',
        '-PfirebaseBomVersion=33.9.0',
        'dependencies',
        '--configuration',
        'debugRuntimeClasspath',
      ],
      {
        cwd: androidDir,
        encoding: 'utf8',
        env: { ...process.env, JAVA_HOME: java },
      },
    );
    expect(r.stdout).toMatch(/firebase-bom:33\.9\.0/);
  });

  describe('supported Connect Android range', () => {
    it.each(['11.0.21-beta', '11.0.21', '11.1.10-beta', '11.9.9'])('accepts %s', (version) => {
      expect(gradle([`-PconnectSdkVersion=${version}`]).status).toBe(0);
    });

    it.each(['11.0.20', '10.9.9', '12.0.0', '13.1.0'])('rejects %s and names the range', (version) => {
      const r = gradle([`-PconnectSdkVersion=${version}`]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(new RegExp(`'${version}' is outside the supported Connect Android range`));
      expect(r.stderr).toMatch(/\[11\.0\.21, 12\.0\.0\)/);
    });

    it('treats an empty pin as not set and uses the default', () => {
      expect(gradle(['-PconnectSdkVersion=']).status).toBe(0);
    });

    it.each(['latest', '+', '11.x'])('rejects %j, which is not a version', (version) => {
      expect(gradle([`-PconnectSdkVersion=${version}`]).status).not.toBe(0);
    });
  });

  // `androidVersion` of the plugin block pins the Connect Android SDK, as the Cordova plugin's AndroidVersion does. The version in
  // effect shows in the error a beta gets under useRelease, so that is how these read it.
  describe('androidVersion in the plugin block', () => {
    const withConfig = (block: Record<string, unknown>, ...args: string[]) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-version-'));
      const file = path.join(dir, 'capacitor.config.json');
      fs.writeFileSync(file, JSON.stringify({ plugins: { AcousticConnect: block } }));
      try {
        return gradle([`-PacousticConfigFile=${file}`, ...args]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };

    it('is the pin of the build: the version it names is the one used', () => {
      const r = withConfig({ useRelease: true, androidVersion: '11.2.0-beta' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/version '11\.2\.0-beta' is a beta/);
    });

    it('is overridden by the Gradle property connectSdkVersion', () => {
      expect(
        withConfig({ useRelease: true, androidVersion: '11.2.0-beta' }, '-PconnectSdkVersion=11.0.24').status,
      ).toBe(0);
    });

    it.each([[''], ['  '], [undefined]])('is not set when it is %j: the default is used', (androidVersion) => {
      const r = withConfig({ useRelease: true, androidVersion });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/version '11\.1\.10-beta' is a beta/);
    });

    it('is checked against the supported range, like the property', () => {
      const r = withConfig({ androidVersion: '10.0.0' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/'10\.0\.0' is outside the supported Connect Android range/);
    });

    it.each([['latest'], ['+'], ['11.x'], ['11.1.10foo'], [12], [true]])(
      'stops the build, naming androidVersion, for %j',
      (androidVersion) => {
        const r = withConfig({ androidVersion });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toMatch(/androidVersion/);
      },
    );

    it.each([['11.0.24'], ['11.1.10-beta'], [' 11.1.10-beta ']])('accepts %j', (androidVersion) => {
      expect(withConfig({ androidVersion }).status).toBe(0);
    });
  });

  it('warns at build time when push is on and the app has no google-services.json', () => {
    // the plugin's android/ has no app/ next to it, so the file is missing here
    const r = gradleWarnings(['-PacousticPushEnabled=true']);
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/pushEnabled is true but .*google-services\.json/);
    expect(r.output).toMatch(/android\/app/);
  });

  it('stays quiet about it when push is off', () => {
    const r = gradleWarnings([]);
    expect(r.output).not.toMatch(/google-services/);
  });
});

// A module of its own: the requires above would otherwise share one scope with the other test files.
export {};
