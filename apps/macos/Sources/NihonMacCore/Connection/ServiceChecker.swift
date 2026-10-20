import Foundation
import NihonAPIClient
import OpenAPIRuntime
import OpenAPIURLSession

/// The versions of a service that answered the health check with a compatible API.
public struct ServiceInfo: Equatable, Sendable {
    public let version: String
    public let apiVersion: String

    public init(version: String, apiVersion: String) {
        self.version = version
        self.apiVersion = apiVersion
    }
}

/// Why the service cannot be used, as the interface presents it; the same classification as the Web client.
public enum ServiceFailure: Error, Equatable, Sendable {
    /// No HTTP answer (stopped or unreachable service), 503 while stopping, or 502 or 504 from a relay.
    case unavailable
    /// The service implements another API major version than this client.
    case incompatible(serverAPIVersion: String?)
    /// Any other error answer; `requestID` locates it in the service log.
    case error(status: Int?, code: String?, requestID: String?)

    /// Classifies an error answer of the service.
    public static func classify(status: Int, code: String?, requestID: String?) -> ServiceFailure {
        if code == "unsupported_api_version" {
            return .incompatible(serverAPIVersion: nil)
        }
        if [502, 503, 504].contains(status) {
            return .unavailable
        }
        return .error(status: status, code: code, requestID: requestID)
    }
}

/// Checks that the local service answers and implements this client's API major version.
public protocol ServiceChecking: Sendable {
    /// Returns the outcome of one check. Throws `CancellationError` only, when the calling task is cancelled.
    func check() async throws -> Result<ServiceInfo, ServiceFailure>
}

/// Checks the service with `GET /api/health` through the client generated from the contract.
public struct ServiceChecker: ServiceChecking {
    private let client: any APIProtocol

    public init(client: any APIProtocol) {
        self.client = client
    }

    /// A checker of the service at `serviceURL`. The session is ephemeral: nothing is cached on disk.
    public init(serviceURL: URL) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = Self.requestTimeout
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration)
        self.init(client: NihonAPI.makeClient(
            serverURL: serviceURL,
            transport: URLSessionTransport(configuration: .init(session: session))
        ))
    }

    /// A local service answers in milliseconds; a longer silence means it is stuck or starting.
    public static let requestTimeout: TimeInterval = 10

    public func check() async throws -> Result<ServiceInfo, ServiceFailure> {
        let output: Operations.GetHealth.Output
        do {
            output = try await client.getHealth()
        } catch {
            if Task.isCancelled || Self.isCancellation(error) {
                throw CancellationError()
            }
            return .failure(Self.classify(transportError: error))
        }
        switch output {
        case .ok(let ok):
            guard case .json(let health) = ok.body else {
                return .failure(.error(status: 200, code: nil, requestID: nil))
            }
            guard Self.majorVersion(of: health.apiVersion) == NihonAPIVersion.major else {
                return .failure(.incompatible(serverAPIVersion: health.apiVersion))
            }
            return .success(ServiceInfo(version: health.version, apiVersion: health.apiVersion))
        case .default(let status, let response):
            let error = try? response.body.json.error
            return .failure(ServiceFailure.classify(status: status, code: error?.code, requestID: error?.requestId))
        }
    }

    static func majorVersion(of version: String) -> Int? {
        version.split(separator: ".").first.flatMap { Int($0) }
    }

    /// A request without an HTTP answer means an unavailable service; an answer that is not the
    /// documented JSON (another program on the port, for example) is an error.
    static func classify(transportError error: any Error) -> ServiceFailure {
        if let clientError = error as? ClientError {
            if let response = clientError.response {
                return .error(status: response.status.code, code: nil, requestID: response.headerFields[.nihonRequestID])
            }
            return clientError.underlyingError is URLError ? .unavailable : .error(status: nil, code: nil, requestID: nil)
        }
        return error is URLError ? .unavailable : .error(status: nil, code: nil, requestID: nil)
    }

    static func isCancellation(_ error: any Error) -> Bool {
        let underlying = (error as? ClientError)?.underlyingError ?? error
        return underlying is CancellationError || (underlying as? URLError)?.code == .cancelled
    }
}
