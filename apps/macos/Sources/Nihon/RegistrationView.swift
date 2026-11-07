import NihonMacCore
import SwiftUI

/// The registration screen: a card with the local form, then the optional Google and GitHub registration, as
/// in the "Create account" mockups. The model checks what is typed with the service's rules and the service still
/// decides; an error of a field is shown in red under that field, and only a problem of no field above the form.
struct RegistrationView: View {
    let model: RegistrationModel
    let language: Language

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
        // A problem of no field is announced once. An error of a field is read with the field, where focus goes; when
        // the field already has focus, it is announced once instead.
        .onChange(of: model.problem) { _, problem in
            guard let problem else { return }
            AccessibilityNotification.Announcement(problem.message.text(language)).post()
        }
        .onChange(of: model.focusRequest) { _, request in
            guard let request else { return }
            switch RegistrationModel.delivery(fieldHasFocus: focus == request.field) {
            case .focus:
                focus = request.field
            case .announce:
                if let error = model.errors[request.field] {
                    AccessibilityNotification.Announcement(error.message.text(language)).post()
                }
            }
        }
        .onChange(of: focus) { left, _ in
            if let left { model.leaveField(left) }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            form
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
        if let problem = model.problem {
            problemBox(problem)
        }
        usernameField
        passwordField(.password, label: .passwordLabel, show: .showPassword, hide: .hidePassword)
        passwordField(.confirmation, label: .confirmationLabel, show: .showConfirmation, hide: .hideConfirmation)
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
            Text(problem.message.text(language))
                .fontWeight(.medium)
                .frame(maxWidth: .infinity, alignment: .leading)
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
    }

    private var usernameField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(language.text(AccountsText.usernameLabel)).fontWeight(.semibold)
            TextField("", text: binding(.username))
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .focused($focus, equals: .username)
                .fieldBox(invalid: model.errors[.username] != nil, palette: palette)
                .accessibilityLabel(language.text(AccountsText.usernameLabel))
                .accessibilityHint(hint(.username))
            fieldError(.username)
        }
        .padding(.top, 20)
    }

    private func passwordField(
        _ field: RegistrationField, label: AccountsText, show: AccountsText, hide: AccountsText
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
                .accessibilityHint(hint(field))
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
            .fieldBox(invalid: model.errors[field] != nil, palette: palette)
            fieldError(field)
        }
        .padding(.top, 20)
    }

    /// The one message of a field, in the theme's error color under it. VoiceOver reads it with the field (its
    /// hint), so the text itself is hidden from VoiceOver and never announced a second time.
    @ViewBuilder
    private func fieldError(_ field: RegistrationField) -> some View {
        if let error = model.errors[field] {
            Label {
                Text(error.message.text(language))
            } icon: {
                Image(systemName: "exclamationmark.circle.fill")
            }
            .font(.callout.weight(.medium))
            .foregroundStyle(palette[.error])
            .accessibilityHidden(true)
        }
    }

    /// What VoiceOver reads after the label: the error of this field when it has one; nothing at rest.
    private func hint(_ field: RegistrationField) -> String {
        model.errors[field].map { $0.message.text(language) } ?? ""
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
                    Text(ProviderText.continueWith(provider, in: language))
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
        case .starting(let provider): ProviderText.starting(provider, in: language)
        case .waiting(let provider): ProviderText.waiting(for: provider, in: language)
        case .completing: language.text(MacAccountsText.completing)
        case .local, nil: nil
        }
    }
}

private extension View {
    /// A rounded outline in the muted text color, thicker and in the error color when the field has an error.
    func fieldBox(invalid: Bool, palette: Palette) -> some View {
        padding(.horizontal, 14)
            .frame(minHeight: 44)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(invalid ? palette[.error] : palette[.textMuted], lineWidth: invalid ? 2 : 1)
            )
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
