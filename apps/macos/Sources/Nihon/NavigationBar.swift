import NihonMacCore
import SwiftUI

/// The navigation bar at the top of the window, laid out like the Web client's header: the brand, the learning
/// spaces, then the account spaces. Wide windows show one row; narrower ones put the learning spaces under the
/// brand and the account spaces, as the Web client does, and the narrowest let each group wrap onto more lines,
/// so that none is clipped.
struct NavigationBar: View {
    let language: Language
    let selection: Space
    let select: (Space) -> Void

    /// The three ways the bar lays itself out, from the widest window to the narrowest.
    private enum Arrangement {
        case oneRow, twoRows, wrapping

        /// The group shown first after the brand, reading from the top left.
        var firstGroup: NavigationGroup { self == .twoRows ? .account : .primary }
    }

    @Environment(\.palette) private var palette
    @FocusState private var focus: NavigationStop?

    var body: some View {
        ViewThatFits(in: .horizontal) {
            oneRow
            twoRows
            wrappingRows
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .frame(maxWidth: 1280 + 48)
        .frame(maxWidth: .infinity)
        // A new window gives its first focusable view the focus; the ring should only appear once a key asks for it.
        .task {
            try? await Task.sleep(for: .milliseconds(300))
            if focus == .brand { focus = nil }
        }
    }

    private var oneRow: some View {
        HStack(spacing: 32) {
            brand
            Spacer(minLength: 0)
            links(.primary, in: .oneRow)
            Spacer(minLength: 0)
            links(.account, in: .oneRow)
        }
        .frame(maxWidth: .infinity)
    }

    private var twoRows: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 32) {
                brand
                Spacer(minLength: 0)
                links(.account, in: .twoRows)
            }
            links(.primary, in: .twoRows)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var wrappingRows: some View {
        VStack(alignment: .leading, spacing: 12) {
            brand
            links(.primary, in: .wrapping)
            links(.account, in: .wrapping)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var brand: some View {
        HStack(spacing: 8) {
            SakuraLogo()
                .frame(width: 36, height: 36)
            Text("Nihon")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(palette[.text])
        }
        .contentShape(Rectangle())
        .focusRing(RoundedRectangle(cornerRadius: 8), isFocused: focus == .brand)
        .navigationStop(.brand, focus: $focus, move: move) { select(.home) }
        .accessibilityLabel("Nihon")
        .accessibilitySortPriority(3)
    }

    private func links(_ group: NavigationGroup, in arrangement: Arrangement) -> some View {
        let layout = arrangement == .wrapping ? AnyLayout(FlowLayout(spacing: 4)) : AnyLayout(HStackLayout(spacing: 4))
        return layout {
            ForEach(group.spaces) { item($0) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(language.text(group.label))
        // Assistive technology reads the bar in the order Tab and the eye follow: the brand, then each group in the
        // order the layout shows them, which puts the account spaces before the learning spaces on two rows.
        .accessibilitySortPriority(group == arrangement.firstGroup ? 2 : 1)
    }

    private func item(_ space: Space) -> some View {
        NavigationItem(space: space, language: language, isSelected: space == selection, isFocused: focus == .space(space))
            .navigationStop(.space(space), focus: $focus, move: move) { select(space) }
            .accessibilityLabel(language.text(space.label))
            .accessibilityAddTraits(space == selection ? .isSelected : [])
    }

    /// Moves the keyboard focus to the previous or next stop of the bar, in reading order.
    private func move(from stop: NavigationStop, by step: Int) {
        let stops = NavigationStop.all
        guard let index = stops.firstIndex(of: stop) else { return }
        focus = stops[min(max(index + step, 0), stops.count - 1)]
    }
}

/// What the keyboard can reach in the bar: the brand, then the spaces in reading order.
private enum NavigationStop: Hashable {
    case brand
    case space(Space)

    static let all: [NavigationStop] = [.brand] + (NavigationGroup.primary.spaces + NavigationGroup.account.spaces).map { .space($0) }
}

private extension View {
    /// Makes the view a button the keyboard reaches with Tab whatever the Full Keyboard Access setting is, which
    /// the system only applies to its own controls. Space and Return open it, the arrow keys move along the bar,
    /// and a click opens it without leaving a ring behind.
    func navigationStop(
        _ stop: NavigationStop,
        focus: FocusState<NavigationStop?>.Binding,
        move: @escaping (NavigationStop, Int) -> Void,
        action: @escaping () -> Void
    ) -> some View {
        self
            .focusable(true, interactions: .edit)
            .focusEffectDisabled()
            .focused(focus, equals: stop)
            .onKeyPress(keys: [.space, .return]) { _ in
                action()
                return .handled
            }
            .onKeyPress(.leftArrow) {
                move(stop, -1)
                return .handled
            }
            .onKeyPress(.rightArrow) {
                move(stop, 1)
                return .handled
            }
            .onTapGesture {
                focus.wrappedValue = nil
                action()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { action() }
    }

    /// The keyboard focus ring: drawn outside the shape, with a gap, so that it contrasts with the page background
    /// whether or not the space is the filled current one.
    func focusRing(_ shape: some InsettableShape, isFocused: Bool) -> some View {
        modifier(FocusRing(shape: shape, isFocused: isFocused))
    }
}

private struct FocusRing<Outline: InsettableShape>: ViewModifier {
    let shape: Outline
    let isFocused: Bool

    @Environment(\.palette) private var palette

    func body(content: Content) -> some View {
        // Only present while focused, so that the ring does not enlarge the frame of every space.
        content.overlay {
            if isFocused {
                shape.inset(by: -3).stroke(palette[.focus], lineWidth: 3)
            }
        }
    }
}

/// Lays its views out left to right and starts a new line when the next one does not fit, as a wrapping flex row.
private struct FlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let arrangement = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        return CGSize(width: arrangement.width, height: arrangement.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let arrangement = arrange(width: bounds.width, subviews: subviews)
        for (subview, origin) in zip(subviews, arrangement.origins) {
            subview.place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (origins: [CGPoint], width: CGFloat, height: CGFloat) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (origins, widest, y + lineHeight)
    }
}

/// One space of the bar: a pill with its icon and label, filled with the accent when it is the current space.
private struct NavigationItem: View {
    let space: Space
    let language: Language
    let isSelected: Bool
    let isFocused: Bool

    @Environment(\.palette) private var palette
    @State private var isHovering = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: space.systemImage)
                .font(.system(size: 17))
            Text(language.text(space.label))
                .font(.system(size: 16))
        }
        .foregroundStyle(isSelected ? palette[.onAccent] : palette[.text])
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .background(background, in: Capsule())
        .contentShape(Capsule())
        .focusRing(Capsule(), isFocused: isFocused)
        .onHover { isHovering = $0 }
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
