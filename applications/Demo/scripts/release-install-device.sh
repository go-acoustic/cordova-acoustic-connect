#!/usr/bin/env bash
#
# Copyright (C) 2026 Acoustic, L.P. All rights reserved.
#
# Builds a Release-configuration archive of the Demo app and installs it on a
# physical device — the workflow `cordova build ios` cannot do on its own.
# Cordova's own build command doesn't drive `xcodebuild archive`, and letting
# Xcode sign a plain `cordova run ios` build yields a development-signed app,
# not the production-signed build needed to verify APNs against production.
#
# No `-exportArchive` / exportOptions.plist step: `xcodebuild archive` already
# produces a fully signed .app inside the .xcarchive
# (Products/Applications/*.app) with the correct aps-environment baked into
# its entitlements by the plugin's after_prepare hook (Release configuration
# → production, Debug → development — see resolveApsEnvironmentForEntitlementsFile
# in src/ios/hooks/after_prepare.js). Exporting to an .ipa is only needed for
# redistribution (TestFlight, sharing outside this machine); installing
# straight onto a device you already have provisioned doesn't need it.
#
# Mirrors the manual QA release-testing steps for validating the iOS
# production Connect SDK build (useRelease=true) against production APNs on
# a real device, with the machine-specific bits (paths, team ID, bundle id,
# scheme name) resolved automatically instead of hardcoded.
#
# Usage:
#   npm run release:install-device -- <device-udid>
#   ./scripts/release-install-device.sh <device-udid>
#
# Find a connected device's UDID with: xcrun devicectl list devices
#
# Requires:
#   - `cordova prepare ios` already run (platforms/ios/ exists)
#   - ConnectConfig.json present with useRelease=true and a real
#     iOSDevelopmentTeam (see the plugin README's Configuration section)

set -euo pipefail

DEVICE_UDID="${1:-}"
if [ -z "$DEVICE_UDID" ]; then
    echo "Usage: $0 <device-udid>" >&2
    echo "Find it with: xcrun devicectl list devices" >&2
    exit 1
fi

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$DEMO_DIR/platforms/ios"
CONFIG_XML="$DEMO_DIR/config.xml"

if [ ! -d "$IOS_DIR" ]; then
    echo "platforms/ios not found under $DEMO_DIR — run 'cordova prepare ios' first." >&2
    exit 1
fi
if [ ! -f "$CONFIG_XML" ]; then
    echo "config.xml not found at $CONFIG_XML" >&2
    exit 1
fi

BUNDLE_ID="$(node -e "
    const fs = require('fs');
    const xml = fs.readFileSync(process.argv[1], 'utf8');
    const m = xml.match(/<widget\b[^>]*\sid=\"([^\"]+)\"/);
    if (!m) process.exit(1);
    process.stdout.write(m[1]);
" "$CONFIG_XML")" || {
    echo "Could not find the widget id in $CONFIG_XML" >&2
    exit 1
}

WORKSPACE="$(find "$IOS_DIR" -maxdepth 1 -name '*.xcworkspace' | head -1)"
if [ -z "$WORKSPACE" ]; then
    echo "No .xcworkspace found in $IOS_DIR — run 'pod install' first (this script does that in step 1, but needs the Podfile in place)." >&2
    exit 1
fi
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"

BUILD_DIR="$IOS_DIR/build"
ARCHIVE_PATH="$BUILD_DIR/$SCHEME.xcarchive"

echo "==> Bundle ID: $BUNDLE_ID | Scheme: $SCHEME | Device: $DEVICE_UDID"

echo "==> [1/3] pod install"
( cd "$IOS_DIR" && pod install )

echo "==> [2/3] xcodebuild archive (Release)"
rm -rf "$ARCHIVE_PATH"
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE_PATH" \
    -allowProvisioningUpdates archive

APP_PATH="$(find "$ARCHIVE_PATH/Products/Applications" -maxdepth 1 -name '*.app' | head -1)"
if [ -z "$APP_PATH" ]; then
    echo "Archive succeeded but no .app was found under $ARCHIVE_PATH/Products/Applications" >&2
    exit 1
fi

echo "==> [3/3] installing and launching on device $DEVICE_UDID"
xcrun devicectl device install app --device "$DEVICE_UDID" "$APP_PATH"
xcrun devicectl device process launch --device "$DEVICE_UDID" "$BUNDLE_ID"

echo "==> Done — $BUNDLE_ID installed and launched on $DEVICE_UDID"
