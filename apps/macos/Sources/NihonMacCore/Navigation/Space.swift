/// The two navigation groups of the shell's navigation bar, as in the Web client's header.
public enum NavigationGroup: Sendable {
    case primary
    case account

    /// The accessible name of the group.
    public var label: ShellText {
        switch self {
        case .primary: .navigationLabel
        case .account: .accountNavigationLabel
        }
    }

    public var spaces: [Space] {
        switch self {
        case .primary: Space.primary
        case .account: Space.account
        }
    }
}

/// The spaces of the shell, as in the Web client's navigation: four learning spaces, then the account spaces.
public enum Space: String, CaseIterable, Identifiable, Sendable {
    case home
    case learning
    case kanji
    case library
    case profile
    case admin

    public var id: String { rawValue }

    public static let primary: [Space] = [.home, .learning, .kanji, .library]
    // The administration entry is shown to everyone until accounts and roles exist (#7, #77); the server
    // alone will decide who may use an administration feature.
    public static let account: [Space] = [.profile, .admin]

    /// The group of the navigation bar that shows the space.
    public var group: NavigationGroup {
        Space.primary.contains(self) ? .primary : .account
    }

    /// The number of the Go menu shortcut (Command-1 to Command-6): the position in the navigation bar, from
    /// left to right.
    public var shortcutNumber: Int {
        (Space.primary + Space.account).firstIndex(of: self)! + 1
    }

    public var label: ShellText {
        switch self {
        case .home: .navHome
        case .learning: .navLearning
        case .kanji: .navKanji
        case .library: .navLibrary
        case .profile: .navProfile
        case .admin: .navAdmin
        }
    }
}
