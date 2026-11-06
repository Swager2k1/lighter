import test from 'node:test';
import assert from 'node:assert/strict';
import { startHealthServer, stopHealthServer } from '../src/services/healthServer.js';

test('healthServer responds 200 OK on / and /health and 404 on others', async () => {
  const port = 8991;
  const server = startHealthServer(port);

  try {
    const resRoot = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(resRoot.status, 200);
    assert.equal(await resRoot.text(), 'OK');

    const resHealth = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(resHealth.status, 200);
    assert.equal(await resHealth.text(), 'OK');

    const resHealthQuery = await fetch(`http://127.0.0.1:${port}/health?ping=1`);
    assert.equal(resHealthQuery.status, 200);
    assert.equal(await resHealthQuery.text(), 'OK');

    const resOther = await fetch(`http://127.0.0.1:${port}/secret-logs`);
    assert.equal(resOther.status, 404);
    assert.equal(await resOther.text(), 'Not Found');
  } finally {
    await stopHealthServer(server);
  }
});

