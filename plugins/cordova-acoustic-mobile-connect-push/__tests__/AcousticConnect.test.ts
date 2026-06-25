/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for the AcousticConnect Promise façade.
 * Covers the Technical ACs for the AcousticConnect Promise façade.
 */

export {}; // ensure this file is a module so the UMD global from
           // `export as namespace AcousticConnect` doesn't shadow our
           // local `const AcousticConnect`.

const mockExec: jest.Mock = jest.fn();
jest.mock('cordova/exec', () => mockExec, { virtual: true });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AcousticConnect = require('../www/AcousticConnect.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json');

type ExecCall = [
    success: (value: unknown) => void,
    error: (err: unknown) => void,
    service: string,
    action: string,
    args: unknown[]
];

function resolveOnExec(value: unknown = undefined): void {
    mockExec.mockImplementation(
        (resolve: (v: unknown) => void): void => resolve(value)
    );
}

beforeEach(() => {
    mockExec.mockReset();
    resolveOnExec(undefined);
});

const ALL_METHODS: Array<[string, () => Promise<unknown>]> = [
    ['enable',
        () => AcousticConnect.enable('appKey', 'https://example.com', 'automatic')],
    ['disable',
        () => AcousticConnect.disable()],
    ['setLogLevel',
        () => AcousticConnect.setLogLevel('error')],
    ['logIdentity',
        () => AcousticConnect.logIdentity('email', 'user@example.com')],
    ['push.requestPermission',
        () => AcousticConnect.push.requestPermission()],
    ['push.getPermissionState',
        () => AcousticConnect.push.getPermissionState()],
    ['push.didReceiveAuthorization',
        () => AcousticConnect.push.didReceiveAuthorization(true)],
    ['push.didReceiveNotification',
        () => AcousticConnect.push.didReceiveNotification({ k: 'v' })],
    ['push.didReceiveResponse',
        () => AcousticConnect.push.didReceiveResponse('id', { k: 'v' })],
];

describe('public surface shape', () => {
    test('AcousticConnect is an object', () => {
        expect(typeof AcousticConnect).toBe('object');
        expect(AcousticConnect).not.toBeNull();
    });

    test('exposes push as a sub-namespace', () => {
        expect(typeof AcousticConnect.push).toBe('object');
    });

    test.each(ALL_METHODS)(
        'method %s exists and returns a Promise',
        async (_name, invoke) => {
            const result = invoke();
            expect(result).toBeInstanceOf(Promise);
            await result;
        }
    );
});

describe('enable — JS-edge validation', () => {
    test.each([
        ['empty appKey', '', 'https://example.com'],
        ['whitespace appKey', '   ', 'https://example.com'],
        ['undefined appKey', undefined as unknown as string, 'https://example.com'],
        ['null appKey', null as unknown as string, 'https://example.com'],
        ['empty postURL', 'key', ''],
        ['whitespace postURL', 'key', '   '],
        ['undefined postURL', 'key', undefined as unknown as string],
        ['null postURL', 'key', null as unknown as string],
    ])('rejects ACOUSTIC_INVALID_ARGS — %s',
        async (_label, appKey, postURL) => {
            await expect(
                AcousticConnect.enable(appKey, postURL, 'automatic')
            ).rejects.toMatchObject({
                code: 'ACOUSTIC_INVALID_ARGS',
                message: expect.any(String),
            });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test.each([
        ['off',              'off'],
        ['AUTOMATIC upper',  'AUTOMATIC'],
        ['bogus string',     'bogus'],
    ])('rejects ACOUSTIC_INVALID_ARGS for invalid pushMode: %s',
        async (_label, mode) => {
            await expect(
                AcousticConnect.enable('key', 'https://example.com', mode as never)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test.each(['automatic', 'manual'] as const)(
        'accepts valid pushMode "%s" and forwards to exec',
        async (mode) => {
            await AcousticConnect.enable('key', 'https://example.com', mode);
            expect(mockExec).toHaveBeenCalledTimes(1);
            const call = mockExec.mock.calls[0] as ExecCall;
            expect(call[4][2]).toBe(mode);
        }
    );

    test('forwards valid args to cordova.exec', async () => {
        await AcousticConnect.enable(
            'key',
            'https://example.com',
            'automatic',
            { iosAppGroupIdentifier: 'group.x' }
        );
        expect(mockExec).toHaveBeenCalledTimes(1);
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[2]).toBe('ConnectPlugin');
        expect(call[3]).toBe('enable');
        expect(call[4]).toEqual([
            'key',
            'https://example.com',
            'automatic',
            { iosAppGroupIdentifier: 'group.x' },
        ]);
    });

    test('defaults pushMode to "automatic" when omitted', async () => {
        await AcousticConnect.enable('key', 'https://example.com');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][2]).toBe('automatic');
        expect(call[4][3]).toBeNull();
    });
});

describe('setLogLevel — JS-edge validation', () => {
    test.each(['silent', 'error', 'warn', 'info', 'verbose'] as const)(
        'accepts valid level %s and forwards to cordova.exec',
        async (level) => {
            await AcousticConnect.setLogLevel(level);
            expect(mockExec).toHaveBeenCalledTimes(1);
            const call = mockExec.mock.calls[0] as ExecCall;
            expect(call[3]).toBe('setLogLevel');
            expect(call[4]).toEqual([level]);
        }
    );

    test.each([
        ['empty string', ''],
        ['bogus', 'bogus'],
        ['ERROR uppercase', 'ERROR'],
        ['null', null],
        ['undefined', undefined],
        ['number', 1],
        ['object', {}],
    ])('rejects ACOUSTIC_INVALID_ARGS for %s',
        async (_label, bad) => {
            await expect(
                AcousticConnect.setLogLevel(bad)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );
});

describe('push.didReceiveAuthorization — null short-circuit', () => {
    test('resolves false without invoking cordova.exec when granted=null',
        async () => {
            await expect(
                AcousticConnect.push.didReceiveAuthorization(null)
            ).resolves.toBe(false);
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test('resolves false without invoking cordova.exec when granted=undefined',
        async () => {
            await expect(
                AcousticConnect.push.didReceiveAuthorization(undefined)
            ).resolves.toBe(false);
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test('forwards [true, null] when granted=true and error omitted',
        async () => {
            resolveOnExec(true);
            await AcousticConnect.push.didReceiveAuthorization(true);
            const call = mockExec.mock.calls[0] as ExecCall;
            expect(call[3]).toBe('pushDidReceiveAuthorization');
            expect(call[4]).toEqual([true, null]);
        }
    );

    test('forwards [false, "denied"] when granted=false and error provided',
        async () => {
            resolveOnExec(true);
            await AcousticConnect.push.didReceiveAuthorization(false, 'denied');
            const call = mockExec.mock.calls[0] as ExecCall;
            expect(call[4]).toEqual([false, 'denied']);
        }
    );

    test('forwards [true, null] when granted=true and error=undefined',
        async () => {
            resolveOnExec(true);
            await AcousticConnect.push.didReceiveAuthorization(true, undefined);
            const call = mockExec.mock.calls[0] as ExecCall;
            expect(call[4]).toEqual([true, null]);
        }
    );
});

describe('exec call shape — single-call, no keepCallback', () => {
    const TABLE: Array<[
        string,
        () => Promise<unknown>,
        string,
        unknown[]
    ]> = [
        ['disable',
            () => AcousticConnect.disable(),
            'disable',
            []],
        ['push.requestPermission',
            () => AcousticConnect.push.requestPermission(),
            'pushRequestPermission',
            []],
        ['push.getPermissionState',
            () => AcousticConnect.push.getPermissionState(),
            'pushGetPermissionState',
            []],
        ['push.didReceiveNotification',
            () => AcousticConnect.push.didReceiveNotification({ foo: 'bar' }),
            'pushDidReceiveNotification',
            [{ foo: 'bar' }]],
        ['push.didReceiveResponse',
            () => AcousticConnect.push.didReceiveResponse('id', { foo: 'bar' }),
            'pushDidReceiveResponse',
            ['id', { foo: 'bar' }]],
        ['logIdentity',
            () => AcousticConnect.logIdentity(
                'email', 'user@example.com', 'loggedIn', { loginMethod: 'email' }
            ),
            'logIdentificationEvent',
            ['email', 'user@example.com', 'loggedIn', { loginMethod: 'email' }]],
    ];

    test.each(TABLE)(
        '%s invokes cordova.exec once with action=%s and expected args',
        async (_name, invoke, expectedAction, expectedArgs) => {
            await invoke();
            expect(mockExec).toHaveBeenCalledTimes(1);
            const call = mockExec.mock.calls[0] as ExecCall;
            expect(call[2]).toBe('ConnectPlugin');
            expect(call[3]).toBe(expectedAction);
            expect(call[4]).toEqual(expectedArgs);
        }
    );

    test('cordova.exec receives exactly 5 positional args (no keepCallback)',
        async () => {
            await AcousticConnect.disable();
            expect(mockExec.mock.calls[0].length).toBe(5);
        }
    );

    test('exec is invoked exactly once per public-method call', async () => {
        for (const [, invoke] of ALL_METHODS) {
            mockExec.mockReset();
            resolveOnExec(undefined);
            await invoke();
            expect(mockExec).toHaveBeenCalledTimes(1);
        }
    });
});

describe('logIdentity — JS-edge validation', () => {
    test.each([
        ['empty identifierName',     '',    'user@example.com'],
        ['whitespace identifierName','   ', 'user@example.com'],
        ['null identifierName',      null,  'user@example.com'],
        ['undefined identifierName', undefined, 'user@example.com'],
        ['empty identifierValue',    'email', ''],
        ['whitespace identifierValue','email', '   '],
        ['null identifierValue',     'email', null],
        ['undefined identifierValue','email', undefined],
    ])('rejects ACOUSTIC_INVALID_ARGS — %s',
        async (_label, name, value) => {
            await expect(
                AcousticConnect.logIdentity(name, value)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test('forwards action logIdentificationEvent with all 4 args', async () => {
        await AcousticConnect.logIdentity(
            'email', 'user@example.com', 'loggedIn', { loginMethod: 'email' }
        );
        expect(mockExec).toHaveBeenCalledTimes(1);
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[2]).toBe('ConnectPlugin');
        expect(call[3]).toBe('logIdentificationEvent');
        expect(call[4]).toEqual([
            'email',
            'user@example.com',
            'loggedIn',
            { loginMethod: 'email' },
        ]);
    });

    test('defaults signalType to "loggedIn" when omitted', async () => {
        await AcousticConnect.logIdentity('email', 'user@example.com');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][2]).toBe('loggedIn');
    });

    test('defaults signalType to "loggedIn" when blank string passed', async () => {
        await AcousticConnect.logIdentity('email', 'user@example.com', '   ');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][2]).toBe('loggedIn');
    });

    test('defaults additionalParameters to {} when omitted', async () => {
        await AcousticConnect.logIdentity('email', 'user@example.com', 'loggedIn');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][3]).toEqual({});
    });

    test('passes accountRegistered signal with registrationMethod param', async () => {
        await AcousticConnect.logIdentity(
            'email', 'user@example.com', 'accountRegistered',
            { registrationMethod: 'email' }
        );
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4]).toEqual([
            'email',
            'user@example.com',
            'accountRegistered',
            { registrationMethod: 'email' },
        ]);
    });
});

describe('package layout', () => {
    test('package.json declares types entry pointing to types/index.d.ts',
        () => {
            expect(pkg.types).toBe('types/index.d.ts');
        }
    );

    test('package.json files list includes www/ and types/', () => {
        expect(pkg.files).toEqual(
            expect.arrayContaining(['www/', 'types/'])
        );
    });
});
