import { rollup } from 'rollup';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';

// Compile the unmodified upstream dependency, keeping one shared Nest instance.
// Static external imports remain ESM; no require(ESM) runtime flag is needed.
const bundle = await rollup({
  input: './dist/src/throttling.js',
  external: id => !id.startsWith('.') && !id.startsWith('/') &&
    !id.includes(':') && !id.startsWith('@nestjs/throttler'),
  plugins: [nodeResolve(), commonjs({ esmExternals: id => id.startsWith('@nestjs/'), requireReturnsDefault: false })],
  onwarn(warning, warn) {
    if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
    warn(warning);
  },
});
try { await bundle.write({ file: 'dist/src/throttling.js', format: 'es', sourcemap: true }); }
finally { await bundle.close(); }
