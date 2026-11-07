import NihonMacCore
import SwiftUI

/// The page of a space. Until the features exist, each page presents its space with the shared texts.
struct SpacePage: View {
    let space: Space
    let language: Language
    let select: (Space) -> Void
    let register: () -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                switch space {
                case .home: home
                case .learning: page(LearningText.title, LearningText.body)
                case .kanji: page(KanjiText.title, KanjiText.body)
                case .library: page(LibraryText.title, LibraryText.body)
                case .profile:
                    page(ProfileText.title, ProfileText.body)
                    Button(language.text(ProfileText.createAccount), action: register)
                        .buttonStyle(SecondaryButtonStyle())
                case .admin: page(AdminText.title, AdminText.body)
                }
            }
            .frame(maxWidth: 640, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 40)
            .padding(.vertical, 64)
        }
    }

    /// The approved home layout: a primary "Start review" action and a separate "Discover new kana" action.
    @ViewBuilder
    private var home: some View {
        Text(language.text(HomeText.eyebrow))
            .font(.headline)
            .foregroundStyle(palette[.textMuted])
        Text(language.text(HomeText.practiceTitle))
            .font(.system(size: 44, weight: .bold))
            .foregroundStyle(palette[.text])
            .accessibilityAddTraits(.isHeader)
        Text(language.text(HomeText.practiceBody))
            .font(.title3)
            .foregroundStyle(palette[.textMuted])
        HStack(spacing: 28) {
            Button {
                select(.learning)
            } label: {
                HStack(spacing: 12) {
                    Text(language.text(HomeText.startReview))
                    Image(systemName: "arrow.right").accessibilityHidden(true)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            Button {
                select(.learning)
            } label: {
                Label(language.text(HomeText.discoverKana), systemImage: "plus")
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(.top, 16)
    }

    @ViewBuilder
    private func page<Key: TextKey>(_ title: Key, _ body: Key) -> some View {
        Text(language.text(title))
            .font(.largeTitle.bold())
            .foregroundStyle(palette[.text])
            .accessibilityAddTraits(.isHeader)
        Text(language.text(body))
            .font(.title3)
            .foregroundStyle(palette[.textMuted])
    }
}
