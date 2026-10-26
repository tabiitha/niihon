import NihonMacCore
import SwiftUI

/// The navigation bar at the top of the window, laid out like the Web client's header: the brand, the learning
/// spaces, then the account spaces. Wide windows show one row; narrower ones put the spaces under the brand,
/// and the narrowest scroll them sideways so that none is clipped.
struct NavigationBar: View {
    /// Room for the window's close, minimize, and zoom buttons, which sit over the bar's leading edge.
    static let windowButtonsInset: CGFloat = 70

    let language: Language
    let selection: Space
    let select: (Space) -> Void

    @Environment(\.palette) private var palette

    var body: some View {
        ViewThatFits(in: .horizontal) {
            oneRow
            twoRows
            scrollingRows
        }
        .padding(.leading, Self.windowButtonsInset)
        .padding(.trailing, 24)
        .padding(.vertical, 16)
        .frame(maxWidth: 1280 + Self.windowButtonsInset)
        .frame(maxWidth: .infinity)
    }

    private var oneRow: some View {
        HStack(spacing: 32) {
            brand
            Spacer(minLength: 0)
            links(.primary)
            Spacer(minLength: 0)
            links(.account)
        }
        .frame(maxWidth: .infinity)
    }

    private var twoRows: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 32) {
                brand
                Spacer(minLength: 0)
                links(.account)
            }
            links(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var scrollingRows: some View {
        VStack(alignment: .leading, spacing: 12) {
            brand
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 24) {
                    links(.primary)
                    links(.account)
                }
                .padding(.vertical, 4)
            }
        }
    }

    private var brand: some View {
        Button {
            select(.home)
        } label: {
            HStack(spacing: 8) {
                SakuraLogo()
                    .frame(width: 36, height: 36)
                    .accessibilityHidden(true)
                Text("Nihon")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(palette[.text])
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Nihon")
    }

    private func links(_ group: NavigationGroup) -> some View {
        HStack(spacing: 4) {
            ForEach(group.spaces) { space in
                NavigationItem(space: space, language: language, isSelected: space == selection) {
                    select(space)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(language.text(group.label))
    }
}

/// One space of the bar: a pill with its icon and label, filled with the accent when it is the current space.
private struct NavigationItem: View {
    let space: Space
    let language: Language
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            NavigationItemLabel(space: space, language: language, isSelected: isSelected, isHovering: isHovering)
        }
        .buttonStyle(.plain)
        .focusEffectDisabled()
        .onHover { isHovering = $0 }
        .accessibilityLabel(language.text(space.label))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct NavigationItemLabel: View {
    let space: Space
    let language: Language
    let isSelected: Bool
    let isHovering: Bool

    @Environment(\.palette) private var palette
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: space.systemImage)
                .font(.system(size: 17))
                .accessibilityHidden(true)
            Text(language.text(space.label))
                .font(.system(size: 16))
        }
        .foregroundStyle(isSelected ? palette[.onAccent] : palette[.text])
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .background(background, in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(palette[.focus], lineWidth: 3)
                .opacity(isFocused ? 1 : 0)
        }
        .contentShape(Capsule())
    }

    private var background: Color {
        if isSelected { palette[.accent] } else if isHovering { palette[.accent].opacity(0.12) } else { .clear }
    }
}

extension Space {
    /// The system symbol drawn before the label.
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

/// The five petals of the Web client's logo, drawn in a 32 by 32 box and scaled to the frame.
private struct SakuraPetals: Shape {
    func path(in rect: CGRect) -> Path {
        var petal = Path()
        petal.move(to: CGPoint(x: 16, y: 15))
        petal.addCurve(to: CGPoint(x: 11.8, y: 7), control1: CGPoint(x: 12.8, y: 12.6), control2: CGPoint(x: 11, y: 9.8))
        petal.addCurve(to: CGPoint(x: 15, y: 4.6), control1: CGPoint(x: 12.3, y: 5.2), control2: CGPoint(x: 13.8, y: 4))
        petal.addLine(to: CGPoint(x: 16, y: 6))
        petal.addLine(to: CGPoint(x: 17, y: 4.6))
        petal.addCurve(to: CGPoint(x: 20.2, y: 7), control1: CGPoint(x: 18.2, y: 4), control2: CGPoint(x: 19.7, y: 5.2))
        petal.addCurve(to: CGPoint(x: 16, y: 15), control1: CGPoint(x: 21, y: 9.8), control2: CGPoint(x: 19.2, y: 12.6))
        petal.closeSubpath()

        var flower = Path()
        for step in 0..<5 {
            let turn = CGAffineTransform(translationX: 16, y: 16)
                .rotated(by: Double(step) * 72 * .pi / 180)
                .translatedBy(x: -16, y: -16)
            flower.addPath(petal, transform: turn)
        }
        let scale = min(rect.width, rect.height) / 32
        return flower
            .applying(CGAffineTransform(scaleX: scale, y: scale))
            .offsetBy(dx: rect.minX, dy: rect.minY)
    }
}

/// The brand mark: the accent-colored flower with a center in the color shown on the accent.
struct SakuraLogo: View {
    @Environment(\.palette) private var palette

    var body: some View {
        ZStack {
            SakuraPetals().fill(palette[.accent])
            Circle()
                .fill(palette[.onAccent])
                .scaleEffect(4.4 / 32)
        }
    }
}
