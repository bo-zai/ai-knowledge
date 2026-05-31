# Generate Command DB And Capability Refactor Spec

## 背景

本项目的目标是为目标仓库生成 `bootstrap-knowledge/` 知识包。根据 `notes/wiki-agent-knowledge/design` 下的设计，知识系统不是给人阅读的普通文档，而是给 AI Agent 按需检索的业务与系统知识层。最小单元应是可验证、可引用、可过期判断的知识对象，组合页只负责编排对象，不新增权威事实。

当前 `generate` 命令同时承载了两套生成逻辑：

- 默认项目生成逻辑：基于 MyBatis/SQL 证据优先生成 DB 知识，并保留 route/process/tool/community 等旧 slice 对象生成。
- 业务功能生成逻辑：当传入 `--terms` 或 `--paths` 时，额外运行 capability pipeline，生成 `CAP/TERM/FLOW/CON/MOD/VER/OPEN` 业务功能知识。

这导致命令语义不清晰：用户无法从命令名判断本次生成的是 DB 知识、业务功能知识，还是两者都生成。

## 当前行为结论

### 1. `generate` 当前会生成 DB 知识

不传 `--terms` / `--paths` 时：

```bash
node dist/cli/index.js generate <repo>
```

当前会进入 `runProject` 分支：

- 调用 `prepareKnowledgeGeneration`
- 构建 MyBatis DB evidence bundles
- 通过 `buildSlicePlan` 生成 database slices
- 对 database slice 使用 `buildDbPrompt`
- 生成 `DB` 对象
- 写入 `bootstrap-knowledge/`

所以当前 `generate` 的默认主行为是项目级知识生成，其中 DB 知识是当前最稳定、最主要的落地点。

### 2. `generate` 当前也会生成业务功能知识

只要传入 `--terms` 或 `--paths`：

```bash
node dist/cli/index.js generate <repo> --terms course,goods,order --paths src/main/java
```

当前会进入 `runCapability` 分支：

- 调用 `ensureIndex` / `hasIndex`
- 使用 `discoverCapabilitiesFromGraph`
- 为选中的 capability candidate 构建 `EvidenceBundle`
- 通过 LangGraph LLM claims provider 生成候选 claims
- 组装 `CAP/TERM/FLOW/CON/MOD/VER/OPEN`
- 写入 capability 版 `bootstrap-knowledge/`

因此当前 `generate` 已经包含业务功能知识生成，但它是由 `--terms` / `--paths` 隐式触发的，不是显式模式。

### 3. 当前存在双流程覆盖风险

当前逻辑：

```ts
const hasCapabilityParams = targetTerms.length > 0 || targetPaths.length > 0;
const hasSliceParam = !!options.slice;
const runCapability = hasCapabilityParams;
const runProject = !hasCapabilityParams || hasSliceParam;
```

因此：

- 无 `--terms/--paths`：只跑项目/DB 流程。
- 有 `--terms/--paths` 且无 `--slice`：只跑 capability 流程。
- 有 `--terms/--paths` 且有 `--slice`：先跑项目/DB 流程，再跑 capability 流程。

第三种情况下，两个 writer 都会清理并写入 `bootstrap-knowledge/`。如果输出根目录相同，后写的 capability 包会覆盖前面项目/DB 包。这不符合“权威对象文件 + 统一 catalog”的设计。

## 修订后的目标

重构并优化 `generate` 命令，让它成为明确的知识生成编排入口：

1. DB 与业务功能知识必须统一按设计文档写入相应知识目录。
2. 简化 `generate` 参数，通过一个知识类型参数分别指定生成 DB、业务功能或全部知识。
3. 支持传入一个测试表或测试功能，只生成相应的一个知识切片。
4. 不传知识类型参数时，默认生成所有知识。
5. 消除 `--terms/--paths` 隐式改变命令语义的问题。
6. 消除同一命令中两个 writer 互相覆盖 `bootstrap-knowledge/` 的风险。
7. 保持 `src/cli/` 只做参数解析和命令分发，不承载业务生成逻辑。
8. 保持 `src/generation/` 不直接写文件。
9. 保持 LLM 只生成知识内容，不决定对象 ID、对象类型和路径。
10. 让真实项目 `D:\workspace\other_project\music-education-app` 能验证 DB 与 capability 两类生成行为。

## 非目标

本次不实现完整 wiki-agent 全对象系统。

本次不要求一次性补齐 `SYS/OWN/INV/STATE/DEC/ACTOR`。业务功能生成仍以当前已落地范围为主：

- `CAP`
- `TERM`
- `FLOW`
- `CON`
- `MOD`
- `VER`
- `OPEN`

本次不把 DB 对象强行改造成 capability 对象。DB 知识与 capability 知识可以共存，但必须通过统一写包协议和 catalog 协调。

## 命令语义

### 简化后的参数

`generate` 只保留两个与生成范围直接相关的核心参数：

```bash
--knowledge <db|capability|all>
--target <selector>
```

`--knowledge` 含义：

- `db`：只生成 DB / 数据库知识。
- `capability`：只生成业务功能知识。
- `all`：生成 DB 与业务功能知识，最后合并成一个 `bootstrap-knowledge/` 包。

`--target` 含义：

- 当 `--knowledge db` 时，`--target users` 或 `--target db:users` 表示只生成 `users` 表知识。
- 当 `--knowledge capability` 时，`--target order` 或 `--target capability:order` 表示只生成一个与 `order` 最相关的业务功能知识。
- 当 `--knowledge all` 时，`--target` 必须带类型前缀，例如 `db:users` 或 `capability:order`，避免歧义。
- 不传 `--target` 时，生成该知识类型下的全部可发现知识。

### 默认行为

不传 `--knowledge` 时：

```bash
node dist/cli/index.js generate <repo>
```

默认等价于：

```bash
node dist/cli/index.js generate <repo> --knowledge all
```

也就是生成所有当前可支持的知识：

- 所有可发现 DB 表知识。
- 所有可发现业务功能知识。

### 参数约束

`--knowledge db`：

- 允许 `--target users`。
- 允许 `--target db:users`。
- 不允许 `--target capability:order`。

`--knowledge capability`：

- 必须调用 LLM。
- 不允许 mock mode 生成稳定业务功能知识。
- 不传 `--target` 时，发现并生成全部候选业务功能。
- 传 `--target order` 时，只生成一个与 `order` 最相关的业务功能。
- 生成模式保持“一个 capability candidate 一次 LLM 调用”。多功能生成是对候选功能逐个调用 LLM，而不是把全仓库一次性塞给模型。

`--knowledge all`：

- DB stage 和 capability stage 必须在内存中合并输出，再由一个统一 writer 写入。
- 禁止 DB writer 与 capability writer 先后清理同一个 `bootstrap-knowledge/`。
- 不传 `--target` 时，生成所有 DB 与所有业务功能知识。
- 传 `--target` 时必须带类型前缀，例如 `db:users` 或 `capability:order`。

### 兼容旧参数

旧参数应进入兼容期，但不再作为主设计：

- `--slice database:<table>` 映射为 `--knowledge db --target db:<table>`。
- `--terms order` 映射为 `--knowledge capability --target capability:order`，多个 terms 可以作为 capability discovery hints。
- `--paths` 可作为 capability evidence scope hints，但不再作为“是否生成业务功能知识”的开关。
- report 中记录 `legacyArgsUsed`，便于后续移除。

## 目标架构

### CLI 层

`src/cli/index.ts`：

- 注册参数。
- 增加 `--knowledge <db|capability|all>`。
- 增加 `--target <selector>`。
- 不包含生成细节。

`src/cli/generate.ts`：

- 解析 repo、knowledge、target、out、llm config。
- 进行参数约束校验。
- 调用 `runGenerateOrchestration`。
- 打印最终摘要。

CLI 层不得：

- 构建 evidence bundle。
- 决定 object schema。
- 写业务对象。
- 拼装 DB / capability 具体知识。

### Orchestration 层

新增或重构：

```text
src/knowledge/generate-orchestrator.ts
```

职责：

- 根据 `knowledge` 和 `target` 决定运行哪些 stage。
- 统一收集 generated files / objects / report / debug。
- 统一处理 partial failure。
- 统一调用 packaging 层写包。

建议接口：

```ts
export type GenerateKnowledge = 'db' | 'capability' | 'all';

export interface GenerateOrchestrationInput {
  repoPath: string;
  outputRoot: string;
  knowledge: GenerateKnowledge;
  target?: {
    kind: 'db' | 'capability';
    value: string;
  };
  slice?: string;
  targetTerms: string[];
  targetPaths: string[];
  forceAnalyze?: boolean;
  verbose?: boolean;
  llm: {
    model?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    llmConfig?: string;
  };
}
```

### DB Stage

新增或抽取：

```text
src/knowledge/db-knowledge-pipeline.ts
```

职责：

- 复用现有 MyBatis / SQL evidence extraction。
- 生成 `DB` 对象。
- 不传 target 时生成所有可发现 DB 表。
- 传 `target.kind=db` 时只生成指定表。
- 返回内存中的 package contribution，不直接落盘。

推荐输出：

```ts
export interface KnowledgePackageContribution {
  objects: KnowledgePackageObject[];
  files: Array<{ path: string; content: string }>;
  report: Record<string, unknown>;
  debugFiles: Array<{ path: string; content: string }>;
}
```

### Capability Stage

继续使用：

```text
src/knowledge/capability-knowledge-pipeline.ts
```

但需要确保它只返回内存结果，不直接落盘。当前落盘已在 packaging 层，方向正确。

业务功能生成必须满足：

- LLM 必调。
- LLM 输入只能是 evidence bundle，不允许模型扫全仓库。
- LLM 不决定 object ID、object type、path。
- `OPEN` 不能被吞掉。
- 至少生成可用的 `CAP`、`FLOW` 或 `CON`、`MOD`、`VER` 或 validation `OPEN`。
- 不传 target 时对每个 capability candidate 单独构建 evidence bundle，并逐个调用 LLM。
- 传 `target.kind=capability` 时只选择最匹配的一个 capability candidate，并只调用一次 LLM。

### Packaging 层

需要统一写包入口：

```text
src/packaging/knowledge-package-writer.ts
```

职责：

- 只清理一次 `bootstrap-knowledge/`。
- 写入统一 `catalog.yaml`。
- 写入 DB 与 capability 对象。
- 写入 stage reports。
- 写入 debug files。

不得由 DB writer 与 capability writer 在同一命令里分别清理目录。

## Catalog 要求

统一 `catalog.yaml` 必须表达：

```yaml
version: 1
generation:
  knowledge: db | capability | all
  target:
    kind:
    value:
retrieval_order:
  db_context:
    - DB
  capability_context:
    - CAP
    - TERM
    - FLOW
    - CON
    - MOD
    - VER
    - OPEN
capabilities:
objects:
unknown_escalation_rules:
```

当 `knowledge=all` 时：

- DB 对象与 capability 对象必须同时出现在 `objects`。
- capability page 可以引用相关 DB 对象，但不能把 DB 事实复制成 capability 正文事实。
- 组合页只做对象引用和最小摘要。

## 报告要求

生成报告至少包含：

```json
{
  "knowledge": "db | capability | all",
  "target": {
    "kind": "db | capability",
    "value": "users | order"
  },
  "stages": {
    "db": {
      "ran": true,
      "succeeded": 1,
      "failed": 0
    },
    "capability": {
      "ran": true,
      "capabilityGenerationMode": "single",
      "candidateCount": 1,
      "selectedCandidateId": "CAND-...",
      "llmRuntime": "langgraph",
      "llmCalled": true,
      "llmSucceeded": true
    }
  },
  "warnings": []
}
```

## 验收标准

### 单元测试

必须覆盖：

1. `--knowledge db` 只运行 DB stage。
2. `--knowledge capability` 只运行 capability stage。
3. `--knowledge all` 运行两个 stage，但只写一次 `bootstrap-knowledge/`。
4. 未传 `--knowledge` 时默认 `all`。
5. `--knowledge db --target users` 只生成一个表。
6. `--knowledge capability --target order` 只生成一个业务功能。
7. `--knowledge all --target users` 报参数错误，因为 all 模式下 target 必须带类型前缀。
8. `--knowledge all --target db:users` 只限制 DB stage，capability stage 不运行。
9. `--knowledge all --target capability:order` 只限制 capability stage，DB stage 不运行。
10. `src/cli/generate.ts` 不直接调用 DB evidence builder、capability evidence builder、writer 清理逻辑。

### 集成测试

必须覆盖真实项目：

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge db --target db:course --out D:\tmp\music-education-app-generate-db-one --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

期望：

- 生成 `bootstrap-knowledge/catalog.yaml`。
- 只生成指定表对应的 `DB` 对象。
- report 中 `knowledge=db`。
- 不生成 capability report。

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --target order --out D:\tmp\music-education-app-generate-capability-one --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

期望：

- 生成 `CAP/TERM/FLOW或CON/MOD/VER或OPEN`。
- report 中 `knowledge=capability`。
- report 中 `llmRuntime=langgraph`。
- report 中 `llmCalled=true` 且 `llmSucceeded=true`。
- 不生成技术词 `mybatis` 作为业务 `TERM`。

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge all --out D:\tmp\music-education-app-generate-all --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

期望：

- 一个 `bootstrap-knowledge/` 包内同时存在 DB 与 capability 对象。
- `catalog.yaml` 同时索引 DB 与 capability 对象。
- writer 只清理一次输出目录。
- capability 输出不覆盖 DB 输出。

```bash
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --out D:\tmp\music-education-app-generate-default-all --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

期望：

- 默认行为与 `--knowledge all` 一致。
- report 中 `knowledge=all` 且 `knowledgeInferredFrom=default`。

### 最低交付校验

提交前必须运行：

```bash
npm run typecheck
npm run build
npm test
```

并额外运行上述真实项目命令。

## 风险

### 风险 1：过早统一 DB 与 capability 对象 schema

DB 知识已有专门 schema 约束，capability 知识当前使用另一套 YAML writer。强行一次性统一全部字段会扩大风险。

应对：先统一写包协议和 catalog，再逐步统一对象公共字段。

### 风险 2：`all` 模式变成“两个包拼一起”

如果只是把两个 writer 先后调用，仍然会覆盖。

应对：stage 只能返回内存贡献，最终只能由一个 writer 落盘。

### 风险 3：业务功能生成退化成技术摘要

`--terms mybatis` 这类输入容易让模型生成技术对象。

应对：继续保留技术术语过滤，并在真实项目验证中要求 `mybatis` 不成为业务 `TERM`。

## 本轮完成定义

本轮完成后，`generate` 命令应具备清晰、可解释、可验证的生成范围：

- DB 知识生成。
- 业务功能知识生成。
- DB + 业务功能统一包生成。
- 单表 DB 知识生成。
- 单业务功能知识生成。
- 默认全量知识生成。

用户不再需要通过是否传 `--terms/--paths` 猜测命令行为，也不会因为同一命令内两个 writer 顺序执行导致知识包被覆盖。
