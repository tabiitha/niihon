import NihonMacCore
import SwiftUI

/// One window: the sidebar of spaces and the selected page, shown once the local service answers with a
/// compatible API version. The sidebar stays usable meanwhile.
struct ShellView: View {
    static let windowID = "main"

    @Environment(AppSettings.self) private var settings
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openWindow) private var openWindow
    @State private var connection = ServiceConnection(
        setting: UserDefaults.standard.string(forKey: ServiceAddress.settingKey)
    )
    @State private var selection: Space? = .home
    /// The registration screen of the Profile space, while it is open. Leaving the Profile space, losing the
    /// connection, or closing the window ends it and ignores any late answer.
    @State private var registration: RegistrationModel?

    var body: some View {
        let language = settings.language
        let space = selection ?? .home
        NavigationSplitView {
            List(selection: $selection) {
                Section(language.text(ShellText.navigationLabel)) {
                    ForEach(Space.primary) { SidebarRow(space: $0, language: language) }
                }
                Section(language.text(ShellText.accountNavigationLabel)) {
                    ForEach(Space.account) { SidebarRow(space: $0, language: language) }
                }
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 210)
        } detail: {
            ZStack {
                ThemeBackground()
                detail(space: space, language: language)
            }
        }
        .navigationTitle(language.text(ShellText.documentTitle, [
            "page": registration == nil ? language.text(space.label) : language.text(AccountsText.title),
        ]))
        .environment(\.palette, palette)
        .environment(\.locale, Locale(identifier: language.rawValue))
        .preferredColorScheme(preferredColorScheme)
        .task(id: connection.attempt) {
            await connection.check()
        }
        .onChange(of: selection) { _, space in
            if space != .profile { closeRegistration() }
        }
        .onDisappear { closeRegistration() }
        .onChange(of: connection.state) { _, state in
            announce(state, language: language)
            if case .connected = state {} else { closeRegistration() }
            if case .connected = state {
                StartupProbe.shared?.windowConnected()
            }
        }
        .focusedSceneValue(\.shellActions, ShellActions(
            select: { selection = $0 },
            retry: connection.canRetry ? { connection.retry() } : nil,
            register: connectedService == nil ? nil : { openRegistration() }
        ))
        .task {
            await StartupProbe.shared?.drive(openWindow: openWindow, select: { selection = $0 })
        }
    }

    @ViewBuilder
    private func detail(space: Space, language: Language) -> some View {
        switch connection.state {
        case .connected:
            if let registration, space == .profile {
                RegistrationView(model: registration, language: language) { closeRegistration() }
            } else {
                SpacePage(space: space, language: language, select: { selection = $0 }, register: { openRegistration() })
            }
        case .checking:
            StatusView(status: .checking, language: language, address: connection.address, retry: nil)
        case .failed(let failure):
            StatusView(status: .failed(failure), language: language, address: connection.address) {
                connection.retry()
            }
        case .invalidAddress:
            StatusView(status: .invalidAddress, language: language, address: connection.address, retry: nil)
        }
    }

    /// The service address, once the window is connected to it.
    private var connectedService: URL? {
        if case .connected = connection.state { connection.serviceURL } else { nil }
    }

    private func openRegistration() {
        guard let serviceURL = connectedService else { return }
        selection = .profile
        registration?.leave()
        registration = RegistrationModel(
            client: AccountRegistrationClient(serviceURL: serviceURL),
            listener: LoopbackProviderReturnListener(),
            presenter: WebAuthenticationPresenter(),
            language: { [settings] in settings.language }
        )
    }

    private func closeRegistration() {
        registration?.leave()
        registration = nil
    }

    private var palette: Palette {
        let theme = ThemeCatalog.theme(id: settings.themeID)
        return Palette(mode: theme.mode(settings.appearance.resolve(systemIsDark: colorScheme == .dark)))
    }

    private var preferredColorScheme: ColorScheme? {
        switch settings.appearance {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    /// Lets VoiceOver users know that the content was replaced by a failure.
    private func announce(_ state: ServiceConnection.State, language: Language) {
        let title: String? = switch state {
        case .failed(let failure): StatusView.title(of: failure, language: language)
        case .invalidAddress: language.text(MacShellText.addressTitle)
        case .checking, .connected: nil
        }
        if let title {
            AccessibilityNotification.Announcement(title).post()
        }
    }
}

private struct SidebarRow: View {
    let space: Space
    let language: Language

    var body: some View {
        Label(language.text(space.label), systemImage: space.systemImage)
            .tag(space)
    }
}

extension Space {
    var systemImage: String {
        switch self {
        case .home: "house"
        case .learning: "book"
        case .kanji: "character.book.closed.ja"
        case .library: "books.vertical"
        case .profile: "person.crop.circle"
        case .admin: "gearshape.2"
        }
    }
}
