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
        .navigationTitle(language.text(ShellText.documentTitle, ["page": language.text(space.label)]))
        .environment(\.palette, palette)
        .environment(\.locale, Locale(identifier: language.rawValue))
        .preferredColorScheme(preferredColorScheme)
        .task(id: connection.attempt) {
            await connection.check()
        }
        .onChange(of: connection.state) { _, state in
            announce(state, language: language)
            if case .connected = state {
                StartupProbe.shared?.windowConnected()
            }
        }
        .focusedSceneValue(\.shellActions, ShellActions(
            select: { selection = $0 },
            retry: connection.canRetry ? { connection.retry() } : nil
        ))
        .task {
            await StartupProbe.shared?.drive(openWindow: openWindow, select: { selection = $0 })
        }
    }

    @ViewBuilder
    private func detail(space: Space, language: Language) -> some View {
        switch connection.state {
        case .connected:
            SpacePage(space: space, language: language) { selection = $0 }
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
