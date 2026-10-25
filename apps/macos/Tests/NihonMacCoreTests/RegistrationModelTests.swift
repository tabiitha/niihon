import Foundation
import NihonMacCore
import Testing

// MARK: Fakes

/// A registration service that answers each call when the test resumes it, and records what it received.
actor ScriptedRegistration: AccountRegistering {
    struct Local: Equatable { let username: String; let password: String; let key: String? }
    struct Completion: Equatable { let state: String; let code: String; let key: String? }
    typealias Created = Result<RegisteredProfile, RegistrationFailure>

    private(set) var locals: [Local] = []
    private(set) var starts: [(provider: String, username: String, returnAddress: String)] = []
    private(set) var completions: [Completion] = []
    private var pendingLocal: [CheckedContinuation<Created, Never>] = []
    private var pendingStart: [CheckedContinuation<Result<ProviderStart, RegistrationFailure>, Never>] = []
    private var pendingCompletion: [CheckedContinuation<Created, Never>] = []
    var offered: Result<[String], RegistrationFailure> = .success([])

    func offer(_ result: Result<[String], RegistrationFailure>) { offered = result }

    func registerLocal(username: String, password: String, idempotencyKey: String?) async throws -> Created {
        locals.append(Local(username: username, password: password, key: idempotencyKey))
        return await withCheckedContinuation { pendingLocal.append($0) }
    }

    func providers() async throws -> Result<[String], RegistrationFailure> {
        offered
    }

    func startProvider(_ provider: String, username: String, returnAddress: String) async throws
        -> Result<ProviderStart, RegistrationFailure>
    {
        starts.append((provider, username, returnAddress))
        return await withCheckedContinuation { pendingStart.append($0) }
    }

    func completeProvider(state: String, code: String, idempotencyKey: String?) async throws -> Created {
        completions.append(Completion(state: state, code: code, key: idempotencyKey))
        return await withCheckedContinuation { pendingCompletion.append($0) }
    }

    var waitingLocal: Int { pendingLocal.count }
    var waitingStart: Int { pendingStart.count }
    var waitingCompletion: Int { pendingCompletion.count }
    func answerLocal(_ result: Created) { pendingLocal.removeFirst().resume(returning: result) }
    func answerStart(_ result: Result<ProviderStart, RegistrationFailure>) { pendingStart.removeFirst().resume(returning: result) }
    func answerCompletion(_ result: Created) { pendingCompletion.removeFirst().resume(returning: result) }
}

/// A return address whose answer the test chooses.
final class ScriptedReceiver: ProviderReturnReceiving, @unchecked Sendable {
    let returnAddress = "http://127.0.0.1:49152/oauth/callback"
    private let lock = NSLock()
    private var outcome: ProviderWait?
    private var waiter: CheckedContinuation<ProviderWait, Never>?
    private(set) var stops = 0

    func wait(until deadline: Date) async -> ProviderWait {
        await withCheckedContinuation { continuation in
            lock.lock()
            if let outcome { lock.unlock(); continuation.resume(returning: outcome) } else { waiter = continuation; lock.unlock() }
        }
    }

    func stop() {
        lock.lock(); stops += 1; lock.unlock()
        deliver(.stopped)
    }

    func deliver(_ result: ProviderWait) {
        lock.lock()
        guard outcome == nil else { lock.unlock(); return }
        outcome = result
        let continuation = waiter
        waiter = nil
        lock.unlock()
        continuation?.resume(returning: result)
    }
}

struct ScriptedListener: ProviderReturnListening {
    let receiver: ScriptedReceiver
    var fails = false

    func open(language: Language) async throws -> any ProviderReturnReceiving {
        if fails { throw URLError(.cannotConnectToHost) }
        return receiver
    }
}

@MainActor
final class RecordingPresenter: AuthorizationPagePresenting {
    private(set) var presented: [URL] = []
    private(set) var dismissals = 0
    private var closed: (@MainActor @Sendable () -> Void)?

    func present(_ url: URL, closed: @escaping @MainActor @Sendable () -> Void) {
        presented.append(url)
        self.closed = closed
    }

    func dismiss() { dismissals += 1 }
    func personClosesTheWindow() { closed?() }
}

// MARK: Helpers

private let profile = RegisteredProfile(id: "p-1", username: "sakura")
private let taken = RegistrationFailure.error(status: 409, code: "accounts_username_taken", requestID: "req-9", fields: [])
private func start(_ state: String = "state-1") -> ProviderStart {
    ProviderStart(authorizationURL: "https://provider.example/authorize?x=1", state: state, expiresAt: Date().addingTimeInterval(600))
}

@MainActor
private func waitUntil(_ condition: () async -> Bool) async {
    for _ in 0..<1000 where !(await condition()) {
        await Task.yield()
        try? await Task.sleep(for: .milliseconds(2))
    }
}

@MainActor
private struct Harness {
    let service = ScriptedRegistration()
    let receiver = ScriptedReceiver()
    let presenter = RecordingPresenter()
    let model: RegistrationModel

    init(listenerFails: Bool = false) {
        let keys = KeyCounter()
        model = RegistrationModel(
            client: service,
            listener: ScriptedListener(receiver: receiver, fails: listenerFails),
            presenter: presenter,
            newKey: { keys.next() }
        )
    }

    func type(_ name: String = "sakura", _ secret: String = "correct-horse", confirm: String? = nil) {
        model.setField(.username, to: name)
        model.setField(.password, to: secret)
        model.setField(.confirmation, to: confirm ?? secret)
    }
}

final class KeyCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func next() -> String { lock.lock(); defer { lock.unlock() }; value += 1; return "key-\(value)" }
}

// MARK: Local registration

@MainActor
@Suite("Local registration form", .timeLimit(.minutes(1)))
struct LocalRegistrationModelTests {
    @Test("sends nothing and names the field when an input is missing or the two passwords differ")
    func incomplete() async {
        let h = Harness()
        h.model.submit()
        #expect(h.model.problem == RegistrationProblem(.usernameRequired, field: .username))
        h.type("sakura", "")
        h.model.submit()
        #expect(h.model.problem == RegistrationProblem(.passwordRequired, field: .password))
        h.type("sakura", "secret-1", confirm: "secret-2")
        h.model.submit()
        #expect(h.model.problem == RegistrationProblem(.passwordsDiffer, field: .confirmation))
        #expect(await h.service.locals.isEmpty)
        #expect(h.model.busy == nil)
    }

    @Test("creates the profile, then keeps no password")
    func success() async {
        let h = Harness()
        h.type()
        h.model.submit()
        #expect(h.model.busy == .local)
        await waitUntil { await h.service.waitingLocal == 1 }
        await h.service.answerLocal(.success(profile))
        await h.model.settle()
        #expect(h.model.profile == profile)
        #expect(h.model.password.isEmpty && h.model.confirmation.isEmpty)
        #expect(h.model.busy == nil)
        #expect(await h.service.locals == [.init(username: "sakura", password: "correct-horse", key: "key-1")])
    }

    @Test("drops a second submit while one is running")
    func doubleSubmit() async {
        let h = Harness()
        h.type()
        h.model.submit()
        h.model.submit()
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        await h.service.answerLocal(.success(profile))
        await h.model.settle()
        #expect(await h.service.locals.count == 1)
    }

    @Test("keeps the username and clears the passwords after a definite refusal, with a new key next time")
    func refusal() async {
        let h = Harness()
        h.type()
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        await h.service.answerLocal(.failure(taken))
        await h.model.settle()
        #expect(h.model.problem?.message == .shared(.errorUsernameTaken))
        #expect(h.model.problem?.field == .username)
        #expect(h.model.problem?.requestID == "req-9")
        #expect(h.model.username == "sakura")
        #expect(h.model.password.isEmpty && h.model.confirmation.isEmpty)
        #expect(h.model.profile == nil)

        h.type("sakura2")
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        #expect(await h.service.locals.map(\.key) == ["key-1", "key-2"])
    }

    @Test("keeps everything and the same key after an unreachable service, so a retry cannot create a second profile")
    func unreachable() async {
        let h = Harness()
        h.type()
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        await h.service.answerLocal(.failure(.unavailable))
        await h.model.settle()
        #expect(h.model.problem == RegistrationProblem(.errorUnavailable, retry: .same))
        #expect(h.model.username == "sakura" && h.model.password == "correct-horse" && h.model.confirmation == "correct-horse")

        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        await h.service.answerLocal(.success(profile))
        await h.model.settle()
        #expect(await h.service.locals.map(\.key) == ["key-1", "key-1"])
        #expect(h.model.profile == profile)
    }

    @Test("makes the next attempt a new command when an input changes")
    func editStartsANewCommand() async {
        let h = Harness()
        h.type()
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        await h.service.answerLocal(.failure(.unavailable))
        await h.model.settle()
        h.model.setField(.password, to: "other-secret")
        h.model.setField(.confirmation, to: "other-secret")
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        #expect(await h.service.locals.map(\.key) == ["key-1", "key-2"])
    }

    @Test("sends the next attempt without a key when the service has no room to record one")
    func withoutKey() async {
        let h = Harness()
        h.type()
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        await h.service.answerLocal(.failure(.error(status: 503, code: "idempotency_capacity_reached", requestID: nil, fields: [])))
        await h.model.settle()
        #expect(h.model.problem?.retry == .withoutKey)
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        #expect(await h.service.locals.map(\.key) == ["key-1", nil])
    }

    @Test("shows the field of an invalid password and keeps the username")
    func invalidPassword() async {
        let h = Harness()
        h.type("sakura", "short")
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        await h.service.answerLocal(.failure(.error(status: 400, code: "validation_failed", requestID: "r", fields: ["body.password"])))
        await h.model.settle()
        #expect(h.model.problem?.message == .shared(.errorPasswordInvalid))
        #expect(h.model.problem?.field == .password)
        #expect(h.model.username == "sakura")
    }

    @Test("ignores the answer that arrives after the form was left")
    func staleAnswer() async {
        let h = Harness()
        h.type()
        h.model.submit()
        await waitUntil { await h.service.waitingLocal == 1 }
        h.model.leave()
        #expect(h.model.busy == nil)
        await h.service.answerLocal(.success(profile))
        await h.model.settle()
        #expect(h.model.profile == nil)
        #expect(h.model.problem == nil)
    }

    @Test("reads the providers, and shows none when the service cannot be reached")
    func providers() async {
        let h = Harness()
        await h.service.offer(.success(["google", "github"]))
        await h.model.loadProviders()
        #expect(h.model.providers == ["google", "github"])

        let offline = Harness()
        await offline.service.offer(.failure(.unavailable))
        await offline.model.loadProviders()
        #expect(offline.model.providers.isEmpty)
        #expect(offline.model.problem == nil)
    }
}

// MARK: Provider registration

@MainActor
@Suite("Provider registration form", .timeLimit(.minutes(1)))
struct ProviderRegistrationModelTests {
    /// Runs the form to the point where the provider's page is open.
    private func openProviderPage(_ h: Harness, state: String = "state-1") async {
        h.type("sakura", "")
        h.model.continueWith("github")
        await waitUntil { await h.service.waitingStart == 1 }
        await h.service.answerStart(.success(start(state)))
        await waitUntil { h.model.busy == .waiting(provider: "github") }
    }

    @Test("asks for a username before opening a provider")
    func needsUsername() async {
        let h = Harness()
        h.model.continueWith("github")
        #expect(h.model.problem == RegistrationProblem(.usernameNeededForProvider, field: .username))
        #expect(await h.service.starts.isEmpty)
    }

    @Test("opens the provider's page, compares the state, and creates one profile")
    func success() async {
        let h = Harness()
        await openProviderPage(h)
        #expect(h.presenter.presented == [URL(string: "https://provider.example/authorize?x=1")!])
        let starts = await h.service.starts
        #expect(starts.map(\.provider) == ["github"] && starts.map(\.username) == ["sakura"])
        #expect(starts.first?.returnAddress == "http://127.0.0.1:49152/oauth/callback")

        h.receiver.deliver(.returned(.code(state: "state-1", code: "the-code")))
        await waitUntil { await h.service.waitingCompletion == 1 }
        #expect(h.model.busy == .completing(provider: "github"))
        await h.service.answerCompletion(.success(profile))
        await h.model.settle()
        #expect(h.model.profile == profile)
        #expect(h.model.busy == nil)
        #expect(await h.service.completions == [.init(state: "state-1", code: "the-code", key: "key-1")])
        #expect(h.presenter.dismissals >= 1)
    }

    @Test("sends nothing to the service when the returned state is not the issued one")
    func stateMismatch() async {
        let h = Harness()
        await openProviderPage(h)
        h.receiver.deliver(.returned(.code(state: "forged", code: "the-code")))
        await h.model.settle()
        #expect(h.model.problem?.message == .shared(.errorFlowInvalid))
        #expect(await h.service.completions.isEmpty)
        #expect(h.model.username == "sakura")
        #expect(h.model.busy == nil)
    }

    @Test("says so when the person refuses, without a state it cannot trust, or closes the window")
    func notCompleted() async {
        let refused = Harness()
        await openProviderPage(refused)
        refused.receiver.deliver(.returned(.denied(state: "state-1")))
        await refused.model.settle()
        #expect(refused.model.problem?.message == .shared(.errorProviderDenied))

        let stateless = Harness()
        await openProviderPage(stateless)
        stateless.receiver.deliver(.returned(.denied(state: nil)))
        await stateless.model.settle()
        #expect(stateless.model.problem?.message == .shared(.errorFlowInvalid))

        let closed = Harness()
        await openProviderPage(closed)
        closed.presenter.personClosesTheWindow()
        await closed.model.settle()
        #expect(closed.model.problem?.message == .native(.providerClosed))
        #expect(await closed.service.completions.isEmpty)

        let expired = Harness()
        await openProviderPage(expired)
        expired.receiver.deliver(.expired)
        await expired.model.settle()
        #expect(expired.model.problem?.message == .shared(.errorFlowExpired))
    }

    @Test("stops waiting when the person cancels")
    func cancel() async {
        let h = Harness()
        await openProviderPage(h)
        h.model.cancelProvider()
        await h.model.settle()
        #expect(h.model.problem?.message == .native(.providerClosed))
        #expect(h.model.busy == nil)
    }

    @Test("releases the return address when the service refuses to start the registration")
    func startRefused() async {
        let h = Harness()
        h.type("sakura", "")
        h.model.continueWith("github")
        await waitUntil { await h.service.waitingStart == 1 }
        await h.service.answerStart(.failure(taken))
        await h.model.settle()
        #expect(h.model.problem?.message == .shared(.errorUsernameTaken))
        #expect(h.receiver.stops == 1)
        #expect(h.presenter.presented.isEmpty)
        #expect(h.model.username == "sakura")
    }

    @Test("explains that the Mac cannot receive the answer when it cannot listen")
    func cannotListen() async {
        let h = Harness(listenerFails: true)
        h.type("sakura", "")
        h.model.continueWith("github")
        await h.model.settle()
        #expect(h.model.problem?.message == .native(.errorListener))
        #expect(await h.service.starts.isEmpty)
        #expect(h.model.busy == nil)
    }

    @Test("repeats an undecided completion with the same code and key, and never creates a second profile")
    func repeatCompletion() async {
        let h = Harness()
        await openProviderPage(h)
        h.receiver.deliver(.returned(.code(state: "state-1", code: "the-code")))
        await waitUntil { await h.service.waitingCompletion == 1 }
        await h.service.answerCompletion(.failure(.unavailable))
        await h.model.settle()
        #expect(h.model.canRepeatCompletion)

        h.model.repeatCompletion()
        await waitUntil { await h.service.waitingCompletion == 1 }
        await h.service.answerCompletion(.success(profile))
        await h.model.settle()
        #expect(h.model.profile == profile)
        let completions = await h.service.completions
        #expect(completions.count == 2)
        #expect(completions[0] == completions[1])
        #expect(!h.model.canRepeatCompletion)
    }

    @Test("offers no repeat after a definite refusal, such as an identity that already has a profile")
    func definiteRefusal() async {
        let h = Harness()
        await openProviderPage(h)
        h.receiver.deliver(.returned(.code(state: "state-1", code: "the-code")))
        await waitUntil { await h.service.waitingCompletion == 1 }
        await h.service.answerCompletion(.failure(.error(
            status: 409, code: "accounts_identity_already_registered", requestID: "r", fields: []
        )))
        await h.model.settle()
        #expect(h.model.problem?.message == .shared(.errorIdentityRegistered))
        #expect(!h.model.canRepeatCompletion)
        #expect(h.model.profile == nil)
        #expect(h.model.username == "sakura")
    }

    @Test("repeats without a key when the service has no room to record one")
    func repeatWithoutKey() async {
        let h = Harness()
        await openProviderPage(h)
        h.receiver.deliver(.returned(.code(state: "state-1", code: "the-code")))
        await waitUntil { await h.service.waitingCompletion == 1 }
        await h.service.answerCompletion(.failure(.error(status: 503, code: "idempotency_capacity_reached", requestID: nil, fields: [])))
        await h.model.settle()
        h.model.repeatCompletion()
        await waitUntil { await h.service.waitingCompletion == 1 }
        #expect(await h.service.completions.map(\.key) == ["key-1", nil])
    }

    @Test("ignores the provider's answer after the form was left, and closes the window")
    func leaving() async {
        let h = Harness()
        await openProviderPage(h)
        h.model.leave()
        #expect(h.receiver.stops >= 1)
        #expect(h.presenter.dismissals >= 1)
        await h.model.settle()
        #expect(await h.service.completions.isEmpty)
        #expect(h.model.profile == nil && h.model.problem == nil && h.model.busy == nil)
    }
}
