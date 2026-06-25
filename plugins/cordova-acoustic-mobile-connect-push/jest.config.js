/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Jest configuration for the Acoustic Connect Cordova plugin.
 * The __tests__/ source-set is populated by the push plugin tests.
 */

/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    // 'node' instead of 'jsdom': the test suite has no DOM dependencies (no
    // document/window access). jsdom spins up a fake browser environment with
    // pending timers and fetch internals that keep the process alive after all
    // tests finish, requiring --forceExit to terminate and printing the
    // "Force exiting Jest" open-handles warning on every CI run.
    testEnvironment: 'node',
    testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    passWithNoTests: true,
    clearMocks: true,
    // Belt-and-suspenders: exit cleanly even if a future test accidentally
    // leaves an async handle open (e.g. a timer or network connection).
    forceExit: true,
    collectCoverageFrom: [
        'www/**/*.js'
    ],
    coverageDirectory: '<rootDir>/coverage'
};
