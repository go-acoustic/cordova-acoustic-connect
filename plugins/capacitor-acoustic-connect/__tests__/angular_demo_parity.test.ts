import * as fs from 'fs';
import * as path from 'path';

// The Angular sample (applications/DemoCapacitorAngular) promises a call for every public method of the plugin: this fails
// when a method is added to AcousticConnectApi and the sample does not call it.

const DEFINITIONS = path.join(__dirname, '..', 'src', 'definitions.ts');
const SERVICE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'applications',
  'DemoCapacitorAngular',
  'src',
  'app',
  'acoustic.service.ts',
);

function apiBlock(): string {
  const text = fs.readFileSync(DEFINITIONS, 'utf8');
  const start = text.indexOf('export interface AcousticConnectApi');
  return text.slice(start);
}

function methodNames(block: string): { top: string[]; push: string[] } {
  const pushStart = block.indexOf('push: {');
  const pushEnd = block.indexOf('\n  };', pushStart);
  const pushBlock = block.slice(pushStart, pushEnd);
  const top = block.slice(0, pushStart);
  const names = (s: string) => Array.from(new Set(Array.from(s.matchAll(/^\s{2,4}(\w+)\(/gm)).map((m) => m[1])));
  return { top: names(top), push: names(pushBlock) };
}

describe('the Angular sample covers the plugin API', () => {
  const service = fs.readFileSync(SERVICE, 'utf8');
  const { top, push } = methodNames(apiBlock());

  it('reads the methods of the API', () => {
    expect(top).toEqual(
      expect.arrayContaining(['enable', 'disable', 'logCustomEvent', 'logIdentity', 'getConfigItem']),
    );
    expect(push).toEqual(expect.arrayContaining(['requestPermission', 'getPermissionState', 'didReceiveResponse']));
  });

  it.each(top.map((n) => [n]))('calls AcousticConnect.%s', (name) => {
    expect(service).toMatch(new RegExp(`AcousticConnect\\.${name}\\(`));
  });

  it.each(push.map((n) => [n]))('calls AcousticConnect.push.%s', (name) => {
    expect(service).toMatch(new RegExp(`AcousticConnect\\.push\\.${name}\\(`));
  });
});

describe('the Angular sample shows the screens of DemoCapacitor', () => {
  const root = path.join(__dirname, '..', '..', '..', 'applications');
  const ts = fs.readFileSync(path.join(root, 'DemoCapacitorAngular', 'src', 'app', 'behaviour-core.ts'), 'utf8');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const core = require(path.join(root, 'DemoCapacitor', 'src', 'js', 'behaviour', 'behaviour-core.js'));
  const keys = (re: RegExp) => Array.from(ts.matchAll(re)).map((m) => m[1]);

  it('has the verification scenarios of DemoCapacitor, in the same order', () => {
    expect(keys(/^\s{4}key: '([\w-]+)'/gm)).toEqual(core.SCENARIOS.map((s: { key: string }) => s.key));
  });

  it('has the showcase features of DemoCapacitor, then its own two (the SDK and the manual push calls)', () => {
    const own = keys(/^\s{2}\{ id: '([\w-]+)', title:/gm);
    expect(own.slice(0, core.FEATURES.length)).toEqual(core.FEATURES.map((f: { id: string }) => f.id));
    expect(own.slice(core.FEATURES.length)).toEqual(['sdk', 'push-manual']);
  });

  it('has the same probe, payloads and chain depth', () => {
    expect(ts).toContain(`key: '${core.CONFIG_PROBE.key}'`);
    expect(ts).toContain(`name: '${core.CUSTOM_EVENT.name}'`);
    expect(ts).toContain(`MAX_DEPTH = ${core.MAX_DEPTH}`);
    expect(ts).toContain(`SAMPLE_TEXT = '${core.SAMPLE_TEXT}'`);
  });
});
