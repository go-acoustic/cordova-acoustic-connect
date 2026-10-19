// The Capacitor plugin says it has "the Cordova plugin's API": the same method names, positional arguments, push.* group and error
// codes (docs/migration-from-cordova.md). Nothing but these checks keeps the two in step when one of them changes. The e2e core
// checks what the plugins do; this checks what they offer, from the API objects themselves (the Cordova file `www/AcousticConnect.js`
// and `createAcousticConnect` of this plugin), so a method added to one plugin and forgotten in the other fails here.
//
// The differences that are meant are listed below, each with its reason. A new one has to be listed here, and in the migration
// guide, on purpose.

import * as fs from 'fs';
import * as path from 'path';

import { createAcousticConnect } from '../src/api';
import type { AcousticConnectPlugin } from '../src/definitions';

// The Cordova file needs cordova/exec, which only a Cordova app has.
jest.mock('cordova/exec', () => jest.fn(), { virtual: true });
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cordovaApi = require('../../cordova-acoustic-mobile-connect-push/www/AcousticConnect.js');

const capacitorApi = createAcousticConnect({} as AcousticConnectPlugin);

/** Methods only the Capacitor plugin has, and why. */
const CAPACITOR_ONLY: Record<string, string> = {
  'push.didRegisterWithToken':
    'iOS manual push mode: Capacitor apps get the APNs token from @capacitor/push-notifications; the Cordova plugin has no call for it',
  'push.didFailToRegister': 'the pair of push.didRegisterWithToken',
};

/** Methods only the Cordova plugin has, and why. None: every call of the Cordova plugin is on the Capacitor one. */
const CORDOVA_ONLY: Record<string, string> = {};

/**
 * Methods whose number of declared parameters differs, as [Cordova, Capacitor], with the reason in a comment beside the entry. None now;
 * an entry would look like `'push.didReceiveResponse': [2, 3], // why the Capacitor method takes one more`.
 */
const ARITY_DIFFERENCES: Record<string, [number, number]> = {};

/** A method of an API object: only its name and the number of declared parameters are compared. */
type Method = (...args: unknown[]) => unknown;

/** `name` for a function, `push.name` for the methods of the push group. */
function methods(api: Record<string, unknown>): Map<string, Method> {
  const found = new Map<string, Method>();
  for (const [name, value] of Object.entries(api)) {
    if (typeof value === 'function') found.set(name, value as Method);
    else if (name === 'push' && value && typeof value === 'object') {
      for (const [inner, fn] of Object.entries(value as Record<string, unknown>)) {
        if (typeof fn === 'function') found.set(`push.${inner}`, fn as Method);
      }
    }
  }
  return found;
}

/** Every file under a directory, without build output, dependencies and symbolic links (a link to a parent directory would never end). */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'build' ? [] : walk(full);
    return [full];
  });
}

const cordova = methods(cordovaApi);
const capacitor = methods(capacitorApi as unknown as Record<string, unknown>);

describe('the API of the Cordova plugin and of the Capacitor plugin', () => {
  it('finds the methods of both, so the checks below do not pass on empty lists', () => {
    expect(cordova.size).toBeGreaterThan(20);
    expect(capacitor.size).toBeGreaterThan(20);
    expect(cordova.has('enable') && cordova.has('push.requestPermission')).toBe(true);
  });

  it('has every method of the Cordova plugin on the Capacitor plugin, except the ones listed', () => {
    const missing = [...cordova.keys()].filter((name) => !capacitor.has(name) && !(name in CORDOVA_ONLY));
    expect(missing).toEqual([]);
  });

  it('has no method on the Capacitor plugin that the Cordova plugin lacks, except the ones listed', () => {
    const extra = [...capacitor.keys()].filter((name) => !cordova.has(name) && !(name in CAPACITOR_ONLY));
    expect(extra).toEqual([]);
  });

  it('lists only differences that are still there', () => {
    for (const name of Object.keys(CAPACITOR_ONLY)) {
      expect([name, capacitor.has(name) && !cordova.has(name)]).toEqual([name, true]);
    }
    for (const name of Object.keys(CORDOVA_ONLY)) {
      expect([name, cordova.has(name) && !capacitor.has(name)]).toEqual([name, true]);
    }
    for (const name of Object.keys(ARITY_DIFFERENCES)) {
      expect([name, cordova.has(name) && capacitor.has(name)]).toEqual([name, true]);
    }
  });

  it('takes the same number of positional arguments in every shared method, except the ones listed', () => {
    const different: string[] = [];
    for (const [name, cordovaMethod] of cordova) {
      const capacitorMethod = capacitor.get(name);
      if (!capacitorMethod) continue;
      const listed = ARITY_DIFFERENCES[name];
      const ok = listed
        ? cordovaMethod.length === listed[0] && capacitorMethod.length === listed[1]
        : cordovaMethod.length === capacitorMethod.length;
      if (!ok) different.push(`${name}: Cordova ${cordovaMethod.length}, Capacitor ${capacitorMethod.length}`);
    }
    expect(different).toEqual([]);
  });

  it('promises the same error codes, and each plugin has all of them', () => {
    // docs/migration-from-cordova.md: the codes an app can see in a { code, message } error.
    const promised = ['ACOUSTIC_INTERNAL_ERROR', 'ACOUSTIC_INVALID_ARGS', 'ACOUSTIC_PUSH_MODE_NOT_MANUAL'];
    const root = path.join(__dirname, '..', '..');
    const sources = (...dirs: string[][]): string =>
      dirs
        .map((parts) => path.join(root, ...parts))
        .flatMap((dir) => walk(dir))
        .map((file) => fs.readFileSync(file, 'utf8'))
        .join('\n');
    const cordovaText = sources(
      ['cordova-acoustic-mobile-connect-push', 'www'],
      ['cordova-acoustic-mobile-connect-push', 'src', 'android'],
      ['cordova-acoustic-mobile-connect-push', 'src', 'ios'],
    );
    const capacitorText = sources(
      ['capacitor-acoustic-connect', 'src'],
      ['capacitor-acoustic-connect', 'ios', 'Sources'],
      ['capacitor-acoustic-connect', 'android', 'src', 'main'],
    );
    for (const code of promised) {
      expect([code, cordovaText.includes(code), capacitorText.includes(code)]).toEqual([code, true, true]);
    }
    // No code on the Capacitor side that the guide does not name. The scan reads the source as text, so a code named in a comment or a
    // string counts too: a new ACOUSTIC_ identifier anywhere in these directories has to be added to the guide and to `promised`.
    const used = [...new Set(capacitorText.match(/ACOUSTIC_[A-Z_]+/g) ?? [])].sort();
    expect(used).toEqual(promised);
  });
});
