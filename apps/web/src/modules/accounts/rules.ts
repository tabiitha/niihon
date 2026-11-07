import type { FormField, TextKey } from './errors.ts';

/**
 * The server's rules for a username and a password, copied from the contract (`contracts/openapi.json`, the
 * `x-nihon-rules` of `LocalRegistration` and `OAuthRegistrationStart`, with the raw `maxLength` of the same
 * fields). `rules.test.ts` fails when they differ from the contract, and checks a set of values against the real
 * server. They only help with typing: the server still decides, and its refusals are shown the same way.
 */
export const usernameRules = {
  normalization: 'NFKC',
  trim: true,
  minLength: 3,
  maxLength: 32,
  pattern: '^[\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M}_.-]*$',
  /** The longest value the server reads at all, in UTF-16 code units (`maxLength` of the field). */
  rawMaxLength: 256,
} as const;

export const passwordRules = {
  normalization: 'NFKC',
  minLength: 8,
  maxLength: 128,
  notBlank: true,
  noControlCharacters: true,
  differentFromUsername: true,
  rawMaxLength: 512,
} as const;

const usernamePattern = new RegExp(usernameRules.pattern, 'u');

/** Lengths count Unicode code points, as the server does. */
const codePoints = (value: string) => [...value].length;

/** The form of a username that the server compares: NFKC, trimmed, then lowercase NFKC. */
function usernameKey(username: string): string {
  return username.normalize('NFKC').trim().toLowerCase().normalize('NFKC');
}

export function checkUsername(username: string): TextKey | undefined {
  if (username.trim() === '') {
    return 'usernameRequired';
  }
  const normalized = username.normalize('NFKC').trim();
  const length = codePoints(normalized);
  if (
    username.length > usernameRules.rawMaxLength ||
    length < usernameRules.minLength ||
    length > usernameRules.maxLength ||
    !usernamePattern.test(normalized)
  ) {
    return 'errorUsernameInvalid';
  }
  return undefined;
}

export function checkPassword(password: string, username: string): TextKey | undefined {
  if (password === '') {
    return 'passwordRequired';
  }
  const normalized = password.normalize('NFKC');
  const length = codePoints(normalized);
  // Two refusals the length rule does not explain get their own words.
  if (normalized.trim() === '') {
    return 'passwordOnlySpaces';
  }
  if (/\p{Cc}/u.test(normalized)) {
    return 'passwordCharacter';
  }
  if (
    password.length > passwordRules.rawMaxLength ||
    length < passwordRules.minLength ||
    length > passwordRules.maxLength ||
    normalized.toLowerCase() === usernameKey(username)
  ) {
    return 'errorPasswordInvalid';
  }
  return undefined;
}

export function checkConfirmation(password: string, confirmation: string): TextKey | undefined {
  return confirmation === password ? undefined : 'passwordsDiffer';
}

export interface Entries {
  readonly username: string;
  readonly password: string;
  readonly confirmation: string;
}

/** The local check of one field, given everything typed. */
export function checkField(field: FormField, entries: Entries): TextKey | undefined {
  switch (field) {
    case 'username':
      return checkUsername(entries.username);
    case 'password':
      return checkPassword(entries.password, entries.username);
    case 'confirmation':
      return checkConfirmation(entries.password, entries.confirmation);
  }
}
