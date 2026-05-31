# Java MyBatis Capability Discovery Real Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `generate-capability` produce capability-oriented business knowledge for the real Java/Maven/MyBatis project at `D:\workspace\other_project\music-education-app`.

**Architecture:** Extend `capability-discovery` to scan Java, MyBatis XML, config, tests, and docs; keep skeleton claim generation and packaging intact. Make empty CLI generation a failure. Add Java fixture tests plus mandatory real-project validation.

**Tech Stack:** TypeScript strict mode, Node fs/path, Commander CLI, Vitest, PowerShell validation on Windows.

---

## Requirements

- Do not use git worktree.
- Keep CLI thin; discovery logic stays in `src/slicing`.
- No Java AST parser dependency.
- Non-OPEN generated objects must cite evidence refs.
- Real validation must use `D:\workspace\other_project\music-education-app`.
- Do not overwrite the real repo’s existing `bootstrap-knowledge`; validate with `--out D:\tmp\music-education-app-capability-validation`.

## Files

- Modify: `src/slicing/capability-discovery.ts`
- Modify: `src/slicing/capability-candidate-schema.ts` only if signal kind enums need new values.
- Modify: `src/cli/generate-capability.ts`
- Modify: `tests/unit/slicing/capability-discovery.test.ts`
- Modify: `tests/integration/generate-capability.test.ts`

## Task 1: Add Java Fixture Discovery Tests

**Files:**
- Modify: `tests/unit/slicing/capability-discovery.test.ts`

- [ ] **Step 1: Add Java/Spring/MyBatis fixture test**

Add a test that creates this repo fixture:

```text
src/main/java/com/demo/controller/CourseController.java
src/main/java/com/demo/service/CourseService.java
src/main/java/com/demo/mapper/CourseMapper.java
src/main/resources/mapper/CourseMapper.xml
src/test/java/com/demo/service/CourseServiceTest.java
```

Use Java content:

```java
package com.demo.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/courses")
public class CourseController {
    private final CourseService courseService;

    public CourseController(CourseService courseService) {
        this.courseService = courseService;
    }

    @GetMapping("/{id}")
    public CourseDetail getCourseDetail(Long id) {
        return courseService.getCourseDetail(id);
    }
}
```

```java
package com.demo.service;

import org.springframework.stereotype.Service;

@Service
public class CourseService {
    private final CourseMapper courseMapper;

    public CourseService(CourseMapper courseMapper) {
        this.courseMapper = courseMapper;
    }

    public CourseDetail getCourseDetail(Long id) {
        return courseMapper.selectCourseDetail(id);
    }
}
```

```java
package com.demo.mapper;

public interface CourseMapper {
    CourseDetail selectCourseDetail(Long id);
}
```

```xml
<mapper namespace="com.demo.mapper.CourseMapper">
  <select id="selectCourseDetail" resultType="com.demo.CourseDetail">
    select id, name, price from course where id = #{id}
  </select>
</mapper>
```

```java
package com.demo.service;

import org.junit.jupiter.api.Test;

class CourseServiceTest {
    @Test
    void shouldLoadCourseDetail() {
    }
}
```

Call:

```ts
const candidates = await discoverCapabilities({
  repoRoot,
  targetTerms: ['course', 'mybatis'],
  targetPaths: ['src/main/java', 'src/main/resources', 'src/test'],
});
```

Assert:

```ts
expect(candidates.length).toBeGreaterThan(0);
const candidate = candidates[0]!;
expect(candidate.primaryEntryPoints.length).toBeGreaterThan(0);
expect(candidate.behaviorAnchors.length).toBeGreaterThan(0);
expect(candidate.dataAnchors.length).toBeGreaterThan(0);
expect(candidate.testAnchors.length).toBeGreaterThan(0);
expect(candidate.confidence).toBeGreaterThanOrEqual(0.55);
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected before implementation: Java fixture test fails because scanner ignores `.java` and `.xml`.

## Task 2: Extend File Scanning

**Files:**
- Modify: `src/slicing/capability-discovery.ts`

- [ ] **Step 1: Replace hard-coded TS-only extension filter**

Change file extension support to:

```ts
const DISCOVERY_FILE_EXTENSIONS = new Set([
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
  '.java',
  '.xml',
  '.yml',
  '.yaml',
  '.properties',
  '.md',
  '.txt',
]);
```

Use `path.extname(entry.name).toLowerCase()` in `scanDirectory()`.

- [ ] **Step 2: Ignore generated/heavy directories**

In recursive scan, skip directories:

```ts
const IGNORED_DISCOVERY_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  'build',
  'dist',
  '.idea',
  '.mvn',
  'logs',
]);
```

- [ ] **Step 3: Run scanner tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: Java fixture still may fail until signal extractors are added, but scanning should now include Java/XML files.

## Task 3: Add Java Entry Signals

**Files:**
- Modify: `src/slicing/capability-discovery.ts`
- Modify: `src/slicing/capability-candidate-schema.ts` only if needed.

- [ ] **Step 1: Add `collectEntrySignals`**

Implement:

```ts
async function collectEntrySignals(targetPaths: string[], repoRoot: string): Promise<EntrySignal[]> {
  const signals: EntrySignal[] = [];
  for (const targetPath of targetPaths) {
    const files = await scanDirectory(path.resolve(repoRoot, targetPath));
    for (const file of files) {
      const relative = path.relative(repoRoot, file);
      const content = await fs.readFile(file, 'utf-8').catch(() => '');
      if (file.endsWith('.java')) {
        signals.push(...extractJavaEntrySignals(content, relative));
      }
    }
  }
  return signals;
}
```

Implement `extractJavaEntrySignals`:

```ts
function extractJavaEntrySignals(content: string, location: string): EntrySignal[] {
  const signals: EntrySignal[] = [];
  const className = content.match(/\bclass\s+(\w+)/)?.[1] ?? content.match(/\binterface\s+(\w+)/)?.[1] ?? path.basename(location);
  const hasController = /@(RestController|Controller)\b/.test(content);
  const hasService = /@Service\b/.test(content);
  const hasComponent = /@Component\b/.test(content);
  const hasScheduled = /@Scheduled\b/.test(content);
  const routeMatches = [...content.matchAll(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(([^)]*)\))?/g)];

  if (hasController || routeMatches.length > 0) {
    signals.push({
      kind: 'http',
      location,
      name: className,
      signature: routeMatches.map(match => match[0]).join(' '),
      description: 'Spring controller or route entry',
    });
  } else if (hasScheduled) {
    signals.push({ kind: 'job', location, name: className, description: 'Scheduled job entry' });
  } else if (hasService || hasComponent) {
    signals.push({ kind: 'service', location, name: className, description: 'Spring service/component entry' });
  }

  return signals;
}
```

- [ ] **Step 2: Wire into `discoverCapabilities`**

Call:

```ts
const primaryEntryPoints = await collectEntrySignals(targetPaths, repoRoot);
```

Use it in candidate instead of `primaryEntryPoints: []`.

Update `entrySignal` scoring:

```ts
const entrySignal = primaryEntryPoints.length > 0 ? 0.9 : targetPaths.length > 0 ? 0.55 : 0.2;
```

- [ ] **Step 3: Run discovery tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: entry signal assertions pass.

## Task 4: Add Java Behavior And Data Signals

**Files:**
- Modify: `src/slicing/capability-discovery.ts`

- [ ] **Step 1: Extend behavior extraction for Java methods**

In `collectBehaviorSignals`, if file ends with `.java`, match methods:

```ts
const javaMethodRegex = /\b(public|private|protected)\s+(?:static\s+)?(?:final\s+)?[\w<>\[\], ?]+\s+(\w+)\s*\([^)]*\)\s*\{/g;
```

For each match:

```ts
const name = match[2];
const terms = normalizeCapabilityTerms(name);
signals.push({
  location: path.relative(repoRoot, file),
  verb: terms[0] || name,
  object: terms.slice(1).join(' ') || name,
});
```

- [ ] **Step 2: Extend data extraction for Java classes/interfaces/enums**

In `collectDataSignals`, for `.java` files detect:

```ts
/\b(class|interface|enum)\s+(\w+)/
```

Push:

```ts
{
  kind: 'type',
  location: relative,
  name: match[2],
}
```

Also capture Java field names:

```ts
/\b(private|protected|public)\s+[\w<>\[\], ?]+\s+(\w+)\s*;/
```

Attach as `fields` if `DataSignal` supports fields.

- [ ] **Step 3: Extend data extraction for MyBatis XML**

For `.xml` files containing `<mapper`, detect:

```ts
const namespace = content.match(/<mapper\s+[^>]*namespace=["']([^"']+)["']/)?.[1];
const statementRegex = /<(select|insert|update|delete)\s+[^>]*id=["']([^"']+)["'][^>]*>/g;
```

For each statement, push:

```ts
{
  kind: 'sql',
  location: relative,
  name: `${namespace ?? 'mapper'}.${statementId}`,
  fields: extractSimpleSqlTableNames(content),
}
```

`extractSimpleSqlTableNames` can conservatively match table names after `from`, `join`, `insert into`, `update`.

- [ ] **Step 4: Run discovery tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: Java fixture behavior/data assertions pass.

## Task 5: Add Java Test Signals

**Files:**
- Modify: `src/slicing/capability-discovery.ts`

- [ ] **Step 1: Extend `collectTestSignals`**

Support `.java` test files. Detect:

```ts
const className = content.match(/\bclass\s+(\w*Test)\b/)?.[1];
const testMethods = [...content.matchAll(/@Test[\s\S]*?\bvoid\s+(\w+)\s*\(/g)];
```

For each method:

```ts
signals.push({
  location: path.relative(repoRoot, file),
  testName: methodName,
});
```

- [ ] **Step 2: Run discovery tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts
```

Expected: Java fixture test signal assertion passes.

## Task 6: Add Java Integration Test For CLI

**Files:**
- Modify: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Add Java/Maven fixture integration test**

Create fixture with:

```text
src/main/java/com/demo/controller/CourseController.java
src/main/java/com/demo/service/CourseService.java
src/main/java/com/demo/mapper/CourseMapper.java
src/main/resources/mapper/CourseMapper.xml
src/test/java/com/demo/service/CourseServiceTest.java
pom.xml
```

Run:

```ts
await execa('node', [
  'dist/cli/index.js',
  'generate-capability',
  repo,
  '--terms',
  'course,mybatis',
  '--paths',
  'src/main/java,src/main/resources,src/test',
]);
```

Assert:

```ts
catalog contains 'capabilities:'
catalog contains 'CAP-'
objects/capabilities has at least one file
views/capabilities has at least one file
objects/flows exists
objects/modules exists
objects/contracts exists
objects/validation exists
objects/open exists
```

- [ ] **Step 2: Build before integration test**

Because integration test runs `dist/cli/index.js`, run:

```bash
npm run build
```

- [ ] **Step 3: Run integration test**

Run:

```bash
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: pass.

## Task 7: Make Empty Generation Fail

**Files:**
- Modify: `src/cli/generate-capability.ts`
- Modify: `tests/integration/generate-capability.test.ts`

- [ ] **Step 1: Add empty generation integration test**

Run command against an empty temp repo:

```ts
const result = await execa(
  'node',
  ['dist/cli/index.js', 'generate-capability', repo, '--terms', 'missing', '--paths', 'src'],
  { reject: false }
);

expect(result.exitCode).not.toBe(0);
expect(result.stderr + result.stdout).toContain('No capability knowledge files generated');
```

- [ ] **Step 2: Throw on empty result**

In `runGenerateCapability`, replace:

```ts
console.warn('No capability knowledge files generated');
return;
```

with:

```ts
throw new Error(`No capability knowledge files generated for target repository: ${resolvedRepoPath}`);
```

- [ ] **Step 3: Run integration test**

Run:

```bash
npm run build
npx vitest run tests/integration/generate-capability.test.ts
```

Expected: pass.

## Task 8: Local Verification

**Files:**
- No new files unless tests require fixture fixes.

- [ ] **Step 1: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 2: Build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 3: Focused tests**

Run:

```bash
npx vitest run tests/unit/slicing/capability-discovery.test.ts tests/integration/generate-capability.test.ts tests/unit/knowledge/capability-knowledge-pipeline.test.ts tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: pass.

- [ ] **Step 4: Full tests**

Run:

```bash
npm test
```

Expected: pass.

## Task 9: Real Project Validation

**Files:**
- Generated output under `D:\tmp\music-education-app-capability-validation\bootstrap-knowledge`.

- [ ] **Step 1: Remove previous validation output if needed**

Use PowerShell carefully:

```powershell
if (Test-Path D:\tmp\music-education-app-capability-validation\bootstrap-knowledge) {
  Remove-Item -LiteralPath D:\tmp\music-education-app-capability-validation\bootstrap-knowledge -Recurse -Force
}
```

Do not delete anything inside `D:\workspace\other_project\music-education-app`.

- [ ] **Step 2: Run real project command**

Run:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --verbose
```

Expected:

- command exits `0`
- output does not say `No capability knowledge files generated`
- output path is `D:\tmp\music-education-app-capability-validation\bootstrap-knowledge`

- [ ] **Step 3: Verify generated files**

Run:

```powershell
Get-ChildItem -Path D:\tmp\music-education-app-capability-validation\bootstrap-knowledge -Recurse | Select-Object -ExpandProperty FullName
```

Expected includes:

```text
catalog.yaml
views\capabilities\CAP-*.md
objects\capabilities\CAP-*.yaml
objects\flows\FLOW-*.yaml
objects\modules\MOD-*.yaml
objects\contracts\CON-*.yaml
objects\validation\VER-*.yaml
objects\open\OPEN-*.yaml
```

- [ ] **Step 4: Verify catalog**

Run:

```powershell
Get-Content -Path D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\catalog.yaml
```

Expected:

- `capabilities:` exists
- capability key starts with `CAP-`
- capability has `view: views/capabilities/CAP-*.md`
- capability lists generated object IDs
- `sdd_stage_mapping:` exists

- [ ] **Step 5: Verify capability view**

Run:

```powershell
Get-Content -Path (Get-ChildItem D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\views\capabilities\*.md | Select-Object -First 1).FullName
```

Expected:

- headings: Purpose, Terms, Current Flow, Code Surface, Contracts, Validation, Unknowns
- object ID references: CAP, FLOW, MOD, CON, VER, OPEN

- [ ] **Step 6: Verify evidence-backed objects**

Run:

```powershell
rg -n "evidencePrimary:|evidence://|sddStageUses:" D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\objects
```

Expected:

- non-OPEN objects include `evidence://...`
- objects include `sddStageUses`

- [ ] **Step 7: Final implementation response**

Claude Code must report:

```text
Real project validated: D:\workspace\other_project\music-education-app
Command used:
Output path:
Generated capability:
Object types:
Catalog capability mapping: present / missing
Capability view object references: present / missing
Evidence refs: present / missing
```

## Self-Review Checklist

- Spec coverage: plan covers Java scanning, entry/behavior/data/test signals, empty-generation failure, integration tests, local tests, and real project validation.
- Placeholder scan: no task contains TBD or vague fill-in work.
- Type consistency: uses existing `EntrySignal`, `BehaviorSignal`, `DataSignal`, `TestSignal`, and pipeline types.
- Scope control: no full repo clustering, no SDD adapters, no AST dependency.

