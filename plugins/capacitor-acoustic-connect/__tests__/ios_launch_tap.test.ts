/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

// The notification tap that launches a killed app on iOS. The SDK takes over notification handling inside `enable`, so when the page calls
// `enable()` (autoEnable off, or no keys in the config) the tap, delivered right after launch, went to Capacitor's router and was lost. The
// native side keeps it in PushLaunchHolder and replays it into the SDK once `enable` has run. The holder needs a running app, so it is checked
// on the simulator; these tests keep the wiring and the rules from being undone by an edit (the Swift tests cover the order of the calls).

const root = path.join(__dirname, '..');
const sources = path.join(root, 'ios', 'Sources', 'AcousticConnectPlugin');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const source = (file: string) => fs.readFileSync(path.join(sources, file), 'utf8');
const releaseNotes = () => fs.readFileSync(path.join(root, '..', '..', 'latestChangesCapacitor'), 'utf8');

describe('the iOS launch tap holder', () => {
  const holder = () => source('PushLaunchHolder.swift');

  it('sits in the one directory that the podspec and the Swift package both build', () => {
    expect(fs.existsSync(path.join(sources, 'PushLaunchHolder.swift'))).toBe(true);
    const podspec = read(fs.readdirSync(root).find((f: string) => f.endsWith('.podspec')) as string);
    expect(podspec).toMatch(/source_files\s*=\s*'ios\/Sources\/\*\*\/\*\.\{swift/);
    expect(read('Package.swift')).toContain('path: "ios/Sources/AcousticConnectPlugin"');
    expect(JSON.parse(read('package.json')).files).toContain('ios/Sources');
  });

  it('is installed when the plugin loads, before the SDK can start and before the bridge logic exists', () => {
    const plugin = source('AcousticConnectPlugin.swift');
    const install = plugin.indexOf('PushLaunchHolder.installIfWanted(config: config)');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(plugin.indexOf('public override func load()'));
    expect(install).toBeLessThan(plugin.indexOf('beginAutoEnable'));
    expect(plugin).toContain('launchHold: launchHold');
  });

  it("is wanted only for push in automatic mode, and put in front of Capacitor's router or an empty slot only", () => {
    const text = holder();
    expect(text).toMatch(/pushEnabled && \(mode \?\? \.automatic\) == \.automatic/);
    expect(text).toContain('current == nil || current is NotificationRouter');
  });

  it('passes every notification call on to the router it stands in front of, and answers itself without one', () => {
    const text = holder();
    expect(text).toContain(
      'previous?.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)',
    );
    expect(text).toContain(
      'previous?.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)',
    );
    expect(text).toMatch(/completionHandler\(\[\]\)/);
  });

  it('keeps the latest tap only, ignores a dismissal, and drops a tap older than 30 seconds', () => {
    const text = holder();
    expect(text).toContain('UNNotificationDismissActionIdentifier');
    expect(text).toMatch(/maxHoldSeconds: TimeInterval = 30/);
    expect(text).toMatch(/Date\(\)\.timeIntervalSince\(heldAt\) <= Self\.maxHoldSeconds/);
  });

  it('empties the slot for the SDK, which asserts it is empty, and gives the router back when the SDK will not install a delegate', () => {
    expect(holder()).toContain('center.delegate = sdkInstallsDelegate ? nil : previous');
  });

  it('replays the tap through the delegate the SDK installed, not through the manual forwarders', () => {
    const text = holder();
    expect(text).toContain('delegate.userNotificationCenter?(center, didReceive: response, withCompletionHandler: {})');
    expect(text).not.toContain('didReceivePushResponse');
  });

  it('is handed over just before the SDK is enabled and replayed after the config that needs the SDK running', () => {
    const bridge = source('AcousticConnect.swift');
    const handOver = bridge.indexOf('launchHold?.handOver(sdkInstallsDelegate: mode == .automatic)');
    const enable = bridge.indexOf('sdk.enable(appKey: appKey');
    const after = bridge.indexOf('applyConfigAfterEnable()\n        launchTap?()');
    expect(handOver).toBeGreaterThan(-1);
    expect(handOver).toBeLessThan(enable);
    expect(enable).toBeLessThan(after);
  });

  it('leaves consent where it was: nothing in the holder or its wiring enables the SDK', () => {
    const code = holder()
      .split('\n')
      .filter((line: string) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/ConnectSDK|\.enable\(/);
  });
});

describe('the docs and the release notes on the iOS launch tap', () => {
  it("push.md describes the launch tap and no longer puts the SDK in front of Capacitor's router", () => {
    const text = read('docs', 'push.md');
    expect(text).toContain('A tap that launches the app');
    expect(text).toContain('30 seconds');
    expect(text).not.toContain("in front of Capacitor's");
  });

  it('the Capacitor release notes have the fix, and carry no ticket keys', () => {
    const notes = releaseNotes();
    expect(notes).toMatch(/Fixes\n\n- iOS: tapping a push notification that launched a killed app/);
    expect(notes).not.toMatch(/\b[A-Z]{2,}-\d+\b/);
  });
});
