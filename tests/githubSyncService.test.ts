import test from 'node:test';
import assert from 'node:assert/strict';
import { GithubSyncService } from '../src/services/githubSyncService.js';

test('GithubSyncService reports isConfigured correctly', () => {
  const serviceWithoutToken = new GithubSyncService({ token: '', repo: 'Swager2k1/Lighter', branch: 'main' });
  assert.equal(serviceWithoutToken.isConfigured(), false);

  const serviceWithToken = new GithubSyncService({ token: 'test_pat_token', repo: 'Swager2k1/Lighter', branch: 'main' });
  assert.equal(serviceWithToken.isConfigured(), true);
});

test('syncFile returns missing_token when unconfigured without throwing', async () => {
  const service = new GithubSyncService({ token: '' });
  const result = await service.syncFile('test.csv', 'col1,col2\nval1,val2', 'sync test');
  assert.equal(result.success, false);
  assert.equal(result.reason, 'missing_token');
});

test('syncFile successfully commits existing file using mocked fetch', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method?: string; body?: any; headers?: any }[] = [];

  try {
    globalThis.fetch = (async (url: any, init?: any) => {
      calls.push({
        url: url.toString(),
        method: init?.method,
        body: init?.body ? JSON.parse(init.body) : undefined,
        headers: init?.headers,
      });

      // 1. GET existing file sha
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({ sha: 'existing_file_sha_123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 2. PUT commit
      if (init?.method === 'PUT') {
        return new Response(
          JSON.stringify({
            commit: { sha: 'new_commit_sha_456' },
            content: { sha: 'new_blob_sha_789' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response('Not Found', { status: 404 });
    }) as any;

    const service = new GithubSyncService({
      token: 'valid_pat_123',
      repo: 'Swager2k1/Lighter',
      branch: 'main',
    });

    const csvContent = 'Week,Period,Asset\nWeek 11,24.10,TSM';
    const result = await service.syncCsvFile(csvContent, 'sync: add trade');

    assert.equal(result.success, true);
    assert.equal(result.commitSha, 'new_commit_sha_456');

    // Проверка вызовов API
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'GET');
    assert.ok(calls[0].url.includes('pnl_and_points_analysis.csv'));

    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].body.sha, 'existing_file_sha_123');
    assert.ok(calls[1].body.message.includes('[skip ci]'));
    assert.equal(Buffer.from(calls[1].body.content, 'base64').toString('utf-8'), csvContent);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncFile automatically retries on 409 conflict and succeeds', async () => {
  const originalFetch = globalThis.fetch;
  let putAttempts = 0;

  try {
    globalThis.fetch = (async (url: any, init?: any) => {
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({ sha: putAttempts === 0 ? 'sha_v1' : 'sha_v2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (init?.method === 'PUT') {
        putAttempts++;
        if (putAttempts === 1) {
          return new Response(JSON.stringify({ message: 'is at 596c... but expected da114...' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ commit: { sha: 'retry_commit_ok' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    }) as any;

    const service = new GithubSyncService({
      token: 'valid_pat_123',
      repo: 'Swager2k1/Lighter',
      branch: 'main',
    });

    const result = await service.syncFile('test.csv', 'data', 'sync: retry test');
    assert.equal(result.success, true);
    assert.equal(result.commitSha, 'retry_commit_ok');
    assert.equal(putAttempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent syncFile calls are queued sequentially without collision', async () => {
  const originalFetch = globalThis.fetch;
  const executionLog: string[] = [];

  try {
    globalThis.fetch = (async (url: any, init?: any) => {
      const urlStr = url.toString();
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({ sha: 'sha_base' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body);
        executionLog.push(`start:${body.message}`);
        await new Promise((r) => setTimeout(r, 20));
        executionLog.push(`end:${body.message}`);
        return new Response(JSON.stringify({ commit: { sha: 'sha_done' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    }) as any;

    const service = new GithubSyncService({
      token: 'valid_pat_123',
      repo: 'Swager2k1/Lighter',
      branch: 'main',
    });

    // Запускаем два коммита одновременно (как config.json и pnl.csv при закрытии сделки)
    const [res1, res2] = await Promise.all([
      service.syncConfigFile('{}', 'sync: config'),
      service.syncCsvFile('csv', 'sync: csv'),
    ]);

    assert.equal(res1.success, true);
    assert.equal(res2.success, true);

    // Должно выполниться строго по очереди: start:config -> end:config -> start:csv -> end:csv
    assert.deepEqual(executionLog, [
      'start:sync: config [skip ci]',
      'end:sync: config [skip ci]',
      'start:sync: csv [skip ci]',
      'end:sync: csv [skip ci]',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



