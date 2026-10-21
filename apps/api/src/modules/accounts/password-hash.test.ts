import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { argon2Parameters, hashPassword, verifyPassword } from './password-hash.ts';

describe('password hashing', () => {
  it('writes an Argon2id PHC string with the documented parameters and a fresh salt', async () => {
    const [first, second] = await Promise.all([hashPassword('correct horse'), hashPassword('correct horse')]);
    const pattern = new RegExp(`^\\$argon2id\\$v=19\\$m=${argon2Parameters.memoryKiB},t=${argon2Parameters.passes},p=${argon2Parameters.parallelism}\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}$`);
    assert.match(first, pattern);
    assert.notEqual(first, second);
    assert.ok(!first.includes('correct horse'));
  });

  it('verifies the password it hashed and nothing else', async () => {
    const hash = await hashPassword('correct horse');
    assert.equal(await verifyPassword('correct horse', hash), true);
    assert.equal(await verifyPassword('correct horses', hash), false);
    assert.equal(await verifyPassword('', hash), false);
  });

  it('treats Unicode-equivalent passwords as the same', async () => {
    const hash = await hashPassword('ｐａｓｓｗｏｒｄ１２３');
    assert.equal(await verifyPassword('password123', hash), true);
  });

  it('verifies a fixed known-answer hash, which pins the PHC parsing and the parameter handling', async () => {
    // A stored hash with other parameters than the current ones (t=2): password "password", salt "somesalt".
    const stored = '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc';
    assert.equal(await verifyPassword('password', stored), true);
    assert.equal(await verifyPassword('Password', stored), false);
  });

  it('refuses malformed hashes and hashes that ask for excessive resources', async () => {
    for (const stored of [
      '',
      'plain-text',
      '$argon2i$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc',
      '$argon2id$v=19$m=4294967295,t=3,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc',
      '$argon2id$v=19$m=65536,t=999999,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc',
      '$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$AAAA',
    ]) {
      assert.equal(await verifyPassword('password', stored), false, stored);
    }
  });
});
