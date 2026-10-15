/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseArgs,
  appGroupFor,
  teamFor,
  sdkVersionFrom,
  setupIosPush,
  PLACEHOLDER,
} = require('../cli/setup-ios-push.cjs');

const CLI = path.join(__dirname, '..', 'cli', 'index.cjs');
const GROUP = 'group.co.acoustic.example';

/** An app folder with an iOS project directory in it (the project file itself is the Ruby script's business). */
function app(files: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-cli-'));
  fs.mkdirSync(path.join(dir, 'ios', 'App', 'App.xcodeproj'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}
const read = (dir: string, ...p: string[]) => fs.readFileSync(path.join(dir, 'ios', 'App', ...p), 'utf8');

describe('parseArgs', () => {
  it('takes the app folder, the App Group, the team and the dry-run flag', () => {
    expect(parseArgs(['/app', '--app-group', GROUP, '--team', 'ABCDE12345', '--dry-run'])).toEqual({
      dir: '/app',
      appGroup: GROUP,
      team: 'ABCDE12345',
      dryRun: true,
    });
  });

  it('defaults to the current folder and nothing else', () => {
    expect(parseArgs([])).toEqual({ dir: process.cwd(), appGroup: undefined, team: undefined, dryRun: false });
  });

  it.each([[['--bogus']], [['--app-group']], [['--team']], [['a', 'b']]])('rejects %j', (args) => {
    expect(() => parseArgs(args)).toThrow();
  });
});

describe('appGroupFor', () => {
  it('prefers the option, then iosAppGroupIdentifier of the plugin block in capacitor.config.json', () => {
    const dir = app({
      'capacitor.config.json': { plugins: { AcousticConnect: { iosAppGroupIdentifier: 'group.from.config' } } },
    });
    expect(appGroupFor({ dir, appGroup: GROUP })).toBe(GROUP);
    expect(appGroupFor({ dir })).toBe('group.from.config');
  });

  it('says how to give it when there is none', () => {
    expect(() => appGroupFor({ dir: app() })).toThrow(/--app-group/);
  });

  it.each([['co.acoustic.example'], ['group.'], ['group. x'], ['group.é']])(
    'rejects %j: an App Group is group.<reverse-dns>',
    (bad) => {
      expect(() => appGroupFor({ dir: app(), appGroup: bad })).toThrow(/App Group/);
    },
  );
});

describe('teamFor', () => {
  const config = (team: unknown) => ({
    'capacitor.config.json': { plugins: { AcousticConnect: { iosDevelopmentTeam: team } } },
  });

  it('prefers the option, then iosDevelopmentTeam of the plugin block, which is what the Cordova plugin read from ConnectConfig.json', () => {
    expect(teamFor({ dir: app(config('QXQ67VKX2B')), team: 'ABCDE12345' })).toBe('ABCDE12345');
    expect(teamFor({ dir: app(config('QXQ67VKX2B')) })).toBe('QXQ67VKX2B');
  });

  it.each([[undefined], [''], ['  '], ['YOUR_TEAM_ID']])(
    'is none for %j: a team is optional, and the placeholder of the example is not one',
    (team) => {
      expect(teamFor({ dir: app(config(team)) })).toBeUndefined();
      expect(teamFor({ dir: app() })).toBeUndefined();
    },
  );

  it.each([['QXQ67VKX'], ['qxq67vkx2b'], ['QXQ67VKX2B1'], [12], ['QXQ 67VKX2']])(
    'rejects %j: a team ID is ten letters and digits',
    (team) => {
      expect(() => teamFor({ dir: app(config(team)) })).toThrow(/team/i);
    },
  );

  it('rejects an option that is not a team ID either', () => {
    expect(() => teamFor({ dir: app(), team: 'nope' })).toThrow(/team/i);
  });
});

describe('sdkVersionFrom', () => {
  it('reads the pinned Connect-SP version out of Package.swift, so the extensions use the SDK of the app', () => {
    const swift = '.package(url: "https://github.com/go-acoustic/Connect-SP.git", exact: "2.1.15")';
    expect(sdkVersionFrom(swift)).toBe('2.1.15');
    expect(sdkVersionFrom('.package(url: "https://github.com/go-acoustic/Connect-SP.git", from: "2.1.51")')).toBe('2.1.51');
    expect(sdkVersionFrom(fs.readFileSync(path.join(__dirname, '..', 'Package.swift'), 'utf8'))).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  });

  it('is null when there is no pin', () => {
    expect(sdkVersionFrom('// nothing')).toBeNull();
  });
});

describe('setupIosPush', () => {
  const noRuby = () => ({ status: 0, output: '' });

  it('writes the two extensions with the App Group in them, and no placeholder left', () => {
    const dir = app();
    const report = setupIosPush({ dir, appGroup: GROUP, ruby: noRuby });
    for (const name of [
      'ConnectNSE/NotificationService.swift',
      'ConnectNSE/ConnectNSE-Info.plist',
      'ConnectNSE/ConnectNSE.entitlements',
      'ConnectNCE/NotificationViewController.swift',
      'ConnectNCE/ConnectNCE-Info.plist',
      'ConnectNCE/ConnectNCE.entitlements',
    ]) {
      const text = read(dir, ...name.split('/'));
      expect(text).not.toContain(PLACEHOLDER);
      expect(report.written).toContain(name);
    }
    expect(read(dir, 'ConnectNSE', 'NotificationService.swift')).toContain(`"${GROUP}"`);
    expect(read(dir, 'ConnectNCE', 'ConnectNCE.entitlements')).toContain(`<string>${GROUP}</string>`);
  });

  it('never overwrites a file that is already there, and says so', () => {
    const dir = app({ 'ios/App/ConnectNSE/NotificationService.swift': '// mine' });
    const report = setupIosPush({ dir, appGroup: GROUP, ruby: noRuby });
    expect(read(dir, 'ConnectNSE', 'NotificationService.swift')).toBe('// mine');
    expect(report.kept).toContain('ConnectNSE/NotificationService.swift');
    expect(report.written).not.toContain('ConnectNSE/NotificationService.swift');
  });

  it('hands the project, the group, the SDK version and the team to the script that edits the Xcode project', () => {
    const dir = app();
    const calls: unknown[] = [];
    setupIosPush({
      dir,
      appGroup: GROUP,
      team: 'ABCDE12345',
      ruby: (args: unknown) => (calls.push(args), { status: 0, output: '' }),
    });
    expect(calls).toEqual([
      {
        project: path.join(dir, 'ios', 'App', 'App.xcodeproj'),
        appGroup: GROUP,
        sdkVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        team: 'ABCDE12345',
      },
    ]);
  });

  it('fails, with the output of the script, when the script fails', () => {
    expect(() =>
      setupIosPush({
        dir: app(),
        appGroup: GROUP,
        ruby: () => ({ status: 1, output: 'cannot load such file -- xcodeproj' }),
      }),
    ).toThrow(/xcodeproj/);
  });

  it('changes nothing in a dry run', () => {
    const dir = app();
    let called = false;
    const report = setupIosPush({
      dir,
      appGroup: GROUP,
      dryRun: true,
      ruby: () => ((called = true), { status: 0, output: '' }),
    });
    expect(fs.existsSync(path.join(dir, 'ios', 'App', 'ConnectNSE'))).toBe(false);
    expect(called).toBe(false);
    expect(report.written.length).toBe(6);
  });

  it('does not go on with an app that uses CocoaPods, whose Connect SDK would then be in the app twice, and says what to do', () => {
    const dir = app({ 'ios/App/Podfile': "target 'App' do\nend\n" });
    let called = false;
    expect(() =>
      setupIosPush({ dir, appGroup: GROUP, ruby: () => ((called = true), { status: 0, output: '' }) }),
    ).toThrow(/CocoaPods/);
    expect(called).toBe(false);
    expect(fs.existsSync(path.join(dir, 'ios', 'App', 'ConnectNSE'))).toBe(false);
  });

  it('says where the iOS project should be when it is not there', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-cli-'));
    expect(() => setupIosPush({ dir, appGroup: GROUP, ruby: noRuby })).toThrow(/ios\/App\/App\.xcodeproj/);
  });
});

describe('the acoustic-connect command', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

  it('lists its commands without one', () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).toMatch(/setup-ios-push/);
  });

  it('refuses a command it does not have', () => {
    expect(run('nope').status).toBe(2);
  });

  it('shows what setup-ios-push would write, with --dry-run', () => {
    const dir = app();
    const r = run('setup-ios-push', dir, '--app-group', GROUP, '--dry-run');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ConnectNSE/NotificationService.swift');
  });

  it('exits non-zero with the reason when it cannot go on', () => {
    const r = run('setup-ios-push', app());
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--app-group/);
  });

  it('is the bin of the package, and ships', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.bin).toEqual({ 'acoustic-connect': 'cli/index.cjs' });
    expect(pkg.files).toContain('cli/');
  });
});

describe('the README on rich push', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

  it('tells how to add the extensions, what to do first and what it does not cover', () => {
    expect(readme).toContain('npx acoustic-connect setup-ios-push');
    expect(readme).toMatch(/App Group/);
    expect(readme).toMatch(/CocoaPods/);
    expect(readme).toMatch(/real device/);
  });
});

describe('setup-ios-push with the team in the config', () => {
  it('hands the team of the config to the script that edits the project, when no --team is given', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acoustic-cli-'));
    fs.mkdirSync(path.join(dir, 'ios', 'App', 'App.xcodeproj'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'capacitor.config.json'),
      JSON.stringify({
        plugins: { AcousticConnect: { iosAppGroupIdentifier: GROUP, iosDevelopmentTeam: 'QXQ67VKX2B' } },
      }),
    );
    const r = spawnSync(process.execPath, [CLI, 'setup-ios-push', dir, '--dry-run'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/team QXQ67VKX2B/);
  });
});

export {};
