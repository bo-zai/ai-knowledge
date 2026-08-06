# 三角色业务域知识与子 Agent 设计

日期：2026-08-06

## 背景

项目已经有基础 `ai-knowledge` 生成能力，并通过 `capabilities/`、`concepts/`、`workflows/`、`boundaries/`、`constraints/`、`relations/`、`data-model/`、`external-systems/` 等目录沉淀项目知识。当前还存在 `.internal/domain-registry.json`，用于记录业务域、概念和能力之间的关系。

本设计不新建一套独立业务域体系。三角色知识是现有 `ai-knowledge` 的角色化投影：基于已有业务域和基础知识对象，分别沉淀 PM、技术经理、QA 三类子 Agent 所需的知识。

## 目标

构建一个通用工具，能够在项目内自动发现业务域，并为每个业务域生成三类角色知识：

- PM：产品口径、业务规则、建设思路、历史演进、验收口径、冲突和待确认项。
- 技术经理：技术实现、模块职责、调用链、数据流、依赖、影响面、技术演进和风险。
- QA：测试策略、场景矩阵、边界用例、回归范围、覆盖缺口、历史风险。

生成后的子 Agent 可通过 `role + domain` 定位自己的知识入口，并在用户显式 `@agent` 或系统自动路由时参与回答。

## 非目标

- 不把 PM、技术经理、QA 做成新的 `KnowledgeType`。
- 不用历史需求文档重新定义项目业务域。
- 不让低置信、冲突或历史需求污染默认当前结论。
- 不要求子 Agent 自主监听并打断主对话。所谓主动参与由主系统路由器触发。

## 与现有 ai-knowledge 的融合

基础 `ai-knowledge` 是主干，角色知识是视图层。

```text
ai-knowledge/
  architecture.md
  capabilities/
  concepts/
  boundaries/
  external-systems/
  constraints/
  relations/
  data-model/
  workflows/

  roles/
    pm/
    tech-lead/
    qa/

  .internal/
    domain-registry.json
    role-knowledge/
```

业务域来源优先级：

1. `.internal/domain-registry.json`
2. 已生成的 `capabilities/`、`concepts/`、`workflows/`、`boundaries/` 等基础对象
3. 当前代码结构、模块拓扑和代码图
4. git commit scope、message 和 diff
5. 历史需求文档中的业务域线索
6. 人工配置和别名

历史需求文档只作为补充证据和候选域来源，不主导当前业务域划分。

## 目录结构

每个角色使用统一目录结构：

```text
ai-knowledge/roles/{role}/domains/{domain}/
  current/
  evolution/
  evidence/
  review/
  index.json
```

PM：

```text
roles/pm/domains/{domain}/
  current/
    overview.md
    rules.md
    acceptance.md
    open-questions.md
  evolution/
    timeline.md
    decisions.md
    deprecated.md
    conflicts.md
  evidence/
    claims.jsonl
    source-report.json
    links.jsonl
  review/
    claims-to-confirm.jsonl
    open-questions.md
    conflicts.md
  index.json
```

技术经理：

```text
roles/tech-lead/domains/{domain}/
  current/
    overview.md
    architecture.md
    flows.md
    dependencies.md
    risks.md
  evolution/
    timeline.md
    decisions.md
    migrations.md
    deprecated.md
  evidence/
    claims.jsonl
    code-refs.jsonl
    git-report.json
    links.jsonl
  review/
    risk-to-confirm.md
    architecture-questions.md
    stale-code-candidates.jsonl
  index.json
```

QA：

```text
roles/qa/domains/{domain}/
  current/
    overview.md
    strategy.md
    scenarios.md
    boundaries.md
    regression.md
  evolution/
    timeline.md
    incident-patterns.md
    deprecated-cases.md
  evidence/
    claims.jsonl
    test-refs.jsonl
    coverage-report.json
    links.jsonl
  review/
    missing-cases.md
    flaky-or-risky-tests.md
    test-data-questions.md
  index.json
```

候选域、跨角色汇总和无法确认内容放在：

```text
ai-knowledge/roles/_review/
  domain-candidates.md
  summary.md
```

工具内部缓存和报告放在：

```text
ai-knowledge/.internal/role-knowledge/
  report.json
  domain-candidates.json
  pm/cache/
  tech-lead/cache/
  qa/cache/
```

## 业务域发现与融合

角色知识生成前先构建增强的 `DomainProfile`，但不直接替换 `DomainRegistryEntry`。

```ts
type DomainProfile = {
  domainKey: string;
  domainName: string;
  source: "registry" | "registry_enriched" | "knowledge_object" | "candidate";
  confidence: "high" | "medium" | "low";
  concept?: DomainConceptRef;
  capabilityRefs: DomainCapabilityRef[];
  knowledgeRefs: KnowledgeObjectRef[];
  aliases: string[];
  evidence: DomainEvidence[];
};
```

置信度规则：

- `high`：来自 `domain-registry`，或概念和能力共同确认同一业务域。
- `medium`：多个基础知识对象共同指向同一业务域，但 registry 尚未完整记录。
- `low`：只来自历史文档、git scope 或代码目录名。

默认只为 `high` 和 `medium` 业务域生成正式角色知识。`low` 业务域进入 `roles/_review/domain-candidates.md`，不回写正式 registry。

技术模块过滤采用保守策略。`common`、`utils`、`shared`、`core`、`infra`、`config`、`middleware`、`adapter`、`test` 等名称如果没有业务文档、能力或概念证据，降为 ignored。

## 三角色知识边界

PM 负责：

- 功能定义
- 业务目标
- 当前产品规则
- 产品演进
- 业务验收口径
- 过期需求、冲突和待确认项
- 关联 capability、workflow、boundary、concept

PM 不直接沉淀函数、类、SQL、测试代码、部署细节和技术重构细节。

技术经理负责：

- 代码模块和职责
- 核心调用链和数据流
- 接口、数据模型和外部依赖
- 技术方案演进
- 技术约束、风险和影响面
- 迁移、重构和历史技术债

技术经理不把历史需求意图当作当前实现事实。

QA 负责：

- 测试范围和测试策略
- 主流程、异常流、边界流
- 状态、权限和数据组合
- 回归范围和风险路径
- 测试代码、自动化入口和覆盖缺口
- 历史问题和易复发模式

QA 不凭空生成测试点，必须来自 PM 当前规则、技术风险、历史缺陷或测试覆盖缺口。

## Role Claim Schema

三类角色 claim 共享统一骨架。

```ts
type RoleClaimBase = {
  id: string;
  role: "pm" | "tech-lead" | "qa";
  domain: string;
  capability?: string;
  dimension: string;
  claim: string;
  status: "candidate" | "current" | "historical" | "stale" | "conflicting" | "open";
  confidence: "high" | "medium" | "low";
  effective_date?: string;
  time_source?:
    | "document_declared"
    | "document_title"
    | "filename"
    | "git_added_at"
    | "git_commit"
    | "code_current"
    | "test_current"
    | "human"
    | "unknown";
  time_confidence?: "high" | "medium" | "low";
  source_refs: SourceRef[];
  knowledge_refs: KnowledgeObjectRef[];
  role_refs?: RoleKnowledgeRef[];
  relations?: ClaimRelation[];
  validation?: RoleValidation;
  reasoning: string;
  open_questions?: string[];
  created_at: string;
  updated_at: string;
};
```

PM dimension：

```text
business_goal
user_role
entry_point
status_flow
business_rule
permission
exception
acceptance
product_decision
deprecated_requirement
open_question
```

技术经理 dimension：

```text
architecture
module_responsibility
call_flow
data_flow
api_contract
data_model_usage
external_dependency
technical_constraint
migration
technical_debt
impact_risk
```

QA dimension：

```text
test_strategy
main_scenario
exception_scenario
boundary_case
permission_case
state_matrix
regression_scope
test_data
automation
coverage_gap
risk_case
```

`source_refs` 记录原始来源，`knowledge_refs` 记录基础 `ai-knowledge` 对象引用，`role_refs` 记录跨角色引用。所有进入 `current/` 的结论必须有来源和置信度。

## 文档处理

需求文档处理采用结构化解析，而不是纯文本切块。

支持格式：

- `.md`：直接解析 Markdown 结构。
- `.docx`：优先转结构化元素，保留标题、段落、列表、表格。
- `.doc`：最佳努力。优先 LibreOffice headless 转 `.docx`，失败后尝试 Tika 或纯文本兜底，仍失败则记录报告并继续。
- `.pdf`：可选支持。优先使用布局感知解析和 OCR provider。
- `.txt`：作为低结构文本处理。

不同格式统一为 `DocumentElement`：

```ts
type DocumentElement = {
  id: string;
  document_id: string;
  type: "title" | "heading" | "paragraph" | "list_item" | "table" | "image" | "code" | "page_break" | "unknown";
  text: string;
  level?: number;
  page?: number;
  path: string;
  order: number;
  metadata?: Record<string, unknown>;
};
```

再构造成 `DocumentChunk`：

```ts
type DocumentChunk = {
  id: string;
  document_id: string;
  heading_path: string[];
  text: string;
  element_ids: string[];
  start_order: number;
  end_order: number;
  page_start?: number;
  page_end?: number;
  inferred_date?: string;
  inferred_version?: string;
  domain_candidates: DomainCandidate[];
  chunk_kind: "revision_history" | "requirement" | "business_rule" | "flow" | "acceptance" | "table" | "background" | "unknown";
};
```

chunk 按标题、章节、表格、流程和修订记录切分。修订记录单独进入 `document_profile.revisions`，用于推断 claim 时间线。

## 多版本演进处理

功能存在于多份迭代文档中时，不能用最新文档覆盖整份旧文档。归并单位必须是：

```text
业务域 + 子能力 + 规则维度
```

时间来源优先级：

1. 正文发布日期或修订记录
2. 标题或文件名中的日期和版本号
3. git 首次加入时间
4. git 最近修改时间
5. 文件系统修改时间

claim 状态判定优先级：

```text
人工确认 > 当前代码 > 最近 commit + diff > 最新需求文档 > 历史需求文档
```

状态含义：

- `current`：当前有效知识。
- `historical`：历史存在过，但不能证明当前仍有效。
- `stale`：疑似过期或已被废弃。
- `conflicting`：来源之间存在互斥描述。
- `open`：证据不足，需要确认。

低置信、冲突和 open 不进入默认当前事实，只进入 `review/` 或 `evolution/`。

## 基础知识到角色知识的投影

`CAPABILITY` 是三角色共同锚点：

- PM 投影成功能定义、产品规则、验收口径。
- 技术经理投影成实现模块、调用链、影响面。
- QA 投影成主流程测试、异常流和回归范围。

`CONCEPT`：

- PM 关注业务概念和边界。
- 技术经理关注领域模型和模块归属。
- QA 关注状态组合、等价类和测试数据。

`WORKFLOW`：

- PM 关注用户流程、业务节点和状态变化。
- 技术经理关注调用链、事件流、同步异步边界。
- QA 关注端到端场景、中断点和异常恢复。

`BOUNDARY`：

- PM 关注支持或不支持什么。
- 技术经理关注模块边界和责任归属。
- QA 关注边界、权限、异常和负向用例。

`CONSTRAINT`、`DATA_MODEL`、`RELATION`、`EXTERNAL` 也按角色投影，但 PM 只读取业务含义，不沉淀字段级实现。

## 生成顺序

```text
阶段 0：基础 ai-knowledge
  生成或读取现有项目知识。

阶段 1：业务域融合
  以 domain-registry 为主，补充 enriched/candidate domain。

阶段 2：PM 知识
  生成产品当前口径、历史演进、验收、冲突。

阶段 3：技术经理知识
  生成技术实现、调用链、依赖、影响面、技术风险。

阶段 4：QA 知识
  基于 PM、技术经理和测试代码生成测试策略、场景矩阵、覆盖缺口。

阶段 5：子 Agent 绑定
  每个 domain 生成或更新 pm、tech-lead、qa agent 读取入口。

阶段 6：路由与协作
  支持显式 @agent、自动路由和多角色编排。
```

QA 可以依赖 PM current 和技术经理 current。PM 不依赖技术经理，避免技术解释反向污染产品口径。

## CLI 设计

角色知识使用独立命令，并提供 `generate` 集成入口。

```bash
rkg role-knowledge discover-domains
rkg role-knowledge generate
rkg role-knowledge status
rkg generate --with-roles
```

常用参数：

```text
--role pm
--role tech-lead
--role qa
--roles pm,qa
--domains order,payment
--include-candidates
--bootstrap-knowledge
--with-docs
--docs-root <path>
--docs <path>
--include-git
--include-code
--dry-run
--force
--force-roles
--since <date>
--llm
```

`rkg generate` 默认只生成基础 `ai-knowledge`。`rkg generate --with-roles` 先生成基础知识，再生成角色知识。

角色知识不作为新的 `KnowledgeType`，避免把“知识对象类型”和“消费视角”混在一起。

## Agent 读取协议

每个角色的入口为：

```text
ai-knowledge/roles/{role}/domains/{domain}/index.json
```

`index.json`：

```json
{
  "schema_version": 1,
  "domain": "order",
  "domain_name": "订单",
  "role": "pm",
  "status": "generated",
  "generated_at": "2026-08-06T10:00:00+08:00",
  "confidence": "high",
  "base_knowledge_refs": [
    "capabilities/order-cancel.md",
    "workflows/order-cancel-flow.md"
  ],
  "read_profiles": {
    "default": [
      "current/overview.md",
      "current/rules.md",
      "current/acceptance.md"
    ],
    "trace": [
      "evolution/timeline.md",
      "evolution/decisions.md",
      "evolution/deprecated.md"
    ],
    "evidence": [
      "evidence/claims.jsonl",
      "evidence/source-report.json"
    ],
    "review": [
      "review/open-questions.md",
      "review/conflicts.md"
    ]
  },
  "warnings": []
}
```

读取规则：

- 当前问题读 `default`。
- 历史原因和演进读 `trace`。
- 来源、证据和置信度读 `evidence`。
- 冲突、风险和待确认读 `review`。

状态处理：

- `generated`：正常回答。
- `partial`：可以回答，但必须说明缺失来源。
- `needs_review`：必须指出存在冲突或待确认。
- `blocked`：不假装有知识，只说明阻塞原因。

## 多 Agent 协作

三种参与方式：

1. 显式 `@agent`
2. 自动路由
3. 协作编排

路由结果：

```ts
type AgentRouteDecision = {
  domain?: string;
  capability?: string;
  intent:
    | "current_product_rule"
    | "product_history"
    | "technical_impact"
    | "test_strategy"
    | "change_review"
    | "evidence_request"
    | "unknown";
  primaryRole: "pm" | "tech-lead" | "qa" | "none";
  supportingRoles: Array<"pm" | "tech-lead" | "qa">;
  confidence: "high" | "medium" | "low";
  reason: string;
};
```

协作模式：

- 单角色回答：由一个角色独立回答。
- 主角色加补充角色：主角色负责结论，其他角色补充影响或风险。
- 三角色评审：PM 给产品口径，技术经理给实现影响，QA 给测试风险，主系统整合。

子 Agent 不直接互相覆盖结论。多角色回答由主系统聚合。

## 增量更新

缓存粒度为 `domain + role + source fingerprint`。

触发规则：

- 需求文档变化：PM 重建相关 domain，QA 视情况重建。
- 代码变化：技术经理重建相关 domain，QA 重建相关 domain，PM 只重新做当前行为校验。
- 测试代码变化：QA 重建相关 domain。
- 基础 `ai-knowledge` 变化：三角色检查 affected domain。
- `domain-registry` 变化：新增、删除、合并 domain 对应重建角色入口。
- 人工确认变化：PM 重建相关 current/evolution，QA 视情况重建。

## 降级策略

`domain-registry` 不存在时：

- 若基础知识对象存在，可临时推断 domain profile，生成 `partial` 角色知识，并写入 review。
- 若基础知识也不存在，终止角色知识生成，提示先运行基础知识生成或使用 `--bootstrap-knowledge`。

历史文档出现 registry 没有的新业务域时：

- 不创建正式角色目录。
- 写入候选域报告。
- 如同时有当前代码和 git 证据，可生成 draft 到 `roles/_draft/domains/{domain}/`。

文档和代码不一致时：

- PM：当前代码优先，历史文档进入 historical、stale 或 conflicting。
- 技术经理：代码优先，文档只作为背景。
- QA：生成风险和确认项。

## 测试策略

需要覆盖：

1. 从已有 `domain-registry` 生成 role index。
2. registry 不完整时从基础知识对象补全 `DomainProfile`。
3. 低置信候选域只进入 review，不污染 registry。
4. md/docx/txt 文档解析和 chunk。
5. `.doc` 解析失败不阻塞。
6. 多文档同一能力按时间和规则维度归并。
7. 当前代码优先于历史文档。
8. PM、技术经理、QA claim schema 校验。
9. role `index.json` 的 read profiles 正确。
10. `partial`、`needs_review`、`blocked` 状态被 agent 读取协议正确处理。
11. `rkg role-knowledge generate --dry-run` 不覆盖正式知识。
12. 增量缓存命中和 `--force-roles` 重建。

## 实施里程碑

Milestone 1：

- domain 融合
- role 目录结构
- `index.json`
- `domain-registry.roleKnowledgeRefs`

Milestone 2：

- PM 知识完整生成
- 文档解析
- PM claim
- 演进、冲突、待确认

Milestone 3：

- 技术经理知识生成
- 代码和 git 证据
- 调用链、依赖和影响面

Milestone 4：

- QA 知识生成
- 测试策略
- 场景矩阵
- 覆盖缺口

Milestone 5：

- agent 读取协议
- 显式 `@agent`
- 自动路由
- 多角色协作
