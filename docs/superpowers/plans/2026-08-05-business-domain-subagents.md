# Business Domain Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `ai-wiki` so `rkg init-skills` can generate Claude Code business-domain subagents for PM, technical lead, and QA roles.

**Architecture:** Reuse the existing `skills` initialization pipeline. Add a small business-subagent template renderer, pass business-domain options through `init-skills`, and extend the Claude Code adapter to write `.claude/agents/*.md` plus append orchestration rules to the target repository `CLAUDE.md`.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Commander, Vitest, existing `src/skills/*` initialization modules.

---

## Scope

Implement the subagent generation feature inside `D:\workspace\ai-wiki`.

Do not modify the untracked `.agents/` directory currently present in `D:\workspace\ai-wiki`.

Do not implement the business knowledge MCP server in this plan. Generated subagents only reference these tool names:

- `mcp__business_knowledge__search`
- `mcp__business_knowledge__get`

## File Structure

- Modify `src/skills/agents/types.ts`: add business-subagent initialization types and allow `isInitialized` to inspect full config.
- Create `src/skills/business-subagents.ts`: validate domain input, render subagent files, and render the `CLAUDE.md` orchestration section.
- Create `src/skills/templates/business-subagents/pm.md`: PM subagent Markdown template.
- Create `src/skills/templates/business-subagents/tech-lead.md`: technical lead subagent Markdown template.
- Create `src/skills/templates/business-subagents/qa.md`: QA subagent Markdown template.
- Create `src/skills/templates/business-subagents/claude-section.md`: main-session orchestration section template.
- Modify `src/skills/agents/claude-code.ts`: write `.claude/agents/` files and append orchestration rules.
- Modify `src/skills/skill-init.ts`: pass config into `isInitialized` so existing skill initialization does not skip missing subagents.
- Modify `src/cli/init-skills.ts`: parse business-domain CLI options.
- Modify `src/cli/index.ts`: expose CLI flags.
- Create `tests/unit/skills/business-subagents.test.ts`: test validation and template rendering.
- Create `tests/unit/skills/claude-code-subagents.test.ts`: test target-repo file creation and idempotency.
- Modify `tests/integration/generate-command.test.ts`: assert CLI help includes the new options after build.

## Task 1: Extend Initialization Types

**Files:**
- Modify: `src/skills/agents/types.ts`

- [ ] **Step 1: Add a failing type-level usage test through a regular unit test**

Create `tests/unit/skills/business-subagents.test.ts` with this initial content:

```typescript
import { describe, expect, it } from "vitest";
import type { BusinessSubagentInitConfig } from "../../../src/skills/agents/types.js";

describe("business subagent config types", () => {
  it("allows one business domain config with optional aliases and paths", () => {
    const config: BusinessSubagentInitConfig = {
      domain: "order",
      domainName: "订单",
      aliases: ["checkout", "refund"],
      paths: ["src/order/**", "src/checkout/**"],
    };

    expect(config.domain).toBe("order");
    expect(config.domainName).toBe("订单");
    expect(config.aliases).toEqual(["checkout", "refund"]);
    expect(config.paths).toEqual(["src/order/**", "src/checkout/**"]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- tests/unit/skills/business-subagents.test.ts
```

Expected: FAIL because `BusinessSubagentInitConfig` is not exported from `src/skills/agents/types.ts`.

- [ ] **Step 3: Implement the type changes**

Update `src/skills/agents/types.ts`:

```typescript
/**
 * 业务域 subagent 初始化配置
 */
export interface BusinessSubagentInitConfig {
  /** 业务域英文短名，例如 order */
  domain: string;

  /** 业务域中文名，例如 订单 */
  domainName: string;

  /** 业务域别名或触发关键词 */
  aliases?: string[];

  /** 业务域相关路径 glob，用于写入编排规则 */
  paths?: string[];
}

export interface Agent {
  name: string;
  id: string;
  getSkillDir(repoPath: string): string;
  isInitialized(
    repoPath: string,
    config?: SkillInitConfig,
  ): Promise<boolean>;
  initialize(config: SkillInitConfig): Promise<SkillInitResult>;
  generateAgentsMd?(repoPath: string): Promise<string | null>;
}

export interface SkillInitConfig {
  repoPath: string;
  force?: boolean;
  updateAgentsMd?: boolean;
  verbose?: boolean;
  businessSubagents?: BusinessSubagentInitConfig[];
}
```

Keep the existing comments for unchanged fields if they are already more detailed than this snippet.

- [ ] **Step 4: Pass config into initialization checks**

Update `src/skills/skill-init.ts`:

```typescript
const isInitialized = await agent.isInitialized(config.repoPath, config);
```

Update `needsSkillInitialization` in the same file:

```typescript
export async function needsSkillInitialization(
  repoPath: string,
  agentIds?: string[],
  config?: Omit<SkillInitConfig, "repoPath">,
): Promise<boolean> {
  const agents = agentIds ? getAgentsByIds(agentIds) : DEFAULT_AGENTS;
  const fullConfig: SkillInitConfig = { repoPath, ...config };

  for (const agent of agents) {
    const isInitialized = await agent.isInitialized(repoPath, fullConfig);
    if (!isInitialized) {
      return true;
    }
  }

  return false;
}
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npm test -- tests/unit/skills/business-subagents.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/skills/agents/types.ts src/skills/skill-init.ts tests/unit/skills/business-subagents.test.ts
git commit -m "feat: add business subagent init config"
```

## Task 2: Add Business Subagent Templates and Renderer

**Files:**
- Create: `src/skills/business-subagents.ts`
- Create: `src/skills/templates/business-subagents/pm.md`
- Create: `src/skills/templates/business-subagents/tech-lead.md`
- Create: `src/skills/templates/business-subagents/qa.md`
- Create: `src/skills/templates/business-subagents/claude-section.md`
- Modify: `tests/unit/skills/business-subagents.test.ts`

- [ ] **Step 1: Extend the failing renderer tests**

Replace `tests/unit/skills/business-subagents.test.ts` with:

```typescript
import { describe, expect, it } from "vitest";
import {
  normalizeBusinessSubagentConfig,
  renderBusinessSubagentFiles,
  renderClaudeBusinessAgentSection,
} from "../../../src/skills/business-subagents.js";
import type { BusinessSubagentInitConfig } from "../../../src/skills/agents/types.js";

describe("business subagent config types", () => {
  it("allows one business domain config with optional aliases and paths", () => {
    const config: BusinessSubagentInitConfig = {
      domain: "order",
      domainName: "订单",
      aliases: ["checkout", "refund"],
      paths: ["src/order/**", "src/checkout/**"],
    };

    expect(config.domain).toBe("order");
    expect(config.domainName).toBe("订单");
  });
});

describe("business subagent rendering", () => {
  it("normalizes domain id, aliases, and paths", () => {
    const config = normalizeBusinessSubagentConfig({
      domain: "Order_Service",
      domainName: "订单",
      aliases: [" checkout ", "", "refund"],
      paths: [" src/order/** ", ""],
    });

    expect(config.domain).toBe("order-service");
    expect(config.domainName).toBe("订单");
    expect(config.aliases).toEqual(["checkout", "refund"]);
    expect(config.paths).toEqual(["src/order/**"]);
  });

  it("renders three Claude Code subagent files", async () => {
    const files = await renderBusinessSubagentFiles({
      domain: "order",
      domainName: "订单",
      aliases: ["checkout", "refund"],
      paths: ["src/order/**"],
    });

    expect(files).toHaveLength(3);
    expect(files.map((file) => file.filename)).toEqual([
      ".claude/agents/order-pm.md",
      ".claude/agents/order-tech-lead.md",
      ".claude/agents/order-qa.md",
    ]);
    expect(files[0]?.content).toContain("name: order-pm");
    expect(files[0]?.content).toContain("你是 订单 的 PM agent。");
    expect(files[1]?.content).toContain("role: tech");
    expect(files[2]?.content).toContain("role: qa");
  });

  it("renders CLAUDE.md orchestration rules for a domain", async () => {
    const section = await renderClaudeBusinessAgentSection({
      domain: "order",
      domainName: "订单",
      aliases: ["checkout", "refund"],
      paths: ["src/order/**"],
    });

    expect(section).toContain("## 业务域 Agent 协作规则");
    expect(section).toContain("order-pm");
    expect(section).toContain("order-tech-lead");
    expect(section).toContain("order-qa");
    expect(section).toContain("checkout");
    expect(section).toContain("src/order/**");
  });

  it("rejects an empty domain", () => {
    expect(() =>
      normalizeBusinessSubagentConfig({
        domain: "",
        domainName: "订单",
      }),
    ).toThrow("business domain is required");
  });

  it("rejects an empty domain name", () => {
    expect(() =>
      normalizeBusinessSubagentConfig({
        domain: "order",
        domainName: "",
      }),
    ).toThrow("business domain name is required");
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- tests/unit/skills/business-subagents.test.ts
```

Expected: FAIL because `src/skills/business-subagents.ts` does not exist.

- [ ] **Step 3: Create PM template**

Create `src/skills/templates/business-subagents/pm.md`:

```markdown
---
name: {{domain}}-pm
description: {{domainName}} PM agent。用于讨论 {{domain}} domain 的产品意图、需求演进、用户场景、业务规则、验收标准、product requirements、business rules、acceptance criteria。关键词：{{keywords}}
tools: mcp__business_knowledge__search,mcp__business_knowledge__get
---

你是 {{domainName}} 的 PM agent。

## 角色定位

你负责从产品和业务视角回答问题，重点关注：
- 产品目标
- 用户场景
- 需求演进
- 业务规则
- 业务边界
- 验收标准
- 历史取舍

## 知识读取

回答前必须通过业务知识工具查询：
- domain: {{domain}}
- role: pm

如果知识工具没有返回足够证据，必须明确说明“不确定”或“缺少来源”，不得编造业务规则。

## 应该参与的场景

当任务涉及以下内容时，你应该参与：
- 需求澄清
- 业务规则解释
- 用户场景分析
- 验收标准定义
- 需求变更影响
- 产品取舍判断

## 不负责的内容

你不负责最终技术架构、代码实现细节、测试方案定稿。

如果问题涉及实现方案、接口、数据模型、迁移、性能或技术风险，应建议协同 `{{domain}}-tech-lead`。

如果问题涉及测试范围、回归风险或验收用例，应建议协同 `{{domain}}-qa`。

## 输出格式

按以下结构回答：

1. 产品背景
2. 业务规则
3. 边界场景
4. 验收标准
5. 待确认问题
```

- [ ] **Step 4: Create technical lead template**

Create `src/skills/templates/business-subagents/tech-lead.md`:

```markdown
---
name: {{domain}}-tech-lead
description: {{domainName}} technical lead agent。用于讨论 {{domain}} domain 的架构、模块边界、代码实现、接口、数据模型、迁移、性能、technical design、architecture、implementation risk。关键词：{{keywords}}
tools: mcp__business_knowledge__search,mcp__business_knowledge__get
---

你是 {{domainName}} 的技术经理 agent。

## 角色定位

你负责从技术视角回答问题，重点关注：
- 架构演进
- 模块边界
- 代码影响范围
- 数据模型
- 接口依赖
- 技术债
- 性能与稳定性
- 迁移方案
- 实施风险

## 知识读取

回答前必须通过业务知识工具查询：
- domain: {{domain}}
- role: tech

如果问题涉及业务规则，也应查询：
- domain: {{domain}}
- role: pm

如果知识工具没有返回足够证据，必须明确说明“不确定”或“缺少来源”，不得编造技术背景或历史决策。

## 应该参与的场景

当任务涉及以下内容时，你应该参与：
- 技术方案设计
- 代码修改影响分析
- 架构调整
- 接口变更
- 数据模型变更
- 性能或稳定性问题
- 技术债治理
- 迁移和兼容性判断

## 不负责的内容

你不负责最终产品取舍和测试结论。

如果问题涉及产品目标、业务规则或验收口径，应建议协同 `{{domain}}-pm`。

如果问题涉及测试策略、回归范围或发布风险，应建议协同 `{{domain}}-qa`。

## 输出格式

按以下结构回答：

1. 技术背景
2. 当前实现理解
3. 影响范围
4. 方案建议
5. 风险与约束
6. 需要验证的内容
```

- [ ] **Step 5: Create QA template**

Create `src/skills/templates/business-subagents/qa.md`:

```markdown
---
name: {{domain}}-qa
description: {{domainName}} QA/test agent。用于讨论 {{domain}} domain 的测试策略、验收用例、回归范围、缺陷风险、release risk、test plan、regression testing、acceptance test。关键词：{{keywords}}
tools: mcp__business_knowledge__search,mcp__business_knowledge__get
---

你是 {{domainName}} 的 QA agent。

## 角色定位

你负责从测试和质量视角回答问题，重点关注：
- 测试策略
- 验收用例
- 回归范围
- 边界场景
- 缺陷风险
- 发布风险
- 自动化测试入口
- 验证命令

## 知识读取

回答前必须通过业务知识工具查询：
- domain: {{domain}}
- role: qa

如果问题涉及业务规则，也应查询：
- domain: {{domain}}
- role: pm

如果问题涉及实现影响，也应查询：
- domain: {{domain}}
- role: tech

如果知识工具没有返回足够证据，必须明确说明“不确定”或“缺少来源”，不得编造测试结论。

## 应该参与的场景

当任务涉及以下内容时，你应该参与：
- 测试方案
- 验收标准细化
- 回归范围判断
- 缺陷复现
- 发布前风险评估
- 自动化测试建议
- 边界条件补充

## 不负责的内容

你不负责最终产品取舍和技术架构决策。

如果问题涉及产品目标或业务规则，应建议协同 `{{domain}}-pm`。

如果问题涉及代码实现或技术方案，应建议协同 `{{domain}}-tech-lead`。

## 输出格式

按以下结构回答：

1. 测试目标
2. 核心用例
3. 边界场景
4. 回归范围
5. 风险等级
6. 建议验证方式
```

- [ ] **Step 6: Create CLAUDE.md section template**

Create `src/skills/templates/business-subagents/claude-section.md`:

```markdown
## 业务域 Agent 协作规则：{{domainName}}（{{domain}}）

本项目已配置 {{domainName}} 业务域 Claude Code subagents：

- `{{domain}}-pm`：负责产品意图、需求演进、用户场景、业务规则和验收口径。
- `{{domain}}-tech-lead`：负责技术架构、模块边界、实现方案、接口依赖、数据模型和技术风险。
- `{{domain}}-qa`：负责测试策略、核心用例、回归范围、边界场景、缺陷风险和发布风险。

命中条件：

- 用户显式 `@{{domain}}-pm`、`@{{domain}}-tech-lead` 或 `@{{domain}}-qa`。
- 用户提到以下关键词：{{keywords}}
- 用户修改或询问以下路径：{{paths}}
- 用户询问 {{domainName}} 的需求、规则、实现、测试或上线风险。

角色选择规则：

- 需求、业务规则、验收口径：调用 `{{domain}}-pm`。
- 架构、实现、接口、数据模型、迁移、性能、技术风险：调用 `{{domain}}-tech-lead`。
- 测试策略、回归范围、缺陷复现、发布风险：调用 `{{domain}}-qa`。

多角色协作规则：

- 需求澄清：先 PM，再 QA，必要时 Tech Lead。
- 技术设计或代码修改：先 PM，再 Tech Lead，再 QA。
- 缺陷分析：先 QA，再 Tech Lead，再 PM。
- 上线评审：PM、Tech Lead、QA 必须全部参与。

主会话负责整合 agent 输出：

- 合并一致结论。
- 标出冲突意见。
- 标出缺失信息。
- 给出下一步行动。
- 不得把缺少来源的 agent 判断当作事实。
```

- [ ] **Step 7: Implement the renderer**

Create `src/skills/business-subagents.ts`:

```typescript
import path from "node:path";
import type {
  BusinessSubagentInitConfig,
  SkillFile,
} from "./agents/types.js";
import { loadSkillTemplate } from "./skill-templates.js";

export interface NormalizedBusinessSubagentConfig
  extends Required<BusinessSubagentInitConfig> {}

const TEMPLATE_NAMES = {
  pm: "business-subagents/pm",
  techLead: "business-subagents/tech-lead",
  qa: "business-subagents/qa",
  claudeSection: "business-subagents/claude-section",
} as const;

export function normalizeBusinessSubagentConfig(
  input: BusinessSubagentInitConfig,
): NormalizedBusinessSubagentConfig {
  const domain = normalizeDomain(input.domain);
  const domainName = input.domainName.trim();

  if (!domain) {
    throw new Error("business domain is required");
  }
  if (!domainName) {
    throw new Error("business domain name is required");
  }

  return {
    domain,
    domainName,
    aliases: normalizeList(input.aliases),
    paths: normalizeList(input.paths),
  };
}

export async function renderBusinessSubagentFiles(
  input: BusinessSubagentInitConfig,
): Promise<SkillFile[]> {
  const config = normalizeBusinessSubagentConfig(input);
  const [pmTemplate, techLeadTemplate, qaTemplate] = await Promise.all([
    loadSkillTemplate(TEMPLATE_NAMES.pm),
    loadSkillTemplate(TEMPLATE_NAMES.techLead),
    loadSkillTemplate(TEMPLATE_NAMES.qa),
  ]);

  return [
    {
      name: `${config.domain}-pm`,
      filename: `.claude/agents/${config.domain}-pm.md`,
      content: renderTemplate(pmTemplate, config),
    },
    {
      name: `${config.domain}-tech-lead`,
      filename: `.claude/agents/${config.domain}-tech-lead.md`,
      content: renderTemplate(techLeadTemplate, config),
    },
    {
      name: `${config.domain}-qa`,
      filename: `.claude/agents/${config.domain}-qa.md`,
      content: renderTemplate(qaTemplate, config),
    },
  ];
}

export async function renderClaudeBusinessAgentSection(
  input: BusinessSubagentInitConfig,
): Promise<string> {
  const config = normalizeBusinessSubagentConfig(input);
  const template = await loadSkillTemplate(TEMPLATE_NAMES.claudeSection);
  return renderTemplate(template, config);
}

export function getBusinessSubagentDiskPath(
  repoPath: string,
  filename: string,
): string {
  const normalized = filename.replaceAll("/", path.sep);
  return path.join(repoPath, normalized);
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .replaceAll("_", "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function renderTemplate(
  template: string,
  config: NormalizedBusinessSubagentConfig,
): string {
  const keywords = [config.domainName, config.domain, ...config.aliases].join("、");
  const paths = config.paths.length > 0 ? config.paths.join("、") : "未配置固定路径";

  return template
    .replaceAll("{{domain}}", config.domain)
    .replaceAll("{{domainName}}", config.domainName)
    .replaceAll("{{keywords}}", keywords)
    .replaceAll("{{paths}}", paths);
}
```

- [ ] **Step 8: Run the focused test**

Run:

```bash
npm test -- tests/unit/skills/business-subagents.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/skills/business-subagents.ts src/skills/templates/business-subagents tests/unit/skills/business-subagents.test.ts
git commit -m "feat: render business domain subagents"
```

## Task 3: Extend Claude Code Adapter

**Files:**
- Modify: `src/skills/agents/claude-code.ts`
- Create: `tests/unit/skills/claude-code-subagents.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/unit/skills/claude-code-subagents.test.ts`:

```typescript
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_CODE_AGENT } from "../../../src/skills/agents/claude-code.js";

describe("Claude Code business subagent initialization", () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "rkg-subagents-"));
  });

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("writes PM, technical lead, and QA subagents", async () => {
    const result = await CLAUDE_CODE_AGENT.initialize({
      repoPath,
      businessSubagents: [
        {
          domain: "order",
          domainName: "订单",
          aliases: ["checkout", "refund"],
          paths: ["src/order/**"],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.files.map((file) => file.filename)).toContain(
      ".claude/agents/order-pm.md",
    );
    expect(result.files.map((file) => file.filename)).toContain(
      ".claude/agents/order-tech-lead.md",
    );
    expect(result.files.map((file) => file.filename)).toContain(
      ".claude/agents/order-qa.md",
    );

    const pm = await fs.readFile(
      path.join(repoPath, ".claude", "agents", "order-pm.md"),
      "utf-8",
    );
    expect(pm).toContain("name: order-pm");
    expect(pm).toContain("role: pm");
  });

  it("reports not initialized when requested business subagents are missing", async () => {
    await CLAUDE_CODE_AGENT.initialize({ repoPath });

    const initialized = await CLAUDE_CODE_AGENT.isInitialized(repoPath, {
      repoPath,
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });

    expect(initialized).toBe(false);
  });

  it("reports initialized when requested business subagents exist", async () => {
    await CLAUDE_CODE_AGENT.initialize({
      repoPath,
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });

    const initialized = await CLAUDE_CODE_AGENT.isInitialized(repoPath, {
      repoPath,
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });

    expect(initialized).toBe(true);
  });

  it("appends CLAUDE.md orchestration rules once", async () => {
    await fs.writeFile(path.join(repoPath, "CLAUDE.md"), "# Existing\n", "utf-8");

    const first = await CLAUDE_CODE_AGENT.generateAgentsMd(repoPath, {
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });
    const second = await CLAUDE_CODE_AGENT.generateAgentsMd(repoPath, {
      businessSubagents: [{ domain: "order", domainName: "订单" }],
    });

    expect(first).toContain("业务域 Agent 协作规则：订单（order）");
    expect(second).toBeNull();

    const content = await fs.readFile(path.join(repoPath, "CLAUDE.md"), "utf-8");
    expect(content.match(/业务域 Agent 协作规则：订单（order）/g)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- tests/unit/skills/claude-code-subagents.test.ts
```

Expected: FAIL because `generateAgentsMd` does not accept config and Claude Code adapter does not write `.claude/agents`.

- [ ] **Step 3: Update the Agent interface for `generateAgentsMd`**

Update `src/skills/agents/types.ts`:

```typescript
generateAgentsMd?(
  repoPath: string,
  config?: SkillInitConfig,
): Promise<string | null>;
```

- [ ] **Step 4: Pass config into `generateAgentsMd`**

Update `src/skills/skill-init.ts`:

```typescript
const agentsMdContent = await agent.generateAgentsMd(
  config.repoPath,
  config,
);
```

- [ ] **Step 5: Update Claude Code imports**

Update `src/skills/agents/claude-code.ts` imports:

```typescript
import {
  getBusinessSubagentDiskPath,
  normalizeBusinessSubagentConfig,
  renderBusinessSubagentFiles,
  renderClaudeBusinessAgentSection,
} from "../business-subagents.js";
```

- [ ] **Step 6: Update `isInitialized`**

Replace `isInitialized` in `src/skills/agents/claude-code.ts` with:

```typescript
async isInitialized(repoPath: string, config?: SkillInitConfig): Promise<boolean> {
  const skillDir = this.getSkillDir(repoPath);
  const useKnowledgePath = path.join(skillDir, "use-knowledge", "SKILL.md");

  try {
    await fs.access(useKnowledgePath);
  } catch {
    return false;
  }

  for (const domainConfig of config?.businessSubagents ?? []) {
    const normalized = normalizeBusinessSubagentConfig(domainConfig);
    const expectedFiles = [
      `.claude/agents/${normalized.domain}-pm.md`,
      `.claude/agents/${normalized.domain}-tech-lead.md`,
      `.claude/agents/${normalized.domain}-qa.md`,
    ];

    for (const filename of expectedFiles) {
      try {
        await fs.access(getBusinessSubagentDiskPath(repoPath, filename));
      } catch {
        return false;
      }
    }
  }

  return true;
}
```

- [ ] **Step 7: Update `initialize` to write subagents**

Inside `initialize`, after writing `use-knowledge`, add:

```typescript
for (const domainConfig of config.businessSubagents ?? []) {
  const subagentFiles = await renderBusinessSubagentFiles(domainConfig);

  for (const file of subagentFiles) {
    const filePath = getBusinessSubagentDiskPath(config.repoPath, file.filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, "utf-8");
    files.push(file);
  }
}
```

- [ ] **Step 8: Update `generateAgentsMd`**

Replace `generateAgentsMd` in `src/skills/agents/claude-code.ts` with:

```typescript
async generateAgentsMd(
  repoPath: string,
  config?: SkillInitConfig,
): Promise<string | null> {
  const claudeMdPath = path.join(repoPath, "CLAUDE.md");
  let existingContent = "";

  try {
    existingContent = await fs.readFile(claudeMdPath, "utf-8");
  } catch {
    // 文件不存在时创建新文件。
  }

  const sections: string[] = [];

  const skillSection = `
## 知识库技能

本项目已配置 \`use-knowledge\` 技能，帮助你在编码前读取项目知识。

### 使用方法

在开始编码任务前，调用技能：

\`\`\`
/use-knowledge
\`\`\`

该技能会：
1. 指导你读取 \`ai-knowledge/architecture.md\` 建立项目全局认知
2. 按需读取其他知识类型（capabilities、data-models 等）
3. 明确模块归属和包结构，避免代码放错位置

### 适用场景

- 新增业务功能时，先读取知识确定代码位置
- 修改现有代码时，先了解模块依赖关系
- 接手新项目时，快速建立全局认知
`;

  if (!existingContent.includes("use-knowledge")) {
    sections.push(skillSection);
  }

  for (const domainConfig of config?.businessSubagents ?? []) {
    const normalized = normalizeBusinessSubagentConfig(domainConfig);
    const marker = `业务域 Agent 协作规则：${normalized.domainName}（${normalized.domain}）`;
    if (!existingContent.includes(marker)) {
      sections.push(await renderClaudeBusinessAgentSection(normalized));
    }
  }

  if (sections.length === 0) {
    return null;
  }

  const newContent = existingContent
    ? `${existingContent.trimEnd()}\n\n${sections.join("\n\n")}\n`
    : `# 项目编码指南\n\n${sections.join("\n\n")}\n`;

  await fs.writeFile(claudeMdPath, newContent, "utf-8");
  return newContent;
}
```

- [ ] **Step 9: Run focused tests**

Run:

```bash
npm test -- tests/unit/skills/business-subagents.test.ts tests/unit/skills/claude-code-subagents.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/skills/agents/types.ts src/skills/skill-init.ts src/skills/agents/claude-code.ts tests/unit/skills/claude-code-subagents.test.ts
git commit -m "feat: initialize Claude Code business subagents"
```

## Task 4: Add CLI Options

**Files:**
- Modify: `src/cli/init-skills.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/integration/generate-command.test.ts`

- [ ] **Step 1: Add failing help assertions**

Update `tests/integration/generate-command.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("cli smoke test", () => {
  it("prints help successfully", async () => {
    const result = await execa("node", ["dist/cli/index.js", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("generate");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("clean");
  });

  it("prints init-skills business subagent options", async () => {
    const result = await execa("node", [
      "dist/cli/index.js",
      "init-skills",
      "--help",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--business-domain");
    expect(result.stdout).toContain("--business-domain-name");
    expect(result.stdout).toContain("--business-domain-aliases");
    expect(result.stdout).toContain("--business-domain-paths");
  });
});
```

- [ ] **Step 2: Build and run the CLI smoke test to verify failure**

Run:

```bash
npm run build
npm test -- tests/integration/generate-command.test.ts
```

Expected: FAIL because the new CLI options do not exist.

- [ ] **Step 3: Extend init-skills options**

Update `src/cli/init-skills.ts`:

```typescript
export interface InitSkillsOptions {
  path?: string;
  repo?: string;
  agents?: string;
  force?: boolean;
  updateAgentsMd?: boolean;
  verbose?: boolean;
  businessDomain?: string;
  businessDomainName?: string;
  businessDomainAliases?: string;
  businessDomainPaths?: string;
}
```

Add this helper near the bottom of the file:

```typescript
function parseCommaList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
```

In `runInitSkills`, before `initializeSkills`, add:

```typescript
const businessSubagents =
  options.businessDomain || options.businessDomainName
    ? [
        {
          domain: options.businessDomain ?? "",
          domainName: options.businessDomainName ?? "",
          aliases: parseCommaList(options.businessDomainAliases),
          paths: parseCommaList(options.businessDomainPaths),
        },
      ]
    : undefined;
```

Pass it into `initializeSkills`:

```typescript
const summary: SkillInitSummary = await initializeSkills(
  {
    repoPath,
    force: options.force,
    updateAgentsMd: options.updateAgentsMd ?? true,
    verbose: options.verbose,
    businessSubagents,
  },
  agentIds,
);
```

- [ ] **Step 4: Expose CLI flags**

Update the `init-skills` command in `src/cli/index.ts`:

```typescript
program
  .command("init-skills [path]")
  .description(
    "Initialize AI Agent skills for the project. If no path specified, uses current directory.",
  )
  .option(
    "--repo <path>",
    "Target repository path (overrides positional argument)",
  )
  .option(
    `--agents <ids>`,
    `Agents to initialize: ${agentOptions}. Defaults to claude-code.`,
  )
  .option("--force", "Force re-initialization even if skills exist")
  .option("--no-update-agents-md", "Skip updating AGENTS.md")
  .option("--business-domain <domain>", "Business domain id, for example order")
  .option(
    "--business-domain-name <name>",
    "Business domain display name, for example 订单",
  )
  .option(
    "--business-domain-aliases <aliases>",
    "Comma-separated business domain aliases and trigger keywords",
  )
  .option(
    "--business-domain-paths <paths>",
    "Comma-separated source path globs related to this business domain",
  )
  .option("--verbose", "Enable verbose logging")
  .action(async (path, options) => {
    const { runInitSkills } = await import("./init-skills.js");
    await runInitSkills({ ...options, path });
  });
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run build
npm test -- tests/integration/generate-command.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/init-skills.ts src/cli/index.ts tests/integration/generate-command.test.ts
git commit -m "feat: expose business subagent CLI options"
```

## Task 5: Add End-to-End Initialization Test

**Files:**
- Create: `tests/integration/init-skills-subagents.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/init-skills-subagents.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("init-skills business subagents", () => {
  it("creates Claude Code business subagents and updates CLAUDE.md", async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "rkg-init-subagents-"));

    const result = await execa("node", [
      "dist/cli/index.js",
      "init-skills",
      "--repo",
      repo,
      "--agents",
      "claude-code",
      "--business-domain",
      "order",
      "--business-domain-name",
      "订单",
      "--business-domain-aliases",
      "checkout,refund",
      "--business-domain-paths",
      "src/order/**,src/checkout/**",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(".claude/agents/order-pm.md");
    expect(result.stdout).toContain(".claude/agents/order-tech-lead.md");
    expect(result.stdout).toContain(".claude/agents/order-qa.md");

    const pm = await fs.readFile(
      path.join(repo, ".claude", "agents", "order-pm.md"),
      "utf-8",
    );
    const techLead = await fs.readFile(
      path.join(repo, ".claude", "agents", "order-tech-lead.md"),
      "utf-8",
    );
    const qa = await fs.readFile(
      path.join(repo, ".claude", "agents", "order-qa.md"),
      "utf-8",
    );
    const claudeMd = await fs.readFile(path.join(repo, "CLAUDE.md"), "utf-8");

    expect(pm).toContain("name: order-pm");
    expect(pm).toContain("role: pm");
    expect(techLead).toContain("name: order-tech-lead");
    expect(techLead).toContain("role: tech");
    expect(qa).toContain("name: order-qa");
    expect(qa).toContain("role: qa");
    expect(claudeMd).toContain("业务域 Agent 协作规则：订单（order）");
    expect(claudeMd).toContain("checkout");
    expect(claudeMd).toContain("src/order/**");

    await fs.rm(repo, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Build and run the test**

Run:

```bash
npm run build
npm test -- tests/integration/init-skills-subagents.test.ts
```

Expected: PASS after Tasks 1-4 are complete.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/init-skills-subagents.test.ts
git commit -m "test: cover business subagent initialization"
```

## Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run unit tests for the feature**

Run:

```bash
npm test -- tests/unit/skills/business-subagents.test.ts tests/unit/skills/claude-code-subagents.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run integration tests for CLI behavior**

Run:

```bash
npm run build
npm test -- tests/integration/generate-command.test.ts tests/integration/init-skills-subagents.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only the pre-existing untracked `.agents/` directory may remain unrelated. All feature files should be committed.

## Self-Review

- Spec coverage: Tasks cover subagent templates, `@agent` support through generated names and `CLAUDE.md` rules, automatic participation through orchestration rules, PM/Tech Lead/QA separation, and ai-wiki integration through `init-skills`.
- Scope boundary: MCP backend and knowledge storage are intentionally excluded. Generated agents only declare the expected MCP tool protocol.
- Type consistency: `BusinessSubagentInitConfig`, `businessSubagents`, `renderBusinessSubagentFiles`, and `renderClaudeBusinessAgentSection` are used consistently across CLI, skill initialization, and Claude Code adapter tasks.
- Test coverage: Unit tests cover normalization/rendering and adapter idempotency. Integration tests cover CLI help and target repository file output.
