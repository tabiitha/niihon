import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchRoute, readerHref, readMediaId, routes } from './routes.ts';

describe('routes', () => {
  it('match every space, with or without a trailing slash', () => {
    assert.equal(matchRoute('/'), 'home');
    assert.equal(matchRoute('/learn'), 'learning');
    assert.equal(matchRoute('/kanji/'), 'kanji');
    assert.equal(matchRoute('/library'), 'library');
    assert.equal(matchRoute('/profile'), 'profile');
    assert.equal(matchRoute('/register'), 'register');
    assert.equal(matchRoute('/admin'), 'admin');
    assert.equal(matchRoute('/reader'), 'reader');
  });

  it('match no page for unknown addresses or identifiers in the path', () => {
    assert.equal(matchRoute('/unknown'), undefined);
    assert.equal(matchRoute('/reader/item-01'), undefined);
    assert.equal(matchRoute('/library/item-01'), undefined);
  });

  it('address media by a query identifier on the fixed reader page', () => {
    const href = readerHref('média 01&x');
    assert.ok(href.startsWith(`${routes.reader}?`));
    assert.equal(readMediaId(new URL(href, 'http://127.0.0.1').search), 'média 01&x');
    assert.equal(readMediaId('?media=item-01'), 'item-01');
    assert.equal(readMediaId('?media=%20'), undefined);
    assert.equal(readMediaId(''), undefined);
  });
});
