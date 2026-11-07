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

  it('catches the words of each kind in each language, as whole words, plurals included', () => {
    const caught: Readonly<Record<(typeof languages)[number], readonly string[]>> = {
      en: [
        'The account is ready on this computer.', 'Two computers.', 'Open Nihon on this Mac.', 'Use your Mac.', 'Saved locally.',
        'Saved on a local disk.', 'You are offline.', 'Install Nihon first.', 'Uninstall Nihon.', 'Reinstall it.',
        'On this machine.', 'Check the server.', 'All servers.', 'Two services.', 'Versions differ.', 'Check the addresses.',
        'On this device.', 'Use a PC.', 'Logs.', 'Request ID 4.', 'Enter the key.', 'Open 127.0.0.1.',
      ],
      fr: [
        'Le compte est prêt sur cet ordinateur.', 'Deux ordinateurs.', 'Ouvrez Nihon sur ce Mac.', 'Utilisez un Mac.',
        'Enregistré en local.', 'Des fichiers locaux.', 'Vous êtes hors ligne.', 'Vous êtes hors-ligne.', 'Après l’installation.',
        'Désinstallez Nihon.', 'Réinstallez Nihon.', 'Sur cette machine.', 'Vérifiez le serveur.', 'Les serveurs.',
        'Les adresses.', 'Les versions.', 'Sur cet appareil.', 'Sur un PC.', 'La clé.', 'Entrez la clé de secours.',
        'Le journal.',
      ],
      ja: [
        'このコンピューターに作成されました。', 'パソコンで開いてください。', 'このMacで開いてください。', 'Macで開きます。',
        'ローカルに保存しました。', 'オフラインです。', 'インストールしてください。', 'アンインストールしてください。',
        'サーバーを確認してください。', 'この端末で開いてください。', 'PCで開きます。', 'キーを入力してください。',
      ],
    };
    for (const language of languages) {
      for (const text of caught[language]) {
        assert.notEqual(forbiddenWordIn(text, language), undefined, `${language}: ${text}`);
      }
    }
  });

  it('lets ordinary words through', () => {
    const allowed: Readonly<Record<(typeof languages)[number], readonly string[]>> = {
      en: ['Welcome, {username}!', 'Use the keyboard.', 'This browser blocks the rest of the sign-up.', 'Macro lessons.', 'Locate a kanji.', 'Catalogue.', 'A quick review.'],
      fr: ['Bienvenue, {username} !', 'Utilisez le clavier.', 'Ce navigateur bloque la suite de l’inscription.', 'Un macaron.', 'La localisation.', 'Les leçons de kana.'],
      ja: ['ログインしてください。', 'キーボードで入力できます。', 'このブラウザでは続けられません。', 'マクロ', 'ようこそ、{username}さん！'],
    };
    for (const language of languages) {
      for (const text of allowed[language]) {
        assert.equal(forbiddenWordIn(text, language), undefined, `${language}: ${text}`);
      }
    }
  });
});
