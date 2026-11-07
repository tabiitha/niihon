import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { languages } from '../i18n/languages.ts';
import { forbiddenWordIn } from '../i18n/voice.ts';
import { shellTexts } from './texts.ts';

describe('what the shell tells an ordinary person', () => {
  it('shows no request identifier, version, address, or code when a page cannot load', () => {
    const panel = readFileSync(fileURLToPath(new URL('StatusPanel.tsx', import.meta.url)), 'utf8');
    assert.doesNotMatch(panel, /requestId|ApiVersion|apiVersion|serverApiVersion/);
    for (const removed of ['errorReference', 'incompatibleVersions']) {
      assert.equal(removed in shellTexts.texts.en, false, `${removed} stays removed`);
    }
  });

  it('uses no technical or deployment words in any language', () => {
    for (const language of languages) {
      for (const [key, text] of Object.entries(shellTexts.texts[language])) {
        assert.equal(forbiddenWordIn(text, language), undefined, `${language}.${key}: ${text}`);
      }
    }
  });
});
