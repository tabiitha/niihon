/// Nihon speaks like a professional consumer website: its texts say nothing about how it is built or deployed
/// (AGENTS.md). `ForbiddenWords` is generated from the Web client's `voice.ts`, the single list of words the
/// interface must not use; the core tests check every generated text with it.
public enum Voice {
    /// The first forbidden word of a text, or `nil`. Placeholders such as `{username}` are removed first. The
    /// expressions are matched as JavaScript does with the `u` flag: on Unicode scalars, with Unicode letter and
    /// digit classes. The character a translated lookbehind captured (`lbN`) is not part of the reported word.
    public static func forbiddenWord(in text: String, language: Language) -> String? {
        guard let entry = ForbiddenWords.patterns[language], let regex = try? Regex(entry.pattern) else { return nil }
        let words = text.replacing(/\{[a-zA-Z]+\}/, with: "")
        let matcher = regex.ignoresCase(entry.ignoresCase).matchingSemantics(.unicodeScalar)
        guard let found = try? matcher.firstMatch(in: words) else { return nil }
        var start = found.range.lowerBound
        for index in 0... {
            let name = "lb\(index)"
            guard entry.pattern.contains("(?<\(name)>") else { break }
            if let before = found.output[name]?.range, before.lowerBound == start {
                start = before.upperBound
            }
        }
        return String(words.unicodeScalars[start..<found.range.upperBound])
    }
}
