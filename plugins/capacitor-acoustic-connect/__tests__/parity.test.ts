import * as fs from 'fs';
import * as path from 'path';

// The three platforms are written separately, so nothing but these checks keeps them the same: every method of
// the native interface must exist on iOS, Android and the web stub, the error codes must be the same strings, and
// every config key must be read by someone.

const root = path.resolve(__dirname, '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const definitions = read('src', 'definitions.ts');
const swiftPlugin = read('ios', 'Sources', 'AcousticConnectPlugin', 'AcousticConnectPlugin.swift');
const swiftBridge = read('ios', 'Sources', 'AcousticConnectPlugin', 'AcousticConnect.swift');
const swiftConfig = read('ios', 'Sources', 'AcousticConnectPlugin', 'NativeConfig.swift');
const kotlinDir = path.join('android', 'src', 'main', 'kotlin', 'co', 'acoustic', 'connect', 'capacitor');
const kotlinPlugin = read(kotlinDir, 'AcousticConnectPlugin.kt');
const kotlinBridge = read(kotlinDir, 'AcousticConnect.kt');
const kotlinConfig = read(kotlinDir, 'NativeConfig.kt');
const gradle = read('android', 'build.gradle');
// The podspec is named for the package: with the beta name in the private repo, with the release name in the public one.
const podspec = read(fs.readdirSync(root).find((f: string) => f.endsWith('.podspec')) as string);
const cliSetup = read('cli', 'setup-ios-push.cjs');
const web = read('src', 'web.ts');
const api = read('src', 'api.ts');

/** The text between the braces of `export interface <name> {`. */
function interfaceBody(source: string, name: string): string {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`interface ${name} not found`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(source.indexOf('{', start) + 1, i);
    }
  }
  throw new Error(`interface ${name} is not closed`);
}

/** Top-level members of an interface body: `name(` for methods, `name?:` or `name:` for properties. */
function members(body: string, kind: 'method' | 'property'): string[] {
  const names: string[] = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    if (depth === 0) {
      const m = kind === 'method' ? /^ {2}([A-Za-z]+)\(/.exec(line) : /^ {2}([A-Za-z]+)\??:/.exec(line);
      if (m) names.push(m[1]);
    }
    depth += (line.match(/[{(]/g) || []).length - (line.match(/[})]/g) || []).length;
    if (depth < 0) depth = 0;
  }
  return [...new Set(names)].sort();
}

/** Kotlin `@PluginMethod fun name(call: PluginCall)`, with or without annotation arguments, on one line or two. */
const kotlinPluginMethods = (source: string): string[] =>
  [...source.matchAll(/@PluginMethod(?:\([^)]*\))?\s+fun ([A-Za-z]+)\(\s*call: PluginCall\s*\)/g)].map((m) => m[1]);

/** Swift `CAPPluginMethod(name: "x", ...)` entries. */
const swiftPluginMethods = (source: string): string[] =>
  [...source.matchAll(/CAPPluginMethod\(\s*name:\s*"([A-Za-z]+)"/g)].map((m) => m[1]);

/** Swift `@objc func x(_ call: CAPPluginCall)` handlers, with or without a visibility modifier. */
const swiftHandlers = (source: string): string[] =>
  [...source.matchAll(/@objc\s+(?:public\s+)?func ([A-Za-z]+)\(\s*_ call: CAPPluginCall\s*\)/g)].map((m) => m[1]);

const nativeMethods = members(interfaceBody(definitions, 'AcousticConnectPlugin'), 'method');
const configKeys = members(interfaceBody(definitions, 'AcousticConnectConfig'), 'property');

describe('native methods', () => {
  it('finds the methods it checks', () => {
    expect(nativeMethods.length).toBeGreaterThanOrEqual(20);
    expect(nativeMethods).toEqual(expect.arrayContaining(['enable', 'logSignal', 'pushDidReceiveResponse']));
  });

  it.each([
    ['iOS pluginMethods', () => [...swiftPlugin.matchAll(/CAPPluginMethod\(name: "([A-Za-z]+)"/g)].map((m) => m[1])],
    [
      'iOS @objc handlers',
      () => [...swiftPlugin.matchAll(/@objc func ([A-Za-z]+)\(_ call: CAPPluginCall\)/g)].map((m) => m[1]),
    ],
    [
      'Android @PluginMethod',
      () => [...kotlinPlugin.matchAll(/@PluginMethod fun ([A-Za-z]+)\(call: PluginCall\)/g)].map((m) => m[1]),
    ],
    ['the web stub', () => [...web.matchAll(/^ {2}async ([A-Za-z]+)\(/gm)].map((m) => m[1])],
  ])('%s has every method of the native interface and nothing else', (_name, find) => {
    expect([...new Set(find())].sort()).toEqual(nativeMethods);
  });

  it('is implemented by the bridge on both platforms', () => {
    // each plugin handler calls the bridge method of the same name
    for (const method of nativeMethods) {
      expect(swiftPlugin).toMatch(new RegExp(`connect\\.${method}\\(`));
      expect(kotlinPlugin).toMatch(new RegExp(`connect\\.${method}\\(`));
    }
  });
});

describe('the source scanners', () => {
  it('read a Kotlin handler whether or not the annotation has arguments or the signature wraps', () => {
    expect(kotlinPluginMethods('@PluginMethod fun a(call: PluginCall) = x()')).toEqual(['a']);
    expect(
      kotlinPluginMethods('@PluginMethod(returnType = PluginMethod.RETURN_NONE) fun b(call: PluginCall) {}'),
    ).toEqual(['b']);
    expect(kotlinPluginMethods('@PluginMethod\n    fun c(\n        call: PluginCall\n    ) {}')).toEqual(['c']);
  });

  it('read Swift entries and handlers with or without a modifier', () => {
    expect(swiftPluginMethods('CAPPluginMethod(name: "a", returnType: x),\nCAPPluginMethod(\n name: "b",')).toEqual([
      'a',
      'b',
    ]);
    expect(
      swiftHandlers('@objc func a(_ call: CAPPluginCall) {}\n@objc public func b(_ call: CAPPluginCall) {}'),
    ).toEqual(['a', 'b']);
  });

  it('do not read a method that is not a plugin handler', () => {
    expect(kotlinPluginMethods('fun helper(call: PluginCall) {}')).toEqual([]);
    expect(swiftHandlers('@objc func helper(_ options: [String: Any]) {}')).toEqual([]);
  });
});

describe('error codes', () => {
  const codes = ['ACOUSTIC_INVALID_ARGS', 'ACOUSTIC_INTERNAL_ERROR', 'ACOUSTIC_PUSH_MODE_NOT_MANUAL'];

  it.each(codes)('%s is the same string on iOS, Android and in the API docs', (code) => {
    expect(swiftBridge).toContain(`"${code}"`);
    expect(kotlinBridge).toContain(`"${code}"`);
    expect(definitions + api).toContain(code);
  });
});

describe('config keys', () => {
  const kotlinKeys = [...kotlinConfig.matchAll(/(?:string|bool)\("([A-Za-z]+)"\)/g)].map((m) => m[1]);
  const swiftKeys = [...swiftConfig.matchAll(/(?:string|bool|layoutBlock)\("([A-Za-z]+)"\)/g)].map((m) => m[1]);
  const gradleKeys = [
    ...gradle.matchAll(/acousticFlag\('([A-Za-z]+)'/g),
    ...gradle.matchAll(/acousticLayoutBlock\('([A-Za-z]+)'\)/g),
    ...gradle.matchAll(/acousticText\('([A-Za-z]+)'\)/g),
    ...podspec.matchAll(/pluginSetting\.call\('([A-Za-z]+)'\)/g),
    ...cliSetup.matchAll(/pluginSetting\([^,]+,\s*'([A-Za-z]+)'\)/g),
  ].map((m) => m[1]);

  it('finds the keys it checks', () => {
    expect(configKeys.length).toBeGreaterThanOrEqual(14);
    expect(kotlinKeys.length).toBeGreaterThan(5);
    expect(swiftKeys.length).toBeGreaterThan(5);
    expect(gradleKeys).toEqual(
      expect.arrayContaining(['pushEnabled', 'useRelease', 'layoutConfigAndroid', 'androidVersion', 'iosVersion']),
    );
  });

  it('every key a platform reads is documented in the config type', () => {
    for (const key of [...kotlinKeys, ...swiftKeys, ...gradleKeys]) {
      expect(configKeys).toContain(key);
    }
  });

  it('every documented key is read by at least one platform', () => {
    const read = new Set([...kotlinKeys, ...swiftKeys, ...gradleKeys]);
    for (const key of configKeys) {
      expect(read).toContain(key);
    }
  });

  it('the settings both platforms understand are read by both', () => {
    const both = [
      'appKey',
      'postMessageUrl',
      'autoEnable',
      'useRelease',
      'killSwitchEnabled',
      'killSwitchUrl',
      'locationLoggingEnabled',
      'screenCaptureEnabled',
      'pushEnabled',
    ];
    for (const key of both) {
      expect([key, kotlinKeys.includes(key)]).toEqual([key, true]);
      expect([key, swiftKeys.includes(key)]).toEqual([key, true]);
    }
  });
});

describe('the README names every push method of the API', () => {
  const readme = read('README.md');
  const pushBody = /^ {2}push: \{([\s\S]*?)^ {2}\};/m.exec(
    interfaceBody(read('src', 'definitions.ts'), 'AcousticConnectApi'),
  );
  const names = [...(pushBody ? pushBody[1] : '').matchAll(/^ {4}([A-Za-z]+)\(/gm)].map((m) => m[1]);

  it('finds the push methods in the API', () => {
    expect(names).toEqual(expect.arrayContaining(['requestPermission', 'didRegisterWithToken', 'didFailToRegister']));
  });

  it.each(names)('%s', (name) => {
    expect(readme).toContain(name);
  });
});
