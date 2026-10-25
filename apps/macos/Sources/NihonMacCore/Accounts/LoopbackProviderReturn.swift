import Foundation
import Network

/// Receives the provider's answer on a loopback port of this Mac, the return address that the service accepts
/// for a native client. It listens on `127.0.0.1` only, serves one tiny page, takes the first valid answer and
/// closes; nothing it reads is logged or stored.
public struct LoopbackProviderReturnListener: ProviderReturnListening {
    /// The path the provider returns to.
    public static let path = "/oauth/callback"

    public init() {}

    public func open(language: Language) async throws -> any ProviderReturnReceiving {
        try await LoopbackReceiver.open(language: language)
    }
}

/// One attempt. Its state is guarded by a lock because Network.framework calls back on its own queue.
final class LoopbackReceiver: ProviderReturnReceiving, @unchecked Sendable {
    /// A request line and headers longer than this are refused.
    static let maximumRequestBytes = 8192
    /// A connection that has not sent a full request after this long is dropped.
    static let connectionTimeout: TimeInterval = 5
    /// Connections served at the same time; the provider's browser needs one.
    static let maximumConnections = 8

    let returnAddress: String
    private let listener: NWListener
    private let queue = DispatchQueue(label: "nihon.oauth-return")
    private let language: Language
    private let lock = NSLock()
    private var outcome: ProviderWait?
    private var waiter: CheckedContinuation<ProviderWait, Never>?
    private var connections = 0

    private init(listener: NWListener, port: UInt16, language: Language) {
        self.listener = listener
        self.language = language
        returnAddress = "http://127.0.0.1:\(port)\(LoopbackProviderReturnListener.path)"
    }

    static func open(language: Language) async throws -> LoopbackReceiver {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        let listener = try NWListener(using: parameters)
        let queue = DispatchQueue(label: "nihon.oauth-return.start")
        let port: UInt16 = try await withCheckedThrowingContinuation { continuation in
            let once = Once()
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if once.first() {
                        if let port = listener.port?.rawValue {
                            continuation.resume(returning: port)
                        } else {
                            continuation.resume(throwing: ListenerError.noPort)
                        }
                    }
                case .failed(let error):
                    if once.first() { continuation.resume(throwing: error) }
                case .cancelled:
                    if once.first() { continuation.resume(throwing: ListenerError.cancelled) }
                default:
                    break
                }
            }
            listener.newConnectionHandler = { $0.cancel() }
            listener.start(queue: queue)
        }
        let receiver = LoopbackReceiver(listener: listener, port: port, language: language)
        listener.newConnectionHandler = { [weak receiver] connection in receiver?.accept(connection) }
        listener.stateUpdateHandler = { [weak receiver] state in
            if case .failed = state { receiver?.finish(.stopped) }
        }
        listener.start(queue: receiver.queue)
        return receiver
    }

    func wait(until deadline: Date) async -> ProviderWait {
        let timer = Task { [weak self] in
            try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow)))
            self?.finish(.expired)
        }
        defer { timer.cancel() }
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                lock.lock()
                if let outcome {
                    lock.unlock()
                    continuation.resume(returning: outcome)
                } else {
                    waiter = continuation
                    lock.unlock()
                }
            }
        } onCancel: {
            finish(.stopped)
        }
    }

    func stop() {
        finish(.stopped)
    }

    /// Records the first outcome, wakes the waiter, and stops listening.
    private func finish(_ result: ProviderWait) {
        lock.lock()
        guard outcome == nil else {
            lock.unlock()
            return
        }
        outcome = result
        let continuation = waiter
        waiter = nil
        lock.unlock()
        listener.cancel()
        continuation?.resume(returning: result)
    }

    private func accept(_ connection: NWConnection) {
        lock.lock()
        let allowed = outcome == nil && connections < Self.maximumConnections
        if allowed { connections += 1 }
        lock.unlock()
        guard allowed else {
            connection.cancel()
            return
        }
        let reader = RequestReader(connection: connection, queue: queue) { [weak self] request in
            self?.handle(request) ?? .refuse(.notFound)
        } done: { [weak self] in
            self?.release()
        }
        reader.start()
    }

    private func release() {
        lock.lock()
        connections -= 1
        lock.unlock()
    }

    /// Chooses the reply and, for a valid answer, finishes the wait.
    private func handle(_ requestLine: String) -> Reply {
        let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count == 3, parts[0] == "GET", let components = URLComponents(string: "http://127.0.0.1" + parts[1]),
              components.path == LoopbackProviderReturnListener.path
        else {
            return .refuse(.notFound)
        }
        let items = components.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        let state = value("state").flatMap { $0.isEmpty || $0.count > 128 ? nil : $0 }
        let answer: ProviderReturn
        if items.contains(where: { $0.name == "error" }) {
            answer = .denied(state: state)
        } else if let state, let code = value("code"), !code.isEmpty, code.count <= 2048 {
            answer = .code(state: state, code: code)
        } else {
            return .refuse(.badRequest)
        }
        finish(.returned(answer))
        return .page(language)
    }

    enum ListenerError: Error {
        case noPort
        case cancelled
    }
}

/// Runs a block the first time only; the listener reports several states.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var used = false

    func first() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if used { return false }
        used = true
        return true
    }
}

enum Reply {
    enum Refusal {
        case notFound
        case badRequest
    }
    case refuse(Refusal)
    case page(Language)

    var bytes: Data {
        switch self {
        case .refuse(.notFound): Reply.response(status: "404 Not Found", body: "")
        case .refuse(.badRequest): Reply.response(status: "400 Bad Request", body: "")
        case .page(let language):
            Reply.response(status: "200 OK", body: """
                <!doctype html><html lang="\(language.rawValue)"><head><meta charset="utf-8">\
                <title>\(language.text(MacAccountsText.returnPageTitle))</title></head>\
                <body style="font-family:-apple-system,sans-serif;text-align:center;margin-top:20vh">\
                <h1>\(language.text(MacAccountsText.returnPageTitle))</h1>\
                <p>\(language.text(MacAccountsText.returnPageBody))</p></body></html>
                """)
        }
    }

    private static func response(status: String, body: String) -> Data {
        let content = Data(body.utf8)
        let head = [
            "HTTP/1.1 \(status)",
            "Content-Type: text/html; charset=utf-8",
            "Content-Length: \(content.count)",
            "Cache-Control: no-store",
            "Referrer-Policy: no-referrer",
            "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'",
            "Connection: close",
            "", "",
        ].joined(separator: "\r\n")
        return Data(head.utf8) + content
    }
}

/// Reads the head of one request, hands its request line to `reply`, answers, and closes.
private final class RequestReader: @unchecked Sendable {
    private let connection: NWConnection
    private let queue: DispatchQueue
    private let reply: @Sendable (String) -> Reply
    private let done: @Sendable () -> Void
    private var buffer = Data()
    private var finished = false

    init(
        connection: NWConnection, queue: DispatchQueue,
        reply: @escaping @Sendable (String) -> Reply, done: @escaping @Sendable () -> Void
    ) {
        self.connection = connection
        self.queue = queue
        self.reply = reply
        self.done = done
    }

    func start() {
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + LoopbackReceiver.connectionTimeout) { [self] in end() }
        receive()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 2048) { [self] data, _, isComplete, error in
            guard !finished else { return }
            if let data { buffer.append(data) }
            if let range = buffer.range(of: Data("\r\n".utf8)) {
                // Only the request line matters; the rest of the head is not read further.
                let line = String(decoding: buffer[buffer.startIndex..<range.lowerBound], as: UTF8.self)
                send(reply(line))
            } else if buffer.count > LoopbackReceiver.maximumRequestBytes || error != nil || isComplete {
                end()
            } else {
                receive()
            }
        }
    }

    private func send(_ reply: Reply) {
        connection.send(content: reply.bytes, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [self] _ in
            end()
        })
    }

    private func end() {
        guard !finished else { return }
        finished = true
        connection.cancel()
        done()
    }
}
