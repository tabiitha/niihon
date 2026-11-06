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

    /// The cases of the Web client's agreement test (apps/web/test/unit/registration.test.ts). Each accepted name
    /// is new, so that the service's answer depends only on the rules.
    private static let passphrase = "a long enough passphrase"
    private static let agreementCases: [(username: String, password: String)] = [
        ("", passphrase), ("   ", passphrase), ("ab", passphrase), (String(repeating: "a", count: 33), passphrase),
        ("agree_" + String(repeating: "x", count: 26), passphrase), ("_agree", passphrase), (".agree", passphrase),
        ("ag ree", passphrase), ("ag/ree", passphrase), ("😀😀😀", passphrase),
        (String(repeating: " ", count: 260) + "agreeraw", passphrase), ("  agreetrim  ", passphrase),
        ("Ａｇｒｅｅ２", passphrase), ("さくら合意", passphrase), ("1agree", passphrase), ("agrée", passphrase),
        ("agree\u{301}d", passphrase), ("ag\u{200D}ree", passphrase), ("ag_\u{301}ree", passphrase), ("agree\u{FEFF}bom", passphrase), ("\u{FEFF}agreebom2\u{FEFF}", passphrase),
        ("agree3", ""), ("agree4", "1234567"), ("agree5", "12345678"), ("agree6", String(repeating: "x", count: 128)),
        ("agree7", String(repeating: "x", count: 129)), ("agree8", String(repeating: "x", count: 513)),
        ("agree9", String(repeating: " ", count: 8)), ("agree10", "abcd\u{7}efgh"), ("Agree_eleven", "AGREE_ELEVEN"),
        ("agreefull", "ＡＧＲＥＥＦＵＬＬ"), ("agree12", "パスワードです本当"), ("agree13", "\u{85}\u{85}\u{85}\u{85}\u{85}\u{85}\u{85}\u{85}"),
    ]

    @Test("the typing checks accept and refuse the same local registrations as the service, on the same field")
    func agreement() async throws {
        let fixture = try await AccountsFixture.start()
        defer { fixture.stop() }
        let client = AccountRegistrationClient(serviceURL: fixture.url)
        for (username, password) in Self.agreementCases {
            let local: RegistrationField? = RegistrationChecks.username(username) != nil
                ? .username
                : RegistrationChecks.password(password, username: username) != nil ? .password : nil
            let answer = try await client.registerLocal(username: username, password: password, idempotencyKey: nil)
            let service: RegistrationField?
            switch answer {
            case .success: service = nil
            case .failure(let failure):
                let problem = RegistrationProblem.describe(failure)
                service = try #require(problem.field, "\(username.debugDescription): \(problem)")
            }
            #expect(local == service, "\(username.debugDescription) / \(password.debugDescription)")
        }
    }

    @Test("the typing checks accept and refuse the same usernames as the service for a provider registration")
    func providerAgreement() async throws {
        let fixture = try await AccountsFixture.start()
        defer { fixture.stop() }
        let client = AccountRegistrationClient(serviceURL: fixture.url)
        let names = ["ab", "_oauth", "oauth agree", String(repeating: " ", count: 260) + "oauthraw", "oauth_agree", "Ｏａｕｔｈ２", "さくら連携"]
        for username in names {
            let answer = try await client.startProvider(
                "github", username: username, returnAddress: "http://127.0.0.1:9/oauth/callback"
            )
            let service: RegistrationField?
            switch answer {
            case .success: service = nil
            case .failure(let failure): service = RegistrationProblem.describe(failure).field
            }
            #expect((RegistrationChecks.username(username) == nil ? nil : RegistrationField.username) == service, "\(username.debugDescription)")
        }
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
