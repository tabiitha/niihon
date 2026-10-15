import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

extension HTTPField.Name {
    /// Contract major version declared by the client.
    public static let nihonAPIVersion = Self("Nihon-API-Version")!
    /// Correlation identifier echoed by the server and repeated in error bodies.
    public static let nihonRequestID = Self("Nihon-Request-Id")!
}

/// Declares the contract major version on every request; a server implementing another
/// major answers `400 unsupported_api_version`.
public struct NihonAPIVersionMiddleware: ClientMiddleware {
    public let major: Int

    public init(major: Int = NihonAPIVersion.major) {
        self.major = major
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        request.headerFields[.nihonAPIVersion] = String(major)
        return try await next(request, body, baseURL)
    }
}

public enum NihonAPI {
    /// Timestamps are UTC with millisecond precision (`2026-10-15T08:30:00.000Z`).
    public static let configuration = Configuration(dateTranscoder: .iso8601WithFractionalSeconds)

    /// A client of the local server, for example `http://127.0.0.1:4000`. Cancelling the calling
    /// task cancels its request.
    public static func makeClient(
        serverURL: URL,
        transport: any ClientTransport = URLSessionTransport()
    ) -> Client {
        Client(
            serverURL: serverURL,
            configuration: configuration,
            transport: transport,
            middlewares: [NihonAPIVersionMiddleware()]
        )
    }
}
