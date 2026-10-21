import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { ConfigError, defaultHost, defaultPort, loadConfig } from './config.ts';

const cwd = resolve('/srv/nihon');

describe('loadConfig', () => {
  it('defaults to the loopback interface and the default port', () => {
    const config = loadConfig({ NIHON_DATA_DIR: '/data' }, cwd);
    assert.equal(config.host, defaultHost);
    assert.equal(defaultHost, '127.0.0.1');
    assert.equal(config.port, defaultPort);
    assert.equal(config.enabledModuleIds, undefined);
    assert.equal(config.webDir, undefined);
  });

  it('has no provider credentials by default', () => {
    assert.deepEqual(loadConfig({ NIHON_DATA_DIR: '/data' }, cwd).oauth, { providers: {}, redirectUris: [] });
  });

  it('reads provider credentials, which must come as a pair', () => {
    const config = loadConfig(
      {
        NIHON_DATA_DIR: '/data',
        NIHON_OAUTH_GOOGLE_CLIENT_ID: ' id-g ',
        NIHON_OAUTH_GOOGLE_CLIENT_SECRET: 'secret-g',
        NIHON_OAUTH_REDIRECT_URIS: 'https://nihon.example/cb, https://nihon.example/cb',
      },
      cwd,
    );
    assert.deepEqual(config.oauth, {
      providers: { google: { clientId: 'id-g', clientSecret: 'secret-g' } },
      redirectUris: ['https://nihon.example/cb'],
    });
    for (const env of [{ NIHON_OAUTH_GITHUB_CLIENT_ID: 'id' }, { NIHON_OAUTH_GITHUB_CLIENT_SECRET: 'secret-never-shown' }]) {
      assert.throws(
        () => loadConfig({ NIHON_DATA_DIR: '/data', ...env }, cwd),
        (error: unknown) => error instanceof ConfigError && !error.message.includes('secret-never-shown'),
      );
    }
  });

  it('rejects return addresses that are not plain https addresses', () => {
    for (const uri of ['http://nihon.example/cb', 'https://nihon.example/cb#x', 'nihon://cb', 'not a url', `https://nihon.example/${'a'.repeat(600)}`]) {
      assert.throws(() => loadConfig({ NIHON_DATA_DIR: '/data', NIHON_OAUTH_REDIRECT_URIS: uri }, cwd), ConfigError, uri);
    }
  });

  it('resolves a relative Web directory and rejects an empty one', () => {
    assert.equal(loadConfig({ NIHON_DATA_DIR: '/data', NIHON_WEB_DIR: 'web' }, cwd).webDir, resolve(cwd, 'web'));
    assert.throws(() => loadConfig({ NIHON_DATA_DIR: '/data', NIHON_WEB_DIR: ' ' }, cwd), ConfigError);
  });

  it('resolves a relative data directory against the working directory', () => {
    assert.equal(loadConfig({ NIHON_DATA_DIR: 'data' }, cwd).dataDir, resolve(cwd, 'data'));
  });

  it('requires a data directory', () => {
    assert.throws(() => loadConfig({}, cwd), ConfigError);
    assert.throws(() => loadConfig({ NIHON_DATA_DIR: '  ' }, cwd), ConfigError);
  });

  it('accepts explicit host and port values', () => {
    const config = loadConfig({ NIHON_DATA_DIR: '/data', NIHON_HOST: '0.0.0.0', NIHON_PORT: '0' }, cwd);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 0);
  });

  it('rejects ports that are not integers in range', () => {
    for (const port of ['', 'abc', '-1', '1.5', '65536', '4000x']) {
      assert.throws(() => loadConfig({ NIHON_DATA_DIR: '/data', NIHON_PORT: port }, cwd), ConfigError, port);
    }
  });

  it('lists enabled modules without blanks or duplicates', () => {
    const config = loadConfig({ NIHON_DATA_DIR: '/data', NIHON_MODULES: ' review, kanji,,review ' }, cwd);
    assert.deepEqual(config.enabledModuleIds, ['review', 'kanji']);
  });

  it('treats an empty module list as no enabled module', () => {
    assert.deepEqual(loadConfig({ NIHON_DATA_DIR: '/data', NIHON_MODULES: '' }, cwd).enabledModuleIds, []);
  });

  it('rejects malformed module identifiers', () => {
    assert.throws(() => loadConfig({ NIHON_DATA_DIR: '/data', NIHON_MODULES: 'Review' }, cwd), ConfigError);
    assert.throws(() => loadConfig({ NIHON_DATA_DIR: '/data', NIHON_MODULES: '../x' }, cwd), ConfigError);
  });
});
