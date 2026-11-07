/// Nihon speaks like a professional consumer website: its texts say nothing about how it is built or deployed
/// (AGENTS.md). `ForbiddenWords` is generated from the Web client's `voice.ts`, the single list of words the
/// interface must not use; the core tests check every generated text with it.
public enum Voice {
    /// The first forbidden word of a text, or `nil`. Placeholders such as `{username}` are removed first. The
    /// expressions are matched as JavaScript does without the `u` flag: word characters and boundaries are ASCII,
    /// so that "clé" or "Réinstallez" are judged exactly as by the Web tests.
    public static func forbiddenWord(in text: String, language: Language) -> String? {
        guard let entry = ForbiddenWords.patterns[language], let regex = try? Regex(entry.pattern) else { return nil }
        let words = text.replacing(/\{[a-zA-Z]+\}/, with: "")
        let matcher = regex
            .ignoresCase(entry.ignoresCase)
            .asciiOnlyWordCharacters()
            .wordBoundaryKind(.simple)
            .matchingSemantics(.unicodeScalar)
        return (try? matcher.firstMatch(in: words)).map { String(words[$0.range]) }
    }
}
