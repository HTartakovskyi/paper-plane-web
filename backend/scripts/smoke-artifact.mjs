import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
if (process.argv.includes('--linux')) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.versions.node.split('.')[0], '24');
}
// Only the DB lifecycle is stubbed. No network or migrations; real compiled Nest
// modules, Prisma constructor, pool configuration and HTTP adapter are exercised.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
process.env.AWS_LAMBDA_FUNCTION_NAME = 'artifact-smoke';
process.env.DATABASE_SSL = 'verify-full';
process.env.API_RATE_LIMIT = '2';
delete process.env.DATABASE_CA_FILE;
const { PrismaService } = await import(pathToFileURL(join(root, 'backend/dist/src/prisma/prisma.service.js')));
let starts = 0;
PrismaService.prototype.onModuleInit = async () => { starts++; };
const { handler } = await import(pathToFileURL(join(root, 'index.mjs')));
const event = { version: '2.0', rawPath: '/', rawQueryString: '', headers: {}, isBase64Encoded: false,
  requestContext: { requestId: 'smoke', http: { method: 'GET', path: '/', sourceIp: '192.0.2.1' } } };
try {
  const context = { callbackWaitsForEmptyEventLoop: true };
  for (let i = 0; i < 2; i++) {
    const result = await handler(event, context);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body, 'Hello World!');
  }
  assert.equal(starts, 1);
  assert.equal(context.callbackWaitsForEmptyEventLoop, false);
  assert.equal((await handler(event, {})).statusCode, 429);
  console.log('Artifact handler: cold/warm HTTP API 2.0 and 429 passed; DB lifecycle stubbed.');
  process.exit(0); // Throttler timers intentionally survive warm invocations.
} catch (error) {
  console.error(error);
  process.exit(1);
}
