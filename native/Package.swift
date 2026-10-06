// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LaiNative",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "Lai", targets: ["LaiNative"]),
        .executable(name: "LaiCoreTests", targets: ["LaiCoreTests"]),
        .executable(name: "LaiInstanceTests", targets: ["LaiInstanceTests"])
    ],
    targets: [
        .target(name: "LaiCore"),
        .executableTarget(name: "LaiInstanceTests", dependencies: ["LaiCore"]),
        .executableTarget(
            name: "LaiNative",
            dependencies: ["LaiCore"]
        ),
        .executableTarget(
            name: "LaiCoreTests",
            dependencies: ["LaiCore"]
        )
    ]
)
