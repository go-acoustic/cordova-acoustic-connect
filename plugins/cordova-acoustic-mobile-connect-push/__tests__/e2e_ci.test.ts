/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Tests for running the e2e verification in Jenkins: the iOS simulator picker the CI
 * stage uses (e2e/core/commands.js + pick-simulator.js) and the shape of the
 * 'E2E Verification' stage in the Jenkinsfile.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const E2E = join(ROOT, 'e2e', 'core');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const commands = require(join(E2E, 'commands.js'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const picker = require(join(E2E, 'pick-simulator.js'));

function sim(udid: string, name: string, extra: Record<string, unknown> = {}) {
    return { udid, name, isAvailable: true, state: 'Shutdown', ...extra };
}

describe('pickIosSimulator', () => {
    it('takes an available iPhone from the newest iOS runtime', () => {
        const json = JSON.stringify({ devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [sim('OLD', 'iPhone 15')],
            'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [sim('NEW', 'iPhone 17')],
        } });
        expect(commands.pickIosSimulator(json)).toBe('NEW');
    });

    it('compares runtime versions as numbers, not text', () => {
        const json = JSON.stringify({ devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-9-3': [sim('NINE', 'iPhone 6')],
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [sim('EIGHTEEN', 'iPhone 16')],
        } });
        expect(commands.pickIosSimulator(json)).toBe('EIGHTEEN');
    });

    it('prefers a booted simulator, so the runner does not start a second one', () => {
        const json = JSON.stringify({ devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
                sim('A', 'iPhone 17'), sim('B', 'iPhone 17 Pro', { state: 'Booted' }),
            ],
        } });
        expect(commands.pickIosSimulator(json)).toBe('B');
    });

    it('skips unavailable simulators and anything that is not an iPhone or not iOS', () => {
        const json = JSON.stringify({ devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
                sim('GONE', 'iPhone 17', { isAvailable: false }), sim('PAD', 'iPad Pro'),
            ],
            'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [sim('WATCH', 'iPhone-like watch')],
            'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [sim('OK', 'iPhone 16')],
        } });
        expect(commands.pickIosSimulator(json)).toBe('OK');
    });

    it('breaks a tie by udid, so the same agent always gets the same simulator', () => {
        const devices = [sim('B-2', 'iPhone 17'), sim('A-1', 'iPhone 17 Pro'), sim('C-3', 'iPhone Air')];
        const forward = JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': devices } });
        const reversed = JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [...devices].reverse() } });
        expect(commands.pickIosSimulator(forward)).toBe('A-1');
        expect(commands.pickIosSimulator(reversed)).toBe('A-1');
    });

    it('fails with a clear message when there is no usable simulator', () => {
        expect(() => commands.pickIosSimulator(JSON.stringify({ devices: {} }))).toThrow('no available iPhone simulator');
    });

    it('fails on output that is not JSON', () => {
        expect(() => commands.pickIosSimulator('not json')).toThrow('simctl');
    });
});

describe('pick-simulator.js', () => {
    it('prints only the udid so a shell can capture it', async () => {
        const out: string[] = [];
        const code = await picker.main({
            exec: async () => ({ stdout: JSON.stringify({ devices: {
                'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [sim('U-1', 'iPhone 17')],
            } }) }),
            write: (s: string) => out.push(s),
            writeError: () => undefined,
        });
        expect(code).toBe(0);
        expect(out.join('')).toBe('U-1\n');
    });

    it('exits 2 and writes nothing to stdout when none is found', async () => {
        const out: string[] = [];
        const err: string[] = [];
        const code = await picker.main({
            exec: async () => ({ stdout: JSON.stringify({ devices: {} }) }),
            write: (s: string) => out.push(s),
            writeError: (s: string) => err.push(s),
        });
        expect(code).toBe(2);
        expect(out).toEqual([]);
        expect(err.join('')).toContain('no available iPhone simulator');
    });
});

describe('Jenkinsfile: E2E Verification stage', () => {
    const jenkins: string = readFileSync(join(ROOT, 'Jenkinsfile'), 'utf8');
    const stageStart = jenkins.indexOf("stage('E2E Verification')");
    const stageBlock = stageStart === -1 ? '' : jenkins.slice(stageStart, jenkins.indexOf("stage('Publish Feature')"));
    const fnStart = jenkins.indexOf('def runE2eVerification()');
    const fnBlock = fnStart === -1 ? '' : jenkins.slice(fnStart, jenkins.indexOf('def runPluginTests()'));
    // the stage block decides whether to run; the function does the work
    const stage = stageBlock + fnBlock;

    it('finds the stage and the function, so the checks below do not pass on an empty text', () => {
        expect(stageStart).toBeGreaterThan(-1);
        expect(stageBlock).toContain('runE2eVerification()');
        expect(stageBlock.length).toBeGreaterThan(100);
        expect(fnBlock.length).toBeGreaterThan(300);
        expect(fnBlock).toContain('node e2e/run.js');
    });

    it('sits after Test and before every publish stage', () => {
        const test = jenkins.indexOf("stage('Test')");
        expect(stageStart).toBeGreaterThan(test);
        expect(fnStart).toBeGreaterThan(-1);
        expect(stageStart).toBeLessThan(jenkins.indexOf("stage('Publish Feature')"));
        expect(stageStart).toBeLessThan(jenkins.indexOf("stage('Publish Beta')"));
        expect(stageStart).toBeLessThan(jenkins.indexOf("stage('Publish Release')"));
    });

    it('runs on the same branches as the other build stages and only when the build is generated', () => {
        expect(stage).toContain("branch 'feature/*'");
        expect(stage).toContain("branch 'develop'");
        expect(stage).toContain("branch 'main'");
        expect(stage).toContain('genBuild');
    });

    it('is opt-in on feature branches (a build parameter that defaults to off) and always on for develop and main', () => {
        expect(jenkins).toMatch(/booleanParam\(name: 'RUN_E2E', defaultValue: false/);
        const decide = jenkins.slice(jenkins.indexOf('def shouldRunE2e()'), jenkins.indexOf('def runE2eVerification()'));
        expect(decide.length).toBeGreaterThan(50);
        expect(decide).toContain("'develop'");
        expect(decide).toContain("'main'");
        expect(decide).toContain('params.RUN_E2E');
        // the stage asks that function instead of reading the parameter itself
        expect(stageBlock).toContain('shouldRunE2e()');
        expect(stageBlock).not.toContain('params.RUN_E2E');
    });

    it('clones the collector sink over ssh from the same organisation as the repo', () => {
        expect(jenkins).toContain('git@github.com:aipoweredmarketer/ac-sdk-mobile-interceptor.git');
        expect(stage).toContain('--sink-repo');
    });

    it('runs the runner on an iOS simulator picked by the helper, with a time limit', () => {
        expect(stage).toContain('e2e/core/pick-simulator.js');
        expect(stage).toContain('e2e/run.js --platform ios');
        expect(stage).toContain('--device');
        expect(stage).toMatch(/timeout\(time: \d+, unit: 'MINUTES'\)/);
    });

    it('maps the runner exit codes: 1 is an error, 2 only marks the build unstable', () => {
        expect(stage).toContain('returnStatus: true');
        expect(stage).toMatch(/== 1[\s\S]*error\(/);
        expect(stage).toMatch(/== 2[\s\S]*unstable\(/);
    });

    it('does not block the build while the stage is new: a failure turns it unstable, and one constant makes it blocking', () => {
        expect(jenkins).toMatch(/@Field def e2eBuildResult\s*=\s*'UNSTABLE'/);
        expect(stageBlock).toMatch(/catchError\(buildResult: e2eBuildResult, stageResult: 'FAILURE'\)/);
        // the call to the runner sits inside that catchError
        expect(stageBlock.indexOf('catchError')).toBeLessThan(stageBlock.indexOf('runE2eVerification()'));
    });

    it('serialises the simulator between builds with a lock, as the React Native pipeline does for its emulator', () => {
        expect(jenkins).toMatch(/@Field def e2eLock\s*=\s*'[\w-]+'/);
        expect(fnBlock).toContain('lock(resource: e2eLock)');
        // the shutdown in finally happens while the lock is still held
        expect(fnBlock.indexOf('lock(resource: e2eLock)')).toBeLessThan(fnBlock.indexOf('simctl shutdown'));
    });

    it('logs how long the stage took, so "how long does it take" has an answer from the builds', () => {
        expect(fnBlock).toContain('System.currentTimeMillis()');
        expect(fnBlock).toMatch(/echo "E2E Verification took \$\{[^}]+\}s"/);
        // measured in the finally, so a failed or timed-out run is counted too
        expect(fnBlock.indexOf('took')).toBeGreaterThan(fnBlock.indexOf('finally'));
    });

    it('keeps the evidence and shuts the simulator down however the run ends', () => {
        expect(stage).toContain('archiveArtifacts');
        expect(stage).toContain('${demoDir}/e2e/evidence/**');
        expect(stage).toContain('finally');
        expect(stage).toContain('simctl shutdown');
    });

    it('does not put the evidence or the e2e files into a published package', () => {
        // the public mirror still leaves .claude out, and the evidence stays gitignored
        expect(jenkins).toContain("--exclude='.claude'");
        const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8') + readFileSync(join(ROOT, 'applications', 'Demo', '.gitignore'), 'utf8');
        expect(gitignore).toMatch(/e2e\/evidence/);
    });
});

describe('Jenkinsfile: build throttling', () => {
    const jenkins: string = readFileSync(join(ROOT, 'Jenkinsfile'), 'utf8');
    const options = jenkins.slice(jenkins.indexOf('options {'), jenkins.indexOf('parameters {'));

    it('throttles concurrent builds by the global categories, like the React Native repo', () => {
        expect(options).toContain('throttleJobProperty(');
        expect(options).toContain("categories: ['SDK', 'AndroidThrottle', 'iOSThrottle']");
        expect(options).toContain('throttleEnabled: true');
        expect(options).toContain("throttleOption: 'category'");
    });

    it('keeps the existing pipeline options', () => {
        expect(options).toContain("durabilityHint 'MAX_SURVIVABILITY'");
        expect(options).toContain("timeout(time: 60, unit: 'MINUTES')");
    });
});


describe('Jenkinsfile: Capacitor E2E Verification', () => {
    const jenkins: string = readFileSync(join(ROOT, 'Jenkinsfile'), 'utf8');
    const stageStart = jenkins.indexOf("stage('E2E Verification')");
    const stageBlock = jenkins.slice(stageStart, jenkins.indexOf("stage('Publish Feature')"));
    // the one run of the runner and the verification around it
    const fnStart = jenkins.indexOf('def runCapacitorE2eOnce(');
    const fnBlock = fnStart === -1 ? '' : jenkins.slice(fnStart, jenkins.indexOf('def runCapacitorPluginTests()'));
    const verification = fnBlock.slice(fnBlock.indexOf('def runCapacitorE2eVerification()'));

    it('finds the function, so the checks below do not pass on an empty text', () => {
        expect(fnStart).toBeGreaterThan(-1);
        expect(fnBlock.length).toBeGreaterThan(500);
    });

    it('runs in the E2E Verification stage, gated on the Capacitor build and the same decision as the Cordova one', () => {
        expect(stageBlock).toContain('runCapacitorE2eVerification()');
        expect(stageBlock).toMatch(/genBuild && runCapacitor && shouldRunE2e\(\)/);
        // not blocking while it is new, with the same constant
        const call = stageBlock.slice(0, stageBlock.indexOf('runCapacitorE2eVerification()'));
        expect(call.lastIndexOf("catchError(buildResult: e2eBuildResult, stageResult: 'FAILURE')")).toBeGreaterThan(call.lastIndexOf('runE2eVerification()'));
    });

    it('runs the Capacitor runner on an iOS simulator picked by the shared helper', () => {
        expect(fnBlock).toContain('e2e/core/pick-simulator.js');
        expect(fnBlock).toContain('node e2e/run.js --platform ios');
        expect(fnBlock).toContain('--sink-repo');
        expect(jenkins).toMatch(/@Field def capacitorDemoDir\s*=\s*"applications\/DemoCapacitor"/);
        expect(fnBlock).toContain('${capacitorDemoDir}');
        expect(fnBlock).toMatch(/timeout\(time: \d+, unit: 'MINUTES'\)/);
    });

    it('tests this checkout\'s plugin, installed as a copy so the app and the plugin share one @capacitor/core', () => {
        expect(fnBlock).toContain('npm run build');
        expect(fnBlock).toContain("npm install --no-save --install-links 'file:../../${capacitorDir}'");
        // built first, installed second, run last
        expect(verification.indexOf('npm run build')).toBeLessThan(verification.indexOf('--install-links'));
        expect(verification.indexOf('--install-links')).toBeLessThan(verification.indexOf('runCapacitorE2eOnce(udid)'));
        expect(fnBlock).toContain('node e2e/run.js --platform ios');
    });

    it('runs a failed run once more on a fresh install, and only a second failure fails the stage', () => {
        const first = verification.indexOf('def rc = runCapacitorE2eOnce(udid)');
        const retry = verification.indexOf('rc = runCapacitorE2eOnce(udid)', first + 10);
        expect(first).toBeGreaterThan(-1);
        expect(retry).toBeGreaterThan(first);
        // the retry is for a FAIL (1) only, reinstalls the app first, and the exit codes are mapped after it
        const between = verification.slice(first, retry);
        expect(between).toMatch(/if \(rc == 1\)/);
        expect(between).toContain("xcrun simctl uninstall '${udid}' co.acoustic.connect.capacitor.demo");
        expect(verification.indexOf("error('Capacitor E2E verification FAILED")).toBeGreaterThan(retry);
        // not a loop: one more run at most
        expect(verification.match(/runCapacitorE2eOnce\(udid\)/g)).toHaveLength(2);
    });

    it('uses Node 22 (nvm), which the Capacitor toolchain needs', () => {
        expect(fnBlock).toContain('${useNode22}');
    });

    it('maps the runner exit codes like the Cordova stage: 1 is an error, 2 only marks the build unstable', () => {
        expect(fnBlock).toContain('returnStatus: true');
        expect(fnBlock).toMatch(/== 1[\s\S]*error\(/);
        expect(fnBlock).toMatch(/== 2[\s\S]*unstable\(/);
    });

    it('shares the simulator lock, shuts the simulator down while holding it, and keeps the evidence', () => {
        expect(fnBlock).toContain('lock(resource: e2eLock)');
        expect(fnBlock.indexOf('lock(resource: e2eLock)')).toBeLessThan(fnBlock.indexOf('simctl shutdown'));
        expect(fnBlock).toContain('archiveArtifacts');
        expect(fnBlock).toContain('${capacitorDemoDir}/e2e/evidence/**');
        expect(fnBlock.indexOf('took')).toBeGreaterThan(fnBlock.indexOf('finally'));
    });

    it('keeps the Capacitor evidence out of git', () => {
        expect(readFileSync(join(ROOT, 'applications', 'DemoCapacitor', '.gitignore'), 'utf8')).toMatch(/e2e\/evidence/);
    });
});

describe('Jenkinsfile: an aborted build does not publish', () => {
    const jenkins: string = readFileSync(join(ROOT, 'Jenkinsfile'), 'utf8');
    const stageBlock = (name: string) => {
        const start = jenkins.indexOf(`stage('${name}')`);
        return start === -1 ? '' : jenkins.slice(start, jenkins.indexOf('steps {', start));
    };

    it.each([
        ['Publish Beta', "branch 'develop'"],
        ['Publish Release', "branch 'main'"],
    ])('%s needs its branch and a build that is not ABORTED', (name, branch) => {
        const block = stageBlock(name);
        expect(block.length).toBeGreaterThan(20);
        expect(block).toContain(branch);
        expect(block).toContain("expression { currentBuild.currentResult != 'ABORTED' }");
        expect(block).toMatch(/allOf\s*\{/);
    });

    it('still publishes an UNSTABLE build (the e2e and Capacitor test steps are non-blocking on purpose)', () => {
        expect(jenkins).not.toMatch(/currentResult\s*(==|!=)\s*'UNSTABLE'/);
    });

    it('keeps the e2e steps inside catchError, which is why the guard is needed', () => {
        const e2e = jenkins.slice(jenkins.indexOf("stage('E2E Verification')"), jenkins.indexOf("stage('Publish Feature')"));
        expect(e2e).toContain('catchError(buildResult: e2eBuildResult');
    });
});
