# capacitor-acoustic-connect

Capacitor plugin for Acoustic Connect (CDP + engagement).

## Install

```bash
npm install capacitor-acoustic-connect
npx cap sync
```

Requires Capacitor 8, Node 22 or newer.

### Android

The Connect Android SDK betas are published to a Maven tree that Capacitor's template does not list,
and the SDK needs `minSdkVersion` 26 (the template has 24). In the app's `android/build.gradle`:

```groovy
allprojects {
    repositories {
        google()
        mavenCentral()
        maven {
            url "https://raw.githubusercontent.com/go-acoustic/Android_Maven/master"
            content { includeGroup "io.github.go-acoustic" }
        }
    }
}
```

and in `android/variables.gradle`: `minSdkVersion = 26`.

Analytics needs no Firebase. For push, set `pushEnabled: true` in the plugin config, add your
`google-services.json`, then run `npx cap sync` and rebuild: the build then uses the push artifact and
Firebase Messaging. The plugin pins Connect Android `11.1.17`;
override it with `androidVersion` in the plugin block of `capacitor.config`, or with the Gradle property `connectSdkVersion` (`-PconnectSdkVersion=...`,
`gradle.properties` or `variables.gradle`), which wins.
The Firebase BOM version used for push is `firebaseBomVersion`, set the same way. With `useRelease: true` the
build rejects `-beta` SDK versions, so pin a release version first.

### iOS

The plugin links the Connect iOS SDK (release build, `2.1.51` or newer, floating: CocoaPods and Swift Package Manager take the newest 2.x release; `iosVersion` in the plugin block pins one in an app that uses
CocoaPods) either through Swift Package Manager or
through CocoaPods; Capacitor 8 projects use Swift Package Manager by default.

- **Swift Package Manager** (Capacitor's default): nothing to add; the plugin's package depends on
  [`Connect-SP`](https://github.com/go-acoustic/Connect-SP). The SDK reads its default settings from a
  `ConnectResources.bundle` in the root of the app, and that package ships the bundle only inside `Connect.framework`.
  Without a copy in the app root the SDK runs without its defaults and sends only part of its data (no client state,
  signals, exceptions or layout). Add a **Run Script** build phase to the app target, after "Embed Frameworks":

  ```sh
  SRC="${TARGET_BUILD_DIR}/${FRAMEWORKS_FOLDER_PATH}/Connect.framework/ConnectResources.bundle"
  DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/ConnectResources.bundle"
  if [ -d "$SRC" ]; then rm -rf "$DEST"; cp -R "$SRC" "$DEST"; fi
  ```

  The sample app (`applications/DemoCapacitor`) has this phase.
- **CocoaPods** (`npx cap add ios --packagemanager CocoaPods`): the `AcousticConnect` pod (`>= 2.1.51`, floating)
  puts the bundle in place itself. The SDK needs iOS 15.1 here: raise `platform :ios` in the Podfile and the
  project's deployment target to `15.1`, because Capacitor's template targets 15.0.

## Use

Configure the plugin in `capacitor.config.ts` (see [docs/configuration.md](docs/configuration.md)):
with `appKey` and `postMessageUrl` set, the SDK starts when the app launches.

```ts
import { AcousticConnect } from 'capacitor-acoustic-connect';

await AcousticConnect.setCurrentScreenName('Checkout');
await AcousticConnect.logCustomEvent('purchase', { total: 24.99, currency: 'EUR' });
await AcousticConnect.logClickEvent('buyButton');
await AcousticConnect.logTextChangeEvent('note', { text: noteField.value }); // masked unless masked: false
const state = await AcousticConnect.push.getPermissionState(); // true, false, or null (not asked yet)
```

See also: [configuration](docs/configuration.md), [push notifications](docs/push.md), [troubleshooting](docs/troubleshooting.md) and
[moving from the Cordova plugin](docs/migration-from-cordova.md).

Errors are plain objects `{ code, message }`: `ACOUSTIC_INVALID_ARGS` for a bad argument,
`ACOUSTIC_INTERNAL_ERROR` when the SDK refuses. In a browser (`ionic serve`) calls that only record
something do nothing, and the ones that need the SDK reject with code `UNAVAILABLE`.
The push methods live under `AcousticConnect.push`: `requestPermission`, `getPermissionState`,
`didReceiveAuthorization`, `didReceiveNotification`, `didReceiveResponse`, `didRegisterWithToken`, `didFailToRegister`.

**iOS manual push mode** (`iosPushMode: 'manual'`): the SDK does not take over the system's push callbacks, so the app hands
over what it gets: the APNs token as hex digits (`didRegisterWithToken(token)`), a failed registration
(`didFailToRegister(message)`), a notification that arrived (`didReceiveNotification(userInfo)`) and what the user did with
one (`didReceiveResponse(actionIdentifier, userInfo)`). In the other mode, and on Android, these reject with
`ACOUSTIC_PUSH_MODE_NOT_MANUAL`; they are unavailable in a browser. The Cordova plugin has no call for the token, so
manual mode could not register a device there. These calls are checked with a fake SDK; they have not been run against a
real push on a device.

## Rich push on iOS (images and expanded notifications)

Rich push needs two extensions in the app: a Notification Service Extension (`ConnectNSE`), which downloads the media and records that
the notification was received, and a Notification Content Extension (`ConnectNCE`), which draws the expanded notification. Both read an
App Group that they share with the app. Capacitor has no install hooks, so one command adds them to the Xcode project:

```shell
npx acoustic-connect setup-ios-push --app-group group.com.example.app   # or iosAppGroupIdentifier in the plugin block
```

Before it, in your Apple developer account: create that App Group, and give the app's identifier and the two extensions' identifiers
(`<app id>.ConnectNSE`, `<app id>.ConnectNCE`) the Push Notifications capability and the App Group. Add `--team <ID>` to set your
development team on the app and the extensions.

What the command does: writes the two extensions' sources, `Info.plist` and entitlements into `ios/App/` (it never overwrites a file that is
there), adds the targets to `ios/App/App.xcodeproj`, embeds them in the app, gives the extensions the app's version (the App Store refuses an app and extensions with different ones),
adds the `aps-environment` entitlement and the App Group to the app's entitlements, and the `remote-notification` background mode to its
`Info.plist`. It needs `ruby` and the `xcodeproj` gem (`gem install xcodeproj`; CocoaPods brings it). Run it again after you change the
app's version, to bring the extensions in line; running it again changes nothing else. `--dry-run` shows what it would write.

How the extensions get the Connect SDK depends on how the app links the plugin:

- **Swift Package Manager** (the default): the command links the `Connect` product of `Connect-SP`, as a Swift package of the Xcode project, at the
  version the plugin pins.
- **CocoaPods** (`ios/App/Podfile` exists): the command adds a `target 'ConnectNSE'` and a `target 'ConnectNCE'` block with the `AcousticConnect` pod to
  the Podfile, with the version requirement of the plugin (`>= 2.1.51`, and `= <iosVersion>` when the plugin block names one), and links no
  package. Then run `pod install` in `ios/App` (or `npx cap sync ios`), which keeps those blocks. The app and the extensions share one
  copy of the SDK frameworks.

What it does not cover is the Apple developer account set-up above. The extensions are built into the DemoCapacitor app (Swift Package Manager)
and the app still passes its wire verification; the CocoaPods route was run on a new Capacitor 8 app (`npx cap add ios --packagemanager CocoaPods`),
which then built for the iOS simulator with both extensions embedded. A rich notification has not been received on a **real device** (the
simulator does not show rich media).

## Checking an app: `doctor`

`npx acoustic-connect doctor [dir] [--require-push]` reads the app and says what would go wrong later, at build time or on the device. It changes
nothing. It checks the plugin block of the config (an app key that is not the placeholder, a https collector URL), the Android project
(`minSdkVersion` 26, the Connect Maven tree, and, for push, a `google-services.json` with a client for the `applicationId`), and the iOS project
(for push the `aps-environment` entitlement and the `remote-notification` background mode, the `ConnectResources.bundle` copy of a Swift Package
Manager app, and that the rich-push extensions and the app share one App Group). The push checks run when `pushEnabled` is on; `--require-push`
runs them anyway, which suits a CI gate. A failed check makes the exit code 1; a warning does not.

## Privacy

- **Typed text** goes through `logTextChangeEvent`, which sends `X` for every character unless you pass
  `masked: false`. The same applies to anything else you send in an event or signal: it goes as you give it.
- **Native masking rules do not reach the page.** The SDK sees the WebView as one control. On Android the layout
  lists it with its position and state and nothing from the page (no text, no inputs).
- **iOS sends a screenshot** of the screen with the layout, and the screenshot shows what the WebView renders.
  `screenCaptureEnabled: false` turns the layout and the screenshot off while screen views and events keep flowing
  (checked on an iOS simulator). Set it for screens that show sensitive content.

## API

<docgen-index>

* [`enable(...)`](#enable)
* [`disable()`](#disable)
* [`setLogLevel(...)`](#setloglevel)
* [`logIdentity(...)`](#logidentity)
* [`getSdkVersion()`](#getsdkversion)
* [`isSdkEnabled()`](#issdkenabled)
* [`flushQueues()`](#flushqueues)
* [`setCurrentScreenName(...)`](#setcurrentscreenname)
* [`logCustomEvent(...)`](#logcustomevent)
* [`logClickEvent(...)`](#logclickevent)
* [`logTextChangeEvent(...)`](#logtextchangeevent)
* [`logSignal(...)`](#logsignal)
* [`logExceptionEvent(...)`](#logexceptionevent)
* [`logScreenViewContextLoad(...)`](#logscreenviewcontextload)
* [`logScreenViewContextUnload(...)`](#logscreenviewcontextunload)
* [`logScreenLayout(...)`](#logscreenlayout)
* [`logLocation()`](#loglocation)
* [`logLocationUpdate(...)`](#loglocationupdate)
* [`logDialogShowEvent(...)`](#logdialogshowevent)
* [`logDialogDismissEvent(...)`](#logdialogdismissevent)
* [`logDialogButtonClickEvent(...)`](#logdialogbuttonclickevent)
* [`logDialogCustomEvent(...)`](#logdialogcustomevent)
* [`setConfigItem(...)`](#setconfigitem)
* [`getConfigItem(...)`](#getconfigitem)
* [`getConfigItem(...)`](#getconfigitem)
* [`getConfigItem(...)`](#getconfigitem)
* [Interfaces](#interfaces)
* [Type Aliases](#type-aliases)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

The API apps call: the Cordova plugin's, with promises and plain return values.

### enable(...)

```typescript
enable(appKey: string, postURL: string, pushMode?: PushMode | undefined, options?: EnableOptions | undefined) => Promise<void>
```

| Param          | Type                                                    |
| -------------- | ------------------------------------------------------- |
| **`appKey`**   | <code>string</code>                                     |
| **`postURL`**  | <code>string</code>                                     |
| **`pushMode`** | <code><a href="#pushmode">PushMode</a></code>           |
| **`options`**  | <code><a href="#enableoptions">EnableOptions</a></code> |

--------------------


### disable()

```typescript
disable() => Promise<void>
```

--------------------


### setLogLevel(...)

```typescript
setLogLevel(level: LogLevel) => Promise<void>
```

| Param       | Type                                          |
| ----------- | --------------------------------------------- |
| **`level`** | <code><a href="#loglevel">LogLevel</a></code> |

--------------------


### logIdentity(...)

```typescript
logIdentity(identifierName: string, identifierValue: string, signalType?: string | undefined, additionalParameters?: Record<string, unknown> | undefined) => Promise<void>
```

| Param                      | Type                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| **`identifierName`**       | <code>string</code>                                              |
| **`identifierValue`**      | <code>string</code>                                              |
| **`signalType`**           | <code>string</code>                                              |
| **`additionalParameters`** | <code><a href="#record">Record</a>&lt;string, unknown&gt;</code> |

--------------------


### getSdkVersion()

```typescript
getSdkVersion() => Promise<string>
```

**Returns:** <code>Promise&lt;string&gt;</code>

--------------------


### isSdkEnabled()

```typescript
isSdkEnabled() => Promise<boolean>
```

**Returns:** <code>Promise&lt;boolean&gt;</code>

--------------------


### flushQueues()

```typescript
flushQueues() => Promise<void>
```

--------------------


### setCurrentScreenName(...)

```typescript
setCurrentScreenName(name: string) => Promise<void>
```

| Param      | Type                |
| ---------- | ------------------- |
| **`name`** | <code>string</code> |

--------------------


### logCustomEvent(...)

```typescript
logCustomEvent(eventName: string, values?: Record<string, FlatValue> | undefined, level?: number | undefined) => Promise<void>
```

| Param           | Type                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| **`eventName`** | <code>string</code>                                                                         |
| **`values`**    | <code><a href="#record">Record</a>&lt;string, <a href="#flatvalue">FlatValue</a>&gt;</code> |
| **`level`**     | <code>number</code>                                                                         |

--------------------


### logClickEvent(...)

```typescript
logClickEvent(controlId: string, data?: Record<string, FlatValue> | undefined) => Promise<void>
```

| Param           | Type                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| **`controlId`** | <code>string</code>                                                                         |
| **`data`**      | <code><a href="#record">Record</a>&lt;string, <a href="#flatvalue">FlatValue</a>&gt;</code> |

--------------------


### logTextChangeEvent(...)

```typescript
logTextChangeEvent(controlId: string, options?: TextChangeOptions | undefined) => Promise<void>
```

| Param           | Type                                                            |
| --------------- | --------------------------------------------------------------- |
| **`controlId`** | <code>string</code>                                             |
| **`options`**   | <code><a href="#textchangeoptions">TextChangeOptions</a></code> |

--------------------


### logSignal(...)

```typescript
logSignal(values: SignalValues, level?: number | undefined) => Promise<void>
```

| Param        | Type                                                  |
| ------------ | ----------------------------------------------------- |
| **`values`** | <code><a href="#signalvalues">SignalValues</a></code> |
| **`level`**  | <code>number</code>                                   |

--------------------


### logExceptionEvent(...)

```typescript
logExceptionEvent(message: string, stackInfo?: string | undefined, unhandled?: boolean | undefined) => Promise<void>
```

| Param           | Type                 |
| --------------- | -------------------- |
| **`message`**   | <code>string</code>  |
| **`stackInfo`** | <code>string</code>  |
| **`unhandled`** | <code>boolean</code> |

--------------------


### logScreenViewContextLoad(...)

```typescript
logScreenViewContextLoad(logicalPageName: string, referrer?: string | null | undefined) => Promise<void>
```

| Param                 | Type                        |
| --------------------- | --------------------------- |
| **`logicalPageName`** | <code>string</code>         |
| **`referrer`**        | <code>string \| null</code> |

--------------------


### logScreenViewContextUnload(...)

```typescript
logScreenViewContextUnload(logicalPageName: string, referrer?: string | null | undefined) => Promise<void>
```

| Param                 | Type                        |
| --------------------- | --------------------------- |
| **`logicalPageName`** | <code>string</code>         |
| **`referrer`**        | <code>string \| null</code> |

--------------------


### logScreenLayout(...)

```typescript
logScreenLayout(name: string, delayMs?: number | undefined) => Promise<void>
```

Asks the native SDK to capture the layout of the screen on display, under `name`.

| Param         | Type                | Description                                                                        |
| ------------- | ------------------- | ---------------------------------------------------------------------------------- |
| **`name`**    | <code>string</code> | Screen name, e.g. `'Login'`. Rejects with `ACOUSTIC_INVALID_ARGS` when empty.      |
| **`delayMs`** | <code>number</code> | Milliseconds to wait before capturing (a non-negative integer); omitted means now. |

--------------------


### logLocation()

```typescript
logLocation() => Promise<void>
```

Logs the device's current location, as the native SDK reads it. Subject to the app's location permission and `locationLoggingEnabled`.

--------------------


### logLocationUpdate(...)

```typescript
logLocationUpdate(latitude: number, longitude: number, level?: number | undefined) => Promise<void>
```

Logs a location the app already has.

| Param           | Type                | Description                                                 |
| --------------- | ------------------- | ----------------------------------------------------------- |
| **`latitude`**  | <code>number</code> | -90 to 90.                                                  |
| **`longitude`** | <code>number</code> | -180 to 180.                                                |
| **`level`**     | <code>number</code> | Monitoring level, a non-negative integer; the default is 3. |

--------------------


### logDialogShowEvent(...)

```typescript
logDialogShowEvent(dialogId: string, dialogTitle: string, dialogType: string) => Promise<void>
```

Logs that a dialog was shown, as a `DialogShowEvent` custom event (`dialogId`, `dialogTitle`, `dialogType`, `eventType`, `timestamp`).

| Param             | Type                |
| ----------------- | ------------------- |
| **`dialogId`**    | <code>string</code> |
| **`dialogTitle`** | <code>string</code> |
| **`dialogType`**  | <code>string</code> |

--------------------


### logDialogDismissEvent(...)

```typescript
logDialogDismissEvent(dialogId: string, dismissReason: string) => Promise<void>
```

Logs that a dialog was dismissed, as a `DialogDismissEvent` custom event; `dismissReason` is e.g. `'cancel'`, `'outside_touch'`, `'back'`.

| Param               | Type                |
| ------------------- | ------------------- |
| **`dialogId`**      | <code>string</code> |
| **`dismissReason`** | <code>string</code> |

--------------------


### logDialogButtonClickEvent(...)

```typescript
logDialogButtonClickEvent(dialogId: string, buttonText: string, buttonIndex: number) => Promise<void>
```

Logs a tap on a dialog button, as a `DialogButtonClickEvent` custom event; `buttonIndex` is the position of the button (a non-negative integer).

| Param             | Type                |
| ----------------- | ------------------- |
| **`dialogId`**    | <code>string</code> |
| **`buttonText`**  | <code>string</code> |
| **`buttonIndex`** | <code>number</code> |

--------------------


### logDialogCustomEvent(...)

```typescript
logDialogCustomEvent(dialogId: string, eventName: string, values?: Record<string, FlatValue> | undefined) => Promise<void>
```

Logs your own event for a dialog, as a `DialogCustomEvent` custom event; `eventName` travels as `customEventName`, `values` are extra flat values.

| Param           | Type                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| **`dialogId`**  | <code>string</code>                                                                         |
| **`eventName`** | <code>string</code>                                                                         |
| **`values`**    | <code><a href="#record">Record</a>&lt;string, <a href="#flatvalue">FlatValue</a>&gt;</code> |

--------------------


### setConfigItem(...)

```typescript
setConfigItem(key: string, value: FlatValue, moduleName: string) => Promise<void>
```

| Param            | Type                                            |
| ---------------- | ----------------------------------------------- |
| **`key`**        | <code>string</code>                             |
| **`value`**      | <code><a href="#flatvalue">FlatValue</a></code> |
| **`moduleName`** | <code>string</code>                             |

--------------------


### getConfigItem(...)

```typescript
getConfigItem(key: string, defaultValue: boolean, moduleName: string) => Promise<boolean>
```

| Param              | Type                 |
| ------------------ | -------------------- |
| **`key`**          | <code>string</code>  |
| **`defaultValue`** | <code>boolean</code> |
| **`moduleName`**   | <code>string</code>  |

**Returns:** <code>Promise&lt;boolean&gt;</code>

--------------------


### getConfigItem(...)

```typescript
getConfigItem(key: string, defaultValue: string, moduleName: string) => Promise<string>
```

| Param              | Type                |
| ------------------ | ------------------- |
| **`key`**          | <code>string</code> |
| **`defaultValue`** | <code>string</code> |
| **`moduleName`**   | <code>string</code> |

**Returns:** <code>Promise&lt;string&gt;</code>

--------------------


### getConfigItem(...)

```typescript
getConfigItem(key: string, defaultValue: number, moduleName: string) => Promise<number>
```

| Param              | Type                |
| ------------------ | ------------------- |
| **`key`**          | <code>string</code> |
| **`defaultValue`** | <code>number</code> |
| **`moduleName`**   | <code>string</code> |

**Returns:** <code>Promise&lt;number&gt;</code>

--------------------


### Interfaces


#### EnableOptions

| Prop                        | Type                | Description                                                 |
| --------------------------- | ------------------- | ----------------------------------------------------------- |
| **`iosAppGroupIdentifier`** | <code>string</code> | iOS: the App Group shared with the notification extensions. |
| **`androidIconResName`**    | <code>string</code> | Android: the resource name of the notification icon.        |


#### TextChangeOptions

| Prop         | Type                 | Description                                                                |
| ------------ | -------------------- | -------------------------------------------------------------------------- |
| **`text`**   | <code>string</code>  | The text. It is masked (one `X` per character) unless `masked` is `false`. |
| **`masked`** | <code>boolean</code> | Send the text as typed. Defaults to `true` (masked).                       |


#### PushPermissionResult

| Prop          | Type                 |
| ------------- | -------------------- |
| **`granted`** | <code>boolean</code> |
| **`error`**   | <code>string</code>  |


### Type Aliases


#### PushMode

How push is wired: the SDK does it (`automatic`) or the app forwards the events (`manual`, iOS).

<code>'automatic' | 'manual'</code>


#### LogLevel

Log level of the plugin bridge.

<code>'silent' | 'error' | 'warn' | 'info' | 'verbose'</code>


#### Record

Construct a type with a set of properties K of type T

<code>{ [P in K]: T; }</code>


#### FlatValue

A value of a custom event or a config item: no nesting, no `null`.

<code>string | number | boolean</code>


#### SignalValues

A signal payload: a JSON object, nested values allowed.

<code>{ [key: string]: <a href="#signalvalue">SignalValue</a> }</code>


#### SignalValue

A JSON value, as a signal carries it.

<code>string | number | boolean | null | SignalValue[] | { [key: string]: <a href="#signalvalue">SignalValue</a> }</code>

</docgen-api>
