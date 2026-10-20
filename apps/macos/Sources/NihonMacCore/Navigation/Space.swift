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
