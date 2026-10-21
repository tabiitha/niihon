import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeUsername } from './username.ts';

describe('username normalization', () => {
  it('keeps the display form and compares case-insensitively', () => {
    assert.deepEqual(normalizeUsername('Sakura_42'), { username: 'Sakura_42', key: 'sakura_42' });
    assert.equal(normalizeUsername('SAKURA_42')?.key, normalizeUsername('sakura_42')?.key);
  });

  it('collapses compatibility forms: full-width letters and composed marks', () => {
    assert.equal(normalizeUsername('ＳＡＫＵＲＡ')?.key, 'sakura');
    assert.equal(normalizeUsername('café')?.key, normalizeUsername('café')?.key);
    assert.equal(normalizeUsername('がさ')?.key, normalizeUsername('がさ')?.key);
  });

  it('accepts Japanese names', () => {
    assert.equal(normalizeUsername('さくら')?.username, 'さくら');
  });

  it('trims surrounding spaces and refuses inner ones', () => {
    assert.equal(normalizeUsername('  taro  ')?.username, 'taro');
    assert.equal(normalizeUsername('ta ro'), undefined);
  });

  it('refuses names that are too short, too long, or start with a symbol', () => {
    for (const input of ['ab', 'a'.repeat(33), '_taro', '-taro', '.taro', 'ta\u0000ro', 'ta/ro', '😀😀😀', '']) {
      assert.equal(normalizeUsername(input), undefined, JSON.stringify(input));
    }
    assert.ok(normalizeUsername('a'.repeat(32)));
  });
});
