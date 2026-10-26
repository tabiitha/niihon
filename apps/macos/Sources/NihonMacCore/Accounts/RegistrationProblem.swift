import Foundation
import NihonAPIClient
import OpenAPIRuntime

/// Why a registration request did not produce data, as the interface presents it; the same classification as
/// the Web client.
public enum RegistrationFailure: Error, Equatable, Sendable {
    /// No HTTP answer (stopped or unreachable service), 503 while stopping, or 502 or 504 from a relay.
    case unavailable
    /// The service implements another API major version than this client.
    case incompatible
    /// Any other error answer. `fields` are the paths of the invalid inputs of a `validation_failed` answer,
    /// such as `body.password`; `requestID` locates the answer in the service log.
    case error(status: Int?, code: String?, requestID: String?, fields: [String])

    /// Classifies an error answer. A 502 or 503 that carries a code the registration explains is the
    /// service's own answer, not a stopped service or a failing relay.
    public static func classify(status: Int, code: String?, requestID: String?, fields: [String] = []) -> RegistrationFailure {
        if code == "unsupported_api_version" {
            return .incompatible
        }
        if [502, 503, 504].contains(status), !(code.map(explainedCodes.contains) ?? false) {
            return .unavailable
        }
        return .error(status: status, code: code, requestID: requestID, fields: fields)
    }

    /// A request without an HTTP answer means an unavailable service; an answer that is not the documented
    /// JSON (another program on the port, for example) is an error.
    static func classify(transportError error: any Error) -> RegistrationFailure {
        if let clientError = error as? ClientError {
            if let response = clientError.response {
                let status = response.status.code
                return [502, 503, 504].contains(status)
                    ? .unavailable
                    : .error(status: status, code: nil, requestID: response.headerFields[.nihonRequestID], fields: [])
            }
            return clientError.underlyingError is URLError ? .unavailable : .error(status: nil, code: nil, requestID: nil, fields: [])
        }
        return error is URLError ? .unavailable : .error(status: nil, code: nil, requestID: nil, fields: [])
    }
}

/// The form field a problem belongs to, so that focus and the description go to the right input.
public enum RegistrationField: Hashable, Sendable {
    case username
    case password
    case confirmation
}

/// How the next attempt relates to the one that failed:
/// - `same`: it is not known that nothing was created, or the service is only busy; the typed data and the
///   idempotency key are kept, so repeating returns the created profile if there is one;
/// - `withoutKey`: the service recorded too many keyed commands and did nothing; repeat without a key;
/// - `new`: a definite refusal; nothing was created, the next attempt is a new command.
public enum RegistrationRetry: Equatable, Sendable {
    case same
    case withoutKey
    case new
}

/// A message of the registration screen: a text shared with the Web client, or one that only the native
/// app needs.
public enum RegistrationMessage: Equatable, Sendable {
    case shared(AccountsText)
    case native(MacAccountsText)

    public func text(_ language: Language, _ values: [String: String] = [:]) -> String {
        switch self {
        case .shared(let key): language.text(key, values)
        case .native(let key): language.text(key, values)
        }
    }
}

/// What the screen shows for a failure: a translated message, the field that caused it, and how to go on.
public struct RegistrationProblem: Equatable, Sendable {
    public let message: RegistrationMessage
    public let field: RegistrationField?
    public let retry: RegistrationRetry?
    /// Request identifier of the service log, shown when the service gave one.
    public let requestID: String?

    public init(
        _ message: RegistrationMessage, field: RegistrationField? = nil,
        retry: RegistrationRetry? = nil, requestID: String? = nil
    ) {
        self.message = message
        self.field = field
        self.retry = retry
        self.requestID = requestID
    }

    public init(_ message: AccountsText, field: RegistrationField? = nil, retry: RegistrationRetry? = nil) {
        self.init(.shared(message), field: field, retry: retry)
    }

    /// The help a field shows, and only after the service refused what was typed in that very field: the rule
    /// is written under the refusal, never beside an empty or accepted field, and never for a name that is merely
    /// taken (a rule would not help) or a missing value (the message already says what to do). The same rule as
    /// the Web client's `hintFor`.
    public func help(for field: RegistrationField) -> AccountsText? {
        guard self.field == field, case .shared(let text) = message else { return nil }
        switch (field, text) {
        case (.username, .errorUsernameInvalid): return .usernameHint
        case (.password, .errorPasswordInvalid): return .passwordHint
        default: return nil
        }
    }

    /// Stable error codes of the registration operations (see docs/architecture/accounts.md) and the message
    /// that explains each one. The service decides what is refused; this table only chooses the words and how
    /// a retry goes.
    public static let byCode: [String: RegistrationProblem] = [
        "accounts_username_taken": .init(.errorUsernameTaken, field: .username),
        "accounts_busy": .init(.errorBusy, retry: .same),
        "accounts_oauth_redirect_uri_invalid": .init(.native(.errorRedirectUri)),
        "accounts_oauth_provider_unavailable": .init(.errorProviderUnavailable),
        "accounts_oauth_state_invalid": .init(.errorFlowInvalid),
        "accounts_oauth_state_expired": .init(.errorFlowExpired),
        "accounts_oauth_code_rejected": .init(.errorCodeRejected),
        "accounts_oauth_identity_unverified": .init(.errorIdentityUnverified),
        "accounts_identity_already_registered": .init(.errorIdentityRegistered),
        "accounts_oauth_provider_failed": .init(.errorProviderFailed),
        "accounts_oauth_flow_consumed": .init(.errorFlowConsumed),
        "idempotency_key_in_use": .init(.errorInProgress, retry: .same),
        "idempotency_capacity_reached": .init(.errorBusy, retry: .withoutKey),
        "idempotency_key_reused": .init(.errorRequestInvalid),
        "payload_too_large": .init(.errorRequestInvalid),
        "unsupported_media_type": .init(.errorRequestInvalid),
        "database_busy": .init(.errorBusy, retry: .same),
        "internal_error": .init(.errorGeneric, retry: .same),
    ]

    /// Chooses the message of a failed registration request. Never shows the service's English text.
    public static func describe(_ failure: RegistrationFailure) -> RegistrationProblem {
        switch failure {
        case .unavailable:
            return .init(.errorUnavailable, retry: .same)
        case .incompatible:
            return .init(.native(.errorIncompatible), retry: .new)
        case .error(let status, let code, let requestID, let fields):
            if code == "validation_failed" {
                if fields.contains("body.password") {
                    return .init(.shared(.errorPasswordInvalid), field: .password, retry: .new, requestID: requestID)
                }
                if fields.contains("body.username") {
                    return .init(.shared(.errorUsernameInvalid), field: .username, retry: .new, requestID: requestID)
                }
                return .init(.shared(.errorRequestInvalid), retry: .new, requestID: requestID)
            }
            // A service failure that no code explains leaves it open whether the profile was created.
            let unexplained = RegistrationProblem(.errorGeneric, retry: (status ?? 500) >= 500 ? .same : .new)
            let known = code.flatMap { byCode[$0] } ?? unexplained
            return .init(known.message, field: known.field, retry: known.retry ?? .new, requestID: requestID)
        }
    }
}

/// The codes `RegistrationProblem.byCode` explains: their 502 and 503 answers come from the service.
private let explainedCodes: Set<String> = Set(RegistrationProblem.byCode.keys)
