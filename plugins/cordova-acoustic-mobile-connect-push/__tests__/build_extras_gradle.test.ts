/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Static checks of src/android/build-extras.gradle: where the Connect Android SDK is resolved
 * from. Connect betas are published only to the GitHub-hosted Maven tree (go-acoustic/Android_Maven),
 * not to Maven Central, so `useRelease` selects the source, the same way the React Native
 * bridge does it.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const GRADLE = readFileSync(join(__dirname, '..', 'src', 'android', 'build-extras.gradle'), 'utf8');
const BETA_TREE = 'https://raw.githubusercontent.com/go-acoustic/Android_Maven/master';

describe('build-extras.gradle: where the Connect Android SDK comes from', () => {
    it('declares the GitHub-hosted beta tree when useRelease is not true', () => {
        expect(GRADLE).toContain(BETA_TREE);
        expect(GRADLE).toMatch(/if\s*\(\s*!useRelease\s*\)\s*\{[\s\S]*?Android_Maven/);
    });

    it('limits that tree to the Connect group, so no other dependency asks it', () => {
        expect(GRADLE).toMatch(/maven\s*\{[^}]*Android_Maven[^}]*content\s*\{\s*includeGroup\s+["']io\.github\.go-acoustic["']\s*\}/);
    });

    it('does not declare the beta tree when useRelease is true: Maven Central only, betas rejected', () => {
        const idx = GRADLE.indexOf('Android_Maven');
        expect(idx).toBeGreaterThan(-1);
        // the one place the tree is declared sits under the !useRelease branch
        expect(GRADLE.slice(0, idx)).toMatch(/if\s*\(\s*!useRelease\s*\)\s*\{[^}]*$/);
        expect(GRADLE).toMatch(/if\s*\(useRelease\)\s*\{[\s\S]*?selection\.reject\(/);
    });

    it('keeps google() and mavenCentral() first, so the default build resolves as before', () => {
        const repos = GRADLE.slice(GRADLE.indexOf('repositories {'), GRADLE.indexOf('}', GRADLE.indexOf('repositories {')));
        expect(repos.indexOf('google()')).toBeLessThan(repos.indexOf('mavenCentral()'));
        expect(GRADLE.indexOf('Android_Maven')).toBeGreaterThan(GRADLE.indexOf('mavenCentral()'));
    });

    it('is not configurable: there is no repository url key in ConnectConfig.json', () => {
        expect(GRADLE).not.toContain('AndroidMavenUrl');
        expect(GRADLE).not.toContain('androidMavenUrl');
    });

    it('reads useRelease before it is used to pick the repositories', () => {
        expect(GRADLE.indexOf('useRelease    = cfg?.Connect?.useRelease')).toBeGreaterThan(-1);
        expect(GRADLE.indexOf('useRelease    = cfg?.Connect?.useRelease')).toBeLessThan(GRADLE.indexOf('Android_Maven'));
    });

    it('pins Connect Android 11.1.17 by default, a release build, so useRelease works without a pin', () => {
        expect(GRADLE).toMatch(/def defaultSdkVersion = [^\n]*"11\.1\.17"/);
        expect(GRADLE).not.toContain('11.0.21-beta');
    });
});

describe('build-extras.gradle: PushEnabled decides the artifact and Firebase', () => {
    it('reads PushEnabled from ConnectConfig.json and keeps push on unless it is false', () => {
        expect(GRADLE).toContain('def pushEnabled = true');
        expect(GRADLE).toContain('pushEnabled   = cfg?.Connect?.PushEnabled != false');
        expect(GRADLE.indexOf('cfg?.Connect?.PushEnabled')).toBeGreaterThan(-1);
    });

    it('takes connect-push-fcm with push on and the analytics-only connect with push off', () => {
        expect(GRADLE).toContain(
            'def connectSdkArtifact = pushEnabled ? "io.github.go-acoustic:connect-push-fcm" : "io.github.go-acoustic:connect"',
        );
    });

    it('adds Firebase Messaging only with push on', () => {
        const dependencies = GRADLE.slice(GRADLE.indexOf('dependencies {'));
        const block = /if \(pushEnabled\) \{([\s\S]*?)\n  \}/.exec(dependencies)?.[1] ?? '';
        expect(block).toContain("implementation platform('com.google.firebase:firebase-bom:33.7.0')");
        expect(block).toContain("implementation 'com.google.firebase:firebase-messaging'");
        // and nowhere else
        expect(dependencies.replace(block, '').match(/firebase/g)?.length ?? 0).toBeLessThanOrEqual(1);
    });

    it('reads PushEnabled before it picks the artifact', () => {
        expect(GRADLE.indexOf('cfg?.Connect?.PushEnabled')).toBeLessThan(GRADLE.indexOf('def connectSdkArtifact'));
    });
});
