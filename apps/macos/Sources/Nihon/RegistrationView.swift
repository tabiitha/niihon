import NihonMacCore
import SwiftUI

/// The registration screen: a card with the local form, then the optional Google and GitHub registration, as
/// in the "Create account" mockups. Every rule is decided by the service; the view shows its answers.
struct RegistrationView: View {
    let model: RegistrationModel
    let language: Language
    /// Leaves the screen for the page it came from.
    let finish: () -> Void

    @Environment(\.palette) private var palette
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focus: RegistrationField?
    @State private var revealed: Set<RegistrationField> = []

    var body: some View {
        ScrollView {
            card
                .frame(maxWidth: 480)
                .padding(.horizontal, 40)
                .padding(.vertical, 48)
                .frame(maxWidth: .infinity)
        }
        .task { await model.loadProviders() }
        .onChange(of: model.problem) { _, problem in
            guard let problem else { return }
            focus = problem.field
            AccessibilityNotification.Announcement(problem.message.text(language)).post()
        }
        .onChange(of: model.profile) { _, profile in
            if let profile {
                AccessibilityNotification.Announcement(
                    language.text(AccountsText.successBody, ["username": profile.username])
                ).post()
            }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let profile = model.profile {
                success(profile)
            } else {
                form
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 32)
        .padding(.horizontal, 36)
        .background(
            RoundedRectangle(cornerRadius: 24)
                .fill(colorScheme == .light ? palette[.surface].opacity(0.78) : palette[.background].opacity(0.88))
        )
        .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(palette[.border]))
        .foregroundStyle(palette[.text])
    }

    // MARK: Form

    private var busy: Bool { model.busy != nil }

    @ViewBuilder
    private var form: some View {
        Text(language.text(AccountsText.title))
            .font(.largeTitle.bold())
            .accessibilityAddTraits(.isHeader)
        Text(language.text(AccountsText.subtitle))
            .font(.body.weight(.medium))
            .foregroundStyle(palette[.accentText])
            .padding(.top, 6)
        if let problem = model.problem {
            problemBox(problem)
        }
        usernameField
        passwordField(.password, label: .passwordLabel, hint: .passwordHint, show: .showPassword, hide: .hidePassword)
        passwordField(.confirmation, label: .confirmationLabel, hint: nil, show: .showConfirmation, hide: .hideConfirmation)
        Button {
            model.submit()
        } label: {
            HStack {
                Spacer(minLength: 0)
                Text(language.text(model.busy == .local ? AccountsText.submitting : AccountsText.submit))
                Spacer(minLength: 0)
                Image(systemName: "arrow.right").accessibilityHidden(true)
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .keyboardShortcut(.defaultAction)
        .disabled(busy)
        .opacity(busy ? 0.7 : 1)
        .padding(.top, 28)
        if !model.providers.isEmpty {
            providers
        }
    }

    private func problemBox(_ problem: RegistrationProblem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(problem.message.text(language)).fontWeight(.medium)
            if let requestID = problem.requestID {
                Text(language.text(AccountsText.errorReference, ["requestId": requestID]))
                    .font(.callout)
                    .foregroundStyle(palette[.textMuted])
                    .textSelection(.enabled)
            }
            if model.canRepeatCompletion {
                Button(language.text(AccountsText.tryAgain)) { model.repeatCompletion() }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
        .padding(.horizontal, 16)
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(palette[.text], lineWidth: 2))
        .padding(.top, 20)
        .accessibilityElement(children: .combine)
    }

    private var usernameField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(language.text(AccountsText.usernameLabel)).fontWeight(.semibold)
            TextField("", text: binding(.username))
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .focused($focus, equals: .username)
                .fieldBox(invalid: model.problem?.field == .username, palette: palette)
                .accessibilityLabel(language.text(AccountsText.usernameLabel))
                .accessibilityHint(hint(.username, AccountsText.usernameHint))
            hintText(AccountsText.usernameHint)
        }
        .padding(.top, 20)
    }

    private func passwordField(
        _ field: RegistrationField, label: AccountsText, hint hintKey: AccountsText?, show: AccountsText, hide: AccountsText
    ) -> some View {
        let isShown = revealed.contains(field)
        return VStack(alignment: .leading, spacing: 6) {
            Text(language.text(label)).fontWeight(.semibold)
            HStack(spacing: 0) {
                Group {
                    if isShown {
                        TextField("", text: binding(field))
                    } else {
                        SecureField("", text: binding(field))
                    }
                }
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .focused($focus, equals: field)
                .accessibilityLabel(language.text(label))
                .accessibilityHint(hint(field, hintKey))
                Button {
                    if isShown { revealed.remove(field) } else { revealed.insert(field) }
                    focus = field
                } label: {
                    Image(systemName: isShown ? "eye.slash" : "eye")
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(language.text(isShown ? hide : show))
            }
            .fieldBox(invalid: model.problem?.field == field, palette: palette)
            if let hintKey {
                hintText(hintKey)
            }
        }
        .padding(.top, 20)
    }

    private func hintText(_ key: AccountsText) -> some View {
        Text(language.text(key)).font(.callout).foregroundStyle(palette[.textMuted])
    }

    /// What VoiceOver reads after the label: the problem of this field when it has one, otherwise its hint.
    private func hint(_ field: RegistrationField, _ key: AccountsText?) -> String {
        if let problem = model.problem, problem.field == field {
            return problem.message.text(language)
        }
        return key.map { language.text($0) } ?? ""
    }

    private func binding(_ field: RegistrationField) -> Binding<String> {
        Binding(
            get: {
                switch field {
                case .username: model.username
                case .password: model.password
                case .confirmation: model.confirmation
                }
            },
            set: { model.setField(field, to: $0) }
        )
    }

    // MARK: Providers

    private var providers: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider().overlay(palette[.border]).padding(.vertical, 12)
            Text(language.text(AccountsText.providersTitle))
                .font(.title3.bold())
                .accessibilityAddTraits(.isHeader)
            Text(language.text(AccountsText.providersNote)).foregroundStyle(palette[.textMuted])
            if let waiting = waitingProvider {
                HStack(spacing: 12) {
                    if reduceMotion {
                        Image(systemName: "hourglass").foregroundStyle(palette[.accentText])
                    } else {
                        ProgressView().controlSize(.small).tint(palette[.accentText])
                    }
                    Text(waiting).accessibilityAddTraits(.updatesFrequently)
                    Spacer(minLength: 0)
                    if case .waiting = model.busy {
                        Button(language.text(MacAccountsText.cancel)) { model.cancelProvider() }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }
            }
            ForEach(model.providers, id: \.self) { provider in
                Button {
                    model.continueWith(provider)
                } label: {
                    Text(language.text(AccountsText.continueWithProvider, ["provider": name(of: provider)]))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(ProviderButtonStyle())
                .disabled(busy)
            }
        }
        .padding(.top, 12)
    }

    private var waitingProvider: String? {
        switch model.busy {
        case .starting(let provider): language.text(AccountsText.startingProvider, ["provider": name(of: provider)])
        case .waiting(let provider): language.text(MacAccountsText.waitingForProvider, ["provider": name(of: provider)])
        case .completing: language.text(MacAccountsText.completing)
        case .local, nil: nil
        }
    }

    private func name(of provider: String) -> String {
        switch provider {
        case "google": language.text(AccountsText.providerGoogle)
        case "github": language.text(AccountsText.providerGithub)
        default: provider
        }
    }

    // MARK: Success

    @ViewBuilder
    private func success(_ profile: RegisteredProfile) -> some View {
        Text(language.text(AccountsText.successTitle))
            .font(.largeTitle.bold())
            .accessibilityAddTraits(.isHeader)
        Text(language.text(AccountsText.successBody, ["username": profile.username]))
            .padding(.top, 12)
        Button(action: finish) {
            HStack(spacing: 12) {
                Text(language.text(AccountsText.backHome))
                Image(systemName: "arrow.right").accessibilityHidden(true)
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .keyboardShortcut(.defaultAction)
        .padding(.top, 28)
    }
}

private extension View {
    /// A rounded outline in the muted text color, thicker when the field has the problem.
    func fieldBox(invalid: Bool, palette: Palette) -> some View {
        padding(.horizontal, 14)
            .frame(minHeight: 44)
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(palette[.textMuted], lineWidth: invalid ? 2.5 : 1))
    }
}

/// An outlined capsule for the optional provider registrations, next to the accent primary action.
private struct ProviderButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(palette[.text])
            .padding(.vertical, 8)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(palette[.accent].opacity(configuration.isPressed ? 0.2 : 0.08), in: Capsule())
            .overlay(Capsule().strokeBorder(palette[.textMuted]))
            .opacity(isEnabled ? 1 : 0.7)
            .contentShape(Capsule())
    }
}
