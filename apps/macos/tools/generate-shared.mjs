import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates the Swift sources through which the macOS client reads the shared interface texts and theme
 * tokens, so that the JSON files stay their single source:
 *
 *   node apps/macos/tools/generate-shared.mjs [--check]
 *
 * Without `--check`, the generated files are written; with it, nothing is written and any difference is a
 * drift (exit code 1). A missing language, a missing or extra key, an empty text, different placeholders,
 * or an incomplete theme stops the generation (exit code 2).
 */

/** A shared JSON file that cannot produce complete Swift sources. */
class InvalidSourceError extends Error {}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const check = process.argv.includes('--check');

/** Interface languages, as offered by apps/web/src/i18n/languages.ts. */
const languages = ['en', 'fr', 'ja'];

/** Text modules the macOS client uses: the Swift type generated for each, and its `locales` folder. */
const textModules = [
  { type: 'ShellText', directory: 'apps/web/src/shell/locales' },
  { type: 'MacShellText', directory: 'apps/macos/Sources/NihonMacCore/Shell/locales' },
  { type: 'HomeText', directory: 'apps/web/src/modules/home/locales' },
  { type: 'LearningText', directory: 'apps/web/src/modules/learning/locales' },
  { type: 'KanjiText', directory: 'apps/web/src/modules/kanji/locales' },
  { type: 'LibraryText', directory: 'apps/web/src/modules/library/locales' },
  { type: 'ProfileText', directory: 'apps/web/src/modules/profile/locales' },
  { type: 'AdminText', directory: 'apps/web/src/modules/admin/locales' },
];

const themesDirectory = 'resources/themes';
const outputDirectory = 'apps/macos/Sources/NihonMacCore/Generated';
const notice = 'Generated from the shared JSON files. Do not edit: run `bun run macos:generate`.';

// Swift keywords that cannot name an enumeration case without backticks.
const swiftKeywords = new Set([
  'associatedtype', 'case', 'class', 'default', 'defer', 'deinit', 'do', 'else', 'enum', 'extension',
  'fallthrough', 'false', 'for', 'func', 'guard', 'if', 'import', 'in', 'init', 'inout', 'internal', 'is',
  'let', 'nil', 'operator', 'private', 'protocol', 'public', 'repeat', 'return', 'self', 'Self', 'static',
  'struct', 'subscript', 'super', 'switch', 'throw', 'throws', 'true', 'try', 'typealias', 'var', 'where', 'while',
]);

try {
  const files = new Map([
    [`${outputDirectory}/ModuleTexts.swift`, generateTexts()],
    [`${outputDirectory}/Themes.swift`, generateThemes()],
  ]);
  const drifted = [...files].filter(([path, content]) => read(path) !== content).map(([path]) => path);
  if (check) {
    if (drifted.length > 0) {
      console.error(`Shared resource drift: the generated Swift sources differ from the JSON files.\n${drifted.map((path) => `  ${path}`).join('\n')}`);
      console.error('Run `bun run macos:generate` and commit the result.');
      process.exitCode = 1;
    } else {
      console.log('Swift texts and themes are up to date.');
    }
  } else {
    for (const [path, content] of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    console.log('Swift texts and themes written.');
  }
} catch (error) {
  if (!(error instanceof InvalidSourceError)) {
    throw error;
  }
  console.error(error.message);
  process.exitCode = 2;
}

function generateTexts() {
  const lines = [`// ${notice}`, ''];
  for (const { type, directory } of textModules) {
    const texts = readLocales(directory);
    const keys = Object.keys(texts.en);
    lines.push(
      `/// Texts of \`${directory}\`.`,
      `public enum ${type}: String, TextKey {`,
      ...keys.map((key) => `    case ${caseName(key)}`),
      '',
      `    public static let source = ${swiftString(directory)}`,
      '',
      `    public static let table: [Language: [${type}: String]] = [`,
    );
    for (const language of languages) {
      lines.push(`        .${language}: [`);
      lines.push(...keys.map((key) => `            .${caseName(key)}: ${swiftString(texts[language][key])},`));
      lines.push('        ],');
    }
    lines.push('    ]', '}', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Reads and validates one `locales` folder: every language, the same keys and placeholders, no empty text. */
function readLocales(directory) {
  const files = readdirSync(join(root, directory)).filter((name) => name.endsWith('.json')).sort();
  const expected = languages.map((language) => `${language}.json`).sort();
  if (files.join() !== expected.join()) {
    throw new InvalidSourceError(`${directory}: expected ${expected.join(', ')}, found ${files.join(', ') || 'nothing'}.`);
  }
  const texts = Object.fromEntries(languages.map((language) => [language, readJson(`${directory}/${language}.json`)]));
  const keys = Object.keys(texts.en);
  if (keys.length === 0) {
    throw new InvalidSourceError(`${directory}/en.json defines no text.`);
  }
  for (const key of keys) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(key)) {
      throw new InvalidSourceError(`${directory}/en.json: "${key}" is not a camelCase key.`);
    }
  }
  for (const language of languages) {
    const entries = texts[language];
    if (Object.keys(entries).sort().join() !== [...keys].sort().join()) {
      throw new InvalidSourceError(`${directory}/${language}.json: keys differ from English.`);
    }
    for (const key of keys) {
      const value = entries[key];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new InvalidSourceError(`${directory}/${language}.json: "${key}" is empty.`);
      }
      if (placeholders(value) !== placeholders(texts.en[key])) {
        throw new InvalidSourceError(`${directory}/${language}.json: "${key}" placeholders differ from English.`);
      }
    }
  }
  return texts;
}

function generateThemes() {
  const themes = readdirSync(join(root, themesDirectory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map(readTheme);
  if (themes.length === 0) {
    throw new InvalidSourceError(`${themesDirectory} contains no theme.`);
  }
  const roles = Object.keys(themes[0].modes.light.colors);
  for (const theme of themes) {
    for (const mode of ['light', 'dark']) {
      const colors = theme.modes[mode]?.colors ?? {};
      if (Object.keys(colors).sort().join() !== [...roles].sort().join()) {
        throw new InvalidSourceError(`${themesDirectory}/${theme.id}: the ${mode} colors must define exactly ${roles.join(', ')}.`);
      }
      for (const [role, value] of Object.entries(colors)) {
        if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
          throw new InvalidSourceError(`${themesDirectory}/${theme.id}: ${mode} "${role}" is not a #RRGGBB color.`);
        }
      }
    }
    for (const pair of theme.contrastPairs ?? []) {
      if (!roles.includes(pair.foreground) || !roles.includes(pair.background) || typeof pair.minimum !== 'number') {
        throw new InvalidSourceError(`${themesDirectory}/${theme.id}: invalid contrast pair ${JSON.stringify(pair)}.`);
      }
    }
  }

  const mode = (theme, name) => {
    const { name: modeName, colors } = theme.modes[name];
    return [
      `            ${name}: ThemeMode(`,
      `                name: ${swiftString(modeName)},`,
      '                colors: [',
      ...roles.map((role) => `                    .${caseName(role)}: RGBColor(hex: 0x${colors[role].slice(1).toUpperCase()}),`),
      '                ]',
      '            ),',
    ];
  };

  const lines = [
    `// ${notice}`,
    '',
    `/// Color roles every theme of \`${themesDirectory}\` defines for both modes.`,
    'public enum ColorRole: String, CaseIterable, Sendable {',
    ...roles.map((role) => `    case ${caseName(role)}`),
    '}',
    '',
    `/// Every theme of \`${themesDirectory}\`, in folder order.`,
    'public enum ThemeCatalog {',
    '    public static let themes: [ThemeTokens] = [',
  ];
  for (const theme of themes) {
    lines.push(
      '        ThemeTokens(',
      `            id: ${swiftString(theme.id)},`,
      `            name: ${swiftString(theme.name)},`,
      ...mode(theme, 'light'),
      ...mode(theme, 'dark'),
      '            contrastPairs: [',
      ...(theme.contrastPairs ?? []).map(
        ({ foreground, background, minimum }) =>
          `                ContrastPair(foreground: .${caseName(foreground)}, background: .${caseName(background)}, minimum: ${Number(minimum).toFixed(1)}),`,
      ),
      '            ]',
      '        ),',
    );
  }
  lines.push('    ]', '}');
  return `${lines.join('\n')}\n`;
}

function readTheme(folder) {
  const path = `${themesDirectory}/${folder}/tokens.json`;
  const theme = readJson(path);
  if (theme.id !== folder || typeof theme.name !== 'string') {
    throw new InvalidSourceError(`${path}: "id" must be "${folder}" and "name" a string.`);
  }
  for (const mode of ['light', 'dark']) {
    if (typeof theme.modes?.[mode]?.name !== 'string') {
      throw new InvalidSourceError(`${path}: the ${mode} mode needs a name.`);
    }
  }
  return theme;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch (error) {
    throw new InvalidSourceError(`${path}: ${error.message}`);
  }
}

function read(path) {
  try {
    return readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');
  } catch {
    return undefined;
  }
}

function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join();
}

function caseName(key) {
  return swiftKeywords.has(key) ? `\`${key}\`` : key;
}

/** A Swift string literal; control characters use `\u{…}` escapes. */
function swiftString(text) {
  const escaped = [...text]
    .map((character) => {
      if (character === '\\') return '\\\\';
      if (character === '"') return '\\"';
      if (character === '\n') return '\\n';
      if (character === '\r') return '\\r';
      if (character === '\t') return '\\t';
      const code = character.codePointAt(0);
      return code < 0x20 || code === 0x7f ? `\\u{${code.toString(16)}}` : character;
    })
    .join('');
  return `"${escaped}"`;
}

