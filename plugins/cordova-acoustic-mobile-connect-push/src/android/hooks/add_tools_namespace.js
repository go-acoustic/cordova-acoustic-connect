#!/usr/bin/env node

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Ensures the merged AndroidManifest.xml carries the `tools` namespace so
 * downstream `tools:replace` / `tools:remove` attributes resolve.
 */

const fs = require('fs');
const path = require('path');

module.exports = function (context) {
    const toolsAttribute = 'xmlns:tools="http://schemas.android.com/tools"';
    const manifestOpen = '<manifest';

    const manifestPath = path.join(
        context.opts.projectRoot,
        'platforms/android/app/src/main/AndroidManifest.xml'
    );

    if (!fs.existsSync(manifestPath)) {
        return;
    }

    let manifest = fs.readFileSync(manifestPath).toString();

    if (manifest.indexOf(toolsAttribute) === -1) {
        manifest = manifest.replace(manifestOpen, manifestOpen + ' ' + toolsAttribute + ' ');
        fs.writeFileSync(manifestPath, manifest, 'utf8');
    }
};
