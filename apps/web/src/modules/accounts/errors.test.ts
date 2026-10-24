import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { classifyErrorResponse } from '../../api/outcome.ts';
import { languages } from '../../i18n/languages.ts';
import { describeFailure, mayHaveCreatedProfile, messageByCode } from './errors.ts';
import { accountsTexts } from './texts.ts';

const contract = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../contracts/openapi.json', import.meta.url)), 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string; description?: string; responses: Record<string, { description?: string }> }>>;
};

const registrationOperations = ['registerLocalAccount', 'listOAuthProviders', 'startOAuthRegistration', 'completeOAuthRegistration'];

/** Every stable error code the contract names in the descriptions of the registration operations. */
function contractCodes(): string[] {
  const codes = new Set<string>();
  for (const methods of Object.values(contract.paths)) {
    for (const operation of Object.values(methods)) {
      if (operation.operationId === undefined || !registrationOperations.includes(operation.operationId)) {
        continue;
      }
      const text = [operation.description ?? '', ...Object.values(operation.responses).map((response) => response.description ?? '')].join('\n');
      for (const match of text.matchAll(/`((?:accounts|idempotency)_[a-z_]+|validation_failed)`/g)) {
        codes.add(match[1] as string);
      }
    }
  }
  return [...codes].sort();
}

const failureOf = (code: string, fields?: readonly string[]) =>
  classifyErrorResponse(409, { error: { code, message: 'English text for developers', requestId: 'req-1', ...(fields === undefined ? {} : { issues: fields.map((path) => ({ path, message: 'x' })) }) } });

describe('registration failure messages', () => {
  it('cover every stable code the contract names for the registration operations', () => {
    const codes = contractCodes();
    assert.ok(codes.includes('accounts_username_taken') && codes.includes('accounts_oauth_flow_consumed'), codes.join());
    for (const code of codes) {
      assert.ok(code === 'validation_failed' || code in messageByCode, `${code} has no message`);
      const problem = describeFailure(failureOf(code, code === 'validation_failed' ? ['body.password'] : undefined));
      assert.notEqual(problem.message, 'errorGeneric', `${code} has no specific message`);
    }
  });

  it('are translated into every interface language, never the server text', () => {
    const codes = contractCodes();
    for (const code of codes) {
      const { message } = describeFailure(failureOf(code, ['body.username']));
      for (const language of languages) {
        const text = accountsTexts.texts[language][message];
        assert.ok(text.length > 0, `${code} in ${language}`);
        assert.doesNotMatch(text, /English text for developers/);
      }
    }
  });

  it('point at the field that caused the problem', () => {
    assert.deepEqual(describeFailure(failureOf('accounts_username_taken')), { message: 'errorUsernameTaken', field: 'username', requestId: 'req-1' });
    assert.equal(describeFailure(failureOf('validation_failed', ['body.password'])).field, 'password');
    assert.equal(describeFailure(failureOf('validation_failed', ['body.username'])).field, 'username');
    assert.equal(describeFailure(failureOf('validation_failed', ['body.role'])).field, undefined);
    assert.equal(describeFailure(failureOf('accounts_busy')).field, undefined);
  });

  it('distinguish an unreachable service, an incompatible client, and an unknown error', () => {
    assert.equal(describeFailure({ kind: 'unavailable' }).message, 'errorUnavailable');
    assert.equal(describeFailure({ kind: 'incompatible' }).message, 'errorIncompatible');
    assert.equal(describeFailure({ kind: 'error', status: 500 }).message, 'errorGeneric');
    assert.equal(describeFailure(failureOf('a_code_from_the_future')).message, 'errorGeneric');
  });

  it('leave it open whether a profile was created only when no explained answer arrived', () => {
    assert.equal(mayHaveCreatedProfile({ kind: 'unavailable' }), true);
    assert.equal(mayHaveCreatedProfile({ kind: 'error', status: 500 }), true);
    assert.equal(mayHaveCreatedProfile(failureOf('accounts_username_taken')), false);
    assert.equal(mayHaveCreatedProfile(failureOf('accounts_busy')), false);
    assert.equal(mayHaveCreatedProfile({ kind: 'incompatible' }), false);
  });
});

describe('interface texts of the accounts module', () => {
  it('keep the placeholders the screen fills in', () => {
    for (const language of languages) {
      assert.match(accountsTexts.texts[language].successBody, /\{username\}/, language);
      assert.match(accountsTexts.texts[language].continueWithProvider, /\{provider\}/, language);
      assert.match(accountsTexts.texts[language].errorReference, /\{requestId\}/, language);
    }
  });
});
