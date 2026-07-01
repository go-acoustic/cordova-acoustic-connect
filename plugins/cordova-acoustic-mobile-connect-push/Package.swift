// swift-tools-version:5.7
//
// Copyright (C) 2026 Acoustic, L.P. All rights reserved.
//
// Cordova-iOS 8+ Swift Package Manager manifest for the Acoustic Connect plugin.
// Cordova-iOS 7 hosts use the CocoaPods path declared in plugin.xml; this file is
// only consumed when the host app is built with cordova-ios >= 8 SPM resolution.

import PackageDescription

let package = Package(
    name: "AcousticConnectCordovaPlugin",
    platforms: [
        .iOS(.v15)
    ],
    products: [
        .library(
            name: "AcousticConnectCordovaPlugin",
            targets: ["AcousticConnectCordovaPlugin"]
        )
    ],
    dependencies: [
        .package(
            url: "https://github.com/go-acoustic/Connect.git",
            from: "2.0.0"
        )
    ],
    targets: [
        // ObjC AppDelegate category compiled as a separate clang target.
        // SPM Swift targets cannot compile .m files; this split is required
        // when cordova-ios 8 resolves the plugin via SPM.
        // sources: restricts compilation to the .m file only.
        // publicHeadersPath: "include" exposes exactly src/ios/include/ —
        // preventing other .h files in src/ios/ from leaking into the module map.
        .target(
            name: "AcousticConnectCordovaPluginObjC",
            path: "src/ios",
            sources: ["AppDelegate+Connect.m"],
            publicHeadersPath: "include"
        ),
        .target(
            name: "AcousticConnectCordovaPlugin",
            dependencies: [
                .product(name: "AcousticConnect", package: "Connect"),
                "AcousticConnectCordovaPluginObjC"
            ],
            path: "src/ios",
            exclude: [
                "AppDelegate+Connect.h",
                "AppDelegate+Connect.m",
                "include"   // ObjC-only headers; not Swift source
            ]
        )
    ]
)
