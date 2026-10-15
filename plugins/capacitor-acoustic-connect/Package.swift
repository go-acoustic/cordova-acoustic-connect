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
        // The Connect iOS SDK (release build): 2.1.51 or newer within 2.x, the same floor and floating range as the CocoaPods route. The package
        // declares iOS 15, so this one does too; the CocoaPods route needs 15.1.
        .package(url: "https://github.com/go-acoustic/Connect-SP.git", from: "2.1.51")
    ],
    targets: [
        .target(
            name: "AcousticConnectPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "Connect", package: "Connect-SP")
            ],
            path: "ios/Sources/AcousticConnectPlugin"),
        .testTarget(
            name: "AcousticConnectPluginTests",
            dependencies: ["AcousticConnectPlugin"],
            path: "ios/Tests/AcousticConnectPluginTests")
    ]
)