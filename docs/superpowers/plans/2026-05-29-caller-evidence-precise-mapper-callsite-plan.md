# Caller Evidence Precise Mapper Callsite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix MyBatis caller evidence so call site snippets come only from confirmed mapper receivers, then validate against the real `D:\workspace\other_project\music-education-app` project.

**Architecture:** Keep the change localized to `src/mybatis/caller-evidence.ts`. Add focused regression tests in `tests/unit/mybatis/caller-evidence.test.ts`, then run unit, full, and real-project validation. The implementation remains regex-based but removes the broad `\w+.methodId(` matcher from trusted call-site selection.

**Tech Stack:** TypeScript strict mode, Vitest, existing MyBatis evidence resolver, PowerShell on Windows.

---

## Requirements

- Do not use git worktree.
- Do not modify unrelated DB generation prompt behavior.
- Do not add Java AST dependencies.
- Do not let uncertain evidence become a fact.
- Real validation must use `D:\workspace\other_project\music-education-app`.

## Files

- Modify: `src/mybatis/caller-evidence.ts`
- Modify: `tests/unit/mybatis/caller-evidence.test.ts`
- Optional docs update only if behavior notes are needed: `docs/superpowers/specs/2026-05-29-caller-evidence-precise-mapper-callsite-spec.md`

## Task 1: Add Regression Test For Non-Mapper Same Method Calls

**Files:**
- Modify: `tests/unit/mybatis/caller-evidence.test.ts`

- [ ] **Step 1: Add failing test**

Add this test to `tests/unit/mybatis/caller-evidence.test.ts`:

```ts
it('ignores non-mapper receivers with the same method name before the mapper call', async () => {
  const repoPath = await mkdtemp(join(tmpdir(), 'caller-evidence-'));
  const javaDir = join(repoPath, 'src', 'main', 'java', 'com', 'demo', 'service');
  await mkdir(javaDir, { recursive: true });

  await writeFile(
    join(javaDir, 'QuestionService.java'),
    `package com.demo.service;

import com.demo.mapper.QuestionMapper;

public class QuestionService {
    private QuestionMapper questionMapper;
    private CacheClient cacheClient;

    /**
     * 根据题目难度构建卡片
     */
    public void buildQuestionCard(Long id) {
        Object cached = cacheClient.selectById(id);
        Object question = questionMapper.selectById(id);
        card.setDifficulty(question);
    }
}
`,
    'utf8',
  );

  const result = await resolveCallerEvidence({
    repoPath,
    namespace: 'com.demo.mapper.QuestionMapper',
    methodId: 'selectById',
  });

  expect(result).toHaveLength(1);
  expect(result[0]?.callerMethod).toBe('buildQuestionCard');
  expect(result[0]?.callSiteSnippet).toContain('questionMapper.selectById(id);');
  expect(result[0]?.callSiteSnippet).not.toContain('cacheClient.selectById(id);');
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
npx vitest run tests/unit/mybatis/caller-evidence.test.ts
```

Expected before implementation: the new test fails because the current matcher can select `cacheClient.selectById(id);`.

## Task 2: Add Regression Test For Non-Default Mapper Variable Names

**Files:**
- Modify: `tests/unit/mybatis/caller-evidence.test.ts`

- [ ] **Step 1: Add failing test**

Add this test:

```ts
it('uses mapper receivers declared as constructor parameters', async () => {
  const repoPath = await mkdtemp(join(tmpdir(), 'caller-evidence-'));
  const javaDir = join(repoPath, 'src', 'main', 'java', 'com', 'demo', 'service');
  await mkdir(javaDir, { recursive: true });

  await writeFile(
    join(javaDir, 'QuestionService.java'),
    `package com.demo.service;

import com.demo.mapper.QuestionMapper;

public class QuestionService {
    private final QuestionMapper mapper;

    public QuestionService(QuestionMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 查询题目详情
     */
    public Object loadQuestion(Long id) {
        return mapper.selectById(id);
    }
}
`,
    'utf8',
  );

  const result = await resolveCallerEvidence({
    repoPath,
    namespace: 'com.demo.mapper.QuestionMapper',
    methodId: 'selectById',
  });

  expect(result).toHaveLength(1);
  expect(result[0]?.callerMethod).toBe('loadQuestion');
  expect(result[0]?.callSiteSnippet).toContain('mapper.selectById(id);');
});
```

- [ ] **Step 2: Run the test and confirm failure or missing coverage**

Run:

```bash
npx vitest run tests/unit/mybatis/caller-evidence.test.ts
```

Expected before implementation: this may fail if only default `questionMapper` is recognized.

## Task 3: Implement Precise Mapper Receiver Collection

**Files:**
- Modify: `src/mybatis/caller-evidence.ts`

- [ ] **Step 1: Replace broad call matcher**

Remove the trusted `\w+` receiver branch from mapper call-site matching. Add these helpers:

```ts
function collectMapperReceivers(content: string, mapperClass: string): string[] {
  const receivers = new Set<string>([toCamelCase(mapperClass), mapperClass]);
  const escapedMapperClass = escapeRegExp(mapperClass);

  const declarationRegex = new RegExp(`\\b${escapedMapperClass}\\s+(\\w+)\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = declarationRegex.exec(content)) !== null) {
    if (match[1]) {
      receivers.add(match[1]);
    }
  }

  return [...receivers];
}

function buildPreciseCallMatcher(receivers: string[], methodId: string): RegExp | null {
  if (receivers.length === 0) {
    return null;
  }

  const receiverPattern = receivers
    .map(escapeRegExp)
    .sort((left, right) => right.length - left.length)
    .join('|');
  const escapedMethodId = escapeRegExp(methodId);

  return new RegExp(
    `(^|[^\\w])(?:${receiverPattern})\\s*\\.\\s*${escapedMethodId}\\s*\\(`,
    'm',
  );
}
```

- [ ] **Step 2: Update `findCallSite`**

Change `findCallSite` to:

```ts
function findCallSite(
  content: string,
  mapperClass: string,
  methodId: string,
): { index: number; snippet: string } | null {
  const receivers = collectMapperReceivers(content, mapperClass);
  const matcher = buildPreciseCallMatcher(receivers, methodId);
  if (!matcher) {
    return null;
  }

  const match = matcher.exec(content);
  if (!match || typeof match.index !== 'number') {
    return null;
  }

  const callIndex = match.index + (match[1]?.length ?? 0);
  return {
    index: callIndex,
    snippet: extractStatementSnippet(content, callIndex),
  };
}
```

- [ ] **Step 3: Keep fallback conservative**

Do not reintroduce a broad fallback like `\w+.methodId(`. If no precise receiver is found, return `null` for call site. This is intentional because missing evidence is safer than wrong evidence.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/unit/mybatis/caller-evidence.test.ts
```

Expected: all caller evidence tests pass.

## Task 4: Verify DB Prompt Still Carries Caller Evidence

**Files:**
- Existing tests only unless failures require changes.

- [ ] **Step 1: Run DB generator prompt tests**

Run:

```bash
npx vitest run tests/unit/generation/db-generator.test.ts
```

Expected: pass. Existing test `includes caller code evidence in user prompt when db_bundle is provided` should still pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

## Task 5: Full Project Test

**Files:**
- No file changes expected.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

## Task 6: Real Project Validation On `music-education-app`

**Files:**
- No source changes expected.
- Generated files may appear under `D:\workspace\other_project\music-education-app\bootstrap-knowledge`.

- [ ] **Step 1: Confirm target project exists**

Run:

```powershell
Get-ChildItem -Path D:\workspace\other_project\music-education-app
```

Expected: command lists the real project files.

- [ ] **Step 2: Run generator against the real project**

Run the project generator from `D:\workspace\ai-wiki`:

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --slice database
```

Expected:

- generation completes without crashing
- `D:\workspace\other_project\music-education-app\bootstrap-knowledge` is written
- generation report records succeeded DB objects or explicit failures with debug traces

If the local CLI expects a different positional option, use the existing generate command help:

```bash
node dist/cli/index.js generate --help
```

Then rerun the equivalent generate command against `D:\workspace\other_project\music-education-app`.

- [ ] **Step 3: Inspect debug traces for caller snippets**

Search generated debug logs or package contents for call site snippets:

```powershell
rg -n "callSiteSnippet|\\.select|Mapper" D:\workspace\other_project\music-education-app\bootstrap-knowledge
```

Expected:

- at least one caller evidence or prompt/debug trace contains `callSiteSnippet`
- snippets with mapper calls use a mapper receiver such as `questionMapper`, `courseMapper`, `mapper`, or a mapper class name
- no inspected snippet is clearly from a non-mapper receiver such as `cacheClient.selectById(...)` when a mapper call exists later

- [ ] **Step 4: Validate DB object field requirements**

Run the existing validation script if available:

```bash
node scripts/validate-music-admin-db.mts D:\workspace\other_project\music-education-app\bootstrap-knowledge
```

If that script is not compatible with this target package, inspect generated DB objects directly:

```powershell
rg -n "description_zh|description_source|read_by_direct|write_by_direct" D:\workspace\other_project\music-education-app\bootstrap-knowledge\objects
```

Expected:

- every generated DB field has `description_zh`
- every generated DB field has `description_source`
- all `description_source` values are `comment` or `inferred`

- [ ] **Step 5: Record real validation result**

Add a short validation note to the final implementation response with:

```text
Real project validated: D:\workspace\other_project\music-education-app
Command used:
Generated package path:
Caller snippet sample:
DB field validation result:
```

## Self-Review Checklist

- Spec coverage: tasks cover precise receiver collection, wrong-receiver regression tests, typecheck, full tests, build, and real-project validation.
- Placeholder scan: no task relies on unspecified future work.
- Type consistency: helper names match the implementation snippets.
- Scope control: no SDD adapter, no Java AST parser, no unrelated prompt restructuring.

