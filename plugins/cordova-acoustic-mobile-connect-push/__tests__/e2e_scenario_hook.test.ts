/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The Demo hook that puts the shared e2e scenario (e2e/core/scenario.js) into the app's www,
 * where index.html loads it, and the places that depend on that copy.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hook = require(join(ROOT, 'applications', 'Demo', 'hooks', 'before_prepare_e2e_scenario.js'));

describe('before_prepare_e2e_scenario hook', () => {
    let dir: string;

    // the hook finds the scenario two levels above the project: <root>/e2e/core, <root>/applications/<app>
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'e2e-hook-'));
        mkdirSync(join(dir, 'e2e', 'core'), { recursive: true });
        mkdirSync(join(dir, 'applications', 'Demo', 'www'), { recursive: true });
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const run = () => hook({ opts: { projectRoot: join(dir, 'applications', 'Demo') } });

    it('copies the shared scenario to www/js/e2e/scenario.js', () => {
        writeFileSync(join(dir, 'e2e', 'core', 'scenario.js'), '// scenario v1');
        run();
        expect(readFileSync(join(dir, 'applications', 'Demo', 'www', 'js', 'e2e', 'scenario.js'), 'utf8')).toBe('// scenario v1');
    });

    it('replaces an older copy on the next prepare', () => {
        writeFileSync(join(dir, 'e2e', 'core', 'scenario.js'), '// scenario v1');
        run();
        writeFileSync(join(dir, 'e2e', 'core', 'scenario.js'), '// scenario v2');
        run();
        expect(readFileSync(join(dir, 'applications', 'Demo', 'www', 'js', 'e2e', 'scenario.js'), 'utf8')).toBe('// scenario v2');
    });

    it('only warns when the shared scenario is missing and no e2e run is prepared (an app copied without the repository)', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(run).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('shared e2e scenario was not found'));
        expect(existsSync(join(dir, 'applications', 'Demo', 'www', 'js', 'e2e', 'scenario.js'))).toBe(false);
        warn.mockRestore();
    });

    it('fails when the shared scenario is missing during an e2e run (the prepare state file exists)', () => {
        mkdirSync(join(dir, 'applications', 'Demo', 'e2e'), { recursive: true });
        writeFileSync(join(dir, 'applications', 'Demo', 'e2e', '.prepare-state.json'), '{}');
        expect(run).toThrow('shared e2e scenario was not found');
    });
});

describe('the Demo app and the shared scenario', () => {
    const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

    it('registers the hook before prepare in config.xml', () => {
        expect(read('applications', 'Demo', 'config.xml')).toMatch(/<hook type="before_prepare" src="hooks\/before_prepare_e2e_scenario\.js" \/>/);
    });

    it('does not track the generated copy', () => {
        expect(read('applications', 'Demo', '.gitignore')).toContain('/www/js/e2e/scenario.js');
        expect(existsSync(join(ROOT, 'applications', 'Demo', 'www', 'js', 'e2e', 'scenario.js')) && require('child_process')
            .spawnSync('git', ['ls-files', '--error-unmatch', 'applications/Demo/www/js/e2e/scenario.js'], { cwd: ROOT }).status === 0).toBe(false);
    });

    it('is the file the Capacitor example apps import', () => {
        expect(read('applications', 'DemoCapacitor', 'src', 'js', 'e2e.js')).toContain("../../../../e2e/core/scenario.js");
        expect(read('applications', 'DemoCapacitorAngular', 'src', 'app', 'e2e.ts')).toContain("../../../../e2e/core/scenario.js");
    });
});
