import { maxRedirectUriLength } from '../../config.ts';

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Whether the browser may be sent back to `value` after the provider. Accepted: an exact address
 * the installation lists, or an `http` loopback address (any port and path), which is what the Web
 * client served by this server and a native client's local listener use. Never an address of
 * another host that the request merely names, so a code cannot be steered to a third party.
 */
export function isAcceptedRedirectUri(value: string, configured: readonly string[]): boolean {
  if (value.length > maxRedirectUriLength) {
    return false;
  }
  if (configured.includes(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      loopbackHosts.has(url.hostname) &&
      url.username === '' &&
      url.password === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}
