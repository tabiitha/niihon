import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isAcceptedRedirectUri } from './redirect.ts';

describe('return addresses', () => {
  it('accepts http loopback addresses on any port and path', () => {
    for (const uri of ['http://127.0.0.1:4000/auth/callback', 'http://localhost:51234/', 'http://[::1]:8080/cb?x=1']) {
      assert.equal(isAcceptedRedirectUri(uri, []), true, uri);
    }
  });

  it('refuses other hosts, schemes, credentials, fragments and look-alikes', () => {
    for (const uri of [
      'https://evil.example/cb',
      'http://127.0.0.1.evil.example/cb',
      'http://localhost.evil.example/cb',
      'https://127.0.0.1/cb',
      'http://user:pass@127.0.0.1/cb',
      'http://127.0.0.1/cb#fragment',
      'javascript:alert(1)',
      'nihon://callback',
      '/relative',
      '',
      `http://127.0.0.1/${'a'.repeat(600)}`,
    ]) {
      assert.equal(isAcceptedRedirectUri(uri, []), false, uri);
    }
  });

  it('accepts exactly the addresses the installation lists', () => {
    const configured = ['https://nihon.example/auth/callback'];
    assert.equal(isAcceptedRedirectUri('https://nihon.example/auth/callback', configured), true);
    assert.equal(isAcceptedRedirectUri('https://nihon.example/other', configured), false);
    assert.equal(isAcceptedRedirectUri('https://nihon.example/auth/callback/', configured), false);
  });
});
