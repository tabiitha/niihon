import Foundation
import Observation

/// The connection state of one window. It only reads the service: it never starts a service, stores
/// business data, or opens a database; closing the window ends its pending check without affecting the
/// service.
@MainActor
@Observable
public final class ServiceConnection {
    public enum State: Equatable, Sendable {
        case checking
        case connected(ServiceInfo)
        case failed(ServiceFailure)
        /// The `NihonServiceURL` setting is not a loopback address; no request is sent.
        case invalidAddress(setting: String)
    }

    public private(set) var state: State = .checking
    /// Increases on every retry; the window runs `check()` once per value, cancelling the previous check.
    public private(set) var attempt = 0
    /// The service address, for display.
    public let address: String

    private let checker: (any ServiceChecking)?

    /// - Parameters:
    ///   - setting: the `NihonServiceURL` setting, or `nil` for the default address.
    ///   - makeChecker: builds the checker of a valid address; tests inject a fake contract client here.
    public init(
        setting: String?,
        makeChecker: (URL) -> any ServiceChecking = { ServiceChecker(serviceURL: $0) }
    ) {
        if let url = ServiceAddress.resolve(setting: setting) {
            address = url.absoluteString
            checker = makeChecker(url)
        } else {
            let setting = setting ?? ""
            address = setting
            checker = nil
            state = .invalidAddress(setting: setting)
        }
    }

    public var canRetry: Bool {
        switch state {
        case .failed: true
        case .checking, .connected, .invalidAddress: false
        }
    }

    /// Requests a new check; the window cancels the pending one and runs `check()` again.
    public func retry() {
        guard checker != nil else { return }
        attempt += 1
    }

    /// Runs one check and publishes its outcome. When the calling task is cancelled (the window closed or a
    /// retry started), or a newer attempt began meanwhile, the late outcome is ignored.
    public func check() async {
        guard let checker else { return }
        let attempt = attempt
        state = .checking
        let outcome: Result<ServiceInfo, ServiceFailure>
        do {
            outcome = try await checker.check()
        } catch {
            return
        }
        guard !Task.isCancelled, attempt == self.attempt else { return }
        switch outcome {
        case .success(let info): state = .connected(info)
        case .failure(let failure): state = .failed(failure)
        }
    }
}
