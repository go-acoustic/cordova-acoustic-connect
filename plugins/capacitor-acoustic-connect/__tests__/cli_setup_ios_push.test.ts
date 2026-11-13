/* eslint-disable @typescript-eslint/no-var-requires */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
// The public package's Package.swift links Connect-SP (the release step rewrites it); capacitor_release.test.ts checks that one.
const itBeta = require('../package.json').name.endsWith('-beta') ? it : it.skip;

const {
  parseArgs,
  appGroupFor,
  teamFor,
  sdkVersionFrom,
  spmPackageFrom,
  setupIosPush,
  setupIosPods,
  addPodSpecsSource,
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
  itBeta(
    'reads the ConnectDebug-SP version the plugin asks for out of Package.swift, so the extensions use the SDK of the app',
    () => {
      const swift = '.package(url: "https://github.com/go-acoustic/ConnectDebug-SP.git", exact: "2.2.36")';
      expect(sdkVersionFrom(swift)).toBe('2.2.36');
      expect(
        sdkVersionFrom('.package(url: "https://github.com/go-acoustic/ConnectDebug-SP.git", from: "2.2.35")'),
      ).toBe('2.2.35');
      expect(sdkVersionFrom(fs.readFileSync(path.join(__dirname, '..', 'Package.swift'), 'utf8'))).toBe('2.2.35');
    },
  );

  it("reads the version of the release package when asked for it, and not the other one's", () => {
    expect(
      sdkVersionFrom('.package(url: "https://github.com/go-acoustic/Connect-SP.git", from: "2.1.51")', 'Connect-SP'),
    ).toBe('2.1.51');
    expect(sdkVersionFrom('.package(url: "https://github.com/go-acoustic/Connect-SP.git", from: "2.1.51")')).toBeNull();
    expect(
      sdkVersionFrom(
        '.package(url: "https://github.com/go-acoustic/ConnectDebug-SP.git", from: "2.2.35")',
        'Connect-SP',
      ),
    ).toBeNull();
  });

  it('is null when there is no pin', () => {
    expect(sdkVersionFrom('// nothing')).toBeNull();
  });

  itBeta(
    'names the Connect package the Swift package links: the beta one here, the release one in the public package',
    () => {
      expect(spmPackageFrom(fs.readFileSync(path.join(__dirname, '..', 'Package.swift'), 'utf8'))).toBe(
        'ConnectDebug-SP',
      );
      expect(spmPackageFrom('.product(name: "Connect", package: "Connect-SP")')).toBe('Connect-SP');
      expect(spmPackageFrom('// nothing')).toBeNull();
    },
  );
});

describe('addPodSpecsSource', () => {
  const PODSPECS = "source 'https://github.com/go-acoustic/PodSpecs.git'";
  const CDN = "source 'https://cdn.cocoapods.org/'";
  const MIRROR = "source 'https://specs.example.com/mirror.git'";

  it('inserts the repo before the first active source, not before a commented copy of it', () => {
    const out = addPodSpecsSource(`# ${CDN}\n${CDN}\nplatform :ios, '15.1'\n`);
    expect(out).toBe(`# ${CDN}\n${PODSPECS}\n${CDN}\nplatform :ios, '15.1'\n`);
  });

  it('adds an active line when the only PodSpecs line is commented out', () => {
    const out = addPodSpecsSource(`# ${PODSPECS}\n${CDN}\n`);
    expect(out).toBe(`# ${PODSPECS}\n${PODSPECS}\n${CDN}\n`);
  });

  it.each([
    [`source "https://github.com/go-acoustic/PodSpecs.git"\n${CDN}\n`],
    [`source 'https://github.com/go-acoustic/PodSpecs'\n${CDN}\n`],
    [`  ${PODSPECS}\n${CDN}\n`],
  ])('takes %j as already naming the repo', (text) => {
    expect(addPodSpecsSource(text)).toBe(text);
  });

  it('finds a source on the last line with no final newline, and adds no CDN', () => {
    expect(addPodSpecsSource(`platform :ios, '15.1'\n${MIRROR}`)).toBe(`platform :ios, '15.1'\n${PODSPECS}\n${MIRROR}`);
  });

  it('gives the same result when run again', () => {
    for (const text of [`# ${CDN}\n${CDN}\n`, `# ${PODSPECS}\n${CDN}\n`, `x\n${MIRROR}`, "platform :ios, '15.1'\n"]) {
      const once = addPodSpecsSource(text);
      expect(addPodSpecsSource(once)).toBe(once);
    }
  });
});

describe('setupIosPods', () => {
  const PODFILE = "platform :ios, '15.1'\n\ntarget 'App' do\n  pod 'Capacitor'\nend\n";

  it('adds the Acoustic spec repo to the Podfile of an app that does not use push', () => {
    const dir = app({ 'ios/App/Podfile': PODFILE });
    expect(setupIosPods({ dir })).toEqual({ usesPods: true, podfileSource: true });
    expect(read(dir, 'Podfile')).toMatch(/^source 'https:\/\/github\.com\/go-acoustic\/PodSpecs\.git'\n/);
    expect(setupIosPods({ dir })).toEqual({ usesPods: true, podfileSource: false });
  });

  it('writes nothing in a dry run, and says it would add the source', () => {
    const dir = app({ 'ios/App/Podfile': PODFILE });
    expect(setupIosPods({ dir, dryRun: true })).toEqual({ usesPods: true, podfileSource: true });
    expect(read(dir, 'Podfile')).toBe(PODFILE);
  });

  it('has nothing to do in an app that uses Swift Package Manager', () => {
    expect(setupIosPods({ dir: app() })).toEqual({ usesPods: false, podfileSource: false });
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

  itBeta(
    'hands the project, the group, the SDK version and the team to the script that edits the Xcode project',
    () => {
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
          sdkPackage: 'ConnectDebug-SP',
          sdkVersion: '2.2.35',
          team: 'ABCDE12345',
          linkSdk: 'spm',
        },
      ]);
    },
  );

  itBeta("has the script link the package of the plugin's Package.swift, whatever useRelease says", () => {
    const dir = app({ 'capacitor.config.json': { plugins: { AcousticConnect: { useRelease: true } } } });
    const calls: { sdkPackage: string; sdkVersion: string }[] = [];
    setupIosPush({ dir, appGroup: GROUP, ruby: (args: never) => (calls.push(args), { status: 0, output: '' }) });
    expect(calls.map((c) => [c.sdkPackage, c.sdkVersion])).toEqual([['ConnectDebug-SP', '2.2.35']]);
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

  describe('in an app that uses CocoaPods', () => {
    const PODSPECS = "source 'https://github.com/go-acoustic/PodSpecs.git'";
    const CDN = "source 'https://cdn.cocoapods.org/'";
    const PODFILE =
      "platform :ios, '15.1'\n\ntarget 'App' do\n  pod 'Capacitor'\nend\n\npost_install do |installer|\nend\n";
    const run = (dir: string, extra: Record<string, unknown> = {}) => {
      const calls: any[] = [];
      const report = setupIosPush({
        dir,
        appGroup: GROUP,
        ruby: (args: unknown) => (calls.push(args), { status: 0, output: '' }),
        ...extra,
      });
      return { calls, report };
    };

    it('gives each extension a target block with the pod of the plugin, the beta SDK, and has the script link no Swift package', () => {
      const dir = app({ 'ios/App/Podfile': PODFILE });
      const { calls, report } = run(dir);
      const podfile = read(dir, 'Podfile');
      expect(podfile).toContain(PODFILE);
      for (const name of ['ConnectNSE', 'ConnectNCE']) {
        expect(podfile).toContain(`target '${name}' do\n  pod 'AcousticConnectDebug', '>= 2.2.35'\nend`);
      }
      expect(report.usesPods).toBe(true);
      expect(report.podfileTargets).toEqual(['ConnectNSE', 'ConnectNCE']);
      expect(calls[0].linkSdk).toBe('pods');
    });

    it('lists the Acoustic spec repo and the CocoaPods CDN first when the Podfile names no source', () => {
      // CocoaPods trunk is read-only from 2 December 2026; later AcousticConnect versions are only in
      // go-acoustic/PodSpecs. Declaring any source turns off the CDN default, so the CDN is added too.
      const dir = app({ 'ios/App/Podfile': PODFILE });
      run(dir);
      expect(read(dir, 'Podfile').startsWith(`${PODSPECS}\n${CDN}\n`)).toBe(true);
    });

    it('puts the Acoustic spec repo just before the first source the Podfile names, and adds no second CDN', () => {
      const dir = app({ 'ios/App/Podfile': `${CDN}\n${PODFILE}` });
      run(dir);
      const podfile = read(dir, 'Podfile');
      expect(podfile.startsWith(`${PODSPECS}\n${CDN}\n`)).toBe(true);
      expect(podfile.split(CDN)).toHaveLength(2);
    });

    it('adds nothing to the Podfile when it is run again', () => {
      const dir = app({ 'ios/App/Podfile': PODFILE });
      run(dir);
      const once = read(dir, 'Podfile');
      const again = run(dir);
      expect(read(dir, 'Podfile')).toBe(once);
      expect(again.report.podfileTargets).toEqual([]);
    });

    it('adds only the block that is missing', () => {
      const dir = app({ 'ios/App/Podfile': PODFILE + "\ntarget 'ConnectNSE' do\n  pod 'AcousticConnect'\nend\n" });
      expect(run(dir).report.podfileTargets).toEqual(['ConnectNCE']);
      expect(read(dir, 'Podfile').match(/target 'ConnectNSE'/g)).toHaveLength(1);
    });

    it('asks for the iosVersion of the plugin block as well, like the podspec', () => {
      const dir = app({
        'ios/App/Podfile': PODFILE,
        'capacitor.config.json': { plugins: { AcousticConnect: { iosVersion: '2.2.2' } } },
      });
      run(dir);
      expect(read(dir, 'Podfile')).toMatch(/pod 'AcousticConnectDebug', '>= 2\.1\.51', '= 2\.2\.2'/);
    });

    it("reads useRelease from the app's config first, then from the copy cap sync left, the order of the podspec", () => {
      const dir = app({
        'ios/App/Podfile': PODFILE,
        'capacitor.config.json': { plugins: { AcousticConnect: { useRelease: false } } },
        'ios/App/App/capacitor.config.json': { plugins: { AcousticConnect: { useRelease: true } } },
      });
      expect(run(dir).report.pod).toBe('AcousticConnectDebug');
      const synced = app({
        'ios/App/Podfile': PODFILE,
        'ios/App/App/capacitor.config.json': { plugins: { AcousticConnect: { useRelease: true } } },
      });
      expect(run(synced).report.pod).toBe('AcousticConnect');
    });

    it('gives the extensions the release pod when useRelease is true, like the podspec', () => {
      const dir = app({
        'ios/App/Podfile': PODFILE,
        'capacitor.config.json': { plugins: { AcousticConnect: { useRelease: true } } },
      });
      run(dir);
      expect(read(dir, 'Podfile')).toContain("target 'ConnectNSE' do\n  pod 'AcousticConnect', '>= 2.1.51'\nend");
      const pinned = app({
        'ios/App/Podfile': PODFILE,
        'capacitor.config.json': { plugins: { AcousticConnect: { useRelease: true, iosVersion: '2.2.2' } } },
      });
      run(pinned);
      expect(read(pinned, 'Podfile')).toMatch(/pod 'AcousticConnect', '>= 2\.1\.51', '= 2\.2\.2'/);
    });

    it('moves a block of the other pod to the pod of the plugin, as two Connect pods cannot be in one app', () => {
      const dir = app({
        'ios/App/Podfile': PODFILE + "\ntarget 'ConnectNSE' do\n  pod 'AcousticConnect', '>= 2.1.51'\nend\n",
      });
      const { report } = run(dir);
      const podfile = read(dir, 'Podfile');
      expect(podfile).toContain("target 'ConnectNSE' do\n  pod 'AcousticConnectDebug', '>= 2.2.35'\nend");
      expect(podfile).not.toMatch(/pod 'AcousticConnect'[,\n]/);
      expect(podfile.match(/target 'ConnectNSE'/g)).toHaveLength(1);
      expect(report.podfileTargets).toEqual(['ConnectNCE']);
      expect(report.podfileMoved).toEqual(['ConnectNSE']);
      expect(run(dir).report.podfileMoved).toEqual([]);

      const back = app({
        'ios/App/Podfile': PODFILE + '\ntarget \'ConnectNCE\' do\n  pod "AcousticConnectDebug"\nend\n',
        'capacitor.config.json': { plugins: { AcousticConnect: { useRelease: true } } },
      });
      expect(run(back).report.podfileMoved).toEqual(['ConnectNCE']);
      expect(read(back, 'Podfile')).toContain("target 'ConnectNCE' do\n  pod 'AcousticConnect', '>= 2.1.51'\nend");
    });

    it('leaves a block that has the pod of the plugin as it is, and moves nothing in a dry run', () => {
      const own = PODFILE + "\ntarget 'ConnectNSE' do\n  pod 'AcousticConnectDebug', '= 2.2.36'\nend\n";
      const dir = app({ 'ios/App/Podfile': own });
      expect(run(dir).report.podfileMoved).toEqual([]);
      expect(read(dir, 'Podfile')).toContain("pod 'AcousticConnectDebug', '= 2.2.36'");
      const other = PODFILE + "\ntarget 'ConnectNSE' do\n  pod 'AcousticConnect'\nend\n";
      const dry = app({ 'ios/App/Podfile': other });
      expect(run(dry, { dryRun: true }).report.podfileMoved).toEqual(['ConnectNSE']);
      expect(read(dry, 'Podfile')).toBe(other);
    });

    it('stops, naming iosVersion, when it is not a version', () => {
      const dir = app({
        'ios/App/Podfile': PODFILE,
        'capacitor.config.json': { plugins: { AcousticConnect: { iosVersion: 'latest' } } },
      });
      expect(() => run(dir)).toThrow(/iosVersion/);
      expect(read(dir, 'Podfile')).toBe(PODFILE);
    });

    it('leaves a Podfile that already names the Acoustic spec repo as it is', () => {
      const text = `${PODSPECS}\n${CDN}\n${PODFILE}`;
      expect(addPodSpecsSource(text)).toBe(text);
    });

    it('reports the source it adds even when both extension targets are already there', () => {
      const withTargets = PODFILE + "\ntarget 'ConnectNSE' do\nend\n\ntarget 'ConnectNCE' do\nend\n";
      const dir = app({ 'ios/App/Podfile': withTargets });
      const { report } = run(dir, { dryRun: true });
      expect(report.podfileTargets).toEqual([]);
      expect(report.podfileSource).toBe(true);
      expect(read(dir, 'Podfile')).toBe(withTargets);
      expect(run(dir).report.podfileSource).toBe(true);
      expect(run(dir).report.podfileSource).toBe(false);
    });

    it('leaves the Podfile as it is in a dry run, and says what it would add', () => {
      const dir = app({ 'ios/App/Podfile': PODFILE });
      const { calls, report } = run(dir, { dryRun: true });
      expect(read(dir, 'Podfile')).toBe(PODFILE);
      expect(report.podfileTargets).toEqual(['ConnectNSE', 'ConnectNCE']);
      expect(calls).toEqual([]);
    });
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

  it('adds the Acoustic spec repo with setup-ios-pods, and says what it would do with --dry-run', () => {
    const dir = app({ 'ios/App/Podfile': "platform :ios, '15.1'\n" });
    const dry = run('setup-ios-pods', dir, '--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/would add the go-acoustic\/PodSpecs source to ios\/App\/Podfile/);
    expect(read(dir, 'Podfile')).toBe("platform :ios, '15.1'\n");
    const real = run('setup-ios-pods', dir);
    expect(real.stdout).toMatch(/added the go-acoustic\/PodSpecs source to ios\/App\/Podfile/);
    expect(run('setup-ios-pods', dir).stdout).toMatch(/already names the go-acoustic\/PodSpecs source/);
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
