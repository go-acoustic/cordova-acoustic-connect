// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorAcousticConnectBeta",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorAcousticConnectBeta",
            targets: ["AcousticConnectPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        // The Connect iOS SDK, within 2.x. The beta package links the beta build from 2.2.35, the first with the functions that log taps and
        // gestures on page elements, which the define CONNECT_WEB_CAPTURE compiles; the public package links the release build from 2.1.51,
        // without the define. Both vend the module Connect, so an app links only one of them. The packages declare iOS 15, so this one does
        // too; the CocoaPods route needs 15.1.
        .package(url: "https://github.com/go-acoustic/ConnectDebug-SP.git", from: "2.2.35")
    ],
    targets: [
        .target(
            name: "AcousticConnectPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "Connect", package: "ConnectDebug-SP")
            ],
            path: "ios/Sources/AcousticConnectPlugin",
            swiftSettings: [.define("CONNECT_WEB_CAPTURE")]),
        .testTarget(
            name: "AcousticConnectPluginTests",
            dependencies: ["AcousticConnectPlugin"],
            path: "ios/Tests/AcousticConnectPluginTests")
    ]
)
