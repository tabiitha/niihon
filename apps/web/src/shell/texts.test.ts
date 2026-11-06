import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { languages } from '../i18n/languages.ts';
import { shellTexts } from './texts.ts';

describe('what the shell tells an ordinary person', () => {
  it('shows no request identifier, version, address, or code when a page cannot load', () => {
    const panel = readFileSync(fileURLToPath(new URL('StatusPanel.tsx', import.meta.url)), 'utf8');
    assert.doesNotMatch(panel, /requestId|ApiVersion|apiVersion|serverApiVersion/);
    for (const removed of ['errorReference', 'incompatibleVersions']) {
      assert.equal(removed in shellTexts.texts.en, false, `${removed} stays removed`);
    }
  });

  it('uses no technical words in any language', () => {
    const technical: Record<string, RegExp> = {
      en: /\b(service|server|log|request|api|version|code|http|localhost)\b/i,
      fr: /\b(service|serveur|journal|requête|api|version|code|http|localhost)\b/i,
      ja: /サービス|サーバー|ログ(?!イン)|参照番号|リクエスト|API|バージョン|コード|http/,
    };
    for (const language of languages) {
      for (const [key, text] of Object.entries(shellTexts.texts[language])) {
        assert.doesNotMatch(text.replace(/\{[a-zA-Z]+\}/g, ''), technical[language] as RegExp, `${language}.${key}: ${text}`);
      }
    }
  });
});
