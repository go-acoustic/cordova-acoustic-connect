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
    ['getSdkVersion',
        () => AcousticConnect.getSdkVersion()],
    ['logCustomEvent',
        () => AcousticConnect.logCustomEvent('purchase')],
    ['setCurrentScreenName',
        () => AcousticConnect.setCurrentScreenName('home')],
    ['flushQueues',
        () => AcousticConnect.flushQueues()],
    ['isSdkEnabled',
        () => AcousticConnect.isSdkEnabled()],
    ['logClickEvent',
        () => AcousticConnect.logClickEvent('btnSignup')],
    ['logTextChangeEvent',
        () => AcousticConnect.logTextChangeEvent('txtEmail')],
    ['logSignal',
        () => AcousticConnect.logSignal({ signalContent: { signalType: 'pageview' } })],
    ['logExceptionEvent',
        () => AcousticConnect.logExceptionEvent('boom')],
    ['logScreenViewContextLoad',
        () => AcousticConnect.logScreenViewContextLoad('home')],
    ['logScreenViewContextUnload',
        () => AcousticConnect.logScreenViewContextUnload('home')],
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
        ['getSdkVersion',
            () => AcousticConnect.getSdkVersion(),
            'getSdkVersion',
            []],
        ['flushQueues',
            () => AcousticConnect.flushQueues(),
            'flushQueues',
            []],
        ['isSdkEnabled',
            () => AcousticConnect.isSdkEnabled(),
            'isSdkEnabled',
            []],
        ['setCurrentScreenName',
            () => AcousticConnect.setCurrentScreenName('home'),
            'setCurrentScreenName',
            ['home']],
        ['logCustomEvent',
            () => AcousticConnect.logCustomEvent(
                'purchase', { sku: 'A1', qty: 2, gift: true }, 2
            ),
            'logCustomEvent',
            ['purchase', { sku: 'A1', qty: 2, gift: true }, 2]],
        ['logClickEvent',
            () => AcousticConnect.logClickEvent('btnSignup', { plan: 'pro' }),
            'logCustomEvent',
            ['click', { controlId: 'btnSignup', plan: 'pro' }, 3]],
        ['logTextChangeEvent',
            () => AcousticConnect.logTextChangeEvent('txtEmail', { text: 'abc' }),
            'logCustomEvent',
            ['textChange', { controlId: 'txtEmail', text: 'XXX', masked: true }, 3]],
        ['logSignal',
            () => AcousticConnect.logSignal({ a: { b: [1, 'x', null] }, c: true }, 1),
            'logSignal',
            [{ a: { b: [1, 'x', null] }, c: true }, 1]],
        ['logExceptionEvent',
            () => AcousticConnect.logExceptionEvent('boom', 'at foo:1', true),
            'logExceptionEvent',
            ['boom', 'at foo:1', true]],
        ['logScreenViewContextLoad',
            () => AcousticConnect.logScreenViewContextLoad('detail', 'home'),
            'logScreenViewContextLoad',
            ['detail', 'home']],
        ['logScreenViewContextUnload',
            () => AcousticConnect.logScreenViewContextUnload('detail', 'home'),
            'logScreenViewContextUnload',
            ['detail', 'home']],
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

describe('logCustomEvent — JS-edge validation', () => {
    test.each([
        ['empty eventName', ''],
        ['whitespace eventName', '   '],
        ['null eventName', null],
        ['undefined eventName', undefined],
        ['number eventName', 1],
        ['object eventName', {}],
    ])('rejects ACOUSTIC_INVALID_ARGS — %s', async (_label, name) => {
        await expect(
            AcousticConnect.logCustomEvent(name)
        ).rejects.toMatchObject({
            code: 'ACOUSTIC_INVALID_ARGS',
            message: expect.stringContaining('logCustomEvent'),
        });
        expect(mockExec).not.toHaveBeenCalled();
    });

    test.each([
        ['nested object value', { a: { b: 1 } }],
        ['array value', { a: [1, 2] }],
        ['null value', { a: null }],
        ['undefined value', { a: undefined }],
        ['function value', { a: () => 1 }],
        ['array as values', [1, 2]],
        ['string as values', 'x'],
        ['number as values', 5],
    ])('rejects ACOUSTIC_INVALID_ARGS for non-flat values — %s',
        async (_label, values) => {
            await expect(
                AcousticConnect.logCustomEvent('evt', values)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test.each([
        ['negative', -1],
        ['fractional', 1.5],
        ['NaN', NaN],
        ['string', '3'],
        ['null', null],
    ])('rejects ACOUSTIC_INVALID_ARGS for invalid level — %s',
        async (_label, level) => {
            await expect(
                AcousticConnect.logCustomEvent('evt', {}, level)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test('defaults values to {} and level to 3 when omitted', async () => {
        await AcousticConnect.logCustomEvent('evt');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[3]).toBe('logCustomEvent');
        expect(call[4]).toEqual(['evt', {}, 3]);
    });

    test('defaults values to {} when undefined is passed explicitly',
        async () => {
            await AcousticConnect.logCustomEvent('evt', undefined, 1);
            const call = mockExec.mock.calls[0] as ExecCall;
            expect(call[4]).toEqual(['evt', {}, 1]);
        }
    );

    test('accepts level 0 (not treated as "omitted")', async () => {
        await AcousticConnect.logCustomEvent('evt', {}, 0);
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][2]).toBe(0);
    });

    test('forwards the original eventName without trimming', async () => {
        await AcousticConnect.logCustomEvent(' evt ');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][0]).toBe(' evt ');
    });

    test('rejects with the native error when exec fails', async () => {
        const nativeError = { code: 'ACOUSTIC_INTERNAL_ERROR', message: 'x' };
        mockExec.mockImplementation(
            (_resolve: unknown, reject: (e: unknown) => void): void =>
                reject(nativeError)
        );
        await expect(AcousticConnect.logCustomEvent('evt'))
            .rejects.toBe(nativeError);
    });
});

describe('setCurrentScreenName — JS-edge validation', () => {
    test.each([
        ['empty', ''],
        ['whitespace', '   '],
        ['null', null],
        ['undefined', undefined],
        ['number', 1],
        ['object', {}],
    ])('rejects ACOUSTIC_INVALID_ARGS — %s', async (_label, name) => {
        await expect(
            AcousticConnect.setCurrentScreenName(name)
        ).rejects.toMatchObject({
            code: 'ACOUSTIC_INVALID_ARGS',
            message: expect.stringContaining('setCurrentScreenName'),
        });
        expect(mockExec).not.toHaveBeenCalled();
    });
});

describe.each([
    ['logScreenViewContextLoad', 'logScreenViewContextLoad'],
    ['logScreenViewContextUnload', 'logScreenViewContextUnload'],
] as const)('%s — JS-edge validation', (method, action) => {
    test.each([
        ['empty', ''],
        ['whitespace', '   '],
        ['null', null],
        ['undefined', undefined],
        ['number', 1],
        ['object', {}],
    ])('rejects ACOUSTIC_INVALID_ARGS for logicalPageName — %s',
        async (_label, name) => {
            await expect(
                AcousticConnect[method](name)
            ).rejects.toMatchObject({
                code: 'ACOUSTIC_INVALID_ARGS',
                message: expect.stringContaining(method),
            });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test.each([
        ['number', 1],
        ['object', {}],
        ['boolean', true],
        ['array', ['a']],
    ])('rejects ACOUSTIC_INVALID_ARGS for non-string referrer — %s',
        async (_label, referrer) => {
            await expect(
                AcousticConnect[method]('detail', referrer)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test.each([
        ['omitted', undefined],
        ['null', null],
        ['empty string', ''],
        ['whitespace', '   '],
    ])('sends referrer as null when %s', async (_label, referrer) => {
        await AcousticConnect[method]('detail', referrer);
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[3]).toBe(action);
        expect(call[4]).toEqual(['detail', null]);
    });

    test('forwards name and referrer unchanged', async () => {
        await AcousticConnect[method]('detail', 'home');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4]).toEqual(['detail', 'home']);
    });

    test('rejects with the native error when exec fails', async () => {
        const nativeError = { code: 'ACOUSTIC_INTERNAL_ERROR', message: 'x' };
        mockExec.mockImplementation(
            (_resolve: unknown, reject: (e: unknown) => void): void =>
                reject(nativeError)
        );
        await expect(AcousticConnect[method]('detail'))
            .rejects.toBe(nativeError);
    });
});

describe('logClickEvent — JS-edge validation and payload', () => {
    test.each([
        ['empty', ''],
        ['whitespace', '   '],
        ['null', null],
        ['undefined', undefined],
        ['number', 1],
        ['object', {}],
    ])('rejects ACOUSTIC_INVALID_ARGS for controlId — %s', async (_label, id) => {
        await expect(
            AcousticConnect.logClickEvent(id)
        ).rejects.toMatchObject({
            code: 'ACOUSTIC_INVALID_ARGS',
            message: expect.stringContaining('logClickEvent'),
        });
        expect(mockExec).not.toHaveBeenCalled();
    });

    test.each([
        ['nested object', { a: { b: 1 } }],
        ['array value', { a: [1] }],
        ['null value', { a: null }],
        ['array as data', [1]],
        ['string as data', 'x'],
        ['null as data', null],
    ])('rejects ACOUSTIC_INVALID_ARGS for non-flat data — %s',
        async (_label, data) => {
            await expect(
                AcousticConnect.logClickEvent('btn', data)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test('logs a "click" custom event carrying the controlId, at the default level', async () => {
        await AcousticConnect.logClickEvent('btnSignup');
        expect(mockExec).toHaveBeenCalledTimes(1);
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[2]).toBe('ConnectPlugin');
        expect(call[3]).toBe('logCustomEvent');
        expect(call[4]).toEqual(['click', { controlId: 'btnSignup' }, 3]);
    });

    test('merges extra data into the event values', async () => {
        await AcousticConnect.logClickEvent('btn', { plan: 'pro', seats: 3, trial: true });
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][1]).toEqual({
            controlId: 'btn', plan: 'pro', seats: 3, trial: true,
        });
    });

    test('data cannot override the controlId', async () => {
        await AcousticConnect.logClickEvent('real', { controlId: 'spoofed' });
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][1]).toEqual({ controlId: 'real' });
    });

    test('does not mutate the caller\'s data object', async () => {
        const data = { plan: 'pro' };
        await AcousticConnect.logClickEvent('btn', data);
        expect(data).toEqual({ plan: 'pro' });
    });

    test('rejects with the native error when exec fails', async () => {
        const nativeError = { code: 'ACOUSTIC_INTERNAL_ERROR', message: 'x' };
        mockExec.mockImplementation(
            (_resolve: unknown, reject: (e: unknown) => void): void =>
                reject(nativeError)
        );
        await expect(AcousticConnect.logClickEvent('btn'))
            .rejects.toBe(nativeError);
    });
});

describe('logTextChangeEvent — JS-edge validation and masking', () => {
    test.each([
        ['empty', ''],
        ['whitespace', '   '],
        ['null', null],
        ['undefined', undefined],
        ['number', 1],
        ['object', {}],
    ])('rejects ACOUSTIC_INVALID_ARGS for controlId — %s', async (_label, id) => {
        await expect(
            AcousticConnect.logTextChangeEvent(id)
        ).rejects.toMatchObject({
            code: 'ACOUSTIC_INVALID_ARGS',
            message: expect.stringContaining('logTextChangeEvent'),
        });
        expect(mockExec).not.toHaveBeenCalled();
    });

    test.each([
        ['string options', 'abc'],
        ['number options', 1],
        ['null options', null],
        ['array options', ['abc']],
        ['non-string text', { text: 5 }],
        ['null text', { text: null }],
        ['non-boolean masked', { text: 'a', masked: 'false' }],
        ['numeric masked', { text: 'a', masked: 0 }],
    ])('rejects ACOUSTIC_INVALID_ARGS for invalid options — %s',
        async (_label, options) => {
            await expect(
                AcousticConnect.logTextChangeEvent('txt', options)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test('sends only the controlId when no text is given', async () => {
        await AcousticConnect.logTextChangeEvent('txtEmail');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[3]).toBe('logCustomEvent');
        expect(call[4]).toEqual(['textChange', { controlId: 'txtEmail' }, 3]);
    });

    test('masks the text by default, keeping only its length', async () => {
        await AcousticConnect.logTextChangeEvent('txtPwd', { text: 'hunter2' });
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][1]).toEqual({
            controlId: 'txtPwd', text: 'XXXXXXX', masked: true,
        });
    });

    test('the plaintext never crosses the bridge when masked', async () => {
        await AcousticConnect.logTextChangeEvent('txtPwd', { text: 's3cr3t-value' });
        expect(JSON.stringify(mockExec.mock.calls[0][4])).not.toContain('s3cr3t');
    });

    test('masks per character, not per UTF-16 unit', async () => {
        await AcousticConnect.logTextChangeEvent('txt', { text: '😀a' });
        const call = mockExec.mock.calls[0] as ExecCall;
        expect((call[4][1] as { text: string }).text).toBe('XX');
    });

    test('masks an empty string to an empty string', async () => {
        await AcousticConnect.logTextChangeEvent('txt', { text: '' });
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][1]).toEqual({ controlId: 'txt', text: '', masked: true });
    });

    test('sends the plaintext only when masked is explicitly false', async () => {
        await AcousticConnect.logTextChangeEvent('txtName', { text: 'Ada', masked: false });
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][1]).toEqual({
            controlId: 'txtName', text: 'Ada', masked: false,
        });
    });

    test('masked: true is the same as the default', async () => {
        await AcousticConnect.logTextChangeEvent('txt', { text: 'ab', masked: true });
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4][1]).toEqual({ controlId: 'txt', text: 'XX', masked: true });
    });

    test('rejects with the native error when exec fails', async () => {
        const nativeError = { code: 'ACOUSTIC_INTERNAL_ERROR', message: 'x' };
        mockExec.mockImplementation(
            (_resolve: unknown, reject: (e: unknown) => void): void =>
                reject(nativeError)
        );
        await expect(AcousticConnect.logTextChangeEvent('txt', { text: 'a' }))
            .rejects.toBe(nativeError);
    });
});

describe('logSignal — JS-edge validation', () => {
    test.each([
        ['null', null],
        ['undefined', undefined],
        ['string', 'x'],
        ['number', 1],
        ['array', [1, 2]],
        ['Date', new Date()],
    ])('rejects ACOUSTIC_INVALID_ARGS when values is %s', async (_label, values) => {
        await expect(
            AcousticConnect.logSignal(values)
        ).rejects.toMatchObject({
            code: 'ACOUSTIC_INVALID_ARGS',
            message: expect.stringContaining('logSignal'),
        });
        expect(mockExec).not.toHaveBeenCalled();
    });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    test.each([
        ['function', { a: () => 1 }],
        ['undefined', { a: undefined }],
        ['NaN', { a: NaN }],
        ['Infinity', { a: Infinity }],
        ['nested NaN', { a: { b: [1, NaN] } }],
        ['nested function', { a: [{ b: () => 1 }] }],
        ['bigint', { a: BigInt(1) }],
        ['symbol', { a: Symbol('s') }],
        ['Date value', { a: new Date() }],
        ['circular reference', cyclic],
    ])('rejects ACOUSTIC_INVALID_ARGS for a non-JSON payload — %s',
        async (_label, values) => {
            await expect(
                AcousticConnect.logSignal(values)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test.each([
        ['negative', -1],
        ['fractional', 1.5],
        ['NaN', NaN],
        ['string', '3'],
        ['null', null],
    ])('rejects ACOUSTIC_INVALID_ARGS for invalid level — %s',
        async (_label, level) => {
            await expect(
                AcousticConnect.logSignal({ a: 1 }, level)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test('carries nested objects, arrays, null and scalars unchanged', async () => {
        const payload = {
            signalContent: { signalType: 'pageview', url: 'https://x.test' },
            audience: [{ name: 'Account ID', value: '42' }],
            count: 3,
            flag: false,
            nothing: null,
        };
        await AcousticConnect.logSignal(payload, 1);
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[3]).toBe('logSignal');
        expect(call[4]).toEqual([payload, 1]);
    });

    test('accepts an empty object', async () => {
        await AcousticConnect.logSignal({});
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4]).toEqual([{}, 3]);
    });

    test('defaults level to 3 when omitted and keeps level 0', async () => {
        await AcousticConnect.logSignal({ a: 1 });
        expect((mockExec.mock.calls[0] as ExecCall)[4][1]).toBe(3);
        mockExec.mockReset();
        resolveOnExec(undefined);
        await AcousticConnect.logSignal({ a: 1 }, 0);
        expect((mockExec.mock.calls[0] as ExecCall)[4][1]).toBe(0);
    });

    test('rejects with the native error when exec fails', async () => {
        const nativeError = { code: 'ACOUSTIC_INTERNAL_ERROR', message: 'x' };
        mockExec.mockImplementation(
            (_resolve: unknown, reject: (e: unknown) => void): void =>
                reject(nativeError)
        );
        await expect(AcousticConnect.logSignal({ a: 1 }))
            .rejects.toBe(nativeError);
    });
});

describe('logExceptionEvent — JS-edge validation', () => {
    test.each([
        ['empty', ''],
        ['whitespace', '   '],
        ['null', null],
        ['undefined', undefined],
        ['number', 1],
        ['object', {}],
    ])('rejects ACOUSTIC_INVALID_ARGS for message — %s', async (_label, message) => {
        await expect(
            AcousticConnect.logExceptionEvent(message)
        ).rejects.toMatchObject({
            code: 'ACOUSTIC_INVALID_ARGS',
            message: expect.stringContaining('logExceptionEvent'),
        });
        expect(mockExec).not.toHaveBeenCalled();
    });

    test.each([
        ['number', 1],
        ['object', {}],
        ['array', ['a']],
    ])('rejects ACOUSTIC_INVALID_ARGS for non-string stackInfo — %s',
        async (_label, stackInfo) => {
            await expect(
                AcousticConnect.logExceptionEvent('boom', stackInfo)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test.each([
        ['string', 'true'],
        ['number', 1],
        ['null', null],
    ])('rejects ACOUSTIC_INVALID_ARGS for non-boolean unhandled — %s',
        async (_label, unhandled) => {
            await expect(
                AcousticConnect.logExceptionEvent('boom', 'stack', unhandled)
            ).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
            expect(mockExec).not.toHaveBeenCalled();
        }
    );

    test('defaults stackInfo to "" and unhandled to false', async () => {
        await AcousticConnect.logExceptionEvent('boom');
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[3]).toBe('logExceptionEvent');
        expect(call[4]).toEqual(['boom', '', false]);
    });

    test('forwards message, stack and unhandled unchanged', async () => {
        await AcousticConnect.logExceptionEvent('boom', 'Error: boom\n  at a.js:1', true);
        const call = mockExec.mock.calls[0] as ExecCall;
        expect(call[4]).toEqual(['boom', 'Error: boom\n  at a.js:1', true]);
    });
});

describe('isSdkEnabled — result normalisation', () => {
    test.each([
        ['true', true, true],
        ['1 (iOS bool bridged as number)', 1, true],
        ['false', false, false],
        ['0', 0, false],
        ['null', null, false],
        ['undefined', undefined, false],
    ])('resolves a strict boolean for native value %s',
        async (_label, nativeValue, expected) => {
            resolveOnExec(nativeValue);
            await expect(AcousticConnect.isSdkEnabled())
                .resolves.toBe(expected);
        }
    );
});

describe('getSdkVersion — result passthrough', () => {
    test('resolves the native version string unchanged', async () => {
        resolveOnExec('11.0.21-beta');
        await expect(AcousticConnect.getSdkVersion())
            .resolves.toBe('11.0.21-beta');
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

describe('flat value maps accept plain objects only', () => {
    const notPlain: Array<[string, unknown]> = [
        ['Date', new Date()],
        ['Map', new Map([['a', 1]])],
        ['Set', new Set([1])],
        ['RegExp', /x/],
    ];

    test.each(notPlain)('logCustomEvent rejects a %s as values, instead of sending {}', async (_label, values) => {
        await expect(AcousticConnect.logCustomEvent('e', values)).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
        expect(mockExec).not.toHaveBeenCalled();
    });

    test.each(notPlain)('logClickEvent rejects a %s as data', async (_label, data) => {
        await expect(AcousticConnect.logClickEvent('btn', data)).rejects.toMatchObject({ code: 'ACOUSTIC_INVALID_ARGS' });
        expect(mockExec).not.toHaveBeenCalled();
    });

    test('still accepts a plain object and an object without a prototype', async () => {
        await AcousticConnect.logCustomEvent('e', { a: 1 });
        const bare = Object.create(null); bare.a = 'x';
        await AcousticConnect.logCustomEvent('e', bare);
        expect(mockExec).toHaveBeenCalledTimes(2);
    });
});

