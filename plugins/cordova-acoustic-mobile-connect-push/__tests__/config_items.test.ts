/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Tests for the runtime configuration API: AcousticConnect.setConfigItem / getConfigItem.
 *
 * The native side only moves strings and booleans between the SDK's config store and the
 * bridge; the typing (boolean / string / number, taken from the default value) and the
 * fallback to the default for a missing item live in the JS facade, which is what is tested
 * here. The native handlers are covered by the static source tests.
 */

export {};

const mockExec: jest.Mock = jest.fn();
jest.mock('cordova/exec', () => mockExec, { virtual: true });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AcousticConnect = require('../www/AcousticConnect.js');

type ExecCall = [(v: unknown) => void, (e: unknown) => void, string, string, unknown[]];

function resolveWith(value: unknown): void {
    mockExec.mockImplementation((resolve: (v: unknown) => void) => resolve(value));
}

beforeEach(() => {
    mockExec.mockReset();
    resolveWith(undefined);
});

describe('setConfigItem', () => {
    test.each([
        ['boolean', true],
        ['false', false],
        ['string', 'https://example.test'],
        ['empty string', ''],
        ['integer', 5],
        ['zero', 0],
        ['fraction', 0.5],
        ['negative', -3],
    ])('passes a %s value to the native side unchanged', async (_label, value) => {
        await AcousticConnect.setConfigItem('SomeKey', value, 'EOCore');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[2]).toBe('ConnectPlugin');
        expect(call[3]).toBe('setConfigItem');
        expect(call[4]).toEqual(['SomeKey', value, 'EOCore']);
    });

    test('resolves with undefined', async () => {
        await expect(AcousticConnect.setConfigItem('K', true, 'EOCore')).resolves.toBeUndefined();
    });

    test.each([
        ['empty key', '', true, 'EOCore'],
        ['blank key', '   ', true, 'EOCore'],
        ['numeric key', 5, true, 'EOCore'],
        ['null key', null, true, 'EOCore'],
        ['object value', 'K', { a: 1 }, 'EOCore'],
        ['array value', 'K', [1], 'EOCore'],
        ['null value', 'K', null, 'EOCore'],
        ['undefined value', 'K', undefined, 'EOCore'],
        ['NaN value', 'K', NaN, 'EOCore'],
        ['Infinity value', 'K', Infinity, 'EOCore'],
        ['function value', 'K', () => 1, 'EOCore'],
        ['missing module', 'K', true, undefined],
        ['empty module', 'K', true, ''],
        ['numeric module', 'K', true, 1],
    ])('rejects ACOUSTIC_INVALID_ARGS for %s without calling native', async (_label, key, value, mod) => {
        await expect(AcousticConnect.setConfigItem(key, value, mod)).rejects.toMatchObject({
            code: 'ACOUSTIC_INVALID_ARGS',
            message: expect.stringContaining('setConfigItem'),
        });
        expect(mockExec).not.toHaveBeenCalled();
    });

    test('rejects with the native error when the SDK refuses the item', async () => {
        const nativeError = { code: 'ACOUSTIC_INTERNAL_ERROR', message: 'setConfigItem returned false' };
        mockExec.mockImplementation((_ok: unknown, fail: (e: unknown) => void) => fail(nativeError));
        await expect(AcousticConnect.setConfigItem('K', true, 'EOCore')).rejects.toMatchObject(nativeError);
    });
});

describe('getConfigItem', () => {
    test('asks the native side for the raw item by key and module', async () => {
        resolveWith('true');
        await AcousticConnect.getConfigItem('SomeKey', false, 'EOCore');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[3]).toBe('getConfigItem');
        expect(call[4]).toEqual(['SomeKey', 'EOCore']);
    });

    test.each([
        ['true', true], ['false', false], ['TRUE', true], ['False', false],
    ])('reads boolean "%s" as %s when the default is a boolean', async (raw, expected) => {
        resolveWith(raw);
        await expect(AcousticConnect.getConfigItem('K', !expected, 'M')).resolves.toBe(expected);
    });

    test('keeps a stored false even when the default is true', async () => {
        // the bridge must tell "missing" from "false"
        resolveWith('false');
        await expect(AcousticConnect.getConfigItem('K', true, 'M')).resolves.toBe(false);
    });

    test.each([
        ['5', 5], ['0', 0], ['-2', -2], ['0.25', 0.25], [' 7 ', 7],
    ])('reads number "%s" as %s when the default is a number', async (raw, expected) => {
        resolveWith(raw);
        await expect(AcousticConnect.getConfigItem('K', 99, 'M')).resolves.toBe(expected);
    });

    test('returns a string as stored when the default is a string', async () => {
        resolveWith('https://x.test/a b');
        await expect(AcousticConnect.getConfigItem('K', 'd', 'M')).resolves.toBe('https://x.test/a b');
    });

    test.each([
        ['undefined', undefined], ['null', null], ['empty string', ''],
    ])('returns the default when the item is missing (%s)', async (_label, raw) => {
        resolveWith(raw);
        await expect(AcousticConnect.getConfigItem('K', true, 'M')).resolves.toBe(true);
        await expect(AcousticConnect.getConfigItem('K', 12, 'M')).resolves.toBe(12);
        await expect(AcousticConnect.getConfigItem('K', 'fallback', 'M')).resolves.toBe('fallback');
    });

    test.each([
        ['boolean from text', 'maybe', true, true],
        ['number from text', 'abc', 8, 8],
        ['number from Infinity', 'Infinity', 8, 8],
    ])('returns the default when the stored value does not fit the type — %s', async (_label, raw, def, expected) => {
        resolveWith(raw);
        await expect(AcousticConnect.getConfigItem('K', def, 'M')).resolves.toBe(expected);
    });

    test('accepts a boolean or number the native side returned untyped', async () => {
        resolveWith(true);
        await expect(AcousticConnect.getConfigItem('K', false, 'M')).resolves.toBe(true);
        resolveWith(3);
        await expect(AcousticConnect.getConfigItem('K', 0, 'M')).resolves.toBe(3);
    });

    test.each([
        ['empty key', '', true, 'M'],
        ['null key', null, true, 'M'],
        ['null default', 'K', null, 'M'],
        ['undefined default', 'K', undefined, 'M'],
        ['object default', 'K', {}, 'M'],
        ['NaN default', 'K', NaN, 'M'],
        ['missing module', 'K', true, undefined],
        ['empty module', 'K', true, ''],
    ])('rejects ACOUSTIC_INVALID_ARGS for %s without calling native', async (_label, key, def, mod) => {
        await expect(AcousticConnect.getConfigItem(key, def, mod)).rejects.toMatchObject({
            code: 'ACOUSTIC_INVALID_ARGS',
            message: expect.stringContaining('getConfigItem'),
        });
        expect(mockExec).not.toHaveBeenCalled();
    });

    test('rejects with the native error', async () => {
        const nativeError = { code: 'ACOUSTIC_INTERNAL_ERROR', message: 'boom' };
        mockExec.mockImplementation((_ok: unknown, fail: (e: unknown) => void) => fail(nativeError));
        await expect(AcousticConnect.getConfigItem('K', true, 'M')).rejects.toMatchObject(nativeError);
    });
});

describe('typings', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path');
    const dts: string = readFileSync(join(__dirname, '..', 'types', 'index.d.ts'), 'utf8');

    it('declares both methods with a value type taken from the default', () => {
        expect(dts).toMatch(/function setConfigItem\(key: string, value: boolean \| string \| number, moduleName: string\): Promise<void>/);
        // overloads, so a literal default (true, 5) does not narrow the result type
        expect(dts).toMatch(/function getConfigItem\(key: string, defaultValue: boolean, moduleName: string\): Promise<boolean>/);
        expect(dts).toMatch(/function getConfigItem\(key: string, defaultValue: string, moduleName: string\): Promise<string>/);
        expect(dts).toMatch(/function getConfigItem\(key: string, defaultValue: number, moduleName: string\): Promise<number>/);
    });
});
