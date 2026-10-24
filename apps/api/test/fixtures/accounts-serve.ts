import { startAccountsApp } from './accounts-app.ts';
import { githubClient, googleClient, googleIssuer, startFakeProviders } from './fake-providers.ts';

/**
 * Serves the accounts module over a real database in a temporary data directory, with Google and GitHub
 * played by a local fake, for the Web client tests and for trying the screen by hand without Internet access.
 * Prints `{"event":"fixture.listening","port":<port>}`, then runs until SIGTERM, SIGINT, or the end of
 * standard input. `NIHON_WEB_DIR` serves a built Web interface next to the API.
 *
 * The fake needs no script: the authorization code names the identity it vouches for.
 *
 * - `github:<id>` is accepted as GitHub user `<id>`; `google:<subject>:<nonce>` as the Google subject.
 *   Any other code is refused by the provider.
 * - The authorization pages approve at once and return to the address with the code of GitHub user 42 or
 *   Google subject `g-42`, so a second registration from the browser meets an identity already registered.
 */
const fake = await startFakeProviders();

fake.githubToken = (form) => {
  const match = /^github:(\d+)$/.exec(form['code'] ?? '');
  return match === null ? { status: 200, body: { error: 'bad_verification_code' } } : { status: 200, body: { access_token: `gho_user${match[1]}`, token_type: 'bearer' } };
};
fake.githubUser = (headers) => {
  const match = /^Bearer gho_user(\d+)$/.exec(String(headers.authorization ?? ''));
  return match === null ? { status: 401, body: { message: 'Bad credentials' } } : { status: 200, body: { id: Number(match[1]), login: `user${match[1]}` } };
};
fake.googleToken = (form) => {
  const match = /^google:([^:]+):(.+)$/.exec(form['code'] ?? '');
  if (match === null) {
    return { status: 400, body: { error: 'invalid_grant' } };
  }
  const seconds = Math.floor(Date.now() / 1000);
  const idToken = fake.signIdToken({ iss: googleIssuer, aud: googleClient.clientId, sub: match[1], nonce: match[2], iat: seconds, exp: seconds + 3600 });
  return { status: 200, body: { access_token: 'ya29.fixture', id_token: idToken } };
};
fake.authorize = (provider, query) => {
  const returnAddress = new URL(query.get('redirect_uri') ?? '');
  returnAddress.searchParams.set('code', provider === 'github' ? 'github:42' : `google:g-42:${query.get('nonce') ?? ''}`);
  returnAddress.searchParams.set('state', query.get('state') ?? '');
  return { status: 302, body: '', headers: { location: returnAddress.href } };
};

const webDir = process.env['NIHON_WEB_DIR'];
const app = await startAccountsApp({
  oauth: { providers: { google: googleClient, github: githubClient }, redirectUris: [] },
  module: { googleEndpoints: fake.endpoints.google, githubEndpoints: fake.endpoints.github },
  ...(webDir === undefined ? {} : { webDir }),
});

process.stdout.write(`${JSON.stringify({ event: 'fixture.listening', port: Number(new URL(app.baseUrl).port) })}\n`);

let stopping = false;
const stop = () => {
  if (!stopping) {
    stopping = true;
    void app.stop().then(() => fake.stop()).then(() => process.exit(0));
  }
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.on('end', stop).resume();
