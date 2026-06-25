/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * ESLint flat config for the Acoustic Connect Cordova plugin.
 * Scopes lint to www/ (plugin JS surface).
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        files: ['www/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.commonjs,
                cordova: 'readonly'
            }
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['warn', { args: 'none' }],
            'no-console': 'off'
        }
    }
];
