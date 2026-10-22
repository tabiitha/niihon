import Foundation
import HTTPTypes
import NihonAPIClient
import NihonMacCore
import OpenAPIRuntime
import Testing

/// The fake answers health only; any other operation of the contract is a test mistake.
struct UnexpectedOperationError: Error {}

/// A contract client whose health answer is chosen by the test.
struct FakeContractClient: APIProtocol {
    let answer: @Sendable () async throws -> Operations.GetHealth.Output

    func getHealth(_ input: Operations.GetHealth.Input) async throws -> Operations.GetHealth.Output {
        try await answer()
    }

    func registerLocalAccount(_ input: Operations.RegisterLocalAccount.Input) async throws
        -> Operations.RegisterLocalAccount.Output
    {
        throw UnexpectedOperationError()
    }

    func listOAuthProviders(_ input: Operations.ListOAuthProviders.Input) async throws
        -> Operations.ListOAuthProviders.Output
    {
        throw UnexpectedOperationError()
    }

    func startOAuthRegistration(_ input: Operations.StartOAuthRegistration.Input) async throws
        -> Operations.StartOAuthRegistration.Output
    {
        throw UnexpectedOperationError()
    }

    func completeOAuthRegistration(_ input: Operations.CompleteOAuthRegistration.Input) async throws
        -> Operations.CompleteOAuthRegistration.Output
    {
        throw UnexpectedOperationError()
    }

    func signIn(_ input: Operations.SignIn.Input) async throws
        -> Operations.SignIn.Output
    {
        throw UnexpectedOperationError()
    }

    func startOAuthSignIn(_ input: Operations.StartOAuthSignIn.Input) async throws
        -> Operations.StartOAuthSignIn.Output
    {
        throw UnexpectedOperationError()
    }

    func completeOAuthSignIn(_ input: Operations.CompleteOAuthSignIn.Input) async throws
        -> Operations.CompleteOAuthSignIn.Output
    {
        throw UnexpectedOperationError()
    }

    func getCurrentSession(_ input: Operations.GetCurrentSession.Input) async throws
        -> Operations.GetCurrentSession.Output
    {
        throw UnexpectedOperationError()
    }

    func signOut(_ input: Operations.SignOut.Input) async throws
        -> Operations.SignOut.Output
    {
        throw UnexpectedOperationError()
    }
}

func health(apiVersion: String = NihonAPIVersion.version) -> Operations.GetHealth.Output {
    .ok(.init(body: .json(.init(status: .ok, service: .nihonApi, version: "0.1.0", apiVersion: apiVersion))))
}

func errorAnswer(_ status: Int, code: String, requestID: String = "req-1") -> Operations.GetHealth.Output {
    .default(statusCode: status, .init(body: .json(.init(error: .init(code: code, message: "Test.", requestId: requestID)))))
}

private func check(_ answer: @escaping @Sendable () async throws -> Operations.GetHealth.Output) async throws
    -> Result<ServiceInfo, ServiceFailure>
{
    try await ServiceChecker(client: FakeContractClient(answer: answer)).check()
}

@Suite("Service check with a fake contract client")
struct ServiceCheckerTests {
    @Test("connects to a service of the same API major version")
    func compatible() async throws {
        let outcome = try await check { health(apiVersion: "\(NihonAPIVersion.major).7.2") }
        #expect(outcome == .success(ServiceInfo(version: "0.1.0", apiVersion: "\(NihonAPIVersion.major).7.2")))
    }

    @Test("reports an incompatible client when the service implements another major version")
    func incompatible() async throws {
        let other = "\(NihonAPIVersion.major + 1).0.0"
        #expect(try await check { health(apiVersion: other) } == .failure(.incompatible(serverAPIVersion: other)))
        #expect(try await check { errorAnswer(400, code: "unsupported_api_version") } == .failure(.incompatible(serverAPIVersion: nil)))
    }

    @Test("reports an unavailable service while it stops or behind a failing relay", arguments: [502, 503, 504])
    func stopping(status: Int) async throws {
        #expect(try await check { errorAnswer(status, code: "stopping") } == .failure(.unavailable))
    }

    @Test("reports other errors with their request identifier")
    func error() async throws {
        #expect(
            try await check { errorAnswer(500, code: "internal_error", requestID: "req-42") }
                == .failure(.error(status: 500, code: "internal_error", requestID: "req-42"))
        )
    }

    @Test("reports an unavailable service when no HTTP answer arrives")
    func noAnswer() async throws {
        let refused = ClientError(
            operationID: "getHealth", operationInput: (), causeDescription: "Transport failed.",
            underlyingError: URLError(.cannotConnectToHost)
        )
        #expect(try await check { throw refused } == .failure(.unavailable))
        #expect(try await check { throw URLError(.timedOut) } == .failure(.unavailable))
    }

    @Test("reports an error when another program answers with something else than the contract")
    func unexpectedAnswer() async throws {
        let unexpected = ClientError(
            operationID: "getHealth", operationInput: (), response: HTTPResponse(status: .notFound),
            causeDescription: "Unexpected content type.", underlyingError: CocoaError(.coderReadCorrupt)
        )
        #expect(try await check { throw unexpected } == .failure(.error(status: 404, code: nil, requestID: nil)))
    }

    @Test("throws only CancellationError when the request is cancelled")
    func cancelled() async {
        await #expect(throws: CancellationError.self) {
            try await check { throw URLError(.cancelled) }
        }
    }
}

@Suite("Service check against the real HTTP adapter")
struct LiveServiceCheckerTests {
    @Test("connects to a running service, then reports it unavailable once stopped")
    func runningThenStopped() async throws {
        var stoppedURL: URL?
        try await withFixtureServer { url in
            let outcome = try await ServiceChecker(serviceURL: url).check()
            guard case .success(let info) = outcome else {
                Issue.record("Expected a connection, received \(outcome)")
                return
            }
            #expect(info.apiVersion == NihonAPIVersion.version)
            #expect(info.version == "0.0.0-fixture")
            stoppedURL = url
        }
        let url = try #require(stoppedURL)
        #expect(try await ServiceChecker(serviceURL: url).check() == .failure(.unavailable))
    }
}

/// Starts the conformance fixture server (apps/api/test/fixtures/serve.ts), the real HTTP adapter of the
/// API, passes its base URL to `body`, then stops it. Requires Node.js 24 or newer on the PATH and
/// `bun install` at the repository root.
private func withFixtureServer(_ body: (URL) async throws -> Void) async throws {
    let repository = URL(filePath: #filePath)
        .deletingLastPathComponent()  // NihonMacCoreTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // macos
        .deletingLastPathComponent()  // apps
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
