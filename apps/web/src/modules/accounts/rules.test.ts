import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { checkConfirmation, checkPassword, checkUsername, passwordRules, usernameRules } from './rules.ts';

interface FieldSchema {
  readonly maxLength: number;
  readonly 'x-nihon-rules': Record<string, unknown>;
}

const contract = JSON.parse(readFileSync(new URL('../../../../../contracts/openapi.json', import.meta.url), 'utf8')) as {
  components: { schemas: Record<string, { properties: Record<string, FieldSchema> }> };
};
const field = (schema: string, name: string) => contract.components.schemas[schema]!.properties[name]!;

describe('typing rules', () => {
  it('are the rules of the contract, for a local account and for a provider registration', () => {
    const { rawMaxLength: usernameRaw, ...username } = usernameRules;
    const { rawMaxLength: passwordRaw, ...password } = passwordRules;
    for (const schema of ['LocalRegistration', 'OAuthRegistrationStart']) {
      assert.deepEqual(field(schema, 'username')['x-nihon-rules'], username, schema);
      assert.equal(field(schema, 'username').maxLength, usernameRaw, schema);
    }
    assert.deepEqual(field('LocalRegistration', 'password')['x-nihon-rules'], password);
    assert.equal(field('LocalRegistration', 'password').maxLength, passwordRaw);
  });

  it('count characters after NFKC, accept letters of any script, and start with a letter or digit', () => {
    for (const accepted of ['abc', 'さくら', 'Ｓａｋｕｒａ', '  taro  ', 'a'.repeat(32), 'ab_c-d.e', '1abc', 'café']) {
      assert.equal(checkUsername(accepted), undefined, JSON.stringify(accepted));
    }
    for (const refused of ['ab', 'a'.repeat(33), '_abc', '.abc', 'ta ro', 'ta/ro', '😀😀😀', `${' '.repeat(260)}taro`]) {
      assert.equal(checkUsername(refused), 'errorUsernameInvalid', JSON.stringify(refused));
    }
    assert.equal(checkUsername('   '), 'usernameRequired');
  });

  it('want a password of 8 to 128 characters, not blank, without control characters, other than the username', () => {
    assert.equal(checkPassword('', 'sakura'), 'passwordRequired');
    for (const accepted of ['12345678', 'パスワードです本当', 'x'.repeat(128), 'sakura12']) {
      assert.equal(checkPassword(accepted, 'sakura'), undefined, accepted);
    }
    for (const refused of ['1234567', 'x'.repeat(129), 'SAKURA_42', 'ＳＡＫＵＲＡ＿４２']) {
      assert.equal(checkPassword(refused, 'Sakura_42'), 'errorPasswordInvalid', JSON.stringify(refused));
    }
    // Refusals the length rule does not explain say why in plain words.
    assert.equal(checkPassword(' '.repeat(8), 'Sakura_42'), 'passwordOnlySpaces');
    assert.equal(checkPassword('\u3000'.repeat(10), 'Sakura_42'), 'passwordOnlySpaces', 'ideographic spaces too');
    assert.equal(checkPassword('abcd\u0007efgh', 'Sakura_42'), 'passwordCharacter');
    assert.equal(checkConfirmation('a long passphrase', 'a long passphrase'), undefined);
    assert.equal(checkConfirmation('a long passphrase', 'a long passphrasE'), 'passwordsDiffer');
  });
});
