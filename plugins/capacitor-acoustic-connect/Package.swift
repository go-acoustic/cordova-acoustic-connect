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
        // The Connect iOS SDK (release build), pinned to the version the CocoaPods route pins too. The package
        // declares iOS 15, so this one does too; the CocoaPods route needs 15.1.
        .package(url: "https://github.com/go-acoustic/Connect-SP.git", exact: "2.1.15")
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