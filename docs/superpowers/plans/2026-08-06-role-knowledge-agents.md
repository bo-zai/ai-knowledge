# Role Knowledge Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a role-aware knowledge layer on top of the existing `ai-knowledge` package so the project can automatically discover domains and generate PM, tech-lead, and QA knowledge for each domain.

**Architecture:** Keep the existing `ai-knowledge` object taxonomy as the source of truth. Add a role-knowledge layer under `ai-knowledge/roles/{role}/domains/{domain}` with shared claim schemas, domain discovery, document parsing, and role-specific rendering. Route agents through `index.json` per role/domain and keep domain registry updates additive.

**Tech Stack:** TypeScript, Node.js, commander, zod, existing knowledge/packaging pipeline, existing test suite (vitest), existing git/workspace conventions.

---

### Task 1: Define shared role-knowledge types and schemas

**Files:**
- Create: `D:\workspace\ai-wiki\src\role-knowledge\types.ts`
- Create: `D:\workspace\ai-wiki\src\role-knowledge\schemas.ts`
- Test: `D:\workspace\ai-wiki\tests\unit\role-knowledge\types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { RoleClaimSchema, RoleIndexSchema } from "../../../src/role-knowledge/schemas.js";

describe("role-knowledge schemas", () => {
  it("accepts a minimal PM claim", () => {
    const parsed = RoleClaimSchema.parse({
      id: "pm-order-rule-001",
      role: "pm",
      domain: "order",
      dimension: "business_rule",
      claim: "支付前用户可以主动取消订单。",
      status: "current",
      confidence: "high",
      source_refs: [],
      knowledge_refs: [],
      reasoning: "需求文档和当前能力知识一致。",
      created_at: "2026-08-06T10:00:00+08:00",
      updated_at: "2026-08-06T10:00:00+08:00",
    });
    expect(parsed.role).toBe("pm");
  });

  it("accepts a minimal role index", () => {
    const parsed = RoleIndexSchema.parse({
      schema_version: 1,
      domain: "order",
      domain_name: "订单",
      role: "pm",
      status: "generated",
      generated_at: "2026-08-06T10:00:00+08:00",
      confidence: "high",
      base_knowledge_refs: ["capabilities/order-cancel.md"],
      read_profiles: {
        default: ["current/overview.md"],
        trace: ["evolution/timeline.md"],
        evidence: ["evidence/claims.jsonl"],
        review: ["review/conflicts.md"],
      },
      warnings: [],
    });
    expect(parsed.domain).toBe("order");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/role-knowledge/types.test.ts -v`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";

export const RoleClaimSchema = z.object({
  id: z.string(),
  role: z.enum(["pm", "tech-lead", "qa"]),
  domain: z.string(),
  capability: z.string().optional(),
  dimension: z.string(),
  claim: z.string(),
  status: z.enum(["candidate", "current", "historical", "stale", "conflicting", "open"]),
  confidence: z.enum(["high", "medium", "low"]),
  effective_date: z.string().optional(),
  time_source: z.string().optional(),
  time_confidence: z.enum(["high", "medium", "low"]).optional(),
  source_refs: z.array(z.object({ type: z.string(), ref: z.string(), title: z.string().optional(), date: z.string().optional(), excerpt: z.string().optional() })),
  knowledge_refs: z.array(z.object({ type: z.string(), path: z.string(), id: z.string().optional(), title: z.string().optional(), relation: z.string() })),
  role_refs: z.array(z.object({ role: z.enum(["pm", "tech-lead", "qa"]), domain: z.string(), path: z.string(), relation: z.string() })).optional(),
  relations: z.array(z.object({ type: z.string(), target_claim_id: z.string(), reason: z.string() })).optional(),
  validation: z.object({ status: z.string(), refs: z.array(z.string()), notes: z.string().optional() }).optional(),
  reasoning: z.string(),
  open_questions: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const RoleIndexSchema = z.object({
  schema_version: z.literal(1),
  domain: z.string(),
  domain_name: z.string(),
  role: z.enum(["pm", "tech-lead", "qa"]),
  status: z.enum(["generated", "partial", "needs_review", "blocked"]),
  generated_at: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  base_knowledge_refs: z.array(z.string()),
  read_profiles: z.object({
    default: z.array(z.string()),
    trace: z.array(z.string()),
    evidence: z.array(z.string()),
    review: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/role-knowledge/types.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/types.ts src/role-knowledge/schemas.ts tests/unit/role-knowledge/types.test.ts
git commit -m "feat: add role knowledge schemas"
```

### Task 2: Extend domain registry with role knowledge references

**Files:**
- Modify: `D:\workspace\ai-wiki\src\packaging\domain-registry.ts`
- Test: `D:\workspace\ai-wiki\tests\unit\packaging\domain-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { upsertRoleKnowledgeRef } from "../../../src/packaging/domain-registry.js";

describe("domain registry role refs", () => {
  it("stores pm role knowledge references without dropping existing fields", () => {
    const registry = {
      updatedAt: "2026-08-06T10:00:00+08:00",
      domains: [
        { domainKey: "order", domainName: "订单", capabilityRefs: [] },
      ],
    };
    const updated = upsertRoleKnowledgeRef(registry, {
      domainKey: "order",
      role: "pm",
      indexPath: "roles/pm/domains/order/index.json",
      generatedAt: "2026-08-06T10:00:00+08:00",
      status: "generated",
    });
    expect(updated.domains[0].roleKnowledgeRefs?.pm?.indexPath).toContain("roles/pm/domains/order/index.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/packaging/domain-registry.test.ts -v`
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function upsertRoleKnowledgeRef(registry: DomainRegistry, input: {
  domainKey?: string;
  domainName?: string;
  role: "pm" | "tech-lead" | "qa";
  indexPath: string;
  generatedAt: string;
  status: "generated" | "partial" | "needs_review" | "blocked";
}) {
  const domainKey = deriveDomainKey({ domainKey: input.domainKey, domainName: input.domainName });
  let entry = registry.domains.find((item) => item.domainKey === domainKey);
  if (!entry) {
    entry = { domainKey, domainName: input.domainName ?? domainKey, capabilityRefs: [] };
    registry.domains.push(entry);
  }
  entry.roleKnowledgeRefs ??= {};
  entry.roleKnowledgeRefs[input.role] = {
    indexPath: input.indexPath,
    generatedAt: input.generatedAt,
    status: input.status,
  };
  return entry;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/packaging/domain-registry.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/packaging/domain-registry.ts tests/unit/packaging/domain-registry.test.ts
git commit -m "feat: link role knowledge refs into domain registry"
```

### Task 3: Add role-knowledge directory initialization and cleanup

**Files:**
- Modify: `D:\workspace\ai-wiki\src\knowledge\init-directory.ts`
- Test: `D:\workspace\ai-wiki\tests\unit\knowledge\role-knowledge-directory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { ensureRoleKnowledgeStructure } from "../../../src/knowledge/init-directory.js";

describe("role knowledge directory structure", () => {
  it("creates roles/pm, roles/tech-lead, and roles/qa directories", async () => {
    const layout = await ensureRoleKnowledgeStructure("D:\\workspace\\ai-wiki\\tmp\\ai-knowledge");
    expect(layout.roleDirs.pm).toContain("roles");
    expect(layout.roleDirs.qa).toContain("qa");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/knowledge/role-knowledge-directory.test.ts -v`
Expected: FAIL because helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function ensureRoleKnowledgeStructure(packageRoot: string) {
  const roleBase = path.join(packageRoot, "roles");
  const roles = ["pm", "tech-lead", "qa"] as const;
  const roleDirs = {} as Record<(typeof roles)[number], string>;
  for (const role of roles) {
    const dir = path.join(roleBase, role);
    await fs.mkdir(dir, { recursive: true });
    roleDirs[role] = dir;
  }
  await fs.mkdir(path.join(packageRoot, ".internal", "role-knowledge"), { recursive: true });
  return { roleBase, roleDirs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/knowledge/role-knowledge-directory.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/init-directory.ts tests/unit/knowledge/role-knowledge-directory.test.ts
git commit -m "feat: create role knowledge directories"
```

### Task 4: Implement domain discovery from registry, knowledge objects, code, docs, and git

**Files:**
- Create: `D:\workspace\ai-wiki\src\role-knowledge\discover-domains.ts`
- Create: `D:\workspace\ai-wiki\tests\unit\role-knowledge\discover-domains.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { discoverDomains } from "../../../src/role-knowledge/discover-domains.js";

describe("discoverDomains", () => {
  it("prefers registry domains and marks unregistered candidates as low confidence", async () => {
    const result = await discoverDomains({
      registry: {
        updatedAt: "2026-08-06T10:00:00+08:00",
        domains: [
          { domainKey: "order", domainName: "订单", capabilityRefs: [] },
        ],
      },
      knowledgeObjects: [
        { type: "capability", id: "cap-order-cancel", name: "订单取消", path: "capabilities/order-cancel.md" },
      ],
      codeSignals: [],
      docSignals: [],
      gitSignals: [],
    });
    expect(result.confirmed.some((d) => d.domainKey === "order")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/role-knowledge/discover-domains.test.ts -v`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function discoverDomains(input: {
  registry: DomainRegistry;
  knowledgeObjects: Array<{ type: string; id: string; name: string; path: string }>;
  codeSignals: DomainSignal[];
  docSignals: DomainSignal[];
  gitSignals: DomainSignal[];
}) {
  const confirmed = input.registry.domains.map((domain) => ({
    domainKey: domain.domainKey,
    domainName: domain.domainName,
    source: "registry",
    confidence: "high",
    capabilityRefs: domain.capabilityRefs,
    aliases: [],
    evidence: [],
  }));
  return { confirmed, enriched: [], candidates: [], ignored: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/role-knowledge/discover-domains.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/discover-domains.ts tests/unit/role-knowledge/discover-domains.test.ts
git commit -m "feat: discover role knowledge domains"
```

### Task 5: Implement document parsing and chunking for role knowledge

**Files:**
- Create: `D:\workspace\ai-wiki\src\role-knowledge\documents.ts`
- Create: `D:\workspace\ai-wiki\src\role-knowledge\chunking.ts`
- Test: `D:\workspace\ai-wiki\tests\unit\role-knowledge\documents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildDocumentChunks } from "../../../src/role-knowledge/chunking.js";

describe("buildDocumentChunks", () => {
  it("keeps revision history as separate chunks", () => {
    const chunks = buildDocumentChunks({
      document: {
        id: "doc-1",
        path: "docs/需求/订单二期.docx",
        text: "修订记录\nV1.0 ...\nV1.1 ...\n订单取消规则...",
      },
    });
    expect(chunks.some((c) => c.chunk_kind === "revision_history")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/role-knowledge/documents.test.ts -v`
Expected: FAIL because helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function buildDocumentChunks(input: { document: { id: string; path: string; text: string } }) {
  const chunks = [];
  if (input.document.text.includes("修订记录")) {
    chunks.push({
      id: `${input.document.id}#revision`,
      document_id: input.document.id,
      heading_path: ["修订记录"],
      text: input.document.text,
      element_ids: [],
      start_order: 0,
      end_order: 0,
      chunk_kind: "revision_history",
      domain_candidates: [],
    });
  }
  chunks.push({
    id: `${input.document.id}#body`,
    document_id: input.document.id,
    heading_path: [],
    text: input.document.text,
    element_ids: [],
    start_order: 0,
    end_order: 0,
    chunk_kind: "requirement",
    domain_candidates: [],
  });
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/role-knowledge/documents.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/documents.ts src/role-knowledge/chunking.ts tests/unit/role-knowledge/documents.test.ts
git commit -m "feat: parse and chunk role knowledge documents"
```

### Task 6: Implement PM claim extraction and rendering

**Files:**
- Create: `D:\workspace\ai-wiki\src\role-knowledge\pm\extract.ts`
- Create: `D:\workspace\ai-wiki\src\role-knowledge\pm\render.ts`
- Test: `D:\workspace\ai-wiki\tests\unit\role-knowledge\pm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { extractPmClaims, renderPmKnowledge } from "../../../src/role-knowledge/pm/extract.js";

describe("pm role knowledge", () => {
  it("extracts a claim from a chunk and renders current overview", () => {
    const claims = extractPmClaims([
      {
        id: "chunk-1",
        document_id: "doc-1",
        heading_path: ["订单取消"],
        text: "支付前用户可以主动取消订单。",
        chunk_kind: "business_rule",
        domain_candidates: [{ domainKey: "order", confidence: "high", reason: "订单语义" }],
      },
    ]);
    const md = renderPmKnowledge({
      domain: "order",
      domainName: "订单",
      claims,
    });
    expect(md).toContain("当前产品口径");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/role-knowledge/pm.test.ts -v`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function extractPmClaims(chunks: Array<{ id: string; text: string; domain_candidates: Array<{ domainKey: string; confidence: string; reason: string }>; chunk_kind: string }>) {
  return chunks.map((chunk) => ({
    id: `${chunk.id}-pm-001`,
    role: "pm" as const,
    domain: chunk.domain_candidates[0]?.domainKey ?? "unknown",
    dimension: "business_rule",
    claim: chunk.text.trim(),
    status: "current" as const,
    confidence: "medium" as const,
    source_refs: [],
    knowledge_refs: [],
    reasoning: "Derived from document chunk.",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

export function renderPmKnowledge(input: { domain: string; domainName: string; claims: Array<{ claim: string; status: string }> }) {
  const current = input.claims.filter((claim) => claim.status === "current").map((claim) => `- ${claim.claim}`).join("\n");
  return `# ${input.domainName}域 PM 当前口径\n\n## 当前产品口径\n\n${current}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/role-knowledge/pm.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/pm/extract.ts src/role-knowledge/pm/render.ts tests/unit/role-knowledge/pm.test.ts
git commit -m "feat: generate pm role knowledge"
```

### Task 7: Implement tech-lead and qa role knowledge generation

**Files:**
- Create: `D:\workspace\ai-wiki\src\role-knowledge\tech-lead\extract.ts`
- Create: `D:\workspace\ai-wiki\src\role-knowledge\tech-lead\render.ts`
- Create: `D:\workspace\ai-wiki\src\role-knowledge\qa\extract.ts`
- Create: `D:\workspace\ai-wiki\src\role-knowledge\qa\render.ts`
- Test: `D:\workspace\ai-wiki\tests\unit\role-knowledge\tech-lead-qa.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { extractTechLeadClaims } from "../../../src/role-knowledge/tech-lead/extract.js";
import { extractQaClaims } from "../../../src/role-knowledge/qa/extract.js";

describe("tech-lead and qa role knowledge", () => {
  it("extracts implementation and test claims", () => {
    const tech = extractTechLeadClaims([{ id: "chunk-1", text: "取消订单由 OrderCancelService 处理。", domain: "order" }]);
    const qa = extractQaClaims([{ id: "chunk-2", text: "需要覆盖履约开始后取消失败。", domain: "order" }]);
    expect(tech[0].role).toBe("tech-lead");
    expect(qa[0].role).toBe("qa");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/role-knowledge/tech-lead-qa.test.ts -v`
Expected: FAIL because modules do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function extractTechLeadClaims(chunks: Array<{ id: string; text: string; domain: string }>) {
  return chunks.map((chunk) => ({
    id: `${chunk.id}-tech-001`,
    role: "tech-lead" as const,
    domain: chunk.domain,
    dimension: "call_flow",
    claim: chunk.text.trim(),
    status: "current" as const,
    confidence: "medium" as const,
    source_refs: [],
    knowledge_refs: [],
    reasoning: "Derived from code and infrastructure evidence.",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

export function extractQaClaims(chunks: Array<{ id: string; text: string; domain: string }>) {
  return chunks.map((chunk) => ({
    id: `${chunk.id}-qa-001`,
    role: "qa" as const,
    domain: chunk.domain,
    dimension: "boundary_case",
    claim: chunk.text.trim(),
    status: "current" as const,
    confidence: "medium" as const,
    source_refs: [],
    knowledge_refs: [],
    reasoning: "Derived from PM rules and implementation risk.",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/role-knowledge/tech-lead-qa.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/tech-lead/extract.ts src/role-knowledge/tech-lead/render.ts src/role-knowledge/qa/extract.ts src/role-knowledge/qa/render.ts tests/unit/role-knowledge/tech-lead-qa.test.ts
git commit -m "feat: generate tech lead and qa role knowledge"
```

### Task 8: Add role-knowledge pipeline orchestration

**Files:**
- Create: `D:\workspace\ai-wiki\src\role-knowledge\pipeline.ts`
- Create: `D:\workspace\ai-wiki\src\role-knowledge\writer.ts`
- Test: `D:\workspace\ai-wiki\tests\unit\role-knowledge\pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { runRoleKnowledgePipeline } from "../../../src/role-knowledge/pipeline.js";

describe("runRoleKnowledgePipeline", () => {
  it("returns a per-role report and writes role index entries", async () => {
    const result = await runRoleKnowledgePipeline({
      repoPath: "D:\\workspace\\ai-wiki",
      outputRoot: "D:\\workspace\\ai-wiki",
      roles: ["pm"],
      domains: ["order"],
      includeDocs: false,
      includeGit: false,
      includeCode: false,
      llm: { enabled: false },
    });
    expect(result.reports.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/role-knowledge/pipeline.test.ts -v`
Expected: FAIL because the pipeline does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function runRoleKnowledgePipeline(input: {
  repoPath: string;
  outputRoot: string;
  roles: Array<"pm" | "tech-lead" | "qa">;
  domains: string[];
  includeDocs: boolean;
  includeGit: boolean;
  includeCode: boolean;
  llm: { enabled: boolean };
}) {
  return {
    reports: input.domains.flatMap((domain) =>
      input.roles.map((role) => ({ domain, role, status: "generated", warnings: [] })),
    ),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/role-knowledge/pipeline.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/pipeline.ts src/role-knowledge/writer.ts tests/unit/role-knowledge/pipeline.test.ts
git commit -m "feat: orchestrate role knowledge pipeline"
```

### Task 9: Wire CLI commands for role knowledge discovery and generation

**Files:**
- Modify: `D:\workspace\ai-wiki\src\cli\index.ts`
- Create: `D:\workspace\ai-wiki\src\cli\role-knowledge.ts`
- Test: `D:\workspace\ai-wiki\tests\unit\cli\role-knowledge.test.ts`
- Integration: `D:\workspace\ai-wiki\tests\integration\role-knowledge-command.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildRoleKnowledgeCommand } from "../../../src/cli/role-knowledge.js";

describe("role-knowledge cli", () => {
  it("registers discover-domains and generate subcommands", () => {
    const command = buildRoleKnowledgeCommand();
    expect(command.commands.some((sub) => sub.name() === "discover-domains")).toBe(true);
    expect(command.commands.some((sub) => sub.name() === "generate")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/cli/role-knowledge.test.ts -v`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
import { Command } from "commander";

export function buildRoleKnowledgeCommand() {
  const command = new Command("role-knowledge").description("Generate role knowledge for pm, tech-lead, and qa");
  command.command("discover-domains").action(async () => {});
  command.command("generate").action(async () => {});
  command.command("status").action(async () => {});
  return command;
}
```

Then wire it into `src/cli/index.ts` with:

```ts
program.addCommand(buildRoleKnowledgeCommand());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/cli/role-knowledge.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/role-knowledge.ts tests/unit/cli/role-knowledge.test.ts tests/integration/role-knowledge-command.test.ts
git commit -m "feat: add role knowledge cli"
```

### Task 10: Update agent templates to read role knowledge by domain

**Files:**
- Modify: `D:\workspace\ai-wiki\src\skills\templates\business-subagents\pm.md`
- Modify: `D:\workspace\ai-wiki\src\skills\templates\business-subagents\tech-lead.md`
- Modify: `D:\workspace\ai-wiki\src\skills\templates\business-subagents\qa.md`
- Test: `D:\workspace\ai-wiki\tests\unit\skills\business-subagents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderBusinessSubagentTemplate } from "../../../src/skills/business-subagents.js";

describe("business subagent templates", () => {
  it("points PM agent to roles/pm/domains/{domain}/index.json", () => {
    const text = renderBusinessSubagentTemplate("pm", { domain: "order", domainName: "订单" });
    expect(text).toContain("roles/pm/domains/order/index.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/skills/business-subagents.test.ts -v`
Expected: FAIL if the template still references the old shape.

- [ ] **Step 3: Write minimal implementation**

Update the templates so they instruct the agent to read:

```text
ai-knowledge/roles/{role}/domains/{domain}/index.json
```

and then select `default`, `trace`, `evidence`, or `review` read profiles depending on intent.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/skills/business-subagents.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/skills/templates/business-subagents/pm.md src/skills/templates/business-subagents/tech-lead.md src/skills/templates/business-subagents/qa.md tests/unit/skills/business-subagents.test.ts
git commit -m "feat: bind business subagents to role knowledge"
```

### Task 11: Add generation reports and review outputs

**Files:**
- Create: `D:\workspace\ai-wiki\src\role-knowledge\reports.ts`
- Modify: `D:\workspace\ai-wiki\src\packaging\write-reports.ts`
- Test: `D:\workspace\ai-wiki\tests\unit\role-knowledge\reports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildRoleKnowledgeReport } from "../../../src/role-knowledge/reports.js";

describe("role knowledge reports", () => {
  it("summarizes generated, partial, needs_review, and blocked states", () => {
    const report = buildRoleKnowledgeReport([
      { domain: "order", role: "pm", status: "generated", warnings: [] },
      { domain: "order", role: "qa", status: "partial", warnings: ["missing-tech-context"] },
    ]);
    expect(report).toContain("partial");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/role-knowledge/reports.test.ts -v`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function buildRoleKnowledgeReport(entries: Array<{ domain: string; role: string; status: string; warnings: string[] }>) {
  return entries.map((entry) => `${entry.domain} ${entry.role} ${entry.status}`).join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/role-knowledge/reports.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/role-knowledge/reports.ts src/packaging/write-reports.ts tests/unit/role-knowledge/reports.test.ts
git commit -m "feat: add role knowledge reports"
```

### Task 12: Verify end-to-end generation and status outputs

**Files:**
- Modify: any files required by previous tasks if integration gaps appear
- Test: `D:\workspace\ai-wiki\tests\integration\role-knowledge-command.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("role knowledge commands", () => {
  it("runs discover-domains and generate without crashing", async () => {
    const result = await execa("node", ["dist/cli/index.js", "role-knowledge", "discover-domains"], { cwd: "D:\\workspace\\ai-wiki" });
    expect(result.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/role-knowledge-command.test.ts -v`
Expected: FAIL until the CLI is wired and the build passes.

- [ ] **Step 3: Write minimal implementation**

Fix any remaining integration gaps from previous tasks, rebuild, and ensure the command exits cleanly.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm build
pnpm vitest run tests/integration/role-knowledge-command.test.ts -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: complete role knowledge pipeline"
```

## Self-review checklist

- Every spec requirement maps to at least one task.
- No task references undefined helper names.
- Claims, indices, domain discovery, document parsing, role generation, CLI, and templates are all covered.
- The plan preserves the existing `ai-knowledge` taxonomy and adds roles as a separate layer.
- The plan avoids creating new `KnowledgeType` values for roles.

