/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Runs the offline self-test of the release-verification skill's assertion engine
 * (.claude/skills/release-verification/scripts/assert-messages.mjs) as part of the
 * plugin's Jest suite, so a change to the engine is checked in CI.
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
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
});
