/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/*
 * Runs the screen views of the Angular sample (applications/DemoCapacitorAngular/src/app/behaviour-core.ts), transpiled here: the sample's
 * own dependencies are not installed for the plugin's tests. The calls below are the ones its components make (home.ts, behaviour-tab.ts,
 * behaviour-showcase.ts, acoustic.service.ts); the components themselves are not run.
 */

const APP = path.join(__dirname, '..', '..', '..', 'applications', 'DemoCapacitorAngular', 'src', 'app');

type Steps = { unload: Promise<unknown> | null; load: Promise<unknown> | null };
interface PageScreens {
  showTab(tab: string, subtab?: string): Steps;
  showSubtab(subtab: string): Steps;
  open(subtab: string, name: string): Steps;
  back(subtab: string): Steps;
  stack(subtab: string): string[];
  setEnabled(value: boolean): Steps;
  current(): string | null;
}

function loadCore(): { createPageScreens: (api: () => unknown) => PageScreens } {
  const source = fs.readFileSync(path.join(APP, 'behaviour-core.ts'), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', 'require', js)(module, module.exports, () => ({}));
  return module.exports as never;
}

function recordingApi() {
  const calls: string[] = [];
  const api = {
    logScreenViewContextLoad: (name: string, referrer: string | null) => {
      calls.push(`LOAD ${name} <- ${referrer}`);
      return Promise.resolve();
    },
    logScreenViewContextUnload: (name: string, referrer: string | null) => {
      calls.push(`UNLOAD ${name} <- ${referrer}`);
      return Promise.resolve();
    },
  };
  return { api, calls };
}

async function settled(steps: Steps): Promise<void> {
  await steps.load;
  await steps.unload;
}

describe('the Angular sample logs its screens as the JavaScript samples do', () => {
  const none = { unload: null, load: null };

  it('logs the walk from launch to Verification, the next screen loaded first', async () => {
    const { api, calls } = recordingApi();
    const screens = loadCore().createPageScreens(() => api);
    screens.showTab('notification'); // HomePage.ngOnInit
    screens.setEnabled(true); // AcousticService.waitForSdk
    screens.showTab('identity'); // HomePage.select('identity')
    screens.showTab('behaviour', 'actions'); // BehaviourTab.ngOnInit
    screens.showSubtab('showcase'); // BehaviourTab.select('showcase')
    expect(await screens.open('showcase', 'Gestures').load).toEqual({ ok: true }); // AcousticService.openView, from BehaviourShowcase.openGestures
    expect(screens.showSubtab('showcase')).toEqual(none); // the active Showcase sub-tab tapped while Gestures is open
    expect(await screens.back('showcase').unload).toEqual({ ok: true }); // AcousticService.closeView, from BehaviourShowcase.closeGestures
    await settled(screens.showSubtab('verification'));
    expect(calls).toEqual([
      'LOAD Push <- null',
      'LOAD Identity <- Push',
      'UNLOAD Push <- null',
      'LOAD Behaviour <- Identity',
      'UNLOAD Identity <- Push',
      'LOAD Showcase <- Behaviour',
      'UNLOAD Behaviour <- Identity',
      'LOAD Gestures <- Showcase',
      'UNLOAD Showcase <- Behaviour',
      'LOAD Showcase <- Gestures',
      'UNLOAD Gestures <- Showcase',
      'LOAD Verification <- Showcase',
      'UNLOAD Showcase <- Gestures',
    ]);
  });

  it('keeps the view opened on a sub-tab when its component is destroyed, and shows it again when the tab comes back', async () => {
    const { api, calls } = recordingApi();
    const screens = loadCore().createPageScreens(() => api);
    screens.showTab('behaviour', 'showcase');
    await settled(screens.setEnabled(true));
    await settled(screens.open('showcase', 'Gestures'));
    await settled(screens.showTab('identity')); // the Behaviour tab and the Showcase are destroyed, the stack is in AcousticService
    await settled(screens.showTab('behaviour', 'showcase')); // BehaviourTab.ngOnInit with the sub-tab kept in AcousticService
    expect(screens.stack('showcase')).toEqual(['Gestures']);
    expect(calls).toEqual([
      'LOAD Showcase <- null',
      'LOAD Gestures <- Showcase',
      'UNLOAD Showcase <- null',
      'LOAD Identity <- Gestures',
      'UNLOAD Gestures <- Showcase',
      'LOAD Gestures <- Identity',
      'UNLOAD Identity <- Gestures',
    ]);
  });

  it('stops on disable and loads the screen on display again on enable', async () => {
    const { api, calls } = recordingApi();
    const screens = loadCore().createPageScreens(() => api);
    screens.showTab('notification');
    await settled(screens.setEnabled(true));
    expect(screens.setEnabled(false)).toEqual(none); // AcousticService.disable
    expect(screens.showTab('identity')).toEqual(none);
    await settled(screens.setEnabled(true)); // AcousticService.enable
    expect(calls).toEqual(['LOAD Push <- null', 'LOAD Identity <- null']);
  });

  it('wires the components to these calls', () => {
    const read = (file: string) => fs.readFileSync(path.join(APP, file), 'utf8');
    expect(read('home/home.ts')).toContain("if (tab !== 'behaviour') this.acoustic.screens.showTab(tab);");
    const tab = read('tabs/behaviour-tab.ts');
    expect(tab).toContain("this.acoustic.screens.showTab('behaviour', this.subtab());");
    expect(tab).toContain('this.acoustic.screens.showSubtab(s);');
    expect(tab).toContain('readonly subtab = this.acoustic.subtab;');
    const showcase = read('tabs/behaviour-showcase.ts');
    expect(showcase).toContain("this.acoustic.openView('showcase', GESTURE_SCREEN).load");
    expect(showcase).toContain("this.acoustic.closeView('showcase').unload");
    expect(showcase).toContain("this.acoustic.openView('showcase', detailScreen(1))");
    expect(showcase).toContain("this.acoustic.openView('showcase', detailScreen(depth + 1))");
    expect(showcase).toContain("this.acoustic.closeView('showcase');");
    expect(showcase).not.toContain('ngOnDestroy');
    expect(read('tabs/behaviour-verification.ts')).toContain("acoustic.openView('verification', screenViews)");
    const screenViews = read('tabs/behaviour-screen-views.ts');
    expect(screenViews).toContain("acoustic.closeView('verification')");
    expect(screenViews).toContain('acoustic.enterCase(');
    const service = read('acoustic.service.ts');
    expect(service).toContain('this.screens.setEnabled(true)');
    expect(service).toContain('AcousticConnect.disable().then(() => void this.screens.setEnabled(false))');
    expect(service).toContain('const steps = this.screens.open(subtab, name);');
    expect(service).toContain('const steps = this.screens.back(subtab);');
    expect(service).toContain("this.openView('verification', name).load");
  });
});
