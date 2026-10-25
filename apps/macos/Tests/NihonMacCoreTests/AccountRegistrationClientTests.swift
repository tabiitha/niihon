import Foundation
import HTTPTypes
import NihonAPIClient
import NihonMacCore
import OpenAPIRuntime
import Testing

private func errorBody(_ code: String, requestID: String = "req-1", fields: [String] = []) -> Components.Schemas.ErrorResponse {
    .init(error: .init(
        code: code, message: "English text for developers.", requestId: requestID,
        issues: fields.isEmpty ? nil : fields.map { .init(path: $0, message: "x") }
    ))
}

private func created() -> Components.Schemas.Profile {
    .init(id: "p-1", username: "sakura", role: "user", registeredWith: "local", createdAt: Date(timeIntervalSince1970: 1_800_000_000))
}

private func client(_ configure: (inout FakeContractClient) -> Void) -> AccountRegistrationClient {
    var fake = FakeContractClient(answer: { throw UnexpectedOperationError() })
    configure(&fake)
    return AccountRegistrationClient(client: fake)
}

private func register(_ client: AccountRegistrationClient, key: String? = "key-1") async throws
    -> Result<RegisteredProfile, RegistrationFailure>
{
    try await client.registerLocal(username: "sakura", password: "correct-horse", idempotencyKey: key)
}

/// Remembers what the adapter sent.
private final class Sent: @unchecked Sendable {
    private let lock = NSLock()
    private var inputs: [Operations.RegisterLocalAccount.Input] = []
    func add(_ input: Operations.RegisterLocalAccount.Input) { lock.lock(); inputs.append(input); lock.unlock() }
    var all: [Operations.RegisterLocalAccount.Input] { lock.lock(); defer { lock.unlock() }; return inputs }
}

@Suite("Registration through a fake contract client")
struct AccountRegistrationClientTests {
    @Test("sends the credentials and the idempotency key, and returns the created profile")
    func created_() async throws {
        let sent = Sent()
        let registration = client {
            $0.registerLocal = { (input: Operations.RegisterLocalAccount.Input) -> Operations.RegisterLocalAccount.Output in
                sent.add(input)
                return .created(.init(body: .json(created())))
            }
        }
        #expect(try await register(registration) == .success(RegisteredProfile(id: "p-1", username: "sakura")))
        #expect(try await register(registration, key: nil) == .success(RegisteredProfile(id: "p-1", username: "sakura")))
        let inputs = sent.all
        #expect(inputs.map(\.headers.idempotencyKey) == ["key-1", nil])
        guard case .json(let body) = inputs[0].body else {
            Issue.record("Expected a JSON body")
            return
        }
        #expect(body.username == "sakura" && body.password == "correct-horse")
    }

    @Test("reports the stable code, the request identifier, and the invalid fields of each refusal")
    func refusals() async throws {
        let taken = client { $0.registerLocal = { _ in .conflict(.init(body: .json(errorBody("accounts_username_taken", requestID: "req-7")))) } }
        #expect(try await register(taken) == .failure(.error(status: 409, code: "accounts_username_taken", requestID: "req-7", fields: [])))

        let invalid = client { $0.registerLocal = { _ in .badRequest(.init(body: .json(errorBody("validation_failed", fields: ["body.password"])))) } }
        #expect(try await register(invalid) == .failure(.error(status: 400, code: "validation_failed", requestID: "req-1", fields: ["body.password"])))

        let large = client { $0.registerLocal = { _ in .contentTooLarge(.init(body: .json(errorBody("payload_too_large")))) } }
        #expect(try await register(large) == .failure(.error(status: 413, code: "payload_too_large", requestID: "req-1", fields: [])))

        let other = client { $0.registerLocal = { _ in .default(statusCode: 500, .init(body: .json(errorBody("internal_error")))) } }
        #expect(try await register(other) == .failure(.error(status: 500, code: "internal_error", requestID: "req-1", fields: [])))
    }

    @Test("does not take a service that answered 502 or 503 with a known code for a stopped service")
    func answeringService() async throws {
        let busy = client { $0.registerLocal = { _ in .serviceUnavailable(.init(body: .json(errorBody("accounts_busy")))) } }
        #expect(try await register(busy) == .failure(.error(status: 503, code: "accounts_busy", requestID: "req-1", fields: [])))

        let stopping = client { $0.registerLocal = { _ in .serviceUnavailable(.init(body: .json(errorBody("stopping")))) } }
        #expect(try await register(stopping) == .failure(.unavailable))

        let providerFailed = client {
            $0.completeRegistration = { _ in .badGateway(.init(body: .json(errorBody("accounts_oauth_provider_failed")))) }
        }
        #expect(try await providerFailed.completeProvider(state: "s", code: "c", idempotencyKey: "k")
            == .failure(.error(status: 502, code: "accounts_oauth_provider_failed", requestID: "req-1", fields: [])))
    }

    @Test("reports an incompatible client")
    func incompatible() async throws {
        let other = client { $0.registerLocal = { _ in .badRequest(.init(body: .json(errorBody("unsupported_api_version")))) } }
        #expect(try await register(other) == .failure(.incompatible))
    }

    @Test("reports an unavailable service when no HTTP answer arrives or a relay fails")
    func unavailable() async throws {
        let refused = ClientError(
            operationID: "registerLocalAccount", operationInput: (), causeDescription: "Transport failed.",
            underlyingError: URLError(.cannotConnectToHost)
        )
        #expect(try await register(client { $0.registerLocal = { _ in throw refused } }) == .failure(.unavailable))
        #expect(try await register(client { $0.registerLocal = { _ in throw URLError(.timedOut) } }) == .failure(.unavailable))
        let relay = ClientError(
            operationID: "registerLocalAccount", operationInput: (), response: HTTPResponse(status: .badGateway),
            causeDescription: "Not JSON.", underlyingError: DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "x"))
        )
        #expect(try await register(client { $0.registerLocal = { _ in throw relay } }) == .failure(.unavailable))
    }

    @Test("reports an error when another program answers with something else than the contract")
    func unexpectedAnswer() async throws {
        let html = ClientError(
            operationID: "registerLocalAccount", operationInput: (), response: HTTPResponse(status: .notFound),
            causeDescription: "Not JSON.", underlyingError: DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "x"))
        )
        #expect(try await register(client { $0.registerLocal = { _ in throw html } })
            == .failure(.error(status: 404, code: nil, requestID: nil, fields: [])))
    }

    @Test("lets a cancelled task through instead of reporting a failure")
    func cancelled() async {
        let registration = client { $0.registerLocal = { _ in throw CancellationError() } }
        await #expect(throws: CancellationError.self) { _ = try await register(registration) }
        let urlCancelled = client { $0.listProviders = { _ in throw URLError(.cancelled) } }
        await #expect(throws: CancellationError.self) { _ = try await urlCancelled.providers() }
    }

    @Test("reads the offered providers and the start of a provider registration")
    func providers() async throws {
        let registration = client {
            $0.listProviders = { _ in .ok(.init(body: .json(.init(items: [.init(id: "google"), .init(id: "github")])))) }
            $0.startRegistration = { input in
                guard case .json(let body) = input.body, body.redirectUri == "http://127.0.0.1:5/oauth/callback" else { throw UnexpectedOperationError() }
                return .created(.init(body: .json(.init(
                    authorizationUrl: "https://provider.example/a", state: "s-1", expiresAt: Date(timeIntervalSince1970: 1_800_000_000)
                ))))
            }
        }
        #expect(try await registration.providers() == .success(["google", "github"]))
        #expect(try await registration.startProvider("github", username: "sakura", returnAddress: "http://127.0.0.1:5/oauth/callback")
            == .success(ProviderStart(authorizationURL: "https://provider.example/a", state: "s-1", expiresAt: Date(timeIntervalSince1970: 1_800_000_000))))
    }
}
