import type {
  AcousticConnectApi,
  AcousticConnectPlugin,
  AcousticError,
  FlatValue,
  LogLevel,
  PushMode,
  TextChangeOptions,
} from './definitions';

const VALID_LOG_LEVELS: LogLevel[] = ['silent', 'error', 'warn', 'info', 'verbose'];
const VALID_PUSH_MODES: PushMode[] = ['automatic', 'manual'];
/** The bytes of an APNs device token written as hex digits: pairs of them, at least 32 bytes (a token is 32 bytes today and may grow). */
const HEX_BYTES = /^([0-9a-fA-F]{2}){32,}$/;
/** The native default level of an event. */
const DEFAULT_EVENT_LEVEL = 3;
const MAX_SIGNAL_DEPTH = 32;

const invalid = (message: string): Promise<never> =>
  Promise.reject<never>({ code: 'ACOUSTIC_INVALID_ARGS', message } as AcousticError);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0;

/** Only a plain object: a Date, Map or Set has no own keys and would reach the native side as `{}`. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

const isFlatValue = (value: unknown): value is FlatValue =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && isFinite(value));

const isFlatMap = (value: unknown): value is Record<string, FlatValue> =>
  isPlainObject(value) && Object.keys(value).every((key) => isFlatValue(value[key]));

/** True when the value survives JSON serialisation unchanged. */
const isJsonValue = (value: unknown, depth: number): boolean => {
  if (depth > MAX_SIGNAL_DEPTH) return false;
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return isFinite(value);
    default:
  }
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (isPlainObject(value)) return Object.keys(value).every((key) => isJsonValue(value[key], depth + 1));
  return false;
};

/**
 * Replaces every character with `X`, keeping only the length. Done here, before the call: the native
 * SDKs mask only native controls, and an input in the WebView has none, so a text sent as a custom
 * event would reach the collector as typed. By code point, so an emoji counts as one.
 */
const maskText = (text: string): string =>
  Array.from(text)
    .map(() => 'X')
    .join('');

/** Reads a stored item as the type of `fallback`; a missing item, or one that does not fit, gives `fallback`. */
const parseConfigItem = (raw: unknown, fallback: FlatValue): FlatValue => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof fallback === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const text = String(raw).trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
    return fallback;
  }
  if (typeof fallback === 'number') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    return isFinite(n) ? n : fallback;
  }
  return String(raw);
};

/** Builds the Cordova-style API on a native plugin. */
export function createAcousticConnect(native: AcousticConnectPlugin): AcousticConnectApi {
  const screenViewContext =
    (method: 'logScreenViewContextLoad' | 'logScreenViewContextUnload') =>
    (logicalPageName: string, referrer?: string | null): Promise<void> => {
      if (!isNonEmptyString(logicalPageName)) return invalid(`${method}: logicalPageName must be a non-empty string`);
      if (referrer !== undefined && referrer !== null && typeof referrer !== 'string') {
        return invalid(`${method}: referrer must be a string or null`);
      }
      return native[method]({ logicalPageName, referrer: isNonEmptyString(referrer) ? referrer : null });
    };

  const api: AcousticConnectApi = {
    enable(appKey, postURL, pushMode, options) {
      if (!isNonEmptyString(appKey)) return invalid('enable: appKey must be a non-empty string');
      if (!isNonEmptyString(postURL)) return invalid('enable: postURL must be a non-empty string');
      if (pushMode && !VALID_PUSH_MODES.includes(pushMode)) {
        return invalid("enable: pushMode must be 'automatic' or 'manual'");
      }
      // options first: an untyped caller must not be able to replace the arguments that were just checked
      return native.enable({ ...(options || {}), appKey, postURL, ...(pushMode ? { pushMode } : {}) });
    },

    disable: () => native.disable(),

    setLogLevel(level) {
      if (!VALID_LOG_LEVELS.includes(level)) {
        return invalid("setLogLevel: level must be one of 'silent','error','warn','info','verbose'");
      }
      return native.setLogLevel({ level });
    },

    logIdentity(identifierName, identifierValue, signalType, additionalParameters) {
      if (!isNonEmptyString(identifierName)) return invalid('logIdentity: identifierName must be a non-empty string');
      if (!isNonEmptyString(identifierValue)) return invalid('logIdentity: identifierValue must be a non-empty string');
      return native.logIdentity({
        identifierName,
        identifierValue,
        signalType: typeof signalType === 'string' && signalType.trim() ? signalType.trim() : 'loggedIn',
        additionalParameters:
          additionalParameters && typeof additionalParameters === 'object' ? additionalParameters : {},
      });
    },

    getSdkVersion: async () => (await native.getSdkVersion()).value,

    isSdkEnabled: async () => (await native.isSdkEnabled()).value === true,

    flushQueues: () => native.flushQueues(),

    setCurrentScreenName(name) {
      if (!isNonEmptyString(name)) return invalid('setCurrentScreenName: name must be a non-empty string');
      return native.setCurrentScreenName({ name });
    },

    logCustomEvent(eventName, values, level) {
      if (!isNonEmptyString(eventName)) return invalid('logCustomEvent: eventName must be a non-empty string');
      const payload = values === undefined ? {} : values;
      if (!isFlatMap(payload)) {
        return invalid('logCustomEvent: values must be a flat object of string, number or boolean values');
      }
      const lvl = level === undefined ? DEFAULT_EVENT_LEVEL : level;
      if (!isNonNegativeInteger(lvl)) return invalid('logCustomEvent: level must be a non-negative integer');
      return native.logCustomEvent({ eventName, values: payload, level: lvl });
    },

    logClickEvent(controlId, data) {
      if (!isNonEmptyString(controlId)) return invalid('logClickEvent: controlId must be a non-empty string');
      const extra = data === undefined ? {} : data;
      if (!isFlatMap(extra)) {
        return invalid('logClickEvent: data must be a flat object of string, number or boolean values');
      }
      return api.logCustomEvent('click', { ...extra, controlId });
    },

    logTextChangeEvent(controlId, options?: TextChangeOptions) {
      if (!isNonEmptyString(controlId)) return invalid('logTextChangeEvent: controlId must be a non-empty string');
      const opts = options === undefined ? {} : options;
      if (!isPlainObject(opts)) return invalid('logTextChangeEvent: options must be an object');
      if (opts.text !== undefined && typeof opts.text !== 'string')
        return invalid('logTextChangeEvent: text must be a string');
      if (opts.masked !== undefined && typeof opts.masked !== 'boolean') {
        return invalid('logTextChangeEvent: masked must be a boolean');
      }
      const values: Record<string, FlatValue> = { controlId };
      if (opts.text !== undefined) {
        const masked = opts.masked !== false;
        values.text = masked ? maskText(opts.text) : opts.text;
        values.masked = masked;
      }
      return api.logCustomEvent('textChange', values);
    },

    logSignal(values, level) {
      if (!isPlainObject(values) || !isJsonValue(values, 0)) {
        return invalid('logSignal: values must be a JSON-serialisable plain object');
      }
      const lvl = level === undefined ? DEFAULT_EVENT_LEVEL : level;
      if (!isNonNegativeInteger(lvl)) return invalid('logSignal: level must be a non-negative integer');
      return native.logSignal({ values, level: lvl });
    },

    logExceptionEvent(message, stackInfo, unhandled) {
      if (!isNonEmptyString(message)) return invalid('logExceptionEvent: message must be a non-empty string');
      const stack = stackInfo === undefined ? '' : stackInfo;
      if (typeof stack !== 'string') return invalid('logExceptionEvent: stackInfo must be a string');
      const isUnhandled = unhandled === undefined ? false : unhandled;
      if (typeof isUnhandled !== 'boolean') return invalid('logExceptionEvent: unhandled must be a boolean');
      return native.logExceptionEvent({ message, stackInfo: stack, unhandled: isUnhandled });
    },

    logScreenViewContextLoad: screenViewContext('logScreenViewContextLoad'),
    logScreenViewContextUnload: screenViewContext('logScreenViewContextUnload'),

    logScreenLayout(name, delayMs) {
      if (!isNonEmptyString(name)) return invalid('logScreenLayout: name must be a non-empty string');
      if (delayMs !== undefined && !isNonNegativeInteger(delayMs)) {
        return invalid('logScreenLayout: delayMs must be a non-negative integer');
      }
      return native.logScreenLayout(delayMs === undefined ? { name } : { name, delayMs });
    },

    setConfigItem(key, value, moduleName) {
      if (!isNonEmptyString(key)) return invalid('setConfigItem: key must be a non-empty string');
      if (!isFlatValue(value)) return invalid('setConfigItem: value must be a boolean, a string or a finite number');
      if (!isNonEmptyString(moduleName)) return invalid('setConfigItem: moduleName must be a non-empty string');
      return native.setConfigItem({ key, value, moduleName });
    },

    getConfigItem: ((key: string, defaultValue: FlatValue, moduleName: string): Promise<FlatValue> => {
      if (!isNonEmptyString(key)) return invalid('getConfigItem: key must be a non-empty string');
      if (!isFlatValue(defaultValue)) {
        return invalid('getConfigItem: defaultValue must be a boolean, a string or a finite number');
      }
      if (!isNonEmptyString(moduleName)) return invalid('getConfigItem: moduleName must be a non-empty string');
      return native.getConfigItem({ key, moduleName }).then((result) => parseConfigItem(result?.value, defaultValue));
    }) as AcousticConnectApi['getConfigItem'],

    push: {
      requestPermission: () => native.pushRequestPermission(),
      getPermissionState: async () => (await native.pushGetPermissionState()).value,
      async didReceiveAuthorization(granted, error) {
        if (granted === null || granted === undefined) return false;
        return (await native.pushDidReceiveAuthorization({ granted, error: error == null ? null : error })).value;
      },
      didReceiveNotification: async (userInfo) => (await native.pushDidReceiveNotification({ userInfo })).value,
      didReceiveResponse: async (actionIdentifier, userInfo) =>
        (await native.pushDidReceiveResponse({ actionIdentifier, userInfo })).value,
      async didRegisterWithToken(token) {
        if (typeof token !== 'string' || !HEX_BYTES.test(token)) {
          return invalid(
            'push.didRegisterWithToken: token must be the device token as hex digits, at least 32 bytes (64 digits)',
          );
        }
        return (await native.pushDidRegisterWithToken({ token })).value;
      },
      async didFailToRegister(error) {
        if (error !== undefined && error !== null && typeof error !== 'string') {
          return invalid('push.didFailToRegister: error must be a string or null');
        }
        return (await native.pushDidFailToRegister({ error: error == null ? null : error })).value;
      },
    },
  };
  return api;
}
