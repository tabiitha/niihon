import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { languages } from './languages.ts';

// Every module keeps its texts in `locales/<language>.json` next to its code. A key missing in any
// interface language fails here, so no screen ships with an untranslated text.
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

function findLocaleDirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) {
      return [];
    }
    const path = join(directory, entry.name);
    return entry.name === 'locales' ? [path] : findLocaleDirectories(path);
  });
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string).sort();
}

const localeDirectories = findLocaleDirectories(sourceRoot);

describe('interface texts', () => {
  it('exist for the shell and the six spaces', () => {
    const modules = localeDirectories.map((directory) => relative(sourceRoot, join(directory, '..')).replaceAll('\\', '/'));
    for (const module of ['shell', 'modules/home', 'modules/learning', 'modules/kanji', 'modules/library', 'modules/profile', 'modules/admin']) {
      assert.ok(modules.includes(module), `${module} has no locales directory`);
    }
  });

  for (const directory of localeDirectories) {
    const module = relative(sourceRoot, directory).replaceAll('\\', '/');

    it(`${module} has one file per interface language with the same keys and placeholders`, () => {
      assert.deepEqual(readdirSync(directory).sort(), languages.map((language) => `${language}.json`).sort());
      const texts = Object.fromEntries(
        languages.map((language) => [
          language,
          JSON.parse(readFileSync(join(directory, `${language}.json`), 'utf8')) as Record<string, unknown>,
        ]),
      );
      const englishKeys = Object.keys(texts['en'] ?? {}).sort();
      assert.ok(englishKeys.length > 0, `${module}/en.json is empty`);
      for (const language of languages) {
        const entries = texts[language] ?? {};
        assert.deepEqual(Object.keys(entries).sort(), englishKeys, `${module}/${language}.json keys differ from English`);
        for (const key of englishKeys) {
          const value = entries[key];
          assert.ok(typeof value === 'string' && value.trim() !== '', `${module}/${language}.json: "${key}" is empty`);
          assert.deepEqual(
            placeholders(value),
            placeholders(texts['en']?.[key] as string),
            `${module}/${language}.json: "${key}" placeholders differ from English`,
          );
        }
      }
    });
  }
});
