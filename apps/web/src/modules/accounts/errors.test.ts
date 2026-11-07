import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { classifyErrorResponse } from '../../api/outcome.ts';
import { languages } from '../../i18n/languages.ts';
import { forbiddenWordIn } from '../../i18n/voice.ts';
import { describeFailure, explainedCodes, messageByCode, type Retry } from './errors.ts';
import { accountsTexts } from './texts.ts';

type Operation = { operationId?: string; responses: Record<string, { description?: string }> };
const contract = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../contracts/openapi.json', import.meta.url)), 'utf8')) as {
  paths: Record<string, Record<string, Operation>>;
};

const registrationOperations = ['registerLocalAccount', 'listOAuthProviders', 'startOAuthRegistration', 'completeOAuthRegistration'];

/**
 * Every stable error code the contract names for the registration operations, with the HTTP status the
 * contract gives it: the status of the response that mentions the code, or the one written after it in the
 * `default` response (`internal_error` (500)).
 */
function contractCodes(): Map<string, number> {
  const statuses = new Map<string, number>();
  for (const methods of Object.values(contract.paths)) {
    for (const operation of Object.values(methods)) {
      if (operation.operationId === undefined || !registrationOperations.includes(operation.operationId)) {
        continue;
      }
      for (const [status, response] of Object.entries(operation.responses)) {
        const description = response.description ?? '';
        if (status === 'default') {
          for (const match of description.matchAll(/`([a-z_]+)` \((\d{3})\)/g)) {
            statuses.set(match[1] as string, Number(match[2]));
          }
          continue;
        }
        for (const match of description.matchAll(/`((?:accounts|idempotency)_[a-z_]+|validation_failed|unsupported_api_version|payload_too_large|unsupported_media_type)`/g)) {
          statuses.set(match[1] as string, Number(status));
        }
      }
    }
  }
  return statuses;
}

const answer = (status: number, code: string, fields?: readonly string[]) =>
  classifyErrorResponse(
    status,
    { error: { code, message: 'English text for developers', requestId: 'req-1', ...(fields === undefined ? {} : { issues: fields.map((path) => ({ path, message: 'x' })) }) } },
    explainedCodes,
  );

/** How a retry goes after each code; any code of the contract that is not here must be a definite refusal. */
const expectedRetry: Readonly<Record<string, Retry>> = {
  accounts_busy: 'same',
  idempotency_key_in_use: 'same',
  database_busy: 'same',
  internal_error: 'same',
  stopping: 'same',
  idempotency_capacity_reached: 'withoutKey',
};

describe('registration failure messages', () => {
  const codes = contractCodes();

  it('are read from the real contract, with the statuses the server uses', () => {
    assert.equal(codes.get('accounts_username_taken'), 409);
    assert.equal(codes.get('accounts_oauth_provider_failed'), 502);
    assert.equal(codes.get('accounts_oauth_flow_consumed'), 503);
    assert.equal(codes.get('accounts_busy'), 503);
    assert.equal(codes.get('idempotency_capacity_reached'), 503);
    assert.equal(codes.get('payload_too_large'), 413);
    assert.equal(codes.get('internal_error'), 500);
  });

  it('explain every stable code of the contract with its real status, and say how a retry goes', () => {
    for (const [code, status] of codes) {
      const failure = answer(status, code, code === 'validation_failed' ? ['body.password'] : undefined);
      const problem = describeFailure(failure);
      const where = `${code} (${String(status)})`;
      if (code === 'stopping') {
        assert.deepEqual(failure, { kind: 'unavailable' }, where);
        assert.equal(problem.message, 'errorUnavailable', where);
      } else if (code === 'unsupported_api_version') {
        assert.equal(problem.message, 'errorIncompatible', where);
      } else {
        assert.equal(failure.kind, 'error', `${where} must not look like a stopped service`);
        assert.notEqual(problem.message, 'errorUnavailable', where);
        assert.ok(code === 'validation_failed' || code in messageByCode, `${where} has no message`);
      }
      assert.equal(problem.retry, expectedRetry[code] ?? 'new', `${where}: retry`);
    }
  });

  it('are translated into every interface language, never the server text', () => {
    for (const [code, status] of codes) {
      const { message } = describeFailure(answer(status, code, ['body.username']));
      for (const language of languages) {
        const text = accountsTexts.texts[language][message];
        assert.ok(text.length > 0, `${code} in ${language}`);
        assert.doesNotMatch(text, /English text for developers/);
      }
    }
  });

  it('do not take a server that answered for a stopped service', () => {
    for (const [code, status] of [
      ['accounts_oauth_provider_failed', 502],
      ['accounts_oauth_flow_consumed', 503],
      ['accounts_busy', 503],
      ['idempotency_capacity_reached', 503],
    ] as const) {
      assert.equal(describeFailure(answer(status, code)).message === 'errorUnavailable', false, code);
    }
    // Without the explained code, a 502/503/504 stays a stopped service or a failing relay.
    assert.deepEqual(classifyErrorResponse(503, { error: { code: 'accounts_busy', message: 'x', requestId: 'r' } }), { kind: 'unavailable' });
    assert.deepEqual(answer(503, 'stopping'), { kind: 'unavailable' });
    assert.deepEqual(classifyErrorResponse(502, 'not json', explainedCodes), { kind: 'unavailable' });
  });

  it('point at the field that caused the problem', () => {
    assert.deepEqual(describeFailure(answer(409, 'accounts_username_taken')), { message: 'errorUsernameTaken', field: 'username', retry: 'new' });
    assert.equal(describeFailure(answer(400, 'validation_failed', ['body.password'])).field, 'password');
    assert.equal(describeFailure(answer(400, 'validation_failed', ['body.username'])).field, 'username');
    assert.equal(describeFailure(answer(400, 'validation_failed', ['body.role'])).field, undefined);
    assert.equal(describeFailure(answer(503, 'accounts_busy')).field, undefined);
  });

  it('distinguish an unreachable service, an incompatible client, and an unknown error', () => {
    assert.deepEqual(describeFailure({ kind: 'unavailable' }), { message: 'errorUnavailable', retry: 'same' });
    assert.equal(describeFailure({ kind: 'incompatible' }).message, 'errorIncompatible');
    assert.deepEqual(describeFailure({ kind: 'error', status: 500 }), { message: 'errorGeneric', retry: 'same' });
    assert.deepEqual(describeFailure(answer(418, 'a_code_from_the_future')).retry, 'new');
    assert.deepEqual(describeFailure(answer(500, 'a_code_from_the_future')).retry, 'same');
  });
});

describe('interface texts of the accounts module', () => {
  it('keep the placeholders the screen fills in', () => {
    for (const language of languages) {
      assert.match(accountsTexts.texts[language].successBody, /\{username\}/, language);
      assert.match(accountsTexts.texts[language].continueWithProvider, /\{provider\}/, language);
    }
  });
});

describe('field refusals of the server', () => {
  it('belong to the field the server named', () => {
    const refused = (...paths: string[]) => describeFailure(answer(400, 'validation_failed', paths));
    assert.deepEqual(refused('body.username'), { message: 'errorUsernameInvalid', field: 'username', retry: 'new' });
    assert.deepEqual(refused('body.password'), { message: 'errorPasswordInvalid', field: 'password', retry: 'new' });
    assert.equal(describeFailure(answer(409, 'accounts_username_taken')).field, 'username');
  });
});

describe('texts of the accounts screens', () => {
  it('has no text that no screen shows', () => {
    const here = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
    const code = ['RegisterPage.tsx', 'errors.ts', 'form.ts', 'registration.ts', 'rules.ts'].map(here).join('\n');
    for (const key of Object.keys(accountsTexts.texts.en)) {
      assert.match(code, new RegExp(`'${key}'`), `${key} is never used`);
    }
    for (const removed of ['subtitle', 'providersNote', 'usernameHint', 'passwordHint']) {
      assert.equal(removed in accountsTexts.texts.en, false, `${removed} stays removed`);
    }
  });
});

describe('what an ordinary person sees', () => {
  it('never shows a request identifier, even when the server gave one', () => {
    const problem = describeFailure(answer(409, 'accounts_username_taken'));
    assert.equal('requestId' in problem, false);
    const page = readFileSync(fileURLToPath(new URL('RegisterPage.tsx', import.meta.url)), 'utf8');
    assert.doesNotMatch(page, /requestId/);
  });

  it('uses no technical or deployment words in any language', () => {
    for (const language of languages) {
      for (const [key, text] of Object.entries(accountsTexts.texts[language])) {
        if (key !== 'providerGoogle' && key !== 'providerGithub') {
          assert.equal(forbiddenWordIn(text, language), undefined, `${language}.${key}: ${text}`);
        }
      }
    }
  });

  it('welcomes the new member without talking about the computer', () => {
    for (const language of languages) {
      assert.match(accountsTexts.texts[language].successBody, /\{username\}/, language);
    }
    assert.equal(accountsTexts.texts.fr.successBody, 'Bienvenue, {username} ! Votre compte est prêt.');
    assert.equal(accountsTexts.texts.en.successBody, 'Welcome, {username}! Your account is ready.');
  });

  it('says plainly that registration is not available when the service has no registration yet', () => {
    const problem = describeFailure(answer(404, 'not_found'));
    assert.equal(problem.message, 'errorNotAvailable');
    assert.equal(problem.retry, 'new', 'no immediate Try again');
  });
});
