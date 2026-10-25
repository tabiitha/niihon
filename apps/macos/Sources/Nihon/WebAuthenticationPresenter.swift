import AppKit
import AuthenticationServices
import NihonMacCore

/// Shows a provider's page in the system web authentication session. The session is only a window: the
/// provider's answer comes back to the loopback address of `LoopbackProviderReturnListener`, so the session
/// is dismissed by the app once that answer arrived, and reports when the person closes it first.
@MainActor
final class WebAuthenticationPresenter: NSObject, AuthorizationPagePresenting, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    /// Identifies the session being shown, so that the end of an earlier one is not taken for this one's.
    private var sessionID: UUID?

    func present(_ url: URL, closed: @escaping @MainActor @Sendable () -> Void) {
        dismiss()
        // The provider never redirects to this scheme (its return address is the loopback address), so the
        // completion handler only runs when the window is closed or dismissed.
        let id = UUID()
        let session = ASWebAuthenticationSession(
            url: url, callbackURLScheme: "nihon-provider-window",
            completionHandler: Self.completionHandler { [weak self] in
                guard let self, self.sessionID == id else { return }
                self.session = nil
                self.sessionID = nil
                closed()
            }
        )
        session.presentationContextProvider = self
        // A provider's page needs no cookies from Safari, and an ephemeral session opens without the system
        // prompt that asks to share information between the app and the website.
        session.prefersEphemeralWebBrowserSession = true
        self.session = session
        sessionID = id
        if !session.start() {
            self.session = nil
            sessionID = nil
            closed()
        }
    }

    /// The system calls the completion handler on its own queue, so the handler is built outside the main actor
    /// and hops back to it.
    private nonisolated static func completionHandler(
        _ closed: @escaping @MainActor @Sendable () -> Void
    ) -> ASWebAuthenticationSession.CompletionHandler {
        { _, _ in Task { @MainActor in closed() } }
    }

    func dismiss() {
        guard let session else { return }
        self.session = nil
        sessionID = nil
        session.cancel()
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
        }
    }
}
