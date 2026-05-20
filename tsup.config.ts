import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'cli/index': 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
});