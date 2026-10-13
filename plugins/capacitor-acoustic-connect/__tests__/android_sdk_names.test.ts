/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const MAIN = path.join(__dirname, '..', 'android', 'src', 'main', 'kotlin', 'co', 'acoustic', 'connect', 'capacitor');

// The Connect Android SDK takes the module of a config setting, and the class that posts the queue at once, as strings. They are
// written once, in ConnectSdk.kt, with a comment saying what they are, so a reader of the other files is not left to wonder and a
// change in the SDK is one edit.
describe('names the Connect Android SDK takes as strings', () => {
  const sources = () =>
    fs
      .readdirSync(MAIN)
      .filter((f: string) => f.endsWith('.kt'))
      .map((f: string) => ({ file: f, text: fs.readFileSync(path.join(MAIN, f), 'utf8') }));

  /** The literals of a file: its comments do not count. */
  const code = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line: string) => !line.trim().startsWith('//'))
      .join('\n');

  const count = (needle: string) =>
    sources().flatMap(({ file, text }: { file: string; text: string }) =>
      code(text)
        .split(needle)
        .slice(1)
        .map(() => file),
    );

  it('writes the config module "Tealeaf" once, in ConnectSdk.kt', () => {
    expect(count('"Tealeaf"')).toEqual(['ConnectSdk.kt']);
  });

  it('writes the class "com.tl.uic.Tealeaf" once, in ConnectSdk.kt', () => {
    expect(count('"com.tl.uic.Tealeaf"')).toEqual(['ConnectSdk.kt']);
  });

  it('explains the constants', () => {
    const text = sources().find(({ file }: { file: string }) => file === 'ConnectSdk.kt').text;
    expect(text).toMatch(
      /\/\*\*[^]*config module[^]*\*\/\s*(internal |public )?const val TEALEAF_CONFIG_MODULE = "Tealeaf"/i,
    );
  });
});

// The class that talks to the SDK is internal to the plugin, so it is named for what it is, not as a stand-in for something else.
describe('the class that implements ConnectSdk', () => {
  const root = path.join(__dirname, '..');
  const kotlin = fs.readFileSync(path.join(MAIN, 'ConnectSdk.kt'), 'utf8');
  const swiftDir = path.join(root, 'ios', 'Sources', 'AcousticConnectPlugin');

  it('is ConnectSdkImpl, and internal, in Kotlin', () => {
    expect(kotlin).toMatch(/^internal class ConnectSdkImpl\(/m);
    expect(kotlin).not.toContain('RealConnectSdk');
  });

  it('is ConnectSdkImpl in Swift, in a file of that name', () => {
    expect(fs.existsSync(path.join(swiftDir, 'ConnectSdkImpl.swift'))).toBe(true);
    expect(fs.existsSync(path.join(swiftDir, 'RealConnectSdk.swift'))).toBe(false);
    expect(fs.readFileSync(path.join(swiftDir, 'ConnectSdkImpl.swift'), 'utf8')).toMatch(
      /final class ConnectSdkImpl: ConnectSdk/,
    );
  });

  it('is not called by the old name anywhere in the plugin', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e: { name: string; isDirectory: () => boolean }) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory())
          return ['node_modules', 'build', 'dist', '.build', '__tests__'].includes(e.name) ? [] : walk(full);
        return /\.(kt|swift|md)$/.test(e.name) ? [full] : [];
      });
    const offenders = walk(root).filter((f) => fs.readFileSync(f, 'utf8').includes('RealConnectSdk'));
    expect(offenders).toEqual([]);
  });
});

export {};
