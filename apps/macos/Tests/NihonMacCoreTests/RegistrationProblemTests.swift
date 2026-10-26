import Foundation
import NihonMacCore
import Testing

/// Every stable error code the contract names for the registration operations, with the HTTP status the
/// contract gives it: the status of the response that mentions the code, or the one written after it in the
/// `default` response (`internal_error` (500)). The same extraction as the Web client's test.
private func contractCodes() throws -> [String: Int] {
    let repository = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    let data = try Data(contentsOf: repository.appending(path: "contracts/openapi.json"))
    let contract = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let paths = try #require(contract["paths"] as? [String: [String: Any]])
    let operations: Set = ["registerLocalAccount", "listOAuthProviders", "startOAuthRegistration", "completeOAuthRegistration"]
    let named = /`((?:accounts|idempotency)_[a-z_]+|validation_failed|unsupported_api_version|payload_too_large|unsupported_media_type)`/
    let defaulted = /`([a-z_]+)` \((\d{3})\)/
    var statuses: [String: Int] = [:]
    for methods in paths.values {
        for case let operation as [String: Any] in methods.values {
            guard let id = operation["operationId"] as? String, operations.contains(id),
                  let responses = operation["responses"] as? [String: [String: Any]]
            else { continue }
            for (status, response) in responses {
                let description = response["description"] as? String ?? ""
                if status == "default" {
                    for match in description.matches(of: defaulted) {
                        statuses[String(match.output.1)] = Int(match.output.2)
                    }
                } else if let number = Int(status) {
                    for match in description.matches(of: named) {
                        statuses[String(match.output.1)] = number
                    }
                }
            }
        }
    }
    return statuses
}

private func answer(_ status: Int, _ code: String, fields: [String] = []) -> RegistrationFailure {
    RegistrationFailure.classify(status: status, code: code, requestID: "req-1", fields: fields)
}

/// How a retry goes after each code; any code of the contract that is not here must be a definite refusal.
private let expectedRetry: [String: RegistrationRetry] = [
    "accounts_busy": .same,
    "idempotency_key_in_use": .same,
    "database_busy": .same,
    "internal_error": .same,
    "stopping": .same,
    "idempotency_capacity_reached": .withoutKey,
]

@Suite("Registration failure messages")
struct RegistrationProblemTests {
    @Test("are read from the real contract, with the statuses the service uses")
    func contract() throws {
        let codes = try contractCodes()
        #expect(codes["accounts_username_taken"] == 409)
        #expect(codes["accounts_oauth_provider_failed"] == 502)
        #expect(codes["accounts_oauth_flow_consumed"] == 503)
        #expect(codes["accounts_busy"] == 503)
        #expect(codes["idempotency_capacity_reached"] == 503)
        #expect(codes["payload_too_large"] == 413)
        #expect(codes["internal_error"] == 500)
    }

    @Test("explain every stable code of the contract with its real status, and say how a retry goes")
    func everyCode() throws {
        for (code, status) in try contractCodes() {
            let failure = answer(status, code, fields: code == "validation_failed" ? ["body.password"] : [])
            let problem = RegistrationProblem.describe(failure)
            let where_ = "\(code) (\(status))"
            if code == "stopping" {
                #expect(failure == .unavailable, "\(where_)")
                #expect(problem.message == .shared(.errorUnavailable), "\(where_)")
            } else if code == "unsupported_api_version" {
                #expect(failure == .incompatible, "\(where_)")
                #expect(problem.message == .native(.errorIncompatible), "\(where_)")
            } else {
                #expect(failure != .unavailable, "\(where_) must not look like a stopped service")
                #expect(problem.message != .shared(.errorUnavailable), "\(where_)")
                #expect(code == "validation_failed" || RegistrationProblem.byCode[code] != nil, "\(where_) has no message")
            }
            #expect(problem.retry == (expectedRetry[code] ?? .new), "\(where_): retry")
        }
    }

    @Test("are translated into every interface language, never the service text")
    func translated() throws {
        for (code, status) in try contractCodes() {
            let problem = RegistrationProblem.describe(answer(status, code, fields: ["body.username"]))
            for language in Language.allCases {
                let text = problem.message.text(language)
                #expect(!text.isEmpty, "\(code) in \(language)")
                #expect(!text.contains("English text for developers"))
            }
        }
    }

    @Test("do not take a service that answered for a stopped service")
    func answeringService() {
        for (status, code) in [(502, "accounts_oauth_provider_failed"), (503, "accounts_oauth_flow_consumed"),
                               (503, "accounts_busy"), (503, "idempotency_capacity_reached")] {
            #expect(answer(status, code) != .unavailable, "\(code)")
        }
        // Without a code, a 502/503/504 stays a stopped service or a failing relay.
        for status in [502, 503, 504] {
            #expect(RegistrationFailure.classify(status: status, code: nil, requestID: nil) == .unavailable)
            #expect(answer(status, "stopping") == .unavailable)
            #expect(answer(status, "a_code_from_the_future") == .unavailable)
        }
    }

    @Test("point at the field that caused the problem")
    func field() {
        #expect(RegistrationProblem.describe(answer(409, "accounts_username_taken"))
            == RegistrationProblem(.shared(.errorUsernameTaken), field: .username, retry: .new, requestID: "req-1"))
        #expect(RegistrationProblem.describe(answer(400, "validation_failed", fields: ["body.password"])).field == .password)
        #expect(RegistrationProblem.describe(answer(400, "validation_failed", fields: ["body.username"])).field == .username)
        #expect(RegistrationProblem.describe(answer(400, "validation_failed", fields: ["body.role"])).field == nil)
        #expect(RegistrationProblem.describe(answer(503, "accounts_busy")).field == nil)
    }

    @Test("show a field's help only after the service refused what was typed in that field")
    func help() throws {
        let refusedName = RegistrationProblem.describe(answer(400, "validation_failed", fields: ["body.username"]))
        let refusedPassword = RegistrationProblem.describe(answer(400, "validation_failed", fields: ["body.password"]))
        #expect(refusedName.help(for: .username) == .usernameHint)
        #expect(refusedName.help(for: .password) == nil && refusedName.help(for: .confirmation) == nil)
        #expect(refusedPassword.help(for: .password) == .passwordHint)
        #expect(refusedPassword.help(for: .username) == nil && refusedPassword.help(for: .confirmation) == nil)

        // No other refusal comes with a help: not a taken name, not any other code of the contract.
        for (code, status) in try contractCodes() where code != "validation_failed" {
            let problem = RegistrationProblem.describe(answer(status, code))
            for field in [RegistrationField.username, .password, .confirmation] {
                #expect(problem.help(for: field) == nil, "\(code) must not bring a help")
            }
        }
        let taken = RegistrationProblem.describe(answer(409, "accounts_username_taken"))
        #expect(taken.field == .username && taken.help(for: .username) == nil)

        // Nor the checks made before anything is sent: a missing value, a missing name before a provider, two
        // different passwords.
        let local: [RegistrationProblem] = [
            .init(.usernameRequired, field: .username), .init(.passwordRequired, field: .password),
            .init(.passwordsDiffer, field: .confirmation), .init(.usernameNeededForProvider, field: .username),
        ]
        for problem in local {
            for field in [RegistrationField.username, .password, .confirmation] {
                #expect(problem.help(for: field) == nil)
            }
        }
        // A refusal that names no field brings no help to any field.
        let otherField = RegistrationProblem.describe(answer(400, "validation_failed", fields: ["body.role"]))
        #expect([RegistrationField.username, .password, .confirmation].allSatisfy { otherField.help(for: $0) == nil })
    }

    @Test("distinguish an unreachable service, an incompatible client, and an unknown error")
    func kinds() {
        #expect(RegistrationProblem.describe(.unavailable) == RegistrationProblem(.errorUnavailable, retry: .same))
        #expect(RegistrationProblem.describe(.incompatible).message == .native(.errorIncompatible))
        let unknown = RegistrationFailure.error(status: nil, code: nil, requestID: nil, fields: [])
        #expect(RegistrationProblem.describe(unknown) == RegistrationProblem(.errorGeneric, retry: .same))
        #expect(RegistrationProblem.describe(answer(418, "a_code_from_the_future")).retry == .new)
        #expect(RegistrationProblem.describe(answer(500, "a_code_from_the_future")).retry == .same)
    }

    @Test("keep the placeholders the screen fills in")
    func placeholders() {
        for language in Language.allCases {
            #expect(language.text(AccountsText.successBody, ["username": "UNAME"]).contains("UNAME"), "\(language)")
            #expect(language.text(AccountsText.continueWithProvider, ["provider": "PROV"]).contains("PROV"), "\(language)")
            #expect(language.text(AccountsText.errorReference, ["requestId": "REQ"]).contains("REQ"), "\(language)")
            #expect(language.text(MacAccountsText.waitingForProvider, ["provider": "PROV"]).contains("PROV"), "\(language)")
        }
    }
}
