export const minPasswordLength = 8;
export const maxPasswordLength = 128;

/**
 * Password rules: length is counted in characters (code points) after Unicode normalization, so a
 * passphrase in any script is accepted; there are no composition rules. Returns the reason a
 * password is refused, or `undefined` when it is acceptable. Reasons never include the password.
 */
export function checkPassword(password: string, usernameKey: string): string | undefined {
  const normalized = password.normalize('NFKC');
  const length = [...normalized].length;
  if (length < minPasswordLength) {
    return `The password must have at least ${minPasswordLength} characters.`;
  }
  if (length > maxPasswordLength) {
    return `The password must have at most ${maxPasswordLength} characters.`;
  }
  if (normalized.trim() === '') {
    return 'The password must not be blank.';
  }
  if (/\p{Cc}/u.test(normalized)) {
    return 'The password must not contain control characters.';
  }
  if (normalized.toLowerCase() === usernameKey) {
    return 'The password must differ from the username.';
  }
  return undefined;
}
