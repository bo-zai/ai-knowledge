# Capability Markdown Doc Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert existing capability JSON/object output into a fixed, useful Markdown capability document without letting the LLM write Markdown.

**Architecture:** Keep the current `EvidenceBundle -> CandidateClaim[] -> KnowledgeObject[]` pipeline. Add a deterministic `CapabilityDocModel` aggregation layer and a Markdown renderer, then route `buildCapabilityKnowledgeFiles()` through that model.

**Tech Stack:** TypeScript, Zod-validated LLM claim JSON, existing capability knowledge pipeline, Vitest for packaging tests, real `music-education-app` generation for final review.

---

## File Structure

- Create: `src/knowledge/capability-doc-model.ts`
  - Owns the conversion from `KnowledgeObject[] + EvidenceIndexItem[]` to `CapabilityDocModel`.
  - Contains no file system access and no LLM calls.

- Create: `src/packaging/capability-markdown-renderer.ts`
  - Owns deterministic Markdown rendering for the fixed 10-section ability document.
  - Contains table formatting and evidence formatting helpers.

- Modify: `src/packaging/capability-knowledge-writer.ts`
  - Calls the new model builder and renderer.
  - Writes both `capabilities/<capabilityId>.md` and `views/capabilities/<capabilityId>.md`.

- Modify: `src/knowledge/capability-knowledge-pipeline.ts`
  - Adds document-model quality checks after objects are assembled.

- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`
  - Updates packaging assertions from object bullet-list view to fixed Markdown document.

## Task 1: Add Capability Doc Model

**Files:**
- Create: `src/knowledge/capability-doc-model.ts`

- [ ] **Step 1: Create model types**

Create `src/knowledge/capability-doc-model.ts`:

```ts
import type { KnowledgeObject } from './capability-object-assembler.js';
import type { EvidenceIndexItem } from '../packaging/capability-knowledge-writer.js';

export interface CapabilityDocTerm {
  term: string;
  meaningZh: string;
  notEqualTo: string[];
  evidenceRefs: string[];
}

export interface CapabilityDocBehaviorStep {
  step: string;
  evidenceRefs: string[];
}

export interface CapabilityDocBehavior {
  title: string;
  summary: string;
  steps: CapabilityDocBehaviorStep[];
  evidenceRefs: string[];
}

export interface CapabilityDocCodeAnchor {
  role: string;
  symbolOrRoute: string;
  path: string;
  touchWhen: string[];
  doNotTouchWhen: string[];
  evidenceRefs: string[];
}

export interface CapabilityDocDataContract {
  subject: string;
  kind: string;
  fields: Array<{
    name: string;
    meaningZh: string;
    source: string;
    evidenceRefs: string[];
  }>;
  caveats: string[];
  evidenceRefs: string[];
}

export interface CapabilityDocUnknown {
  question: string;
  blockedDecisions: string[];
  minimalNextEvidence: string[];
  riskIfGuessed: string;
}

export interface CapabilityDocValidation {
  goal: string;
  checks: string[];
  acceptanceOracle: string[];
  cannotVerifyWithout: string[];
  evidenceRefs: string[];
}

export interface CapabilityDocEvidence {
  ref: string;
  kind: string;
  location?: string;
  name?: string;
  summary?: string;
}

export interface CapabilityDocModel {
  capabilityId: string;
  title: string;
  summaryZh: string;
  includes: string[];
  excludes: string[];
  triggers: string[];
  terms: CapabilityDocTerm[];
  behaviors: CapabilityDocBehavior[];
  codeAnchors: CapabilityDocCodeAnchor[];
  dataContracts: CapabilityDocDataContract[];
  unknowns: CapabilityDocUnknown[];
  validation: CapabilityDocValidation[];
  evidenceIndex: CapabilityDocEvidence[];
}
```

- [ ] **Step 2: Add helpers**

Append helpers in the same file:

```ts
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function objectSource(object: KnowledgeObject): string {
  return asString(object.metadata.source) ?? 'llm';
}

function isWeakSkeletonTerm(object: KnowledgeObject): boolean {
  if (object.type !== 'TERM') return false;
  if (objectSource(object) !== 'skeleton') return false;
  const canonicalTerm = asString(object.metadata.canonicalTerm) ?? '';
  const definition = asString(object.metadata.businessDefinition) ?? '';
  return definition.length === 0 || definition.toLowerCase() === canonicalTerm.toLowerCase();
}

function collectUsedRefs(objects: KnowledgeObject[]): Set<string> {
  const refs = new Set<string>();
  for (const object of objects) {
    for (const ref of object.evidencePrimary) refs.add(ref);
    for (const ref of object.evidenceSupporting) refs.add(ref);
  }
  return refs;
}
```

- [ ] **Step 3: Build model function**

Append `buildCapabilityDocModel`:

```ts
export function buildCapabilityDocModel(input: {
  objects: KnowledgeObject[];
  capabilityId: string;
  evidenceIndex?: EvidenceIndexItem[];
}): CapabilityDocModel {
  const { objects, capabilityId } = input;
  const cap = objects.find(o => o.id === capabilityId) ?? objects.find(o => o.type === 'CAP');
  const title = asString(cap?.metadata.canonicalTerm) ?? cap?.id ?? capabilityId;
  const summaryZh = cap?.description ?? `Capability ${capabilityId}`;

  const terms = objects
    .filter(o => o.type === 'TERM')
    .filter(o => !isWeakSkeletonTerm(o))
    .map(o => ({
      term: asString(o.metadata.canonicalTerm) ?? o.id.replace(/^TERM-/, ''),
      meaningZh: asString(o.metadata.businessDefinition) ?? o.description,
      notEqualTo: asStringArray(o.metadata.notEqualTo),
      evidenceRefs: o.evidencePrimary,
    }));

  const behaviors = objects
    .filter(o => o.type === 'FLOW')
    .map(o => {
      const orderedSteps = Array.isArray(o.metadata.orderedSteps) ? o.metadata.orderedSteps : [];
      const evidenceSteps = Array.isArray(o.metadata.evidenceSteps) ? o.metadata.evidenceSteps : [];
      const steps = orderedSteps
        .map(step => {
          if (!step || typeof step !== 'object') return undefined;
          const record = step as Record<string, unknown>;
          const action = asString(record.action);
          if (!action) return undefined;
          const evidenceRef = asString(record.evidenceRef);
          return { step: action, evidenceRefs: evidenceRef ? [evidenceRef] : o.evidencePrimary };
        })
        .filter((step): step is CapabilityDocBehaviorStep => Boolean(step));

      if (steps.length === 0) {
        for (const item of evidenceSteps) {
          if (!item || typeof item !== 'object') continue;
          const record = item as Record<string, unknown>;
          const action = asString(record.action);
          if (action) steps.push({ step: action, evidenceRefs: o.evidencePrimary });
        }
      }

      return {
        title: o.id,
        summary: o.description,
        steps,
        evidenceRefs: o.evidencePrimary,
      };
    });

  const codeAnchors = objects
    .filter(o => o.type === 'MOD')
    .map(o => ({
      role: asString(o.metadata.ownedResponsibility) ?? o.description,
      symbolOrRoute: asStringArray(o.metadata.entryPoints).join(', ') || o.id,
      path: asString(o.metadata.rootPath) ?? 'unknown',
      touchWhen: asStringArray(o.metadata.touchWhen),
      doNotTouchWhen: asStringArray(o.metadata.doNotTouchWhen),
      evidenceRefs: o.evidencePrimary,
    }));

  const dataContracts = objects
    .filter(o => o.type === 'CON')
    .map(o => {
      const fields: CapabilityDocDataContract['fields'] = [];
      const fieldSemantics = o.metadata.fieldSemantics;
      if (fieldSemantics && typeof fieldSemantics === 'object' && !Array.isArray(fieldSemantics)) {
        for (const [name, value] of Object.entries(fieldSemantics as Record<string, unknown>)) {
          const meaningZh = typeof value === 'string'
            ? value
            : value && typeof value === 'object'
              ? asString((value as Record<string, unknown>).meaning) ?? asString((value as Record<string, unknown>).businessMeaning) ?? ''
              : '';
          fields.push({
            name,
            meaningZh,
            source: asString(o.metadata.subject) ?? o.id,
            evidenceRefs: o.evidencePrimary,
          });
        }
      }

      return {
        subject: asString(o.metadata.subject) ?? o.description,
        kind: asString(o.metadata.kind) ?? 'contract',
        fields,
        caveats: asStringArray(o.metadata.validationRules),
        evidenceRefs: o.evidencePrimary,
      };
    });

  const unknowns = objects
    .filter(o => o.type === 'OPEN')
    .map(o => ({
      question: o.description,
      blockedDecisions: o.blockedDecisions,
      minimalNextEvidence: asStringArray(o.metadata.minimalNextEvidence),
      riskIfGuessed: o.unsupportedParts.join('; ') || 'If guessed, the implementation plan may rely on unsupported assumptions.',
    }));

  const validation = objects
    .filter(o => o.type === 'VER')
    .map(o => ({
      goal: asString(o.metadata.verificationGoal) ?? o.description,
      checks: asStringArray(o.metadata.testAnchors),
      acceptanceOracle: asStringArray(o.metadata.acceptanceOracle),
      cannotVerifyWithout: [],
      evidenceRefs: o.evidencePrimary,
    }));

  if (validation.length === 0) {
    const validationUnknown = unknowns.find(u =>
      u.question.toLowerCase().includes('validation') ||
      u.blockedDecisions.some(decision => decision.toLowerCase().includes('validation')),
    );
    validation.push({
      goal: '当前知识包没有足够证据证明验证路径。',
      checks: [],
      acceptanceOracle: [],
      cannotVerifyWithout: validationUnknown?.minimalNextEvidence.length
        ? validationUnknown.minimalNextEvidence
        : ['补充测试、手工验收步骤或运行证据后，才能把验证结论作为事实。'],
      evidenceRefs: [],
    });
  }

  const usedRefs = collectUsedRefs(objects);
  const evidenceIndex = (input.evidenceIndex ?? [])
    .filter(item => usedRefs.has(item.ref))
    .map(item => ({
      ref: item.ref,
      kind: item.kind,
      location: item.location,
      name: item.name,
      summary: item.summary,
    }));

  return {
    capabilityId,
    title,
    summaryZh,
    includes: asStringArray(cap?.metadata.successCriteria),
    excludes: asStringArray(cap?.metadata.nonGoals),
    triggers: [title, ...terms.map(term => term.term)].filter((item, index, array) => array.indexOf(item) === index),
    terms,
    behaviors,
    codeAnchors,
    dataContracts,
    unknowns,
    validation,
    evidenceIndex,
  };
}
```

- [ ] **Step 4: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: FAIL only if imports or strict typing need adjustment in the new file.

- [ ] **Step 5: Fix strict typing issues**

If TypeScript rejects optional values, update the exact rejected expression by narrowing with `asString()` or `asStringArray()`. Do not introduce `any`.

- [ ] **Step 6: Run typecheck again**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

## Task 2: Add Fixed Markdown Renderer

**Files:**
- Create: `src/packaging/capability-markdown-renderer.ts`

- [ ] **Step 1: Create renderer helpers**

Create `src/packaging/capability-markdown-renderer.ts`:

```ts
import type { CapabilityDocModel } from '../knowledge/capability-doc-model.js';

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function listOrFallback(items: string[], fallback: string): string[] {
  return items.length > 0 ? items : [fallback];
}

function evidenceRefs(refs: string[]): string {
  return refs.length > 0 ? refs.join(', ') : '-';
}

function pushList(lines: string[], items: string[], fallback: string): void {
  for (const item of listOrFallback(items, fallback)) {
    lines.push(`- ${item}`);
  }
}
```

- [ ] **Step 2: Render fixed sections**

Append:

```ts
export function renderCapabilityMarkdown(model: CapabilityDocModel): string {
  const lines: string[] = [];

  lines.push(`# ${model.title}`);
  lines.push('');

  lines.push('## 1. 能力结论');
  lines.push('');
  lines.push(model.summaryZh);
  lines.push('');
  lines.push('包含范围：');
  pushList(lines, model.includes, '当前知识包未提供更细的包含范围，需结合下方行为和代码锚点判断。');
  lines.push('');
  lines.push('不包含范围：');
  pushList(lines, model.excludes, '当前知识包未提供明确非目标；计划时不能把未证实边界当成事实。');
  lines.push('');

  lines.push('## 2. 什么时候会用到这份知识');
  lines.push('');
  pushList(lines, model.triggers, '当需求提到该能力名称、相关入口、相关数据表或相关模块时，应先阅读本文。');
  lines.push('');

  lines.push('## 3. 业务术语');
  lines.push('');
  if (model.terms.length === 0) {
    lines.push('- 当前知识包没有生成足够可靠的业务术语对象；不要从代码类名直接猜业务含义。');
  } else {
    lines.push('| 术语 | 含义 | 不等于 | 证据 |');
    lines.push('| --- | --- | --- | --- |');
    for (const term of model.terms) {
      lines.push(`| ${escapeCell(term.term)} | ${escapeCell(term.meaningZh)} | ${escapeCell(term.notEqualTo.join(', ') || '-')} | ${escapeCell(evidenceRefs(term.evidenceRefs))} |`);
    }
  }
  lines.push('');

  lines.push('## 4. 当前行为');
  lines.push('');
  if (model.behaviors.length === 0) {
    lines.push('- 当前知识包没有稳定 FLOW 对象；实现前需要从代码入口重建当前行为。');
  } else {
    for (const behavior of model.behaviors) {
      lines.push(`### ${behavior.title}`);
      lines.push('');
      lines.push(behavior.summary);
      lines.push('');
      if (behavior.steps.length > 0) {
        behavior.steps.forEach((step, index) => {
          lines.push(`${index + 1}. ${step.step} (${evidenceRefs(step.evidenceRefs)})`);
        });
      } else {
        lines.push(`- 证据：${evidenceRefs(behavior.evidenceRefs)}`);
      }
      lines.push('');
    }
  }

  lines.push('## 5. 入口与代码位置');
  lines.push('');
  if (model.codeAnchors.length === 0) {
    lines.push('- 当前知识包没有稳定 MOD 对象；不能直接给出改动面。');
  } else {
    lines.push('| 场景 | 入口/方法 | 文件 | 作用 | 证据 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const anchor of model.codeAnchors) {
      lines.push(`| ${escapeCell(anchor.role)} | ${escapeCell(anchor.symbolOrRoute)} | ${escapeCell(anchor.path)} | ${escapeCell(anchor.role)} | ${escapeCell(evidenceRefs(anchor.evidenceRefs))} |`);
    }
  }
  lines.push('');

  lines.push('## 6. 改动定位建议');
  lines.push('');
  if (model.codeAnchors.length === 0) {
    lines.push('- 没有可用代码锚点，计划前必须重新检索入口、服务和数据访问层。');
  } else {
    for (const anchor of model.codeAnchors) {
      lines.push(`### ${anchor.path}`);
      lines.push('');
      lines.push('应该修改当：');
      pushList(lines, anchor.touchWhen, '当前知识包没有提供明确 touch_when；修改前需要重新确认模块职责。');
      lines.push('');
      lines.push('不应该修改当：');
      pushList(lines, anchor.doNotTouchWhen, '当前知识包没有提供明确 do_not_touch_when；不要把模块边界当成事实。');
      lines.push('');
    }
  }

  lines.push('## 7. 数据与契约');
  lines.push('');
  if (model.dataContracts.length === 0) {
    lines.push('- 当前知识包没有稳定 CON 对象；涉及接口、SQL、表字段或事件时必须补充契约证据。');
  } else {
    for (const contract of model.dataContracts) {
      lines.push(`### ${contract.subject}`);
      lines.push('');
      lines.push(`- 类型：${contract.kind}`);
      lines.push(`- 证据：${evidenceRefs(contract.evidenceRefs)}`);
      if (contract.fields.length > 0) {
        lines.push('');
        lines.push('| 数据/字段 | 含义 | 来源 | 证据 |');
        lines.push('| --- | --- | --- | --- |');
        for (const field of contract.fields) {
          lines.push(`| ${escapeCell(field.name)} | ${escapeCell(field.meaningZh || '-')} | ${escapeCell(field.source)} | ${escapeCell(evidenceRefs(field.evidenceRefs))} |`);
        }
      }
      if (contract.caveats.length > 0) {
        lines.push('');
        lines.push('注意：');
        pushList(lines, contract.caveats, '');
      }
      lines.push('');
    }
  }

  lines.push('## 8. 不能猜的边界');
  lines.push('');
  if (model.unknowns.length === 0) {
    lines.push('- 当前知识包没有 OPEN 对象；这不代表没有未知，遇到 source of truth、验证或外部系统证据缺口仍需停下确认。');
  } else {
    for (const unknown of model.unknowns) {
      lines.push(`### ${unknown.question}`);
      lines.push('');
      lines.push('阻塞决策：');
      pushList(lines, unknown.blockedDecisions, '当前 OPEN 未声明阻塞决策，使用前需要补充。');
      lines.push('');
      lines.push('最小下一证据：');
      pushList(lines, unknown.minimalNextEvidence, '需要补充代码、测试、契约或负责人确认。');
      lines.push('');
      lines.push(`猜测风险：${unknown.riskIfGuessed}`);
      lines.push('');
    }
  }

  lines.push('## 9. 验证方式');
  lines.push('');
  for (const validation of model.validation) {
    lines.push(`### ${validation.goal}`);
    lines.push('');
    lines.push('检查项：');
    pushList(lines, validation.checks, '当前知识包没有可执行检查项。');
    lines.push('');
    lines.push('验收 oracle：');
    pushList(lines, validation.acceptanceOracle, '当前知识包没有足够证据给出验收 oracle。');
    lines.push('');
    lines.push('无法验证除非：');
    pushList(lines, validation.cannotVerifyWithout, '已有验证证据足够或不需要额外前置条件。');
    lines.push('');
    lines.push(`证据：${evidenceRefs(validation.evidenceRefs)}`);
    lines.push('');
  }

  lines.push('## 10. 证据索引');
  lines.push('');
  if (model.evidenceIndex.length === 0) {
    lines.push('- 本文没有可展开的 evidence index 条目；请查看 `evidence/index.jsonl` 和 debug 材料。');
  } else {
    lines.push('| 证据 | 类型 | 位置 | 支撑结论 |');
    lines.push('| --- | --- | --- | --- |');
    for (const evidence of model.evidenceIndex) {
      lines.push(`| ${escapeCell(evidence.ref)} | ${escapeCell(evidence.kind)} | ${escapeCell(evidence.location ?? '-')} | ${escapeCell(evidence.summary ?? evidence.name ?? '-')} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}
```

- [ ] **Step 3: Typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

## Task 3: Route Capability Writer Through Doc Model

**Files:**
- Modify: `src/packaging/capability-knowledge-writer.ts`

- [ ] **Step 1: Import new functions**

At the top of `src/packaging/capability-knowledge-writer.ts`, add:

```ts
import { buildCapabilityDocModel } from '../knowledge/capability-doc-model.js';
import { renderCapabilityMarkdown } from './capability-markdown-renderer.js';
```

- [ ] **Step 2: Replace `buildCapabilityView` implementation**

Change the signature from:

```ts
export function buildCapabilityView(objects: KnowledgeObject[], capabilityId: string): string {
```

to:

```ts
export function buildCapabilityView(
  objects: KnowledgeObject[],
  capabilityId: string,
  evidenceIndex?: EvidenceIndexItem[],
): string {
  const model = buildCapabilityDocModel({ objects, capabilityId, evidenceIndex });
  return renderCapabilityMarkdown(model);
}
```

Remove the old object-list body.

- [ ] **Step 3: Pass evidence index when building the view**

In `buildCapabilityKnowledgeFiles`, change:

```ts
content: buildCapabilityView(objects, capabilityId),
```

to:

```ts
content: buildCapabilityView(objects, capabilityId, evidenceIndex),
```

- [ ] **Step 4: Write primary capability Markdown**

In `buildCapabilityKnowledgeFiles`, after the existing `views/capabilities` file push, add:

```ts
files.push({
  path: `capabilities/${capabilityId}.md`,
  content: buildCapabilityView(objects, capabilityId, evidenceIndex),
});
```

If this calls `buildCapabilityView` twice, assign the result once:

```ts
const capabilityMarkdown = buildCapabilityView(objects, capabilityId, evidenceIndex);
```

Then use `capabilityMarkdown` for both paths.

- [ ] **Step 5: Typecheck and build**

Run:

```powershell
npm run typecheck
npm run build
```

Expected: both PASS.

## Task 4: Add Doc Model Quality Gate

**Files:**
- Modify: `src/knowledge/capability-knowledge-pipeline.ts`

- [ ] **Step 1: Import doc model builder**

Add:

```ts
import { buildCapabilityDocModel } from './capability-doc-model.js';
```

- [ ] **Step 2: Build evidence index before quality gate if needed**

Move:

```ts
const evidenceIndex = buildEvidenceIndexFromBundle(bundle);
```

above final object quality gates if it is currently declared later.

- [ ] **Step 3: Add document usability gate**

After `const capabilityId = capObject?.id || 'UNKNOWN-CAPABILITY';`, add:

```ts
const docModel = buildCapabilityDocModel({ objects, capabilityId, evidenceIndex });
const docHasSummary = docModel.summaryZh.trim().length > 0;
const docHasCodeAnchors = docModel.codeAnchors.length > 0;
const docHasValidation = docModel.validation.length > 0;

if (!docHasSummary) {
  throw new CapabilityKnowledgeGenerationError('LLM generation failed: capability Markdown summary is empty', []);
}
if (!docHasCodeAnchors) {
  throw new CapabilityKnowledgeGenerationError('LLM generation failed: capability Markdown has no code anchors', []);
}
if (!docHasValidation) {
  throw new CapabilityKnowledgeGenerationError('LLM generation failed: capability Markdown has no validation section', []);
}
```

This gate must not require `TERM` because weak skeleton terms should be dropped.

- [ ] **Step 4: Typecheck and build**

Run:

```powershell
npm run typecheck
npm run build
```

Expected: both PASS.

## Task 5: Update Packaging Tests

**Files:**
- Modify: `tests/unit/packaging/capability-knowledge-writer.test.ts`

- [ ] **Step 1: Update fixed section assertions**

Replace the test that checks old headings:

```ts
expect(viewFile?.content).toContain('## Requirement Intent');
expect(viewFile?.content).toContain('## Current Behavior');
expect(viewFile?.content).toContain('## Business Terms');
expect(viewFile?.content).toContain('## Contracts');
expect(viewFile?.content).toContain('## Code Anchors');
expect(viewFile?.content).toContain('## Validation');
expect(viewFile?.content).toContain('## Unknowns and Escalation');
```

with:

```ts
expect(viewFile?.content).toContain('## 1. 能力结论');
expect(viewFile?.content).toContain('## 2. 什么时候会用到这份知识');
expect(viewFile?.content).toContain('## 3. 业务术语');
expect(viewFile?.content).toContain('## 4. 当前行为');
expect(viewFile?.content).toContain('## 5. 入口与代码位置');
expect(viewFile?.content).toContain('## 6. 改动定位建议');
expect(viewFile?.content).toContain('## 7. 数据与契约');
expect(viewFile?.content).toContain('## 8. 不能猜的边界');
expect(viewFile?.content).toContain('## 9. 验证方式');
expect(viewFile?.content).toContain('## 10. 证据索引');
```

- [ ] **Step 2: Add primary capability path assertion**

In the `generates capability view under views/capabilities/` test, add:

```ts
const primaryFile = files.find(f => f.path === 'capabilities/CAP-DB-KNOWLEDGE-GENERATION.md');
expect(primaryFile).toBeDefined();
```

- [ ] **Step 3: Replace object bullet assertion**

Replace:

```ts
expect(view).toContain('- CAP-TEST: Test capability');
expect(view).toContain('- FLOW-TEST: Test flow');
expect(view).toContain('- OPEN-TEST: Test unknown');
```

with:

```ts
expect(view).toContain('Test capability');
expect(view).toContain('Test flow');
expect(view).toContain('Test unknown');
expect(view).toContain('## 9. 验证方式');
expect(view).not.toContain('## Validation\n- (none)');
```

- [ ] **Step 4: Run targeted tests**

Run:

```powershell
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run compile checks**

Run:

```powershell
npm run typecheck
npm run build
```

Expected: both PASS.

## Task 6: Real Project Validation

**Files:**
- Modify source only if generated Markdown fails the checks below.

- [ ] **Step 1: Build CLI**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 2: Generate order capability docs**

Run:

```powershell
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-capability-md-model --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected: command exits `0`.

- [ ] **Step 3: Read primary Markdown**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge\capabilities\*.md
```

Expected:

```text
The document contains sections 1 through 10.
The document is not only a list of object IDs.
The validation section is not empty.
The code anchor section includes concrete paths or modules.
The unknown boundary section is actionable when OPEN objects exist.
```

- [ ] **Step 4: Confirm compatibility view**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge\views\capabilities\*.md
```

Expected: content matches the primary capability Markdown structure.

- [ ] **Step 5: Confirm LLM still returns JSON**

Run:

```powershell
Get-Content D:\tmp\music-education-app-capability-md-model\bootstrap-knowledge\debug\capability-llm-response.json
```

Expected:

```text
Response contains JSON claims, not final Markdown.
```

## Task 7: Final Verification

**Files:**
- No source edits unless verification fails.

- [ ] **Step 1: Run required project checks**

Run:

```powershell
npm run typecheck
npm run build
npm test
```

Expected: all PASS.

- [ ] **Step 2: Run targeted packaging test**

Run:

```powershell
npx vitest run tests/unit/packaging/capability-knowledge-writer.test.ts
```

Expected: PASS.

- [ ] **Step 3: Produce completion notes**

Report:

```text
Spec:
Plan:
Changed files:
Primary Markdown path:
Compatibility view path:
Validation section status:
Evidence index status:
Commands run:
Remaining gaps:
```

## Self-Review

- Spec coverage:
  - `CapabilityDocModel` is implemented by Task 1.
  - Fixed Markdown rendering is implemented by Task 2.
  - Writer integration and output paths are implemented by Task 3.
  - Quality gates are implemented by Task 4.
  - Unit packaging coverage is updated by Task 5.
  - Real generated Markdown review is covered by Task 6.
  - Required project checks are covered by Task 7.

- Placeholder scan:
  - The plan contains no placeholder markers and no undefined future work steps.

- Type consistency:
  - `CapabilityDocModel`, `CapabilityDocTerm`, `CapabilityDocBehavior`, `CapabilityDocCodeAnchor`, `CapabilityDocDataContract`, `CapabilityDocUnknown`, `CapabilityDocValidation`, and `CapabilityDocEvidence` are all defined before use.
  - `buildCapabilityDocModel()` and `renderCapabilityMarkdown()` signatures match writer integration steps.
