import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'workers/parse-worker': 'src/engine/ingestion/workers/parse-worker.ts',
  },
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  banner: { js: '#!/usr/bin/env node --no-deprecation' },
  external: [
    'openai',
    'yaml',
    'execa',
    'zod',
    'commander',
    /^tree-sitter/,
    'node-gyp-build',
    '@ladybugdb/core',
    '@ladybugdb/core-win32-x64',
    'ladybugdb',
    'better-sqlite3',
    'leiden',
    /vendor\/leiden/,
  ],
});