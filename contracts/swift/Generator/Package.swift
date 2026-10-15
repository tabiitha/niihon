// swift-tools-version: 6.0
// Generation-only package: `swift run --package-path contracts/swift/Generator swift-openapi-generator ...`,
// called by apps/api/contract/generate.ts. Kept apart so that clients of NihonAPIClient never resolve it.
import PackageDescription

let package = Package(
    name: "NihonContractGenerator",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.1"),
    ]
)
