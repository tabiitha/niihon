// swift-tools-version: 6.2
// Native macOS client of Nihon. `NihonMacCore` holds everything testable without a window: the service
// connection, interface texts, and theme tokens; `Nihon` is the SwiftUI application. Sources under
// */Generated come from the shared JSON texts and theme tokens: run `bun run macos:generate`.
import PackageDescription

let package = Package(
    name: "NihonMac",
    platforms: [.macOS(.v26)],
    products: [
        .executable(name: "Nihon", targets: ["Nihon"]),
    ],
    dependencies: [
        .package(path: "../../contracts/swift"),
    ],
    targets: [
        .target(
            name: "NihonMacCore",
            dependencies: [
                .product(name: "NihonAPIClient", package: "swift"),
            ],
            // The native texts, read by tools/generate-shared.mjs into Generated/ModuleTexts.swift.
            exclude: ["Shell/locales", "Accounts/locales"]
        ),
        .executableTarget(
            name: "Nihon",
            dependencies: [
                "NihonMacCore",
                .product(name: "NihonAPIClient", package: "swift"),
            ]
        ),
        .testTarget(
            name: "NihonMacCoreTests",
            dependencies: [
                "NihonMacCore",
                .product(name: "NihonAPIClient", package: "swift"),
            ]
        ),
    ]
)
