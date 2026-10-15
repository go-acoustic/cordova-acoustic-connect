'use strict';

/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Platform patches that let an e2e build talk to the plain-http collector sink.
 * Applied by hooks/after_prepare_e2e.js to the generated platform files, only while
 * an e2e run is prepared (see e2e/prepare.js).
 */

// Android blocks cleartext http by default from API 28. The sink is http.
function patchAndroidManifest(xml) {
    const match = /<application\b[^>]*>/.exec(xml);
    if (!match) {
        throw new Error('AndroidManifest.xml has no <application ...> element to patch');
    }
    const tag = match[0];
    const patched = /android:usesCleartextTraffic="[^"]*"/.test(tag)
        ? tag.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="true"')
        : tag.replace('<application', '<application android:usesCleartextTraffic="true"');
    return xml.replace(tag, patched);
}

// iOS App Transport Security blocks http. Verified on an iOS 26 simulator that
// NSAllowsArbitraryLoads lets the SDK post to http://localhost.
function patchInfoPlist(xml) {
    const plist = require('plist');
    const info = plist.parse(xml);
    const ats = info.NSAppTransportSecurity && typeof info.NSAppTransportSecurity === 'object'
        ? info.NSAppTransportSecurity
        : {};
    ats.NSAllowsArbitraryLoads = true;
    info.NSAppTransportSecurity = ats;
    return plist.build(info);
}

// What the file said before it was patched, so the patch can be reversed exactly.
function readAndroidCleartext(xml) {
    const match = /<application\b[^>]*>/.exec(xml);
    const value = match && /android:usesCleartextTraffic="([^"]*)"/.exec(match[0]);
    return value ? { present: true, value: value[1] } : { present: false };
}

function unpatchAndroidManifest(xml, original) {
    const match = /<application\b[^>]*>/.exec(xml);
    if (!match) return xml;
    const tag = match[0];
    const restored = original.present
        ? tag.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="' + original.value + '"')
        : tag.replace(/ android:usesCleartextTraffic="[^"]*"/, '');
    return xml.replace(tag, restored);
}

function readAts(xml) {
    const plist = require('plist');
    const ats = plist.parse(xml).NSAppTransportSecurity;
    if (!ats || typeof ats !== 'object') return { present: false };
    return typeof ats.NSAllowsArbitraryLoads === 'boolean'
        ? { present: true, arbitraryLoads: ats.NSAllowsArbitraryLoads }
        : { present: true };
}

function unpatchInfoPlist(xml, original) {
    const plist = require('plist');
    const info = plist.parse(xml);
    if (!original.present) {
        delete info.NSAppTransportSecurity;
    } else if (info.NSAppTransportSecurity && typeof info.NSAppTransportSecurity === 'object') {
        if (typeof original.arbitraryLoads === 'boolean') {
            info.NSAppTransportSecurity.NSAllowsArbitraryLoads = original.arbitraryLoads;
        } else {
            delete info.NSAppTransportSecurity.NSAllowsArbitraryLoads;
        }
    }
    return plist.build(info);
}

module.exports = {
    patchAndroidManifest, readAndroidCleartext, unpatchAndroidManifest,
    patchInfoPlist, readAts, unpatchInfoPlist
};
