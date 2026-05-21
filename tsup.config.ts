import { defineConfig } from 'tsup';
import fs from 'fs';
import path from 'path';

// Copy vendor/leiden to dist after build
const copyVendor = () => {
  const srcDir = path.resolve('vendor/leiden');
  const destDir = path.resolve('dist/vendor/leiden');
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
    console.log('Copied vendor/leiden to dist');
  }
};

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
  onSuccess: copyVendor,
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