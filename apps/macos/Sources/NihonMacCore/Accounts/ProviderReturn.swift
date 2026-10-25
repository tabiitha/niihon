import Foundation

/// What the provider's page sent back to the address Nihon gave it.
public enum ProviderReturn: Equatable, Sendable {
    case code(state: String, code: String)
    /// The person refused, or the provider reported an error; `state` is `nil` when it did not return one.
    case denied(state: String?)
}

/// How waiting for the provider's page ended.
public enum ProviderWait: Equatable, Sendable {
    case returned(ProviderReturn)
    /// The waiting was stopped: the provider's window was closed, the person cancelled, or the form was left.
    case stopped
    /// The service's deadline for the flow passed without an answer.
    case expired
}

/// One attempt to receive the provider's answer: an address to give the service, then a single wait.
public protocol ProviderReturnReceiving: Sendable {
    /// The `http` loopback address of this attempt, which the service accepts as `redirectUri`.
    var returnAddress: String { get }
    /// Waits for the answer until `deadline`. Cancelling the calling task stops the wait.
    func wait(until deadline: Date) async -> ProviderWait
    /// Stops waiting and releases the address. Safe to call at any time and more than once.
    func stop()
}

public protocol ProviderReturnListening: Sendable {
    /// Prepares a new attempt. Throws when the Mac cannot receive an answer, for example because the sandbox
    /// lacks the permission to listen.
    func open(language: Language) async throws -> any ProviderReturnReceiving
}

/// The window that shows the provider's page to the person. It only displays; Nihon never sees what is typed
/// there.
@MainActor
public protocol AuthorizationPagePresenting {
    /// Shows `url`. `closed` runs if the person closes the window before `dismiss()`.
    func present(_ url: URL, closed: @escaping @MainActor @Sendable () -> Void)
    func dismiss()
}

/// The provider page to open, or `nil` when the address is not a web address.
public func webAddress(_ address: String) -> URL? {
    guard
        let url = URL(string: address), let scheme = url.scheme?.lowercased(),
        scheme == "https" || scheme == "http", url.host() != nil
    else {
        return nil
    }
    return url
}
