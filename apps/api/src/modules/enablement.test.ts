import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigError } from '../config.ts';
import type { ApiModule } from './api-module.ts';
import { selectEnabledModules } from './enablement.ts';
import { registeredModules } from './registry.ts';

const moduleWithId = (id: string): ApiModule => ({ id, register: () => {} });
const kanji = moduleWithId('kanji');
const review = moduleWithId('review');

describe('selectEnabledModules', () => {
  it('enables every registered module when no list is configured', () => {
    assert.deepEqual(selectEnabledModules([kanji, review], undefined), [kanji, review]);
  });

  it('enables only the listed modules, in registry order', () => {
    assert.deepEqual(selectEnabledModules([kanji, review], ['review']), [review]);
    assert.deepEqual(selectEnabledModules([kanji, review], ['review', 'kanji']), [kanji, review]);
  });

  it('enables nothing for an empty list', () => {
    assert.deepEqual(selectEnabledModules([kanji, review], []), []);
  });

  it('rejects identifiers that no registered module carries', () => {
    assert.throws(() => selectEnabledModules([kanji], ['kanji', 'media']), ConfigError);
  });

  it('rejects a registry that lists the same identifier twice', () => {
    assert.throws(() => selectEnabledModules([kanji, moduleWithId('kanji')], undefined), /registered more than once/);
  });

  it('accepts the shipped registry', () => {
    assert.doesNotThrow(() => selectEnabledModules(registeredModules, undefined));
  });
});
