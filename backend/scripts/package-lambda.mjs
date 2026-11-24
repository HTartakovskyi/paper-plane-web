import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, lstatSync, rmSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(backend, 'build');
mkdirSync(build, { recursive: true });
// Fresh staging directory; never copy .env or local node_modules into an artifact.
const artifact = mkdtempSync(join(build, 'lambda-'));
const stagedBackend = join(artifact, 'backend');
const stagedMath = join(artifact, 'shared', 'game-math');
mkdirSync(stagedBackend, { recursive: true });
mkdirSync(stagedMath, { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'dist']) {
  cpSync(join(backend, file), join(stagedBackend, file), { recursive: true });
}
for (const file of ['package.json', 'dist']) {
  cpSync(join(backend, '..', 'shared', 'game-math', file), join(stagedMath, file), { recursive: true });
}
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script via npm run package:lambda');
const install = spawnSync(process.execPath,
  [npmCli, 'ci', '--omit=dev', '--omit=optional', '--omit=peer', '--ignore-scripts', '--no-bin-links', '--no-audit', '--no-fund'],
  { cwd: stagedBackend, stdio: 'inherit' });
if (install.status !== 0) throw new Error('Artifact dependency installation failed');
// ZIP deployment must not depend on npm file: symlinks being preserved.
const mathLink = join(stagedBackend, 'node_modules', '@paper-plane', 'game-math');
if (!relative(artifact, mathLink).startsWith('backend') || !lstatSync(mathLink).isSymbolicLink()) {
  throw new Error('Unexpected local package layout');
}
rmSync(mathLink, { recursive: true }); // Removes only the verified staging symlink/junction.
cpSync(stagedMath, mathLink, { recursive: true });
// Both package scopes are ESM; Lambda loads this thin root entrypoint.
writeFileSync(join(artifact, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(join(artifact, 'index.mjs'), "export { handler } from './backend/dist/src/lambda.js';\n");
const smoke = spawnSync(process.execPath, ['--no-experimental-require-module', '--no-experimental-detect-module', '--input-type=module', '-e',
  "const m = await import('./index.mjs'); if(typeof m.handler !== 'function') process.exit(1)"],
  { cwd: artifact, stdio: 'inherit' });
if (smoke.status !== 0) throw new Error('Artifact import failed');
const inspection = spawnSync(process.execPath,
  [join(backend, 'scripts', 'verify-artifact.mjs'), artifact], { stdio: 'inherit' });
if (inspection.status !== 0) throw new Error('Artifact portability inspection failed');
function totalBytes(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const path = join(directory, entry.name);
    return sum + (entry.isDirectory() ? totalBytes(path) : lstatSync(path).size);
  }, 0);
}
const bytes = totalBytes(artifact);
if (bytes >= 250 * 1024 * 1024) throw new Error('Artifact exceeds Lambda uncompressed ZIP limit');
const manifest = JSON.parse(readFileSync(join(stagedBackend, 'package.json'), 'utf8'));
console.log(`Lambda artifact: ${artifact}\nHandler: index.handler\nRuntime: nodejs24.x\nBackend: ${manifest.version}`);
console.log('ZIP the contents of this directory, not the directory itself. No migration runs at startup.');
console.log(`Uncompressed size: ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
