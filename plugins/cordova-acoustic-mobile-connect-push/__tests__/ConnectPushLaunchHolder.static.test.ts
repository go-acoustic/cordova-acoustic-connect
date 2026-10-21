/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Static-source checks for the iOS launch notification tap: the holder that keeps the tap that
 * launched the app until the JS enable() call has enabled the SDK, the Objective-C hook that installs
 * it at launch, and the packaging that ships both.
 *
 * Covers what is testable without a simulator:
 *  - the hook registers from +load for UIApplicationDidFinishLaunchingNotification, with queue:nil
 *    (synchronous on the posting thread), and calls the holder through a forward declaration rather
 *    than a generated -Swift.h import;
 *  - the holder installs only when push is on and the native config says automatic, and only when no
 *    one else owns the notification center;
 *  - it keeps only the latest tap, ignores dismissals, completes the handler at once, presents the
 *    same options as the SDK, and bounds how long a tap stays valid;
 *  - the hand-over releases the delegate slot (the SDK asserts it is empty) and replays only on
 *    request;
 *  - plugin.xml compiles both files, and package.json ships the .m file.
 *
 * The behaviour itself (cold-start tap opens the URL; backgrounded regression) is verified on an
 * iOS simulator, not here.
 */

export {};

import { readFileSync } from 'fs';
import { join }         from 'path';

const PLUGIN_DIR = join(__dirname, '..');

function read(rel: string): string {
    return readFileSync(join(PLUGIN_DIR, rel), 'utf8');
}

function stripSwiftComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');
}

function stripObjcComments(src: string): string {
    return stripSwiftComments(src);
}

function extractBlock(source: string, anchorPattern: RegExp): string | undefined {
    const match = anchorPattern.exec(source);
    if (!match) return undefined;
    const open = match.index + match[0].length - 1;
    if (source[open] !== '{') return undefined;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(match.index, i + 1);
    }
    return undefined;
}

const HOLDER = stripSwiftComments(read('src/ios/ConnectPushLaunchHolder.swift'));
const HOOK   = stripObjcComments(read('src/ios/ConnectPushLaunchHook.m'));

describe('ConnectPushLaunchHook.m', () => {
    it('registers from +load, before main(), so no app delegate or pluginInitialize is needed', () => {
        expect(HOOK).toMatch(/\+\s*\(void\)\s*load\s*\{/);
    });

    it('observes UIApplicationDidFinishLaunchingNotification with queue:nil, synchronously on the posting thread', () => {
        const load = extractBlock(HOOK, /\+\s*\(void\)\s*load\s*\{/) ?? '';
        expect(load).toContain('addObserverForName:UIApplicationDidFinishLaunchingNotification');
        expect(load).toMatch(/queue:nil/);
        expect(load).toContain('[ACConnectPushLaunchHolder installIfNeeded]');
    });

    it('forward-declares the Swift holder instead of importing a generated -Swift.h', () => {
        expect(HOOK).toMatch(/@interface ACConnectPushLaunchHolder : NSObject\s*\+\s*\(void\)installIfNeeded;\s*@end/);
        expect(HOOK).not.toMatch(/-Swift\.h/);
    });
});

describe('ConnectPushLaunchHolder.swift — class shape', () => {
    it('is an NSObject exposed to Objective-C under the name the hook declares', () => {
        expect(HOLDER).toMatch(/@objc\(ACConnectPushLaunchHolder\)\s*public final class ConnectPushLaunchHolder: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable/);
        expect(HOLDER).toMatch(/@MainActor\s*@objc public static func installIfNeeded\(\)/);
    });

    it('is not main-actor isolated as a whole: the center calls the delegate from its own queue', () => {
        expect(HOLDER).not.toMatch(/@MainActor\s*@objc\(ACConnectPushLaunchHolder\)/);
    });

    it('keeps the touches of the notification center on the main actor', () => {
        expect(HOLDER).toMatch(/@MainActor\s*private func install\(\)/);
        expect(HOLDER).toMatch(/@MainActor\s*func handOver\(replay: Bool\)/);
    });

    it('guards the held tap with a lock, written and read only inside it', () => {
        expect(HOLDER).toMatch(/private let lock = NSLock\(\)/);
        const hold = extractBlock(HOLDER, /private func hold\(_ response: UNNotificationResponse\)\s*\{/) ?? '';
        expect(hold).toMatch(/locked \{\s*heldResponse = response\s*heldAt = Date\(\)\s*\}/);
        const take = extractBlock(HOLDER, /private func takeHeldTap\(\) -> UNNotificationResponse\?\s*\{/) ?? '';
        expect(take).toMatch(/UNNotificationResponse\?\s*\{\s*locked \{/);
        const outside = HOLDER.replace(hold, '').replace(take, '');
        expect(outside).not.toMatch(/heldResponse = /);
        expect(outside).not.toMatch(/heldAt = /);
    });
});

describe('ConnectPushLaunchHolder.swift — install', () => {
    const install = extractBlock(HOLDER, /private func install\(\)\s*\{/) ?? '';

    it('installs only when the native config asks for push in automatic mode', () => {
        expect(install).toMatch(/guard Self\.launchConfigWantsAutomaticPush\(\) else \{ return \}/);
        const cfg = extractBlock(HOLDER, /private static func launchConfigWantsAutomaticPush\(\) -> Bool\s*\{/) ?? '';
        expect(cfg).toContain('"AcousticConnectNativeConfig"');
        expect(cfg).toContain('subdirectory: "www"');
        expect(cfg).toContain('config["pushEnabled"] as? Bool ?? true');
        expect(cfg).toContain('config["iosPushMode"] as? String ?? "automatic"');
        expect(cfg).toMatch(/return pushEnabled && pushMode == "automatic"/);
    });

    it('leaves a delegate that someone else already set alone', () => {
        expect(install).toMatch(/guard center\.delegate == nil else \{ return \}/);
        expect(install.indexOf('guard center.delegate == nil')).toBeLessThan(install.indexOf('center.delegate = self'));
    });
});

describe('ConnectPushLaunchHolder.swift — holding the tap', () => {
    const didReceive = extractBlock(HOLDER, /public func userNotificationCenter\(\s*_ center: UNUserNotificationCenter,\s*didReceive response: UNNotificationResponse,\s*withCompletionHandler completionHandler: @escaping \(\) -> Void\s*\)\s*\{/) ?? '';
    const willPresent = extractBlock(HOLDER, /public func userNotificationCenter\(\s*_ center: UNUserNotificationCenter,\s*willPresent notification: UNNotification,\s*withCompletionHandler completionHandler: @escaping \(UNNotificationPresentationOptions\) -> Void\s*\)\s*\{/) ?? '';

    it('keeps the response and completes the handler immediately', () => {
        expect(didReceive).toBeTruthy();
        expect(didReceive).toContain('hold(response)');
        expect(didReceive).toMatch(/completionHandler\(\)/);
    });

    it('keeps only the most recent tap: a single slot, overwritten, never a queue', () => {
        expect(HOLDER).toMatch(/private var heldResponse: UNNotificationResponse\?/);
        expect(HOLDER).not.toMatch(/\[UNNotificationResponse\]/);
    });

    it('does not let a dismissal displace a real tap', () => {
        expect(didReceive).toMatch(/if response\.actionIdentifier != UNNotificationDismissActionIdentifier \{\s*hold\(response\)\s*\}/);
    });

    it('presents nothing in the foreground before enable, as an empty delegate slot would not', () => {
        expect(willPresent).toContain('completionHandler([])');
        expect(willPresent).not.toMatch(/\.banner/);
    });
});

describe('ConnectPushLaunchHolder.swift — hand over to the SDK', () => {
    const handOver = extractBlock(HOLDER, /func handOver\(replay: Bool\) -> UNNotificationResponse\?\s*\{/) ?? '';

    it('releases the delegate slot only when it is the holder', () => {
        expect(handOver).toMatch(/if center\.delegate === self \{\s*center\.delegate = nil\s*\}/);
    });

    const take = extractBlock(HOLDER, /private func takeHeldTap\(\) -> UNNotificationResponse\?\s*\{/) ?? '';

    it('clears the held tap on every path, replayed or not', () => {
        expect(handOver).toMatch(/let held = takeHeldTap\(\)/);
        expect(take).toMatch(/defer \{\s*heldResponse = nil\s*heldAt = nil\s*\}/);
    });

    it('returns the tap only when asked to replay and it is still within the hold window', () => {
        expect(handOver).toMatch(/return replay \? held : nil/);
        expect(take).toMatch(/guard let response = heldResponse, let heldAt,/);
        expect(take).toContain('Date().timeIntervalSince(heldAt) <= Self.maxHoldSeconds');
        expect(take).toMatch(/else \{ return nil \}/);
    });

    it('bounds the hold to 30 seconds', () => {
        expect(HOLDER).toMatch(/static let maxHoldSeconds: TimeInterval = 30\b/);
    });
});

describe('packaging', () => {
    const pluginXml = read('plugin.xml');
    const pkg = JSON.parse(read('package.json'));

    it('plugin.xml compiles the holder and the hook into the app target', () => {
        const ios = /<platform name="ios">[\s\S]*?<\/platform>/.exec(pluginXml)?.[0] ?? '';
        expect(ios).toContain('<source-file src="src/ios/ConnectPushLaunchHolder.swift" />');
        expect(ios).toContain('<source-file src="src/ios/ConnectPushLaunchHook.m" />');
    });

    it.each([
        'ConnectPushLaunchHolder.swift',
        'ConnectPushLaunchHook.m',
    ])('the after_prepare hook machinery registers %s in the App compile sources', (file) => {
        // Cordova puts plugin sources into every target and the extension purge removes them again, so a
        // source file this list does not name ends up in no target at all.
        const rb = read('src/ios/add_ios_push_extensions.rb');
        const list = /PLUGIN_COMPILE_FILES = \[[\s\S]*?\]\.freeze/.exec(rb)?.[0] ?? '';
        expect(list).toContain(`App/Plugins/co.acoustic.connect.push/${file}`);
        // ...and the file has to be copied next to ConnectPlugin.swift before that registration.
        const js = read('src/ios/hooks/after_prepare.js');
        const copyList = /const files\s*=\s*\[[^\]]*\]/.exec(js)?.[0] ?? '';
        expect(copyList).toContain(`'${file}'`);
    });

    it('package.json ships the Objective-C file as well as the Swift ones', () => {
        expect(pkg.files).toContain('src/ios/*.swift');
        expect(pkg.files).toContain('src/ios/*.m');
    });

    it.each([
        'src/ios/ConnectPushLaunchHolder.swift',
        'src/ios/ConnectPushLaunchHook.m',
    ])('%s carries no Jira key or Jira/Confluence URL', (rel) => {
        const src = read(rel);
        expect(src).not.toMatch(/\bCA-\d+\b/);
        expect(src).not.toMatch(/atlassian|jiraconf/i);
    });
});
