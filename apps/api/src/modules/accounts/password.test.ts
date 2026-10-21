import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkPassword } from './password.ts';

describe('password rules', () => {
  it('accepts passphrases of 8 to 128 characters in any script', () => {
    assert.equal(checkPassword('correct horse', 'taro'), undefined);
    assert.equal(checkPassword('さくらさくらさくら', 'taro'), undefined);
    assert.equal(checkPassword('a'.repeat(128), 'taro'), undefined);
  });

  it('counts characters, not bytes or UTF-16 units', () => {
    assert.equal(checkPassword('😀'.repeat(8), 'taro'), undefined);
    assert.ok(checkPassword('😀'.repeat(7), 'taro'));
  });

  it('refuses short, long, blank, control-character and username-equal passwords', () => {
    assert.ok(checkPassword('short', 'taro'));
    assert.ok(checkPassword('a'.repeat(129), 'taro'));
    assert.ok(checkPassword('         ', 'taro'));
    assert.ok(checkPassword('pass\nword1234', 'taro'));
    assert.ok(checkPassword('Sakura_42', 'sakura_42'));
  });

  it('never repeats the password in a refusal', () => {
    const reason = checkPassword('hunter2', 'taro');
    assert.ok(reason);
    assert.ok(!reason.includes('hunter2'));
  });
});
