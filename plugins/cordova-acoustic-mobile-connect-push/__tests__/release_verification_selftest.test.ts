/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs the offline self-test of the release-verification skill's assertion engine
 * (.claude/skills/release-verification/scripts/assert-messages.mjs) as part of the
 * plugin's Jest suite, so a change to the engine is checked in CI.
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ENGINE = join(
    __dirname, '..', '..', '..', '.claude', 'skills', 'release-verification',
    'scripts', 'assert-messages.mjs'
);

// `.claude` is not part of the public mirror of this repository (Jenkinsfile excludes it), so
// there the whole skills folder is absent and these tests skip instead of failing for someone who
// runs `npm test` in it. Where the folder exists, a missing engine is a real failure (the file
// was moved or renamed), so these tests do not skip silently.
const SKILLS_DIR = join(__dirname, '..', '..', '..', '.claude', 'skills');
const describeIfEnginePresent = existsSync(SKILLS_DIR) ? describe : describe.skip;

describeIfEnginePresent('release-verification assertion engine', () => {
    it('finds the assertion engine where the skill keeps it', () => {
        expect(existsSync(ENGINE)).toBe(true);
    });

    it('selftest passes: every scenario agrees with its expectation', () => {
        const run = spawnSync(process.execPath, [ENGINE, 'selftest'], { encoding: 'utf8' });
        expect(run.stdout).toContain('all agree with expectation');
        expect(run.status).toBe(0);
    });

    // Node writes to a pipe asynchronously on some platforms, and `process.exit()` drops what is still waiting to be written:
    // on a loaded build agent the self-test's report was cut off before its last lines, and this test failed at random.
    // The preload below makes every write to stdout late, which is that situation every time.
    it('prints the whole selftest report even when stdout is slow', () => {
        const preload = join(mkdtempSync(join(tmpdir(), 'slow-stdout-')), 'slow-stdout.mjs');
        writeFileSync(preload, [
            'const real = process.stdout.write.bind(process.stdout);',
            'process.stdout.write = (chunk, encoding, callback) => {',
            "    const done = typeof encoding === 'function' ? encoding : callback;",
            '    setTimeout(() => { real(chunk); if (done) done(); }, 20);',
            '    return true;',
            '};'
        ].join('\n'));
        const run = spawnSync(process.execPath, ['--import', preload, ENGINE, 'selftest'], { encoding: 'utf8' });
        expect(run.stdout).toContain('all agree with expectation');
        expect(run.status).toBe(0);
    });
});
