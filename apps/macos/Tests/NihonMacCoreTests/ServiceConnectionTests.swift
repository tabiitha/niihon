import Foundation
import NihonMacCore
import Testing

/// A checker that counts its checks and answers each one when the test resumes it.
actor ControlledChecker: ServiceChecking {
    private(set) var checks = 0
    private var pending: [CheckedContinuation<Result<ServiceInfo, ServiceFailure>, Never>] = []

    nonisolated func check() async throws -> Result<ServiceInfo, ServiceFailure> {
        let outcome = await wait()
        try Task.checkCancellation()
        return outcome
    }

    private func wait() async -> Result<ServiceInfo, ServiceFailure> {
        checks += 1
        return await withCheckedContinuation { pending.append($0) }
    }

    var waiting: Int { pending.count }

    /// Answers the oldest pending check.
    func answer(_ outcome: Result<ServiceInfo, ServiceFailure>) {
        pending.removeFirst().resume(returning: outcome)
    }
}

private let info = ServiceInfo(version: "0.1.0", apiVersion: "1.0.0")

@MainActor
private func waitUntil(_ condition: () async -> Bool) async {
    for _ in 0..<500 where !(await condition()) {
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(2))
    }
}

@MainActor
@Suite("Window connection state")
struct ServiceConnectionTests {
    @Test("checks once, then shows the connected service")
    func connects() async {
        let checker = ControlledChecker()
        let connection = ServiceConnection(setting: nil) { _ in checker }
        #expect(connection.address == "http://127.0.0.1:4000")
        let task = Task { await connection.check() }
        await waitUntil { await checker.waiting == 1 }
        #expect(connection.state == .checking)
        await checker.answer(.success(info))
        await task.value
        #expect(connection.state == .connected(info))
        #expect(await checker.checks == 1)
        #expect(!connection.canRetry)
    }

    @Test("shows a failure and checks again only when asked to retry")
    func retries() async {
        let checker = ControlledChecker()
        let connection = ServiceConnection(setting: nil) { _ in checker }
        let first = Task { await connection.check() }
        await waitUntil { await checker.waiting == 1 }
        await checker.answer(.failure(.unavailable))
        await first.value
        #expect(connection.state == .failed(.unavailable))
        #expect(connection.canRetry)

        connection.retry()
        #expect(connection.attempt == 1)
        let second = Task { await connection.check() }
        await waitUntil { await checker.waiting == 1 }
        #expect(connection.state == .checking)
        await checker.answer(.success(info))
        await second.value
        #expect(connection.state == .connected(info))
        #expect(await checker.checks == 2)
    }

    @Test("ignores the late answer of a check replaced by a retry")
    func ignoresLateAnswer() async {
        let checker = ControlledChecker()
        let connection = ServiceConnection(setting: nil) { _ in checker }
        let stale = Task { await connection.check() }
        await waitUntil { await checker.waiting == 1 }
        connection.retry()
        stale.cancel()
        let fresh = Task { await connection.check() }
        await waitUntil { await checker.waiting == 2 }
        await checker.answer(.failure(.error(status: 500, code: nil, requestID: nil)))
        await stale.value
        #expect(connection.state == .checking)
        await checker.answer(.success(info))
        await fresh.value
        #expect(connection.state == .connected(info))
    }

    @Test("ignores the answer of a check cancelled with its window")
    func cancelledWithWindow() async {
        let checker = ControlledChecker()
        let connection = ServiceConnection(setting: nil) { _ in checker }
        let task = Task { await connection.check() }
        await waitUntil { await checker.waiting == 1 }
        task.cancel()
        await checker.answer(.success(info))
        await task.value
        #expect(connection.state == .checking)
    }

    @Test("sends no request when the address setting is not a loopback address")
    func invalidAddress() async {
        var built = 0
        let connection = ServiceConnection(setting: "http://nihon.local:4000") { _ in
            built += 1
            return ControlledChecker()
        }
        #expect(built == 0)
        #expect(connection.state == .invalidAddress(setting: "http://nihon.local:4000"))
        await connection.check()
        connection.retry()
        #expect(connection.attempt == 0)
        #expect(connection.state == .invalidAddress(setting: "http://nihon.local:4000"))
        #expect(!connection.canRetry)
    }

    @Test("connects to the configured loopback address")
    func configuredAddress() {
        var requested: URL?
        let connection = ServiceConnection(setting: "http://127.0.0.1:4100") { url in
            requested = url
            return ControlledChecker()
        }
        #expect(requested == URL(string: "http://127.0.0.1:4100"))
        #expect(connection.address == "http://127.0.0.1:4100")
    }
}
