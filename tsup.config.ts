import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'cli/index': 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  external: [
    'openai',
    'yaml',
    'execa',
    'zod',
    'commander',
    /^tree-sitter/,
    'node-gyp-build',
    'ladybugdb',
    'better-sqlite3',
    'leiden',
  ],
});