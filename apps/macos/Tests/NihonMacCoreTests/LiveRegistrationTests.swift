import Foundation
import NihonMacCore
import Testing

/// The accounts fixture (apps/api/test/fixtures/accounts-serve.ts): the real HTTP adapter and database of the
/// service in a temporary data directory, with Google and GitHub played by a local fake. Requires Node.js 24
/// or newer on the PATH and `bun install` at the repository root. Nothing leaves this Mac.
private final class AccountsFixture: @unchecked Sendable {
    let url: URL
    private let process: Process
    private let input: Pipe

    private init(url: URL, process: Process, input: Pipe) {
        self.url = url
        self.process = process
        self.input = input
    }

    static func start() async throws -> AccountsFixture {
        let repository = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let process = Process()
        process.executableURL = URL(filePath: "/usr/bin/env")
        process.arguments = ["node", repository.appending(path: "apps/api/test/fixtures/accounts-serve.ts").path()]
        let input = Pipe()
        let output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        try process.run()
        struct Listening: Decodable { let port: Int }
        guard let line = try await output.fileHandleForReading.bytes.lines.first(where: { _ in true }) else {
            throw FixtureError.exited(process.terminationStatus)
        }
        let port = try JSONDecoder().decode(Listening.self, from: Data(line.utf8)).port
        return AccountsFixture(url: URL(string: "http://127.0.0.1:\(port)")!, process: process, input: input)
    }

    /// Ends the service: its standard input closes, which makes it stop.
    func stop() {
        try? input.fileHandleForWriting.close()
        process.waitUntilExit()
    }
}

private enum FixtureError: Error {
    case exited(Int32)
}

private let strongPassword = "correct-horse-battery"

@Suite("Registration against the real service")
struct LiveRegistrationTests {
    @Test("registers a local account offline, then refuses the same name, a weak password, and a stopped service")
    func localRegistration() async throws {
        let fixture = try await AccountsFixture.start()
        defer { fixture.stop() }
        let client = AccountRegistrationClient(serviceURL: fixture.url)
        let sameKey = UUID().uuidString

        let created = try await client.registerLocal(username: "Sakura_42", password: strongPassword, idempotencyKey: sameKey)
        guard case .success(let profile) = created else {
            Issue.record("Expected a profile, received \(created)")
            return
        }
        #expect(profile.username == "Sakura_42")

        // A retry with the same key returns the same profile instead of reporting the name as taken.
        #expect(try await client.registerLocal(username: "Sakura_42", password: strongPassword, idempotencyKey: sameKey) == .success(profile))

        // Names that normalize to the same form are the same name.
        let duplicate = try await client.registerLocal(username: "sakura_42", password: strongPassword, idempotencyKey: UUID().uuidString)
        guard case .failure(let taken) = duplicate else {
            Issue.record("Expected a refusal, received \(duplicate)")
            return
        }
        let problem = RegistrationProblem.describe(taken)
        #expect(problem.message == .shared(.errorUsernameTaken) && problem.field == .username && problem.retry == .new)

        let weak = try await client.registerLocal(username: "another", password: "short", idempotencyKey: UUID().uuidString)
        guard case .failure(let invalid) = weak else {
            Issue.record("Expected a refusal, received \(weak)")
            return
        }
        let weakProblem = RegistrationProblem.describe(invalid)
        #expect(weakProblem.message == .shared(.errorPasswordInvalid) && weakProblem.field == .password)

        // The refused attempts created nothing: the name is still free.
        #expect(try await client.registerLocal(username: "another", password: strongPassword, idempotencyKey: UUID().uuidString).isSuccess)

        fixture.stop()
        let stopped = try await client.registerLocal(username: "third", password: strongPassword, idempotencyKey: UUID().uuidString)
        #expect(stopped == .failure(.unavailable))
    }

    @Test("lists the providers, and keeps the form usable when they cannot be read")
    func providers() async throws {
        let fixture = try await AccountsFixture.start()
        defer { fixture.stop() }
        let client = AccountRegistrationClient(serviceURL: fixture.url)
        guard case .success(let ids) = try await client.providers() else {
            Issue.record("Expected the providers")
            return
        }
        #expect(Set(ids) == ["google", "github"])
        fixture.stop()
        #expect(try await client.providers() == .failure(.unavailable))
    }

    @MainActor
    @Test("the form creates one profile through a provider, and refuses the same identity a second time")
    func providerRegistration() async throws {
        let fixture = try await AccountsFixture.start()
        defer { fixture.stop() }
        let client = AccountRegistrationClient(serviceURL: fixture.url)
        let browser = FakeProviderBrowser()

        // The first registration goes through the real loopback receiver and the fake provider.
        let first = RegistrationModel(client: client, listener: LoopbackProviderReturnListener(), presenter: browser)
        first.setField(.username, to: "from_github")
        first.continueWith("github")
        await first.settle()
        #expect(first.profile?.username == "from_github", "problem: \(String(describing: first.problem))")
        #expect(first.busy == nil)
        #expect(browser.opened == 1)

        // The same GitHub account again, under another name: refused, and the other name stays free.
        let second = RegistrationModel(client: client, listener: LoopbackProviderReturnListener(), presenter: browser)
        second.setField(.username, to: "second_name")
        second.continueWith("github")
        await second.settle()
        #expect(second.profile == nil)
        #expect(second.problem?.message == .shared(.errorIdentityRegistered))
        #expect(second.username == "second_name")
        #expect(!second.canRepeatCompletion)
        #expect(try await client.registerLocal(username: "second_name", password: strongPassword, idempotencyKey: UUID().uuidString).isSuccess)

        // A Google registration is another identity: one more profile.
        let google = RegistrationModel(client: client, listener: LoopbackProviderReturnListener(), presenter: browser)
        google.setField(.username, to: "from_google")
        google.continueWith("google")
        await google.settle()
        #expect(google.profile?.username == "from_google", "problem: \(String(describing: google.problem))")
    }

    @MainActor
    @Test("the form reports an unreachable service without losing the typed name")
    func unreachable() async throws {
        let fixture = try await AccountsFixture.start()
        let client = AccountRegistrationClient(serviceURL: fixture.url)
        fixture.stop()
        let model = RegistrationModel(client: client, listener: LoopbackProviderReturnListener(), presenter: FakeProviderBrowser())
        model.setField(.username, to: "sakura")
        model.setField(.password, to: strongPassword)
        model.setField(.confirmation, to: strongPassword)
        model.submit()
        await model.settle()
        #expect(model.problem == RegistrationProblem(.errorUnavailable, retry: .same))
        #expect(model.username == "sakura" && model.password == strongPassword)
        #expect(model.busy == nil)
    }
}

extension Result {
    fileprivate var isSuccess: Bool {
        if case .success = self { true } else { false }
    }
}

/// Plays the person: opens the provider's page, which approves at once and redirects to the return address.
@MainActor
private final class FakeProviderBrowser: AuthorizationPagePresenting {
    private(set) var opened = 0
    private var visit: Task<Void, Never>?

    func present(_ url: URL, closed: @escaping @MainActor @Sendable () -> Void) {
        opened += 1
        visit = Task.detached {
            let session = URLSession(configuration: .ephemeral)
            defer { session.invalidateAndCancel() }
            _ = try? await session.data(from: url)
        }
    }

    func dismiss() {}
}
