/// The words of a provider button and of its waiting states. A provider the app has no name for is never shown by
/// its raw identifier: the screen says "an existing account" in plain words instead.
public enum ProviderText {
    /// The display name of a provider Nihon knows, `nil` for any other identifier.
    public static func name(of provider: String, in language: Language) -> String? {
        switch provider {
        case "google": language.text(AccountsText.providerGoogle)
        case "github": language.text(AccountsText.providerGithub)
        default: nil
        }
    }

    public static func continueWith(_ provider: String, in language: Language) -> String {
        guard let name = name(of: provider, in: language) else {
            return language.text(MacAccountsText.continueWithExistingAccount)
        }
        return language.text(AccountsText.continueWithProvider, ["provider": name])
    }

    public static func starting(_ provider: String, in language: Language) -> String {
        guard let name = name(of: provider, in: language) else {
            return language.text(MacAccountsText.startingExistingAccount)
        }
        return language.text(AccountsText.startingProvider, ["provider": name])
    }

    public static func waiting(for provider: String, in language: Language) -> String {
        guard let name = name(of: provider, in: language) else {
            return language.text(MacAccountsText.waitingForExistingAccount)
        }
        return language.text(MacAccountsText.waitingForProvider, ["provider": name])
    }
}
