#!/usr/bin/env node
'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Puts the shared e2e scenario (e2e/core/scenario.js) into the app's web assets, where
 * index.html loads it (js/e2e/scenario.js). The scenario lives outside this app because the
 * Capacitor example apps run the same one, and a Cordova app can only load files from its
 * own www. Runs before every `cordova prepare`, which copies www into the platforms. The copy
 * is generated and git-ignored; a normal build only loads it and does nothing with it
 * (js/e2e-config.js keeps the scenario off).
 *
 * Runs on every prepare, so a checkout without the rest of the repository (the app copied on its own) must still
 * prepare: a missing scenario is a warning there. During an e2e run (`node e2e/prepare.js prepare` has been run, its
 * state file exists) the scenario is the whole point, so a missing one fails.
 */

const fs = require('fs');
const path = require('path');
const prepare = require('../e2e/prepare.js');

module.exports = function (context) {
    const projectRoot = context.opts.projectRoot;
    const source = path.join(projectRoot, '..', '..', 'e2e', 'core', 'scenario.js');
    const target = path.join(projectRoot, 'www', 'js', 'e2e', 'scenario.js');
    if (!fs.existsSync(source)) {
        const message = 'the shared e2e scenario was not found at ' + source;
        if (prepare.readState(projectRoot)) throw new Error(message);
        console.warn('[e2e] ' + message + '; the app is prepared without it (an e2e run would fail)');
        return;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
};
