import { isAbsolute, resolve } from 'node:path';

export const defaultHost = '127.0.0.1';
export const defaultPort = 4000;

const moduleIdPattern = /^[a-z][a-z0-9-]*$/;

/** Credentials of the Nihon application registered with one OAuth provider; the secret never leaves the server. */
export interface OAuthClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Providers with a Nihon registration on this installation, and where the browser may return to. */
export interface OAuthSettings {
  readonly providers: Readonly<Record<string, OAuthClientCredentials>>;
  /** Exact return addresses accepted in addition to loopback addresses (`http://127.0.0.1:<port>/...`). */
  readonly redirectUris: readonly string[];
}

export const noOAuthSettings: OAuthSettings = { providers: {}, redirectUris: [] };

/** Providers whose credentials the configuration can carry, with the variable name stem of each. */
const oauthProviderVariables = { google: 'GOOGLE', github: 'GITHUB' } as const;
export const maxRedirectUriLength = 512;

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  /** Module identifiers to enable, or `undefined` to enable every registered module. */
  readonly enabledModuleIds: readonly string[] | undefined;
  /** Directory of the built Web interface to serve, or `undefined` to serve the API only. */
  readonly webDir: string | undefined;
  /** Optional provider sign-up; empty when the installation has no provider credentials. */
  readonly oauth: OAuthSettings;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Reads the server configuration from environment variables without touching the file system. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>, cwd: string): ServerConfig {
  return {
    host: parseHost(env['NIHON_HOST']),
    port: parsePort(env['NIHON_PORT']),
    dataDir: parseDataDir(env['NIHON_DATA_DIR'], cwd),
    enabledModuleIds: parseModuleIds(env['NIHON_MODULES']),
    webDir: parseWebDir(env['NIHON_WEB_DIR'], cwd),
    oauth: parseOAuth(env),
  };
}

function parseHost(value: string | undefined): string {
  if (value === undefined) {
    return defaultHost;
  }
  const host = value.trim();
  if (host === '') {
    throw new ConfigError('NIHON_HOST must not be empty.');
  }
  return host;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return defaultPort;
  }
  const port = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || port > 65535) {
    throw new ConfigError(`NIHON_PORT must be an integer between 0 and 65535, received "${value}".`);
  }
  return port;
}

function parseDataDir(value: string | undefined, cwd: string): string {
  const dataDir = value?.trim();
  if (dataDir === undefined || dataDir === '') {
    throw new ConfigError('NIHON_DATA_DIR must name the directory that holds Nihon data.');
  }
  return isAbsolute(dataDir) ? dataDir : resolve(cwd, dataDir);
}

function parseWebDir(value: string | undefined, cwd: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const webDir = value.trim();
  if (webDir === '') {
    throw new ConfigError('NIHON_WEB_DIR must not be empty; unset it to serve the API only.');
  }
  return isAbsolute(webDir) ? webDir : resolve(cwd, webDir);
}

function parseModuleIds(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  for (const id of ids) {
    if (!moduleIdPattern.test(id)) {
      throw new ConfigError(`NIHON_MODULES contains an invalid module identifier "${id}".`);
    }
  }
  return [...new Set(ids)];
}

function parseOAuth(env: Readonly<Record<string, string | undefined>>): OAuthSettings {
  const providers: Record<string, OAuthClientCredentials> = {};
  for (const [provider, stem] of Object.entries(oauthProviderVariables)) {
    const idName = `NIHON_OAUTH_${stem}_CLIENT_ID`;
    const secretName = `NIHON_OAUTH_${stem}_CLIENT_SECRET`;
    const clientId = env[idName]?.trim() ?? '';
    const clientSecret = env[secretName]?.trim() ?? '';
    if (clientId === '' && clientSecret === '') {
      continue;
    }
    if (clientId === '' || clientSecret === '') {
      throw new ConfigError(`${idName} and ${secretName} must be set together.`);
    }
    providers[provider] = { clientId, clientSecret };
  }
  return { providers, redirectUris: parseRedirectUris(env['NIHON_OAUTH_REDIRECT_URIS']) };
}

function parseRedirectUris(value: string | undefined): readonly string[] {
  const uris = (value ?? '')
    .split(',')
    .map((uri) => uri.trim())
    .filter((uri) => uri !== '');
  for (const uri of uris) {
    if (uri.length > maxRedirectUriLength || !isHttpsAddressWithoutFragment(uri)) {
      throw new ConfigError(
        `NIHON_OAUTH_REDIRECT_URIS must list https addresses without fragment of at most ${maxRedirectUriLength} characters.`,
      );
    }
  }
  return [...new Set(uris)];
}

function isHttpsAddressWithoutFragment(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hash === '' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}
