import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { languages } from './languages.ts';
import { forbiddenWordIn } from './voice.ts';

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

// Brand names are shown as they are.
const brandKeys = new Set(['providerGoogle', 'providerGithub']);

describe('the voice of the interface', () => {
  const directories = findLocaleDirectories(sourceRoot);

  it('covers the shell and every module', () => {
    const modules = directories.map((directory) => relative(sourceRoot, join(directory, '..')).replaceAll('\\', '/'));
    for (const module of ['shell', 'modules/accounts', 'modules/home', 'modules/learning', 'modules/kanji', 'modules/library', 'modules/profile', 'modules/admin']) {
      assert.ok(modules.includes(module), module);
    }
  });

  for (const directory of directories) {
    const module = relative(sourceRoot, join(directory, '..')).replaceAll('\\', '/');
    it(`${module} speaks to people, not about the machine or the code`, () => {
      for (const language of languages) {
        const texts = JSON.parse(readFileSync(join(directory, `${language}.json`), 'utf8')) as Record<string, string>;
        for (const [key, text] of Object.entries(texts)) {
          if (!brandKeys.has(key)) {
            assert.equal(forbiddenWordIn(text, language), undefined, `${module} ${language}.${key}: ${text}`);
          }
        }
      }
    });
  }

  it('catches the words of each kind in each language', () => {
    const caught: readonly (readonly [string, (typeof languages)[number]])[] = [
      ['The account is ready on this computer.', 'en'],
      ['Open Nihon on this Mac.', 'en'],
      ['Saved locally.', 'en'],
      ['You are offline.', 'en'],
      ['Install Nihon first.', 'en'],
      ['On this machine.', 'en'],
      ['Check the server.', 'en'],
      ['Le compte est prêt sur cet ordinateur.', 'fr'],
      ['Ouvrez Nihon sur ce Mac.', 'fr'],
      ['Enregistré en local.', 'fr'],
      ['Vous êtes hors ligne.', 'fr'],
      ['Vous êtes hors-ligne.', 'fr'],
      ['Après l’installation.', 'fr'],
      ['Sur cette machine.', 'fr'],
      ['Vérifiez le serveur.', 'fr'],
      ['このコンピューターに作成されました。', 'ja'],
      ['パソコンで開いてください。', 'ja'],
      ['このMacで開いてください。', 'ja'],
      ['ローカルに保存しました。', 'ja'],
      ['オフラインです。', 'ja'],
      ['インストールしてください。', 'ja'],
      ['サーバーを確認してください。', 'ja'],
    ];
    for (const [text, language] of caught) {
      assert.notEqual(forbiddenWordIn(text, language), undefined, `${language}: ${text}`);
    }
    assert.equal(forbiddenWordIn('ログインしてください。', 'ja'), undefined, 'logging in is not a log');
    assert.equal(forbiddenWordIn('Welcome, {username}!', 'en'), undefined);
  });
});
