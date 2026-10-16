import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { apiMajorVersion, apiVersion, apiVersionHeader } from '@nihon/api-client';

import { startFixtureServer, type FixtureServer } from '../../../../contracts/typescript/test/fixture-server.ts';
import { RequestCancelledError } from '../../src/api/outcome.ts';
import { checkService, createApiClient, type FetchFunction } from '../../src/api/service.ts';

const origin = 'http://127.0.0.1:4000';

function answer(status: number, body: unknown): FetchFunction {
  return async () => Response.json(body, { status });
}

function errorBody(code: string) {
  return { error: { code, message: 'test', requestId: 'req-1' } };
}

async function check(fetchImplementation: FetchFunction, signal = new AbortController().signal) {
  return checkService(createApiClient(origin, fetchImplementation), signal);
}

describe('checkService against the real API adapter', () => {
  let server: FixtureServer;
  before(async () => {
    server = await startFixtureServer();
  });
  after(() => server.stop());

  it('is ready when the service implements the same major version', async () => {
    let sentVersion: string | null = null;
    const recording: FetchFunction = async (request) => {
      sentVersion = request.headers.get(apiVersionHeader);
      return fetch(request);
    };
    const outcome = await checkService(createApiClient(server.baseUrl, recording), new AbortController().signal);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.data.apiVersion, apiVersion);
    assert.equal(sentVersion, String(apiMajorVersion));
  });
});

describe('checkService failures', () => {
  it('reports an unreachable service as unavailable', async () => {
    const outcome = await check(async () => {
      throw new TypeError('fetch failed');
    });
    assert.deepEqual(outcome, { ok: false, failure: { kind: 'unavailable' } });
  });

  it('reports a stopping service or a failing relay as unavailable', async () => {
    for (const status of [502, 503, 504]) {
      const outcome = await check(answer(status, errorBody('stopping')));
      assert.deepEqual(outcome, { ok: false, failure: { kind: 'unavailable' } }, String(status));
    }
  });

  it('reports another major version as an incompatible client', async () => {
    const outcome = await check(
      answer(200, { status: 'ok', service: 'nihon-api', version: '9.0.0', apiVersion: `${apiMajorVersion + 1}.0.0` }),
    );
    assert.deepEqual(outcome, { ok: false, failure: { kind: 'incompatible', serverApiVersion: `${apiMajorVersion + 1}.0.0` } });
    assert.deepEqual(await check(answer(400, errorBody('unsupported_api_version'))), {
      ok: false,
      failure: { kind: 'incompatible' },
    });
  });

  it('reports other answers as errors with their request identifier', async () => {
    assert.deepEqual(await check(answer(500, errorBody('internal_error'))), {
      ok: false,
      failure: { kind: 'error', status: 500, code: 'internal_error', requestId: 'req-1' },
    });
    assert.deepEqual(await check(answer(404, 'not json')), { ok: false, failure: { kind: 'error', status: 404 } });
  });

  it('throws RequestCancelledError when the check is cancelled', async () => {
    const controller = new AbortController();
    const pending = check(
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      controller.signal,
    );
    controller.abort();
    await assert.rejects(pending, RequestCancelledError);
  });
});
