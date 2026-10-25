import Foundation
import Observation

/// The state of one registration form, apart from SwiftUI so that its rules can be tested. It carries what the
/// person typed to the service and shows the service's answer; it decides nothing about validity. It guarantees:
/// one request at a time (a second submit is dropped synchronously), the username kept after any failure, the
/// passwords cleared after a definite refusal or a success and kept after an uncertain outcome, one idempotency
/// key per command (reused only while the inputs are unchanged), no secret outside memory, and no state change
/// from an answer that arrives after the form was left (`leave()`).
@MainActor
@Observable
public final class RegistrationModel {
    /// What is being done: the local registration, or the steps of a provider registration.
    public enum Busy: Equatable, Sendable {
        case local
        case starting(provider: String)
        case waiting(provider: String)
        case completing(provider: String)
    }

    public private(set) var username = ""
    public private(set) var password = ""
    public private(set) var confirmation = ""
    public private(set) var busy: Busy?
    public private(set) var problem: RegistrationProblem?
    /// The created profile, once the registration is done.
    public private(set) var profile: RegisteredProfile?
    /// The providers this installation offers, once known.
    public private(set) var providers: [String] = []

    /// Whether the last provider completion can be repeated with the same code and key.
    public var canRepeatCompletion: Bool { completion != nil && busy == nil && problem != nil }

    private struct Completion {
        let state: String
        let code: String
        let key: String
        var withoutKey = false
    }

    private enum Key {
        case unset
        case use(String)
        /// The service asked for the next attempt without a key.
        case omit
    }

    private let client: any AccountRegistering
    private let listener: any ProviderReturnListening
    private let presenter: any AuthorizationPagePresenting
    private let language: () -> Language
    private let newKey: @Sendable () -> String

    private var sending = false
    private var generation = 0
    private var task: Task<Void, Never>?
    private var receiver: (any ProviderReturnReceiving)?
    private var key = Key.unset
    private var completion: Completion?
    /// Why the wait for the provider was stopped by the person, when it was.
    private enum Stop { case windowClosed, cancelled }
    private var stop: Stop?

    public init(
        client: any AccountRegistering,
        listener: any ProviderReturnListening,
        presenter: any AuthorizationPagePresenting,
        language: @escaping () -> Language = { .en },
        newKey: @escaping @Sendable () -> String = { UUID().uuidString }
    ) {
        self.client = client
        self.listener = listener
        self.presenter = presenter
        self.language = language
        self.newKey = newKey
    }

    /// Edits a field. Any edit makes the next attempt a new command.
    public func setField(_ field: RegistrationField, to value: String) {
        key = .unset
        completion = nil
        switch field {
        case .username: username = value
        case .password: password = value
        case .confirmation: confirmation = value
        }
    }

    /// Waits for what the model has started; tests and previews use it, the views do not need it.
    public func settle() async {
        await task?.value
    }

    /// Leaves the form: cancels what is pending, closes the provider's window, and ignores late answers.
    public func leave() {
        generation += 1
        // The cancelled task stays referenced so that `settle()` can wait for its late answer to be dropped.
        task?.cancel()
        receiver?.stop()
        receiver = nil
        presenter.dismiss()
        sending = false
        busy = nil
    }

    /// Reads the providers this installation offers. A failure leaves the list empty: the local form works
    /// without them.
    public func loadProviders() async {
        let generation = generation
        guard let result = try? await client.providers(), generation == self.generation else { return }
        if case .success(let ids) = result {
            providers = ids
        }
    }

    // MARK: Local registration

    public func submit() {
        guard !sending else { return }
        if username.trimmingCharacters(in: .whitespaces).isEmpty {
            return fail(.init(.usernameRequired, field: .username))
        }
        if password.isEmpty {
            return fail(.init(.passwordRequired, field: .password))
        }
        if password != confirmation {
            return fail(.init(.passwordsDiffer, field: .confirmation))
        }
        let generation = begin(.local)
        let sentKey: String?
        switch key {
        case .unset:
            let fresh = newKey()
            key = .use(fresh)
            sentKey = fresh
        case .use(let existing): sentKey = existing
        case .omit: sentKey = nil
        }
        let (username, password) = (username, password)
        task = Task { [client] in
            do {
                let result = try await client.registerLocal(username: username, password: password, idempotencyKey: sentKey)
                self.finishLocal(result, generation: generation)
            } catch {
                self.cancelled(generation: generation)
            }
        }
    }

    private func finishLocal(_ result: Result<RegisteredProfile, RegistrationFailure>, generation: Int) {
        guard generation == self.generation else { return }
        defer { end() }
        switch result {
        case .success(let created):
            // Nothing of the secret stays once the service has answered.
            key = .unset
            password = ""
            confirmation = ""
            profile = created
        case .failure(let failure):
            let problem = RegistrationProblem.describe(failure)
            self.problem = problem
            if problem.retry == .new {
                // A definite refusal: the username stays, the secrets are typed again.
                key = .unset
                password = ""
                confirmation = ""
            } else if problem.retry == .withoutKey {
                key = .omit
            }
        }
    }

    // MARK: Provider registration

    /// Starts a provider registration for the typed username; the provider's page opens in the system web
    /// authentication window, and the answer comes back to this Mac.
    public func continueWith(_ provider: String) {
        guard !sending else { return }
        if username.trimmingCharacters(in: .whitespaces).isEmpty {
            return fail(.init(.usernameNeededForProvider, field: .username))
        }
        let generation = begin(.starting(provider: provider))
        // A new attempt leaves nothing of a previous one: its code can no longer be repeated.
        completion = nil
        stop = nil
        let username = username
        task = Task { [client, listener] in
            let receiver: any ProviderReturnReceiving
            do {
                receiver = try await listener.open(language: self.language())
            } catch {
                return self.cancelledOrFailed(error, .init(.native(.errorListener)), generation: generation)
            }
            guard generation == self.generation else { return receiver.stop() }
            self.receiver = receiver
            do {
                let started = try await client.startProvider(provider, username: username, returnAddress: receiver.returnAddress)
                guard generation == self.generation else { return }
                switch started {
                case .failure(let failure):
                    receiver.stop()
                    self.fail(RegistrationProblem.describe(failure), generation: generation)
                case .success(let start):
                    await self.wait(for: start, provider: provider, receiver: receiver, generation: generation)
                }
            } catch {
                receiver.stop()
                self.cancelled(generation: generation)
            }
        }
    }

    private func wait(
        for start: ProviderStart, provider: String, receiver: any ProviderReturnReceiving, generation: Int
    ) async {
        guard let page = webAddress(start.authorizationURL) else {
            receiver.stop()
            return fail(.init(.errorGeneric), generation: generation)
        }
        receiver.expect(state: start.state)
        busy = .waiting(provider: provider)
        presenter.present(page) { [weak self] in
            self?.stop = .windowClosed
            receiver.stop()
        }
        let outcome = await receiver.wait(until: start.expiresAt)
        guard generation == self.generation else { return }
        presenter.dismiss()
        self.receiver = nil
        switch outcome {
        case .stopped:
            fail(.init(.native(stop == .cancelled ? .providerCancelled : .providerClosed)), generation: generation)
        case .listenerLost:
            fail(.init(.native(.errorListenerLost)), generation: generation)
        case .expired:
            fail(.init(.errorFlowExpired), generation: generation)
        case .returned(let answer):
            // The returned `state` must be the one the service issued for this attempt; otherwise nothing is sent.
            switch answer {
            case .denied(let state) where state == start.state:
                fail(.init(.errorProviderDenied), generation: generation)
            case .code(let state, let code) where state == start.state:
                completion = Completion(state: state, code: code, key: newKey())
                await complete(provider: provider, generation: generation)
            default:
                fail(.init(.errorFlowInvalid), generation: generation)
            }
        }
    }

    /// Repeats the completion that was not decided: same code and key, so that a profile created by the first
    /// attempt is returned instead of a second one being created.
    public func repeatCompletion() {
        guard canRepeatCompletion, !sending, let provider = lastProvider else { return }
        let generation = begin(.completing(provider: provider))
        task = Task { await self.complete(provider: provider, generation: generation) }
    }

    private var lastProvider: String?

    private func complete(provider: String, generation: Int) async {
        guard let pending = completion else { return }
        lastProvider = provider
        busy = .completing(provider: provider)
        do {
            let result = try await client.completeProvider(
                state: pending.state, code: pending.code, idempotencyKey: pending.withoutKey ? nil : pending.key
            )
            guard generation == self.generation else { return }
            defer { end() }
            switch result {
            case .success(let created):
                completion = nil
                profile = created
            case .failure(let failure):
                let problem = RegistrationProblem.describe(failure)
                self.problem = problem
                switch problem.retry ?? .new {
                case .new: completion = nil
                case .same: break
                case .withoutKey: completion?.withoutKey = true
                }
            }
        } catch {
            cancelled(generation: generation)
        }
    }

    /// Stops waiting for the provider because the person asked to.
    public func cancelProvider() {
        stop = .cancelled
        receiver?.stop()
    }

    // MARK: Shared

    private func begin(_ busy: Busy) -> Int {
        sending = true
        problem = nil
        self.busy = busy
        return generation
    }

    private func end() {
        sending = false
        busy = nil
    }

    private func fail(_ problem: RegistrationProblem) {
        self.problem = problem
    }

    private func fail(_ problem: RegistrationProblem, generation: Int) {
        guard generation == self.generation else { return }
        self.problem = problem
        end()
    }

    private func cancelled(generation: Int) {
        // A cancelled request belongs to a form that was left or replaced: nothing to show.
        guard generation == self.generation, !Task.isCancelled else { return }
        end()
    }

    private func cancelledOrFailed(_ error: any Error, _ problem: RegistrationProblem, generation: Int) {
        if error is CancellationError {
            cancelled(generation: generation)
        } else {
            fail(problem, generation: generation)
        }
    }
}
