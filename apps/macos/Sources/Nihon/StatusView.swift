import NihonMacCore
import SwiftUI

/// Shows why the page is missing: the check in progress, an unusable service with a retry action, or an
/// address setting that is not allowed. It says it in plain words only: no address, version, code, or request
/// identifier, which stay in the logs.
struct StatusView: View {
    enum Status {
        case checking
        case failed(ServiceFailure)
        case invalidAddress
    }

    let status: Status
    let language: Language
    let retry: (() -> Void)?

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // The window can be small enough for the message to need more room than it has: it then scrolls.
        GeometryReader { proxy in
            ScrollView {
                content
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }

    private var content: some View {
        VStack(spacing: 16) {
            switch status {
            case .checking:
                if reduceMotion {
                    Image(systemName: "hourglass").font(.largeTitle).foregroundStyle(palette[.accentText])
                } else {
                    ProgressView().controlSize(.large).tint(palette[.accentText])
                }
                Text(language.text(ShellText.loading))
                    .foregroundStyle(palette[.text])
            case .failed(let failure):
                failed(failure)
            case .invalidAddress:
                heading(language.text(MacShellText.addressTitle), systemImage: "exclamationmark.triangle")
                Text(language.text(MacShellText.addressBody)).foregroundStyle(palette[.text])
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: 520)
        .padding(32)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func failed(_ failure: ServiceFailure) -> some View {
        switch failure {
        case .unavailable:
            heading(Self.title(of: failure, language: language), systemImage: "bolt.horizontal.circle")
            Text(language.text(ShellText.unavailableBody)).foregroundStyle(palette[.text])
        case .incompatible:
            heading(Self.title(of: failure, language: language), systemImage: "arrow.triangle.2.circlepath")
            Text(language.text(MacShellText.incompatibleBody)).foregroundStyle(palette[.text])
        case .error:
            heading(Self.title(of: failure, language: language), systemImage: "exclamationmark.circle")
            Text(language.text(ShellText.errorBody)).foregroundStyle(palette[.text])
        }
        if let retry {
            Button(language.text(ShellText.retry), action: retry)
                .buttonStyle(PrimaryButtonStyle())
                .keyboardShortcut(.defaultAction)
                .padding(.top, 8)
        }
    }

    private func heading(_ title: String, systemImage: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 40))
                .foregroundStyle(palette[.accentText])
                .accessibilityHidden(true)
            Text(title)
                .font(.title.bold())
                .foregroundStyle(palette[.text])
                .accessibilityAddTraits(.isHeader)
        }
    }

    static func title(of failure: ServiceFailure, language: Language) -> String {
        switch failure {
        case .unavailable: language.text(ShellText.unavailableTitle)
        case .incompatible: language.text(MacShellText.incompatibleTitle)
        case .error: language.text(ShellText.errorTitle)
        }
    }
}
