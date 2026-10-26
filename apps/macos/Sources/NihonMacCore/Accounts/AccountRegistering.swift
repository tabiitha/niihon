import Foundation
import HTTPTypes
import NihonAPIClient
import OpenAPIRuntime
import OpenAPIURLSession

/// The profile the service created.
public struct RegisteredProfile: Equatable, Sendable {
    public let id: String
    public let username: String

    public init(id: String, username: String) {
        self.id = id
        self.username = username
    }
}

/// A provider registration waiting for the browser to return.
public struct ProviderStart: Equatable, Sendable {
    public let authorizationURL: String
    public let state: String
    public let expiresAt: Date

    public init(authorizationURL: String, state: String, expiresAt: Date) {
        self.authorizationURL = authorizationURL
        self.state = state
        self.expiresAt = expiresAt
    }
}

/// The registration operations of the contract. They carry what the person typed to the service and return its
/// answer; every rule (username, password, uniqueness, roles, providers) is decided by the service. Each method
/// throws `CancellationError` only, when the calling task is cancelled.
public protocol AccountRegistering: Sendable {
    /// `idempotencyKey` is `nil` when the service asked for the command without a key.
    func registerLocal(username: String, password: String, idempotencyKey: String?) async throws
        -> Result<RegisteredProfile, RegistrationFailure>
    /// The providers this installation offers; empty when it has none or is offline.
    func providers() async throws -> Result<[String], RegistrationFailure>
    func startProvider(_ provider: String, username: String, returnAddress: String) async throws
        -> Result<ProviderStart, RegistrationFailure>
    func completeProvider(state: String, code: String, idempotencyKey: String?) async throws
        -> Result<RegisteredProfile, RegistrationFailure>
}

/// Registers accounts through the client generated from the contract.
public struct AccountRegistrationClient: AccountRegistering {
    private let client: any APIProtocol
    /// Ends the session this client created when the client goes away.
    private let session: SessionOwner?

    public init(client: any APIProtocol) {
        self.init(client: client, session: nil)
    }

    private init(client: any APIProtocol, session: SessionOwner?) {
        self.client = client
        self.session = session
    }

    /// Holds a `URLSession` and invalidates it once nothing uses it any longer; running requests finish first.
    private final class SessionOwner: Sendable {
        let session: URLSession

        init(_ session: URLSession) {
            self.session = session
        }

        deinit {
            session.finishTasksAndInvalidate()
        }
    }

    /// A client of the service at `serviceURL`. The session is ephemeral: nothing is cached on disk.
    public init(serviceURL: URL) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.requestTimeout
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration)
        self.init(
            client: NihonAPI.makeClient(
                serverURL: serviceURL,
                transport: URLSessionTransport(configuration: .init(session: session))
            ),
            session: SessionOwner(session)
        )
    }

    /// Hashing a password and exchanging a code with a provider take longer than a health check.
    public static let requestTimeout: TimeInterval = 30

    public func registerLocal(username: String, password: String, idempotencyKey: String?) async throws
        -> Result<RegisteredProfile, RegistrationFailure>
    {
        try await perform {
            let output = try await client.registerLocalAccount(.init(
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(.init(username: username, password: password))
            ))
            switch output {
            case .created(let created): return .success(try created.body.json.registered)
            case .badRequest(let r): return Self.failure(400) { try r.body.json }
            case .conflict(let r): return Self.failure(409) { try r.body.json }
            case .contentTooLarge(let r): return Self.failure(413) { try r.body.json }
            case .unsupportedMediaType(let r): return Self.failure(415) { try r.body.json }
            case .unprocessableContent(let r): return Self.failure(422) { try r.body.json }
            case .serviceUnavailable(let r): return Self.failure(503) { try r.body.json }
            case .default(let status, let r): return Self.failure(status) { try r.body.json }
            }
        }
    }

    public func providers() async throws -> Result<[String], RegistrationFailure> {
        try await perform {
            switch try await client.listOAuthProviders(.init()) {
            case .ok(let ok): return .success(try ok.body.json.items.map(\.id))
            case .badRequest(let r): return Self.failure(400) { try r.body.json }
            case .default(let status, let r): return Self.failure(status) { try r.body.json }
            }
        }
    }

    public func startProvider(_ provider: String, username: String, returnAddress: String) async throws
        -> Result<ProviderStart, RegistrationFailure>
    {
        try await perform {
            let output = try await client.startOAuthRegistration(.init(
                body: .json(.init(provider: provider, username: username, redirectUri: returnAddress))
            ))
            switch output {
            case .created(let created):
                let started = try created.body.json
                return .success(ProviderStart(
                    authorizationURL: started.authorizationUrl, state: started.state, expiresAt: started.expiresAt
                ))
            case .badRequest(let r): return Self.failure(400) { try r.body.json }
            case .conflict(let r): return Self.failure(409) { try r.body.json }
            case .contentTooLarge(let r): return Self.failure(413) { try r.body.json }
            case .unsupportedMediaType(let r): return Self.failure(415) { try r.body.json }
            case .unprocessableContent(let r): return Self.failure(422) { try r.body.json }
            case .serviceUnavailable(let r): return Self.failure(503) { try r.body.json }
            case .default(let status, let r): return Self.failure(status) { try r.body.json }
            }
        }
    }

    public func completeProvider(state: String, code: String, idempotencyKey: String?) async throws
        -> Result<RegisteredProfile, RegistrationFailure>
    {
        try await perform {
            let output = try await client.completeOAuthRegistration(.init(
                headers: .init(idempotencyKey: idempotencyKey),
                body: .json(.init(state: state, code: code))
            ))
            switch output {
            case .created(let created): return .success(try created.body.json.registered)
            case .badRequest(let r): return Self.failure(400) { try r.body.json }
            case .conflict(let r): return Self.failure(409) { try r.body.json }
            case .contentTooLarge(let r): return Self.failure(413) { try r.body.json }
            case .unsupportedMediaType(let r): return Self.failure(415) { try r.body.json }
            case .unprocessableContent(let r): return Self.failure(422) { try r.body.json }
            case .badGateway(let r): return Self.failure(502) { try r.body.json }
            case .serviceUnavailable(let r): return Self.failure(503) { try r.body.json }
            case .default(let status, let r): return Self.failure(status) { try r.body.json }
            }
        }
    }

    /// Runs one call and turns a transport failure into a `RegistrationFailure`.
    private func perform<Value: Sendable>(_ call: () async throws -> Result<Value, RegistrationFailure>) async throws
        -> Result<Value, RegistrationFailure>
    {
        do {
            return try await call()
        } catch {
            if Task.isCancelled || ServiceChecker.isCancellation(error) {
                throw CancellationError()
            }
            return .failure(RegistrationFailure.classify(transportError: error))
        }
    }

    private static func failure<Value>(
        _ status: Int, _ body: () throws -> Components.Schemas.ErrorResponse
    ) -> Result<Value, RegistrationFailure> {
        // An answer whose body is not the documented error JSON still has a status.
        let error = try? body().error
        return .failure(RegistrationFailure.classify(
            status: status, code: error?.code, requestID: error?.requestId, fields: error?.issues?.map(\.path) ?? []
        ))
    }
}

extension Components.Schemas.Profile {
    fileprivate var registered: RegisteredProfile {
        RegisteredProfile(id: id, username: username)
    }
}
