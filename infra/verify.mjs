import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const { Url } = JSON.parse(readFileSync('.deploy/outputs.json'));
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path, options = {}) {
  for (let i = 0; i < 8; i++) {
    await pause(700);
    const response = await fetch(Url + path, options);
    if (response.status === 429) { await response.arrayBuffer(); await pause(1500); continue; }
    return response;
  }
  throw new Error('API throttled after retries');
}
async function json(path, options, status) {
  const r = await request(path, options);
  assert.equal(r.status, status, `${path} HTTP status`);
  assert.ok(!r.headers.get('x-cache')?.includes('Hit'), 'API response must not be cached');
  return r.json();
}
const root = await request('/'); assert.equal(root.status, 200); assert.match(await root.text(), /<div id="root">/); results.push('HTTPS index 200');
const spa = await request('/demo/deep-link'); assert.equal(spa.status, 200); assert.match(await spa.text(), /<div id="root">/); results.push('SPA deep link 200');
const missing = await request('/api/not-a-route'); assert.equal(missing.status, 404); assert.match(missing.headers.get('content-type'), /json/); results.push('Unknown API route stays JSON 404');
const session = await json('/api/sessions', { method: 'POST' }, 201);
assert.match(session.id, /^[0-9a-f-]{36}$/);
const attempts = [];
for (const planeId of ['BasicPlane', 'Glider', 'Dart']) {
  const attempt = await json(`/api/sessions/${session.id}/attempts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planeId, angle: 30, speed: 14 }) }, 201);
  assert.equal(attempt.planeId, planeId); assert.ok(Number.isFinite(attempt.distance)); assert.ok(attempt.points.length > 1); attempts.push(attempt.id);
}
const history = await json(`/api/sessions/${session.id}/attempts`, {}, 200);
assert.deepEqual(history.map(a => a.id), attempts); results.push('Session and all 3 plane attempts persisted and retrieved');
await json(`/api/sessions/${session.id}/attempts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ planeId: 'invalid', angle: 30, speed: 14 }) }, 400); results.push('Invalid input rejected with 400');
const redirect = await fetch(Url.replace('https:', 'http:') + '/', { redirect: 'manual' }); assert.equal(redirect.status, 301); results.push('HTTP redirects to HTTPS');
const report = { url: Url, testedAt: new Date().toISOString(), sessionId: session.id, attempts, results };
writeFileSync('.deploy/public-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
// Leave the single marked smoke-test session intact; no destructive cleanup occurs here.
