/** A username as stored: `username` for display, `key` for uniqueness. */
export interface NormalizedUsername {
  readonly username: string;
  readonly key: string;
}

export const minUsernameLength = 3;
export const maxUsernameLength = 32;

/**
 * Usernames are letters (any script, so Japanese works), digits, marks, and `_ - .`, starting with
 * a letter or digit.
 */
const usernamePattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_.-]*$/u;

/**
 * Normalizes a username the way uniqueness is judged: Unicode compatibility composition (NFKC) so
 * that full-width and composed forms collapse, then lowercase for the comparison key. The display
 * form keeps its case. Returns `undefined` when the result is not an acceptable username.
 */
export function normalizeUsername(input: string): NormalizedUsername | undefined {
  const username = input.normalize('NFKC').trim();
  const length = [...username].length;
  if (length < minUsernameLength || length > maxUsernameLength || !usernamePattern.test(username)) {
    return undefined;
  }
  return { username, key: username.toLowerCase().normalize('NFKC') };
}
