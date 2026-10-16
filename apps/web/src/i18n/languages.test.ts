import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { selectLanguage } from './languages.ts';

describe('selectLanguage', () => {
  it('prefers the signed-in profile language', () => {
    assert.equal(selectLanguage('ja', ['fr-FR', 'en']), 'ja');
  });

  it('otherwise takes the first offered browser language, ignoring the region', () => {
    assert.equal(selectLanguage(undefined, ['de-DE', 'fr-CA', 'ja']), 'fr');
    assert.equal(selectLanguage(undefined, ['JA-jp']), 'ja');
  });

  it('ignores a profile language that is not offered', () => {
    assert.equal(selectLanguage('de', ['ja-JP']), 'ja');
  });

  it('falls back to English', () => {
    assert.equal(selectLanguage(undefined, ['de-DE', 'zh-Hans']), 'en');
    assert.equal(selectLanguage(undefined, []), 'en');
  });
});
