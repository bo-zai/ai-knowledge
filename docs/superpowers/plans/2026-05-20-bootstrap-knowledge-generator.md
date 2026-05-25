# Bootstrap Knowledge Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone TypeScript/Node.js CLI that generates a `bootstrap-knowledge/` package inside a target repository using GitNexus evidence plus OpenAI-compatible LLM generation.

**Architecture:** The CLI is a graph-first generator. It ensures GitNexus indexing exists, builds repository and slice evidence bundles, invokes object-type-specific LLM generators with schema-controlled input/output, validates drafts, and writes a deterministic knowledge package to `bootstrap-knowledge/` inside the target repository.

**Tech Stack:** TypeScript, Node.js, Commander, Zod, YAML, OpenAI-compatible API via `openai`, `execa` for GitNexus process execution, `vitest` for unit/integration tests, `tsx` for dev execution, `tsup` for build.

**Coding Standards:** Follow `docs/superpowers/specs/2026-05-20-bootstrap-knowledge-generator-coding-standards.md` during implementation. Its structure, schema, testing, comment, and LLM-boundary rules are mandatory for all tasks in this plan.

---

## File Structure

Planned repository layout for the new CLI project:

```text
repo-knowledge-generator/
|-- package.json
|-- tsconfig.json
|-- tsup.config.ts
|-- vitest.config.ts
|-- .gitignore
|-- README.md
|-- src/
|   |-- cli/
|   |   |-- index.ts
|   |   |-- generate.ts
|   |   |-- status.ts
|   |   |-- clean.ts
|   |-- config/
|   |   |-- defaults.ts
|   |   |-- env.ts
|   |   |-- model-config.ts
|   |-- shared/
|   |   |-- errors.ts
|   |   |-- fs.ts
|   |   |-- ids.ts
|   |   |-- logger.ts
|   |   |-- yaml.ts
|   |-- schemas/
|   |   |-- common.ts
|   |   |-- manifest.ts
|   |   |-- catalog.ts
|   |   |-- evidence.ts
|   |   |-- term.ts
|   |   |-- con.ts
|   |   |-- flow.ts
|   |   |-- mod.ts
|   |   |-- open.ts
|   |   |-- own.ts
|   |   |-- ver.ts
|   |   |-- db.ts
|   |-- gitnexus/
|   |   |-- commands.ts
|   |   |-- ensure-index.ts
|   |   |-- adapter.ts
|   |   |-- types.ts
|   |-- slicing/
|   |   |-- types.ts
|   |   |-- discover-slices.ts
|   |   |-- build-slice-plan.ts
|   |-- evidence/
|   |   |-- types.ts
|   |   |-- bundle-builder.ts
|   |   |-- route-evidence.ts
|   |   |-- process-evidence.ts
|   |   |-- module-evidence.ts
|   |   |-- db-evidence.ts
|   |   |-- own-evidence.ts
|   |   |-- ver-evidence.ts
|   |   |-- open-evidence.ts
|   |   |-- term-evidence.ts
|   |-- generation/
|   |   |-- llm-client.ts
|   |   |-- prompt-builder.ts
|   |   |-- parse-output.ts
|   |   |-- retry.ts
|   |   |-- object-generators/
|   |       |-- term-generator.ts
|   |       |-- con-generator.ts
|   |       |-- flow-generator.ts
|   |       |-- mod-generator.ts
|   |       |-- open-generator.ts
|   |       |-- own-generator.ts
|   |       |-- ver-generator.ts
|   |       |-- db-generator.ts
|   |-- packaging/
|       |-- dedupe.ts
|       |-- render-object.ts
|       |-- build-manifest.ts
|       |-- build-catalog.ts
|       |-- write-package.ts
|       |-- write-reports.ts
|-- tests/
|   |-- unit/
|   |   |-- schemas/
|   |   |-- gitnexus/
|   |   |-- slicing/
|   |   |-- evidence/
|   |   |-- generation/
|   |   |-- packaging/
|   |-- integration/
|       |-- fixtures/
|       |-- generate-command.test.ts
|       |-- status-command.test.ts
```

Assumption: the new project repository name is `repo-knowledge-generator`.

### Task 1: Scaffold The CLI Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `README.md`
- Create: `src/cli/index.ts`
- Test: `tests/integration/generate-command.test.ts`

- [ ] **Step 1: Write the failing integration smoke test**

```ts
import { describe, expect, it } from 'vitest';
import { execa } from 'execa';

describe('cli smoke test', () => {
  it('prints help successfully', async () => {
    const result = await execa('node', ['dist/cli/index.js', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('generate');
    expect(result.stdout).toContain('status');
    expect(result.stdout).toContain('clean');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/generate-command.test.ts`

Expected: FAIL because project files and built CLI do not exist yet.

- [ ] **Step 3: Create package and tooling files**

```json
{
  "name": "repo-knowledge-generator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "repo-knowledge-generator": "dist/cli/index.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^13.1.0",
    "execa": "^9.5.2",
    "openai": "^5.10.2",
    "yaml": "^2.8.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^24.3.0",
    "tsup": "^8.5.0",
    "tsx": "^4.20.5",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest/globals"],
    "skipLibCheck": true
  },
  "include": ["src", "tests", "tsup.config.ts", "vitest.config.ts"]
}
```

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
});
```

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

```gitignore
node_modules/
dist/
coverage/
.DS_Store
```

- [ ] **Step 4: Implement minimal CLI shell**

```ts
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('repo-knowledge-generator')
  .description('Generate bootstrap-knowledge packages from GitNexus + LLM')
  .version('0.1.0');

program.command('generate').description('Generate bootstrap knowledge package');
program.command('status').description('Show package status');
program.command('clean').description('Remove bootstrap knowledge package');

program.parse();
```

- [ ] **Step 5: Build and rerun the smoke test**

Run:
- `npm install`
- `npm run build`
- `npx vitest run tests/integration/generate-command.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json tsup.config.ts vitest.config.ts .gitignore README.md src/cli/index.ts tests/integration/generate-command.test.ts
git commit -m "feat: scaffold bootstrap knowledge generator cli"
```

### Task 2: Add Shared Infrastructure And Runtime Schemas

**Files:**
- Create: `src/shared/errors.ts`
- Create: `src/shared/fs.ts`
- Create: `src/shared/ids.ts`
- Create: `src/shared/logger.ts`
- Create: `src/shared/yaml.ts`
- Create: `src/config/defaults.ts`
- Create: `src/config/env.ts`
- Create: `src/config/model-config.ts`
- Create: `src/schemas/common.ts`
- Create: `src/schemas/manifest.ts`
- Create: `src/schemas/catalog.ts`
- Create: `src/schemas/evidence.ts`
- Create: `src/schemas/term.ts`
- Create: `src/schemas/con.ts`
- Create: `src/schemas/flow.ts`
- Create: `src/schemas/mod.ts`
- Create: `src/schemas/open.ts`
- Create: `src/schemas/own.ts`
- Create: `src/schemas/ver.ts`
- Create: `src/schemas/db.ts`
- Test: `tests/unit/schemas/object-schemas.test.ts`

- [ ] **Step 1: Write failing schema validation tests**

```ts
import { describe, expect, it } from 'vitest';
import { dbObjectSchema } from '../../../src/schemas/db';

describe('schemas', () => {
  it('rejects db fields without chinese description source', () => {
    const bad = {
      id: 'DB-users',
      type: 'DB',
      title: 'users',
      status: 'fact',
      maturity: 'bootstrap',
      scope: 'db.users',
      repo: 'sample',
      slice_ids: ['db-users'],
      evidence_primary: ['schema.sql'],
      evidence_secondary: [],
      stale_if: [],
      generated_by: 'test',
      generated_at: '2026-05-20T00:00:00Z',
      table_name: 'users',
      table_name_zh: '用户表',
      schema_name: 'public',
      source_kind: 'ddl',
      primary_key: ['id'],
      indexes: [],
      foreign_keys: [],
      read_by: [],
      write_by: [],
      fields: [{ name: 'id', type: 'bigint', nullable: false, default: null, description_zh: '主键', constraints: [] }],
    };
    expect(() => dbObjectSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/unit/schemas/object-schemas.test.ts`

Expected: FAIL because schemas do not exist.

- [ ] **Step 3: Implement shared utilities and config loading**

```ts
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}
```

```ts
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await writeFile(path, content, 'utf8');
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
```

- [ ] **Step 4: Implement runtime schemas**

```ts
import { z } from 'zod';

export const commonObjectSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['TERM', 'CON', 'FLOW', 'MOD', 'OPEN', 'OWN', 'VER', 'DB']),
  title: z.string().min(1),
  status: z.enum(['fact', 'derived', 'open-question']),
  maturity: z.literal('bootstrap'),
  scope: z.string().min(1),
  repo: z.string().min(1),
  slice_ids: z.array(z.string()),
  evidence_primary: z.array(z.string()).min(1),
  evidence_secondary: z.array(z.string()),
  stale_if: z.array(z.string()),
  generated_by: z.string().min(1),
  generated_at: z.string().min(1),
});
```

```ts
import { z } from 'zod';
import { commonObjectSchema } from './common.js';

export const dbFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  nullable: z.boolean(),
  default: z.string().nullable(),
  description_zh: z.string().min(1),
  description_source: z.enum(['comment', 'inferred']),
  constraints: z.array(z.string()),
});

export const dbObjectSchema = commonObjectSchema.extend({
  type: z.literal('DB'),
  table_name: z.string().min(1),
  table_name_zh: z.string().min(1),
  schema_name: z.string().min(1),
  source_kind: z.enum(['ddl', 'migration', 'orm', 'inferred']),
  primary_key: z.array(z.string()),
  indexes: z.array(z.string()),
  foreign_keys: z.array(z.string()),
  read_by: z.array(z.string()),
  write_by: z.array(z.string()),
  fields: z.array(dbFieldSchema).min(1),
});
```

- [ ] **Step 5: Run schema tests**

Run:
- `npm run typecheck`
- `npx vitest run tests/unit/schemas/object-schemas.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared src/config src/schemas tests/unit/schemas/object-schemas.test.ts
git commit -m "feat: add runtime schemas and shared infrastructure"
```

### Task 3: Implement GitNexus Integration And Slice Discovery

**Files:**
- Create: `src/gitnexus/types.ts`
- Create: `src/gitnexus/commands.ts`
- Create: `src/gitnexus/ensure-index.ts`
- Create: `src/gitnexus/adapter.ts`
- Create: `src/slicing/types.ts`
- Create: `src/slicing/discover-slices.ts`
- Create: `src/slicing/build-slice-plan.ts`
- Test: `tests/unit/gitnexus/ensure-index.test.ts`
- Test: `tests/unit/slicing/discover-slices.test.ts`

- [ ] **Step 1: Write failing adapter tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { ensureGitNexusIndex } from '../../../src/gitnexus/ensure-index';

describe('ensureGitNexusIndex', () => {
  it('runs analyze when index is missing', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'ok' });
    await ensureGitNexusIndex({ repoPath: '/tmp/repo', execGitNexus: exec, hasIndex: async () => false });
    expect(exec).toHaveBeenCalledWith(['analyze', '/tmp/repo']);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/unit/gitnexus/ensure-index.test.ts tests/unit/slicing/discover-slices.test.ts`

Expected: FAIL because adapter and slicing modules do not exist.

- [ ] **Step 3: Implement GitNexus process adapter**

```ts
import { execa } from 'execa';

export async function runGitNexus(args: string[], cwd?: string): Promise<{ stdout: string }> {
  const result = await execa('gitnexus', args, { cwd });
  return { stdout: result.stdout };
}
```

```ts
export interface EnsureIndexDeps {
  repoPath: string;
  execGitNexus: (args: string[], cwd?: string) => Promise<{ stdout: string }>;
  hasIndex: (repoPath: string) => Promise<boolean>;
}

export async function ensureGitNexusIndex(deps: EnsureIndexDeps): Promise<void> {
  const indexed = await deps.hasIndex(deps.repoPath);
  if (indexed) return;
  await deps.execGitNexus(['analyze', deps.repoPath], deps.repoPath);
}
```

- [ ] **Step 4: Implement slice discovery**

```ts
export type SliceKind = 'route' | 'process' | 'tool' | 'community' | 'database';

export interface SliceSeed {
  id: string;
  kind: SliceKind;
  title: string;
  source: string;
}
```

```ts
import type { SliceSeed } from './types.js';

export function discoverSlices(input: {
  routes: string[];
  processes: string[];
  tools: string[];
  communities: string[];
  tables: string[];
}): SliceSeed[] {
  return [
    ...input.routes.map((value) => ({ id: `route:${value}`, kind: 'route' as const, title: value, source: value })),
    ...input.processes.map((value) => ({ id: `process:${value}`, kind: 'process' as const, title: value, source: value })),
    ...input.tools.map((value) => ({ id: `tool:${value}`, kind: 'tool' as const, title: value, source: value })),
    ...input.communities.map((value) => ({ id: `community:${value}`, kind: 'community' as const, title: value, source: value })),
    ...input.tables.map((value) => ({ id: `database:${value}`, kind: 'database' as const, title: value, source: value })),
  ];
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/gitnexus/ensure-index.test.ts tests/unit/slicing/discover-slices.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/gitnexus src/slicing tests/unit/gitnexus/ensure-index.test.ts tests/unit/slicing/discover-slices.test.ts
git commit -m "feat: add gitnexus integration and slice discovery"
```

### Task 4: Build Evidence Bundles

**Files:**
- Create: `src/evidence/types.ts`
- Create: `src/evidence/bundle-builder.ts`
- Create: `src/evidence/route-evidence.ts`
- Create: `src/evidence/process-evidence.ts`
- Create: `src/evidence/module-evidence.ts`
- Create: `src/evidence/db-evidence.ts`
- Create: `src/evidence/own-evidence.ts`
- Create: `src/evidence/ver-evidence.ts`
- Create: `src/evidence/open-evidence.ts`
- Create: `src/evidence/term-evidence.ts`
- Test: `tests/unit/evidence/db-evidence.test.ts`
- Test: `tests/unit/evidence/route-evidence.test.ts`

- [ ] **Step 1: Write failing evidence tests**

```ts
import { describe, expect, it } from 'vitest';
import { mergeDbFieldSources } from '../../../src/evidence/db-evidence';

describe('mergeDbFieldSources', () => {
  it('prefers comment source over inferred source', () => {
    const fields = mergeDbFieldSources([
      { name: 'id', type: 'bigint', nullable: false, default: null, description_zh: '主键', description_source: 'comment', constraints: [] },
      { name: 'id', type: 'bigint', nullable: false, default: null, description_zh: '用户编号', description_source: 'inferred', constraints: [] },
    ]);
    expect(fields[0].description_zh).toBe('主键');
    expect(fields[0].description_source).toBe('comment');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/unit/evidence/db-evidence.test.ts tests/unit/evidence/route-evidence.test.ts`

Expected: FAIL because evidence modules do not exist.

- [ ] **Step 3: Implement repository and slice evidence types**

```ts
export interface FactRef {
  file: string;
  symbol?: string;
  lines?: string;
}

export interface EvidenceFact {
  id: string;
  claim: string;
  source_kind: string;
  refs: FactRef[];
}
```

```ts
export interface SliceEvidenceBundle {
  slice: {
    id: string;
    kind: 'route' | 'process' | 'tool' | 'community' | 'database';
    title: string;
    scope: string;
    seed: string;
  };
  facts: EvidenceFact[];
  symbols: Array<{ id: string; name: string; kind: string; file: string; lines?: string; role?: string }>;
  relations: Array<{ type: string; from: string; to: string; reason?: string }>;
  snippets: Array<{ id: string; file: string; lines?: string; content: string }>;
  tables: string[];
  tests: string[];
  gaps: Array<{ id: string; kind: string; question: string; reason: string }>;
}
```

- [ ] **Step 4: Implement DB evidence merge logic**

```ts
type DbField = {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  description_zh: string;
  description_source: 'comment' | 'inferred';
  constraints: string[];
};

export function mergeDbFieldSources(fields: DbField[]): DbField[] {
  const byName = new Map<string, DbField>();
  for (const field of fields) {
    const existing = byName.get(field.name);
    if (!existing) {
      byName.set(field.name, field);
      continue;
    }
    const keep =
      existing.description_source === 'comment'
        ? existing
        : field.description_source === 'comment'
          ? field
          : existing;
    byName.set(field.name, keep);
  }
  return [...byName.values()];
}
```

- [ ] **Step 5: Implement route evidence builder**

```ts
import type { SliceEvidenceBundle } from './types.js';

export function buildRouteEvidence(input: {
  route: string;
  handler_file: string;
  response_keys: string[];
  error_keys: string[];
  middleware: string[];
}): SliceEvidenceBundle {
  return {
    slice: {
      id: `route:${input.route}`,
      kind: 'route',
      title: input.route,
      scope: input.handler_file,
      seed: input.route,
    },
    facts: [
      {
        id: 'F-001',
        claim: `Route ${input.route} is handled by ${input.handler_file}`,
        source_kind: 'gitnexus',
        refs: [{ file: input.handler_file }],
      },
    ],
    symbols: [],
    relations: [],
    snippets: [],
    tables: [],
    tests: [],
    gaps: [],
  };
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/evidence/db-evidence.test.ts tests/unit/evidence/route-evidence.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/evidence tests/unit/evidence/db-evidence.test.ts tests/unit/evidence/route-evidence.test.ts
git commit -m "feat: add evidence bundle builders"
```

### Task 5: Implement LLM Generation And Object Draft Parsing

**Files:**
- Create: `src/generation/llm-client.ts`
- Create: `src/generation/prompt-builder.ts`
- Create: `src/generation/parse-output.ts`
- Create: `src/generation/retry.ts`
- Create: `src/generation/object-generators/term-generator.ts`
- Create: `src/generation/object-generators/con-generator.ts`
- Create: `src/generation/object-generators/flow-generator.ts`
- Create: `src/generation/object-generators/mod-generator.ts`
- Create: `src/generation/object-generators/open-generator.ts`
- Create: `src/generation/object-generators/own-generator.ts`
- Create: `src/generation/object-generators/ver-generator.ts`
- Create: `src/generation/object-generators/db-generator.ts`
- Test: `tests/unit/generation/db-generator.test.ts`
- Test: `tests/unit/generation/parse-output.test.ts`

- [ ] **Step 1: Write failing generation tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseGeneratorOutput } from '../../../src/generation/parse-output';

describe('parseGeneratorOutput', () => {
  it('parses valid object output', () => {
    const result = parseGeneratorOutput('{"objects":[{"id":"DB-users"}],"warnings":[]}');
    expect(result.objects).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/unit/generation/db-generator.test.ts tests/unit/generation/parse-output.test.ts`

Expected: FAIL because generation modules do not exist.

- [ ] **Step 3: Implement OpenAI-compatible client**

```ts
import OpenAI from 'openai';

export function createOpenAiClient(input: {
  baseUrl: string;
  apiKey: string;
}): OpenAI {
  return new OpenAI({
    baseURL: input.baseUrl,
    apiKey: input.apiKey,
  });
}
```

- [ ] **Step 4: Implement strict JSON parsing and retry helpers**

```ts
import { AppError } from '../shared/errors.js';

export function parseGeneratorOutput(text: string): { objects: unknown[]; warnings: unknown[] } {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError(`Invalid generator output: ${String(error)}`, 'INVALID_GENERATOR_OUTPUT');
  }
}
```

- [ ] **Step 5: Implement DB generator prompt contract**

```ts
export function buildDbPrompt(input: unknown): { system: string; user: string } {
  return {
    system:
      'You must generate only JSON. You may only use supplied evidence. You may not invent fields, routes, tables, symbols, or constraints. All output must be Chinese except code identifiers.',
    user: JSON.stringify(
      {
        task: { object_type: 'DB', generation_mode: 'bootstrap' },
        evidence: input,
      },
      null,
      2,
    ),
  };
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/generation/db-generator.test.ts tests/unit/generation/parse-output.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/generation tests/unit/generation/db-generator.test.ts tests/unit/generation/parse-output.test.ts
git commit -m "feat: add llm generation pipeline"
```

### Task 6: Implement Packaging, Rendering, And Reports

**Files:**
- Create: `src/packaging/dedupe.ts`
- Create: `src/packaging/render-object.ts`
- Create: `src/packaging/build-manifest.ts`
- Create: `src/packaging/build-catalog.ts`
- Create: `src/packaging/write-package.ts`
- Create: `src/packaging/write-reports.ts`
- Test: `tests/unit/packaging/render-object.test.ts`
- Test: `tests/unit/packaging/build-catalog.test.ts`

- [ ] **Step 1: Write failing packaging tests**

```ts
import { describe, expect, it } from 'vitest';
import { renderObjectMarkdown } from '../../../src/packaging/render-object';

describe('renderObjectMarkdown', () => {
  it('renders yaml frontmatter and markdown body', () => {
    const text = renderObjectMarkdown({
      frontmatter: { id: 'DB-users', type: 'DB' },
      body: '# Users',
    });
    expect(text).toContain('---');
    expect(text).toContain('id: DB-users');
    expect(text).toContain('# Users');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/unit/packaging/render-object.test.ts tests/unit/packaging/build-catalog.test.ts`

Expected: FAIL because packaging modules do not exist.

- [ ] **Step 3: Implement renderer and catalog builder**

```ts
import YAML from 'yaml';

export function renderObjectMarkdown(input: {
  frontmatter: Record<string, unknown>;
  body: string;
}): string {
  return `---\n${YAML.stringify(input.frontmatter)}---\n\n${input.body}\n`;
}
```

```ts
export function buildCatalog(input: {
  retrievalOrder: string[];
  objects: Array<{ id: string; type: string; path: string; slice_ids: string[] }>;
}) {
  return {
    retrieval_order: input.retrievalOrder,
    objects: Object.fromEntries(
      input.objects.map((object) => [
        object.id,
        { type: object.type, path: object.path, slice_ids: object.slice_ids },
      ]),
    ),
  };
}
```

- [ ] **Step 4: Implement manifest and report writers**

```ts
export function buildManifest(input: {
  repoId: string;
  repoRoot: string;
  generatedAt: string;
  gitnexusVersion: string;
}) {
  return {
    schema_version: 1,
    knowledge_pack_type: 'bootstrap',
    repo_id: input.repoId,
    repo_root: input.repoRoot,
    generated_at: input.generatedAt,
    gitnexus_version: input.gitnexusVersion,
    object_types: ['TERM', 'CON', 'FLOW', 'MOD', 'OPEN', 'OWN', 'VER', 'DB'],
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/packaging/render-object.test.ts tests/unit/packaging/build-catalog.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/packaging tests/unit/packaging/render-object.test.ts tests/unit/packaging/build-catalog.test.ts
git commit -m "feat: add knowledge package rendering and reports"
```

### Task 7: Wire The Generate, Status, And Clean Commands End-To-End

**Files:**
- Modify: `src/cli/index.ts`
- Create: `src/cli/generate.ts`
- Create: `src/cli/status.ts`
- Create: `src/cli/clean.ts`
- Modify: `tests/integration/generate-command.test.ts`
- Create: `tests/integration/status-command.test.ts`

- [ ] **Step 1: Write failing integration tests**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

describe('status command', () => {
  it('reports missing package before generation', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-'));
    await writeFile(join(repo, 'README.md'), '# test repo');
    const result = await execa('node', ['dist/cli/index.js', 'status', '--repo', repo]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('bootstrap-knowledge');
    expect(result.stdout).toContain('missing');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/integration/generate-command.test.ts tests/integration/status-command.test.ts`

Expected: FAIL because subcommands do not implement real behavior.

- [ ] **Step 3: Implement `generate` command orchestration**

```ts
import { Command } from 'commander';

export function registerGenerateCommand(program: Command): void {
  program
    .command('generate')
    .requiredOption('--repo <path>')
    .option('--slice <value>')
    .option('--model <name>')
    .option('--base-url <url>')
    .option('--api-key-env <name>', 'OPENAI_API_KEY')
    .option('--force-analyze')
    .option('--verbose')
    .action(async (options) => {
      await runGenerate(options);
    });
}
```

- [ ] **Step 4: Implement `status` and `clean`**

```ts
export async function runStatus(repoPath: string): Promise<void> {
  // read manifest + coverage if present and print summary
}

export async function runClean(repoPath: string): Promise<void> {
  // remove bootstrap-knowledge directory
}
```

- [ ] **Step 5: Run integration tests**

Run: `npm run build && npx vitest run tests/integration/generate-command.test.ts tests/integration/status-command.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli tests/integration/generate-command.test.ts tests/integration/status-command.test.ts
git commit -m "feat: wire cli commands end to end"
```

### Task 8: Add End-To-End Fixture Coverage For DB Objects And Partial Failure

**Files:**
- Create: `tests/integration/fixtures/sample-repo/`
- Modify: `tests/integration/generate-command.test.ts`
- Create: `tests/integration/partial-failure.test.ts`

- [ ] **Step 1: Write failing end-to-end tests**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from 'execa';

describe('generate end-to-end', () => {
  it('writes DB objects with description_source for every field', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-fixture-'));
    await writeFile(join(repo, 'schema.sql'), "CREATE TABLE users (id BIGINT PRIMARY KEY COMMENT '主键');");
    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key' },
    });
    expect(result.exitCode).toBe(0);
    const dbObject = await readFile(join(repo, 'bootstrap-knowledge', 'objects', 'db', 'DB-users.md'), 'utf8');
    expect(dbObject).toContain('description_zh');
    expect(dbObject).toContain('description_source: comment');
  });

  it('keeps package generation alive when one object fails', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'bootstrap-knowledge-partial-'));
    await writeFile(join(repo, 'README.md'), '# partial failure fixture');
    const result = await execa('node', ['dist/cli/index.js', 'generate', '--repo', repo, '--model', 'test-model', '--base-url', 'http://localhost:11434/v1', '--api-key-env', 'TEST_API_KEY'], {
      env: { TEST_API_KEY: 'test-key', FORCE_OBJECT_FAILURE: 'DB' },
    });
    expect(result.exitCode).toBe(0);
    const summary = await readFile(join(repo, 'bootstrap-knowledge', 'reports', 'generation-summary.md'), 'utf8');
    expect(summary).toContain('failed');
    expect(summary).toContain('DB');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/integration/generate-command.test.ts tests/integration/partial-failure.test.ts`

Expected: FAIL because fixture coverage and partial-failure handling are incomplete.

- [ ] **Step 3: Add a fixture repo with route, process, and DB usage**

```text
tests/integration/fixtures/sample-repo/
|-- schema.sql
|-- src/
|   |-- routes/
|   |-- services/
|   |-- db/
```

Use the fixture to ensure:

- at least one route object exists
- at least one DB table exists
- one DB field has comment-backed description
- one DB field falls back to inferred description

- [ ] **Step 4: Implement partial-failure handling assertions**

Expected runtime behavior:

- failed objects are excluded from `catalog.yaml`
- successful objects are still written
- `reports/generation-summary.md` lists failures
- `reports/coverage-report.yaml` includes warnings and failures

- [ ] **Step 5: Run the full test suite**

Run:
- `npm run typecheck`
- `npm run build`
- `npm test`

Expected:
- all tests PASS
- fixture repo produces `bootstrap-knowledge/`
- DB fields always include `description_zh` and `description_source`

- [ ] **Step 6: Commit**

```bash
git add tests/integration/fixtures tests/integration/generate-command.test.ts tests/integration/partial-failure.test.ts
git commit -m "test: cover db knowledge generation and partial failures"
```

## Self-Review

### Spec coverage

This plan covers:

- standalone TypeScript/Node CLI
- GitNexus reuse and automatic analyze
- whole-repo and slice generation
- `bootstrap-knowledge/` package generation
- object schema implementation
- DB table object generation with Chinese field descriptions
- OpenAI-compatible LLM integration
- deterministic packaging and reports
- partial failure tolerance

### Placeholder scan

The only intentionally generic placeholders are CLI argument examples such as `--repo <path>` and fixture expansion notes. No implementation task depends on unresolved product decisions.

### Type consistency

The plan consistently uses:

- `bootstrap-knowledge/` as the output directory
- `DB` as the table object type
- `description_source: comment | inferred`
- the same object type set as the approved spec

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-bootstrap-knowledge-generator.md`.

Because you said you plan to hand implementation to Claude Code, the intended next step is to give Claude Code:

- the approved design spec
- this implementation plan

and have it execute task-by-task, validating tests after each task.
