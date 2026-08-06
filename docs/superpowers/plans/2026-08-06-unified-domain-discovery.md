# Unified Domain Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified domain discovery pipeline that fuses document, code, and Git evidence into one `domain-registry`, reuses the existing embedding stack for document chunks, and feeds PM/Tech Lead/QA role knowledge from the same domain source of truth.

**Architecture:** Parse documents into structured chunks, embed document/code/knowledge evidence through the existing vector stack, then run an LLM-based domain merger over the combined evidence package. The merged domain registry becomes the shared base for ai-knowledge and all three role agents.

**Tech Stack:** TypeScript, Node 20, zod, Vitest, existing `src/engine/embeddings/*`, existing LadybugDB vector storage, existing CLI and role-knowledge pipeline.

---

### Task 1: Add unified evidence and domain schemas

**Files:**
- Modify: `src/role-knowledge/types.ts`
- Modify: `src/role-knowledge/schemas.ts`
- Modify: `src/packaging/domain-registry.ts`
- Test: `tests/unit/role-knowledge/types.test.ts`
- Test: `tests/unit/packaging/domain-registry-role-refs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  EvidenceEmbeddingSchema,
  DomainRecordSchema,
  DomainStatusSchema,
} from "../../../src/role-knowledge/schemas.js";

describe("unified evidence schemas", () => {
  it("parses a document evidence embedding", () => {
    const parsed = EvidenceEmbeddingSchema.parse({
      id: "doc-1#0",
      sourceType: "document",
      sourceId: "doc-1",
      chunkIndex: 0,
      content: "已支付订单取消后自动退款",
      contentHash: "abc",
      path: "docs/req/order.md",
      titlePath: ["订单取消"],
      domainKey: "order-cancel",
      embedding: [0.1, 0.2],
    });
    expect(parsed.sourceType).toBe("document");
  });

  it("accepts confirmed and conflict domain statuses", () => {
    expect(DomainStatusSchema.parse("confirmed")).toBe("confirmed");
    expect(DomainStatusSchema.parse("conflict")).toBe("conflict");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/role-knowledge/types.test.ts tests/unit/packaging/domain-registry-role-refs.test.ts`
Expected: fail because the new schemas do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export const DomainStatusSchema = z.enum([
  "confirmed",
  "doc_only",
  "code_only",
  "candidate",
  "conflict",
]);

export const EvidenceEmbeddingSchema = z.object({
  id: z.string().min(1),
  sourceType: z.enum(["code", "document", "knowledge", "git"]),
  sourceId: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  content: z.string().min(1),
  contentHash: z.string().min(1),
  path: z.string().min(1).optional(),
  titlePath: z.array(z.string()).default([]),
  domainKey: z.string().min(1).optional(),
  embedding: z.array(z.number()),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/role-knowledge/types.test.ts tests/unit/packaging/domain-registry-role-refs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/types.ts src/role-knowledge/schemas.ts src/packaging/domain-registry.ts tests/unit/role-knowledge/types.test.ts tests/unit/packaging/domain-registry-role-refs.test.ts
git commit -m "feat: add unified evidence domain schemas"
```

### Task 2: Add document parsing, chunking, and evidence embedding

**Files:**
- Modify: `src/role-knowledge/documents.ts`
- Modify: `src/role-knowledge/chunking.ts`
- Create: `src/role-knowledge/document-parser.ts`
- Create: `src/role-knowledge/document-evidence.ts`
- Modify: `src/engine/embeddings/embedding-pipeline.ts`
- Modify: `src/engine/embeddings/types.ts`
- Test: `tests/unit/role-knowledge/document-parser.test.ts`
- Test: `tests/unit/role-knowledge/chunking.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseMarkdownDocument } from "../../../src/role-knowledge/document-parser.js";
import { buildDocumentChunks } from "../../../src/role-knowledge/chunking.js";

describe("document parsing and chunking", () => {
  it("preserves heading path and table text for markdown docs", () => {
    const parsed = parseMarkdownDocument({
      id: "req-1",
      path: "docs/req/order.md",
      text: "# 订单\n\n## 取消\n\n| 条件 | 规则 |\n|---|---|\n| 已支付 | 自动退款 |",
    });
    const chunks = buildDocumentChunks({ document: parsed });
    expect(chunks[0].titlePath).toContain("订单");
    expect(chunks.some((c) => c.text.includes("自动退款"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/role-knowledge/document-parser.test.ts tests/unit/role-knowledge/chunking.test.ts`
Expected: fail because parser/chunker do not yet preserve structured document elements.

- [ ] **Step 3: Write minimal implementation**

```ts
export function parseMarkdownDocument(input: {
  id: string;
  path: string;
  text: string;
}) {
  return createParsedDocument(input);
}
```

```ts
export function buildDocumentChunks(input: { document: ParsedDocument }) {
  return [
    {
      id: `${input.document.id}#0`,
      documentId: input.document.id,
      titlePath: [],
      text: input.document.text,
      kind: "parent",
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/role-knowledge/document-parser.test.ts tests/unit/role-knowledge/chunking.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/document-parser.ts src/role-knowledge/documents.ts src/role-knowledge/chunking.ts tests/unit/role-knowledge/document-parser.test.ts tests/unit/role-knowledge/chunking.test.ts
git commit -m "feat: parse and chunk requirement documents"
```

### Task 3: Reuse existing embedding pipeline for document evidence

**Files:**
- Modify: `src/engine/embeddings/embedding-pipeline.ts`
- Modify: `src/engine/embeddings/embedder.ts`
- Modify: `src/engine/lbug/schema.ts`
- Modify: `src/role-knowledge/document-evidence.ts`
- Test: `tests/unit/embeddings/evidence-embedding.test.ts`
- Test: `tests/unit/role-knowledge/document-evidence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { contentHashForEvidence } from "../../../src/role-knowledge/document-evidence.js";

describe("evidence embedding reuse", () => {
  it("hashes document chunks deterministically", () => {
    const hash1 = contentHashForEvidence({
      sourceType: "document",
      sourceId: "req-1",
      chunkIndex: 0,
      content: "已支付订单取消后自动退款",
      path: "docs/req/order.md",
      titlePath: ["订单", "取消"],
    });
    const hash2 = contentHashForEvidence({
      sourceType: "document",
      sourceId: "req-1",
      chunkIndex: 0,
      content: "已支付订单取消后自动退款",
      path: "docs/req/order.md",
      titlePath: ["订单", "取消"],
    });
    expect(hash1).toBe(hash2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/embeddings/evidence-embedding.test.ts tests/unit/role-knowledge/document-evidence.test.ts`
Expected: fail because evidence hashing and storage abstraction do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
import { createHash } from "node:crypto";
import { embedBatch, embeddingToArray } from "../engine/embeddings/embedder.js";

export type EvidenceEmbeddingInput = {
  sourceType: "code" | "document" | "knowledge" | "git";
  sourceId: string;
  chunkIndex: number;
  content: string;
  path?: string;
  titlePath?: string[];
  domainKey?: string;
};

export async function buildEvidenceEmbeddings(rows: EvidenceEmbeddingInput[]) {
  const texts = rows.map(formatEvidenceEmbeddingText);
  const vectors = await embedBatch(texts);
  return rows.map((row, index) => ({
    id: `${row.sourceType}:${row.sourceId}#${row.chunkIndex}`,
    ...row,
    contentHash: contentHashForEvidence(row),
    embedding: embeddingToArray(vectors[index]),
  }));
}

export function contentHashForEvidence(input: EvidenceEmbeddingInput) {
  return createHash("sha1")
    .update("evidence-embedding/v1")
    .update("\n")
    .update(formatEvidenceEmbeddingText(input))
    .digest("hex");
}

function formatEvidenceEmbeddingText(input: EvidenceEmbeddingInput) {
  return [
    `source_type: ${input.sourceType}`,
    input.path ? `path: ${input.path}` : "",
    input.titlePath?.length ? `title_path: ${input.titlePath.join(" > ")}` : "",
    input.domainKey ? `domain: ${input.domainKey}` : "",
    input.content,
  ]
    .filter(Boolean)
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/embeddings/evidence-embedding.test.ts tests/unit/role-knowledge/document-evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/embeddings/embedding-pipeline.ts src/engine/embeddings/embedder.ts src/engine/lbug/schema.ts src/role-knowledge/document-evidence.ts tests/unit/embeddings/evidence-embedding.test.ts tests/unit/role-knowledge/document-evidence.test.ts
git commit -m "feat: reuse embeddings for document evidence"
```

### Task 4: Build unified domain discovery over code, docs, and Git

**Files:**
- Modify: `src/role-knowledge/discover-domains.ts`
- Modify: `src/role-knowledge/pipeline.ts`
- Modify: `src/cli/role-knowledge.ts`
- Create: `src/role-knowledge/evidence-collector.ts`
- Create: `src/role-knowledge/domain-discovery.ts`
- Test: `tests/integration/role-knowledge-command.test.ts`
- Test: `tests/unit/role-knowledge/discover-domains.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { discoverDomains } from "../../../src/role-knowledge/discover-domains.js";

describe("unified domain discovery", () => {
  it("marks a domain confirmed when docs and code evidence agree", async () => {
    const result = await discoverDomains({
      registry: { domains: [] },
      knowledgeObjects: [{ type: "capabilities", id: "order-cancel", name: "order-cancel", path: "capabilities/order-cancel.md" }],
      codeSignals: [{ domainKey: "order-cancel", summary: "cancel/refund workflow" }],
      docSignals: [{ domainKey: "order-cancel", summary: "订单取消后自动退款" }],
      gitSignals: [{ domainKey: "order-cancel", summary: "feat: support order cancel refund" }],
    });
    expect(result.confirmed[0].domainKey).toBe("order-cancel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/role-knowledge/discover-domains.test.ts tests/integration/role-knowledge-command.test.ts`
Expected: fail because discovery still treats docs/code separately.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function discoverDomains(input: {
  registry: { domains: any[] };
  knowledgeObjects: Array<{ type: string; id: string; name: string; path: string }>;
  codeSignals: Array<{ domainKey: string; summary: string }>;
  docSignals: Array<{ domainKey: string; summary: string }>;
  gitSignals: Array<{ domainKey: string; summary: string }>;
}) {
  return {
    confirmed: input.docSignals.filter((d) =>
      input.codeSignals.some((c) => c.domainKey === d.domainKey),
    ),
    docOnly: [],
    codeOnly: [],
    candidates: [],
    conflicts: [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/role-knowledge/discover-domains.test.ts tests/integration/role-knowledge-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/discover-domains.ts src/role-knowledge/pipeline.ts src/cli/role-knowledge.ts src/role-knowledge/evidence-collector.ts src/role-knowledge/domain-discovery.ts tests/unit/role-knowledge/discover-domains.test.ts tests/integration/role-knowledge-command.test.ts
git commit -m "feat: unify domain discovery across evidence"
```

### Task 5: Regenerate role knowledge from the unified registry

**Files:**
- Modify: `src/role-knowledge/writer.ts`
- Modify: `src/skills/templates/business-subagents/pm.md`
- Modify: `src/skills/templates/business-subagents/tech-lead.md`
- Modify: `src/skills/templates/business-subagents/qa.md`
- Test: `tests/unit/skills/business-subagents.test.ts`
- Test: `tests/unit/role-knowledge/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { writeRoleKnowledge } from "../../../src/role-knowledge/writer.js";

describe("role knowledge writer", () => {
  it("writes a unified read protocol for a confirmed domain", async () => {
    const index = await writeRoleKnowledge({
      outputRoot: "/tmp/ai-knowledge",
      domain: "order-cancel",
      domainName: "订单取消",
      role: "pm",
      status: "generated",
      claims: [],
      currentMarkdown: "# 订单取消",
      evolutionMarkdown: "## 演进",
      evidenceJson: { claims: 0 },
      reviewMarkdown: "",
      baseKnowledgeRefs: [],
    });
    expect(index.domain.domainKey).toBe("order-cancel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/skills/business-subagents.test.ts tests/unit/role-knowledge/types.test.ts`
Expected: fail until the role writer and templates are aligned with the unified registry.

- [ ] **Step 3: Write minimal implementation**

```ts
type UnifiedDomainRecord = {
  domainKey: string;
  sources: {
    code: Array<{ path: string }>;
    docs: Array<{ path: string }>;
  };
};

export function buildBaseKnowledgeRefsFromDomainRecord(record: UnifiedDomainRecord) {
  return Array.from(
    new Set([
      ...record.sources.code.map((ref) => ref.path),
      ...record.sources.docs.map((ref) => ref.path),
    ]),
  ).filter((path) => path.startsWith("capabilities/") || path.startsWith("concepts/") || path.startsWith("workflows/") || path.startsWith("boundaries/"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/skills/business-subagents.test.ts tests/unit/role-knowledge/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/writer.ts src/skills/templates/business-subagents/pm.md src/skills/templates/business-subagents/tech-lead.md src/skills/templates/business-subagents/qa.md tests/unit/skills/business-subagents.test.ts tests/unit/role-knowledge/types.test.ts
git commit -m "feat: regenerate role knowledge from unified domains"
```

### Task 6: Full verification and cleanup

**Files:**
- None

- [ ] **Step 1: Run the full validation suite**

Run:

```bash
npm run typecheck
npm run build
npm test
```

Expected:

- `npm run typecheck` exits 0
- `npm run build` exits 0
- `npm test` exits 0 with all tests passing

- [ ] **Step 2: Inspect the produced registry and role outputs**

Run:

```bash
git status --short
```

Expected:

- only intended source changes remain
- generated files are either committed or ignored by design

- [ ] **Step 3: Commit any final fixes**

```bash
git add src tests docs
git commit -m "feat: complete unified domain discovery"
```
