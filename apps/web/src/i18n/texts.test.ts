import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatText } from './texts.ts';

describe('formatText', () => {
  it('replaces placeholders with their values', () => {
    assert.equal(formatText('{page} · Niihon', { page: 'Kanji' }), 'Kanji · Niihon');
    assert.equal(formatText('{count} / {count}', { count: 3 }), '3 / 3');
  });

  it('leaves unknown placeholders visible', () => {
    assert.equal(formatText('Media {mediaId}'), 'Media {mediaId}');
  });
});
