import NihonMacCore
import SwiftUI

/// What the menu commands can do in the key window.
struct ShellActions {
    let select: (Space) -> Void
    /// `nil` when the window has nothing to retry.
    let retry: (() -> Void)?
    /// `nil` when the window is not connected to the service.
    let register: (() -> Void)?
}

extension FocusedValues {
    @Entry var shellActions: ShellActions?
}

/// The Go menu: Command-1 to Command-6 open the spaces of the key window, Shift-Command-A opens the account
/// registration, Command-R retries the connection.
struct ShellCommands: Commands {
    let language: Language

    @FocusedValue(\.shellActions) private var actions

    var body: some Commands {
        CommandMenu(language.text(MacShellText.goMenu)) {
            ForEach(Array(Space.allCases.enumerated()), id: \.element) { index, space in
                Button(language.text(space.label)) {
                    actions?.select(space)
                }
                .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
                .disabled(actions == nil)
            }
            Divider()
            Button(language.text(MacAccountsText.createAccountMenu)) {
                actions?.register?()
            }
            .keyboardShortcut("a", modifiers: [.command, .shift])
            .disabled(actions?.register == nil)
            Button(language.text(MacShellText.retryConnection)) {
                actions?.retry?()
            }
            .keyboardShortcut("r", modifiers: .command)
            .disabled(actions?.retry == nil)
        }
    }
}
