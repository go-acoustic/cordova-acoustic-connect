#!/usr/bin/env node
'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Prints the udid of the iOS simulator the e2e run should use, for the CI stage:
 *
 *   UDID=$(node e2e/pick-simulator.js)
 *
 * Only the udid goes to stdout; a problem goes to stderr with exit code 2.
 */

const { execFile } = require('child_process');
const commands = require('./commands.js');

function run(file, args) {
    return new Promise(function (resolve, reject) {
        execFile(file, args, { maxBuffer: 16 * 1024 * 1024 }, function (error, stdout) {
            if (error) reject(error); else resolve({ stdout: stdout });
        });
    });
}

async function main(deps) {
    try {
        const out = await deps.exec('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
        deps.write(commands.pickIosSimulator(out.stdout) + '\n');
        return 0;
    } catch (e) {
        deps.writeError(e.message + '\n');
        return 2;
    }
}

if (require.main === module) {
    main({
        exec: run,
        write: function (s) { process.stdout.write(s); },
        writeError: function (s) { process.stderr.write(s); }
    }).then(function (code) { process.exitCode = code; });
}

module.exports = { main };
