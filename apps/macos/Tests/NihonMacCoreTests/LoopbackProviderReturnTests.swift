import Foundation
import Network
import NihonMacCore
import Testing

private let listener = LoopbackProviderReturnListener()

private func get(_ address: String, _ query: String = "") async throws -> (status: Int, body: String, headers: [String: String]) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 5
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let (data, response) = try await session.data(from: URL(string: address + query)!)
    let http = try #require(response as? HTTPURLResponse)
    let headers = Dictionary(uniqueKeysWithValues: http.allHeaderFields.compactMap { key, value in
        (key as? String).flatMap { name in (value as? String).map { (name.lowercased(), $0) } }
    })
    return (http.statusCode, String(decoding: data, as: UTF8.self), headers)
}

private func inFlight(_ receiver: any ProviderReturnReceiving) -> Task<ProviderWait, Never> {
    Task { await receiver.wait(until: Date().addingTimeInterval(30)) }
}

@Suite("Receiving the provider's answer on a loopback port")
struct LoopbackProviderReturnTests {
    @Test("gives an http loopback address the service accepts as return address")
    func address() async throws {
        let receiver = try await listener.open(language: .en)
        defer { receiver.stop() }
        let url = try #require(URL(string: receiver.returnAddress))
        #expect(url.scheme == "http" && url.host() == "127.0.0.1" && url.path() == "/oauth/callback")
        #expect(url.port != nil && url.query() == nil)
    }

    @Test("takes the code and the state of the provider's answer, and answers with a page that echoes nothing")
    func codeAndState() async throws {
        let receiver = try await listener.open(language: .fr)
        receiver.expect(state: "state-1")
        let waiting = inFlight(receiver)
        let reply = try await get(receiver.returnAddress, "?code=the-secret-code&state=state-1")
        #expect(await waiting.value == .returned(.code(state: "state-1", code: "the-secret-code")))
        #expect(reply.status == 200)
        #expect(reply.body.contains(Language.fr.text(MacAccountsText.returnPageTitle)))
        #expect(!reply.body.contains("the-secret-code") && !reply.body.contains("state-1"))
        #expect(reply.headers["cache-control"] == "no-store")
        #expect(reply.headers["referrer-policy"] == "no-referrer")
    }

    @Test("reports a refusal of the provider with its state")
    func denied() async throws {
        let receiver = try await listener.open(language: .en)
        receiver.expect(state: "state-1")
        let waiting = inFlight(receiver)
        _ = try await get(receiver.returnAddress, "?error=access_denied&state=state-1")
        #expect(await waiting.value == .returned(.denied(state: "state-1")))
    }

    @Test("ignores other paths and incomplete answers, and keeps waiting for the real one")
    func strangers() async throws {
        let receiver = try await listener.open(language: .en)
        receiver.expect(state: "real")
        let waiting = inFlight(receiver)
        let base = receiver.returnAddress
        let other = base.replacing("/oauth/callback", with: "/favicon.ico")
        #expect(try await get(other).status == 404)
        #expect(try await get(base).status == 400)
        #expect(try await get(base, "?code=only-a-code").status == 400)
        #expect(try await get(base, "?state=only-a-state").status == 400)
        #expect(try await get(base, "?code=&state=s").status == 400)
        let tooLong = String(repeating: "a", count: 129)
        #expect(try await get(base, "?code=c&state=\(tooLong)").status == 400)
        #expect(try await get(base, "?error=access_denied").status == 400)
        _ = try await get(base, "?code=c&state=real")
        #expect(await waiting.value == .returned(.code(state: "real", code: "c")))
    }

    @Test("refuses an answer that does not carry the issued state, however well formed, and keeps waiting")
    func otherState() async throws {
        let receiver = try await listener.open(language: .en)
        receiver.expect(state: "issued")
        let waiting = inFlight(receiver)
        let base = receiver.returnAddress
        #expect(try await get(base, "?code=forged&state=other").status == 400)
        #expect(try await get(base, "?error=access_denied&state=other").status == 400)
        #expect(try await get(base, "?code=forged").status == 400)
        // Nothing of the refused requests ended the wait: the real answer still arrives.
        _ = try await get(base, "?code=real&state=issued")
        #expect(await waiting.value == .returned(.code(state: "issued", code: "real")))
    }

    @Test("refuses every answer until the issued state is known")
    func beforeTheStateIsKnown() async throws {
        let receiver = try await listener.open(language: .en)
        let waiting = inFlight(receiver)
        #expect(try await get(receiver.returnAddress, "?code=early&state=s").status == 400)
        receiver.expect(state: "s")
        _ = try await get(receiver.returnAddress, "?code=late&state=s")
        #expect(await waiting.value == .returned(.code(state: "s", code: "late")))
    }

    @Test("takes only the first answer, then stops listening")
    func singleUse() async throws {
        let receiver = try await listener.open(language: .en)
        receiver.expect(state: "s")
        let waiting = inFlight(receiver)
        _ = try await get(receiver.returnAddress, "?code=first&state=s")
        #expect(await waiting.value == .returned(.code(state: "s", code: "first")))
        await #expect(throws: (any Error).self) { _ = try await get(receiver.returnAddress, "?code=second&state=s") }
        #expect(await receiver.wait(until: Date().addingTimeInterval(5)) == .returned(.code(state: "s", code: "first")))
    }

    @Test("stops waiting on request, releasing the port")
    func stop() async throws {
        let receiver = try await listener.open(language: .en)
        let waiting = inFlight(receiver)
        receiver.stop()
        #expect(await waiting.value == .stopped)
        await #expect(throws: (any Error).self) { _ = try await get(receiver.returnAddress, "?code=c&state=s") }
    }

    @Test("stops waiting when the calling task is cancelled")
    func cancellation() async throws {
        let receiver = try await listener.open(language: .en)
        defer { receiver.stop() }
        let waiting = inFlight(receiver)
        try await Task.sleep(for: .milliseconds(50))
        waiting.cancel()
        #expect(await waiting.value == .stopped)
    }

    @Test("expires at the service's deadline")
    func expiry() async throws {
        let receiver = try await listener.open(language: .en)
        #expect(await receiver.wait(until: Date().addingTimeInterval(0.2)) == .expired)
        await #expect(throws: (any Error).self) { _ = try await get(receiver.returnAddress, "?code=c&state=s") }
    }

    @Test("survives a request that is too large or never ends, and still takes the real answer")
    func abuse() async throws {
        let receiver = try await listener.open(language: .en)
        receiver.expect(state: "real")
        let waiting = inFlight(receiver)
        let port = try #require(URL(string: receiver.returnAddress)?.port)
        // Garbage without a line end, larger than the limit: the connection is dropped.
        let junk = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(integerLiteral: UInt16(port)), using: .tcp)
        junk.start(queue: .global())
        junk.send(content: Data(repeating: 0x41, count: 20_000), completion: .contentProcessed { _ in })
        try await Task.sleep(for: .milliseconds(200))
        junk.cancel()
        _ = try await get(receiver.returnAddress, "?code=c&state=real")
        #expect(await waiting.value == .returned(.code(state: "real", code: "c")))
    }

    @Test("listens on the loopback interface only")
    func loopbackOnly() async throws {
        let receiver = try await listener.open(language: .en)
        defer { receiver.stop() }
        let port = try #require(URL(string: receiver.returnAddress)?.port)
        let addresses = Self.localIPv4Addresses().filter { !$0.hasPrefix("127.") }
        for address in addresses {
            let connection = NWConnection(host: NWEndpoint.Host(address), port: NWEndpoint.Port(integerLiteral: UInt16(port)), using: .tcp)
            let state = await Self.firstState(of: connection)
            #expect(state != .ready, "\(address):\(port) accepted a connection")
            connection.cancel()
        }
    }

    private static func firstState(of connection: NWConnection) async -> NWConnection.State? {
        await withCheckedContinuation { continuation in
            let once = NSLock()
            nonisolated(unsafe) var resumed = false
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready, .failed, .waiting:
                    once.lock(); defer { once.unlock() }
                    if !resumed { resumed = true; continuation.resume(returning: state) }
                default: break
                }
            }
            connection.start(queue: .global())
        }
    }

    private static func localIPv4Addresses() -> [String] {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return [] }
        defer { freeifaddrs(list) }
        var found: [String] = []
        for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
            guard let address = pointer.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
            found.append(String(cString: host))
        }
        return found
    }
}
