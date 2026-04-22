import { defineConfig } from 'tsup';

export default defineConfig([
  // Programmatic API — dual ESM + CJS so consumers (e.g. openclaw-launcher)
  // can `import` or `require` it from any toolchain.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  // CLI binary — ESM only, with a Node shebang so npm installs it as
  // `graft` on the user's PATH.
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    banner: { js: '#!/usr/bin/env node' },
    sourcemap: true,
  },
]);
