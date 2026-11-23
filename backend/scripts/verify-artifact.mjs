import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node verify-artifact.mjs <unpacked-artifact> [--linux]');
if (process.argv.includes('--linux')) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.versions.node.split('.')[0], '24');
  assert.equal(process.arch, 'x64');
}
let bytes = 0;
let files = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `Symlink in artifact: ${relative(root, path)}`);
    if (stat.isDirectory()) { walk(path); continue; }
    assert.ok(stat.isFile(), 'Unexpected special file');
    assert.ok(!/^\.env(?:\.|$)|\.(?:exe|dll|node|dylib|key|p12)$/i.test(name), `Forbidden file: ${name}`);
    const data = readFileSync(path);
    // This runtime intentionally contains only JS/JSON/WASM, no native executables.
    assert.ok(!(data[0] === 0x4d && data[1] === 0x5a), `PE binary: ${name}`);
    assert.ok(!data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), `Native ELF: ${name}`);
    bytes += stat.size;
    files++;
  }
}
walk(root);
assert.ok(bytes < 250 * 1024 * 1024, 'Lambda uncompressed size limit');
const requireArtifact = createRequire(join(root, 'backend/package.json'));
// prisma-client generator uses the custom generated entry, not legacy .prisma/client.
await import(pathToFileURL(join(root, 'backend/dist/generated/prisma/client.js')));
for (const pkg of ['@prisma/client/runtime/client', '@prisma/adapter-pg', 'pg', '@paper-plane/game-math', 'serverless-http']) {
  // Resolve from artifact only, never from development dependencies.
  const resolved = pkg === '@paper-plane/game-math'
    ? join(root, 'backend/node_modules/@paper-plane/game-math/dist/index.js') : requireArtifact.resolve(pkg);
  assert.ok(!relative(root, resolved).startsWith('..'), `Dependency escaped artifact: ${pkg}`);
  await import(pathToFileURL(resolved));
}
const wasmPath = requireArtifact.resolve('@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.mjs');
const { wasm } = await import(pathToFileURL(wasmPath));
assert.ok(WebAssembly.validate(Buffer.from(wasm, 'base64')), 'PostgreSQL query compiler WASM');
await import(pathToFileURL(requireArtifact.resolve('@prisma/client/runtime/query_compiler_fast_bg.postgresql.mjs')));
const { handler } = await import(pathToFileURL(join(root, 'index.mjs')));
assert.equal(typeof handler, 'function');
console.log(JSON.stringify({ platform: process.platform, node: process.version, arch: process.arch, files, bytes, wasm: 'valid' }));
