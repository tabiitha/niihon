// swift-tools-version: 6.0
// Swift client of the Nihon REST contract. Sources under */Generated are produced from
// contracts/openapi.json by `bun run contract:generate`; do not edit them.
import PackageDescription

let package = Package(
    name: "NihonAPIClient",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "NihonAPIClient", targets: ["NihonAPIClient"]),
    ],
    dependencies: [
        // HTTPTypes is already required by swift-openapi-runtime; the client imports it directly.
        .package(url: "https://github.com/apple/swift-http-types", exact: "1.8.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.13.1"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.3.2"),
    ],
    targets: [
        .target(
            name: "NihonAPIClient",
            dependencies: [
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ]
        ),
        // Client of the conformance fixture (contracts/fixtures/openapi.json), used by the tests only.
        .target(
            name: "NihonAPIConformance",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ]
        ),
        .testTarget(
            name: "NihonAPIClientTests",
            dependencies: [
                "NihonAPIClient",
                "NihonAPIConformance",
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ]
        ),
    ]
)
