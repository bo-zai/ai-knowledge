import { defineConfig } from 'tsup';
import fs from 'fs';
import path from 'path';

// Copy vendor/leiden and scripts to dist after build
const copyAssets = async (): Promise<void> => {
  // Copy vendor/leiden
  const vendorSrc = path.resolve('vendor/leiden');
  const vendorDest = path.resolve('dist/vendor/leiden');
  if (fs.existsSync(vendorSrc)) {
    fs.mkdirSync(vendorDest, { recursive: true });
    for (const file of fs.readdirSync(vendorSrc)) {
      fs.copyFileSync(path.join(vendorSrc, file), path.join(vendorDest, file));
    }
    console.log('Copied vendor/leiden to dist');
  }

  // Copy prompts
  const promptsSrc = path.resolve('src/prompts');
  const promptsDest = path.resolve('dist/prompts');
  if (fs.existsSync(promptsSrc)) {
    fs.mkdirSync(promptsDest, { recursive: true });
    for (const file of fs.readdirSync(promptsSrc)) {
      if (file.endsWith('.md')) {
        fs.copyFileSync(path.join(promptsSrc, file), path.join(promptsDest, file));
      }
    }
    console.log('Copied prompts to dist');
  }

  // Copy scripts
  const scriptsSrc = path.resolve('scripts');
  const scriptsDest = path.resolve('dist/scripts');
  if (fs.existsSync(scriptsSrc)) {
    fs.mkdirSync(scriptsDest, { recursive: true });
    for (const file of fs.readdirSync(scriptsSrc)) {
      if (file.endsWith('.mjs') || file.endsWith('.cjs')) {
        fs.copyFileSync(path.join(scriptsSrc, file), path.join(scriptsDest, file));
      }
    }
    console.log('Copied scripts to dist');
  }

  // Copy skills/templates (skill 模板文件)
  const skillsTemplatesSrc = path.resolve('src/skills/templates');
  const skillsTemplatesDest = path.resolve('dist/skills/templates');
  if (fs.existsSync(skillsTemplatesSrc)) {
    copyDirectoryRecursive(skillsTemplatesSrc, skillsTemplatesDest);
    console.log('Copied skills/templates to dist');
  }
};

// 递归复制目录
function copyDirectoryRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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
  onSuccess: copyAssets,
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
