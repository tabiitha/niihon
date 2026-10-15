import Foundation
import NihonAPIClient
import NihonAPIConformance
import OpenAPIURLSession
import Testing

/// Runs the generated clients against the real HTTP adapter serving the conformance fixture
/// (apps/api/test/fixtures/serve.ts), the same server the TypeScript client tests use.
/// Requires Node.js 24 or newer on the PATH and `bun install` at the repository root.
@Suite("Generated Swift client")
struct NihonAPIClientTests {
    @Test("reads a successful response")
    func health() async throws {
        try await withFixtureServer { url in
            let response = try await NihonAPI.makeClient(serverURL: url).getHealth()
            let health = try response.ok.body.json
            #expect(health.status == .ok)
            #expect(health.apiVersion == NihonAPIVersion.version)
        }
    }

    @Test("decodes one item with its UTC timestamp")
    func item() async throws {
        try await withFixtureServer { url in
            let response = try await conformanceClient(url).getExampleItem(path: .init(itemId: "item-02"))
            let item = try response.ok.body.json
            #expect(item.id == "item-02")
            #expect(item.label == "い")
            #expect(item.createdAt == date("2026-10-02T08:00:00.250Z"))
        }
    }

    @Test("returns a typed error")
    func typedError() async throws {
        try await withFixtureServer { url in
            let response = try await conformanceClient(url).getExampleItem(path: .init(itemId: "missing"))
            guard case .notFound(let notFound) = response else {
                Issue.record("Expected 404, received \(response)")
                return
            }
            let error = try notFound.body.json.error
            #expect(error.code == "example_item_not_found")
            #expect(!error.requestId.isEmpty)
        }
    }

    @Test("walks every page in a stable order")
    func pagination() async throws {
        try await withFixtureServer { url in
            let client = conformanceClient(url)
            var pages: [[String]] = []
            var cursor: String?
            repeat {
                let page = try await client.listExampleItems(query: .init(limit: 2, cursor: cursor)).ok.body.json
                pages.append(page.items.map(\.id))
                cursor = page.nextCursor
            } while cursor != nil
            #expect(pages == [["item-01", "item-02"], ["item-03", "item-04"], ["item-05"]])
        }
    }

    @Test("reports invalid input per field")
    func validation() async throws {
        try await withFixtureServer { url in
            let response = try await conformanceClient(url).listExampleItems(query: .init(limit: 0))
            let error = try response.badRequest.body.json.error
            #expect(error.code == "validation_failed")
            #expect(error.issues?.map(\.path) == ["query.limit"])
        }
    }

    @Test("is refused by the server when generated for another major version")
    func incompatibleClient() async throws {
        try await withFixtureServer { url in
            let client = NihonAPIConformance.Client(
                serverURL: url,
                configuration: NihonAPI.configuration,
                transport: URLSessionTransport(),
                middlewares: [NihonAPIVersionMiddleware(major: NihonAPIVersion.major + 1)]
            )
            let error = try await client.listExampleItems().badRequest.body.json.error
            #expect(error.code == "unsupported_api_version")
        }
    }
}

private func conformanceClient(_ url: URL) -> NihonAPIConformance.Client {
    NihonAPIConformance.Client(
        serverURL: url,
        configuration: NihonAPI.configuration,
        transport: URLSessionTransport(),
        middlewares: [NihonAPIVersionMiddleware()]
    )
}

private func date(_ text: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: text)
}

/// Starts the fixture server, passes its base URL to `body`, then stops it. The server also stops
/// when its standard input closes, so it never outlives the test process.
private func withFixtureServer(_ body: (URL) async throws -> Void) async throws {
    let repository = URL(filePath: #filePath)
        .deletingLastPathComponent()  // NihonAPIClientTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // swift
        .deletingLastPathComponent()  // contracts
        .deletingLastPathComponent()
    let process = Process()
    process.executableURL = URL(filePath: "/usr/bin/env")
    process.arguments = ["node", repository.appending(path: "apps/api/test/fixtures/serve.ts").path()]
    let input = Pipe()
    let output = Pipe()
    process.standardInput = input
    process.standardOutput = output
    try process.run()
    defer {
        try? input.fileHandleForWriting.close()
        process.waitUntilExit()
    }

    struct Listening: Decodable { let port: Int }
    guard let line = try await output.fileHandleForReading.bytes.lines.first(where: { _ in true }) else {
        throw FixtureServerError.exited(process.terminationStatus)
    }
    let port = try JSONDecoder().decode(Listening.self, from: Data(line.utf8)).port
    try await body(URL(string: "http://127.0.0.1:\(port)")!)
}

private enum FixtureServerError: Error {
    case exited(Int32)
}
