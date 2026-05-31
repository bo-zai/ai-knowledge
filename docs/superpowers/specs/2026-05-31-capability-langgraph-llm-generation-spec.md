# Capability LangGraph LLM Generation Spec

## 背景

当前 `generate-capability` 已经具备三部分能力：

1. 规则版业务功能知识生成可用，但只能作为内部补齐/测试手段，不能作为 `generate-capability` 成功输出模式。
2. 旧实现中 `--llm` 会真实调用模型。
3. 项目已有基础 LangGraph runtime：

```text
src/agent-read-runtime/graph-runtime.ts
```

该 runtime 已经使用：

```ts
ChatOpenAI
StateGraph
bindTools
graph.invoke
```

并且相关测试通过：

```text
tests/unit/agent-read-runtime/graph-runtime.test.ts
```

但当前 `generate-capability --llm` 没有接入 LangGraph，而是直接调用：

```text
src/generation/llm-client.ts -> generateWithClient()
```

真实项目验证中，模型被调用，但返回损坏 JSON，最终 fallback 到 skeleton：

```text
LLM called: true
LLM succeeded: false
Fallback: true
Claims: 0 raw, 0 accepted, 10 skeleton, 10 final
```

这说明当前还不是“完整业务功能利用 LLM 生成知识”，只是“直接 LLM 调用 + JSON 解析 + fallback”。

本轮目标是将 capability 知识生成改成强制 LangGraph LLM 模式。`generate-capability` 不再暴露 `--llm` / `--require-llm`，命令默认必须调用 LangGraph，并且必须产出可采纳的 LLM claims。

## 目标

为 `generate-capability` 接入强制 LangGraph 生成流程：

```text
generate-capability
-> discover business capability
-> build EvidenceBundle
-> LangGraph capability claim generation
   -> model_generate
   -> parse_and_validate
   -> repair_json
   -> filter_against_evidence
   -> final claims
-> pipeline may add skeleton claims only to补齐缺失类型
-> assemble objects
-> write package/report/debug
```

必须满足：

1. `generate-capability` 默认走 LangGraph，而不是直接 `generateWithClient()`。
2. 复用现有 LLM 配置：
   - `src/config/model-config.ts`
   - `src/generation/llm-client.ts` 可保留给旧 `generate` 命令使用
   - 不新增第二套配置系统
3. 复用现有 LangGraph 依赖：
   - `@langchain/langgraph`
   - `@langchain/openai`
4. LLM 仍然只能生成 `CandidateClaim[]`，不能决定：
   - object id
   - object path
   - catalog
   - package layout
5. LLM 输入只能来自 `EvidenceBundle` 和 evidence refs，不能扫整个仓库。
6. 命令必须要求至少一个 accepted non-OPEN LLM claim，否则失败。
7. JSON 修复必须在 LangGraph 内完成，不能把损坏输出直接当成功。
8. 真实项目必须验证：

```text
D:\workspace\other_project\music-education-app
```

## 非目标

- 不重写 `generate` 命令已有 LLM 流程。
- 不改 `agent-read-runtime` 的对外语义。
- 不让 LangGraph 读取全仓库。
- 不做 full repo 多 capability 聚类。
- 不引入新的模型 SDK。
- 不让 LLM 生成最终 YAML。

## 架构要求

### 1. 新增 capability 专用 LangGraph runtime

新增文件：

```text
src/generation/capability-langgraph-claims-runtime.ts
```

职责：

1. 接收 `EvidenceBundle`。
2. 构造 strict prompt。
3. 调用 LangGraph。
4. 解析模型输出。
5. 如果 JSON 或 schema 失败，调用 repair 节点。
6. 返回：

```ts
{
  claims: CandidateClaim[];
  rawText: string;
  repairedText?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  graphTrace: {
    attempts: number;
    repaired: boolean;
    validationErrors: string[];
  };
}
```

### 2. LangGraph 节点

最小图：

```text
START
-> model_generate
-> parse_validate
-> accepted | repair_json
-> parse_validate
-> accepted | failed
```

节点职责：

#### model_generate

调用 ChatOpenAI，要求返回 strict JSON。

#### parse_validate

执行：

```text
strip fences
sanitize control chars
JSON.parse
CandidateClaimSchema.safeParse
filterCandidateClaims(claims, bundle)
```

成功条件：

```text
至少有 1 个 accepted non-OPEN claim
```

#### repair_json

把原始输出、错误信息、允许枚举、evidence refs 再次交给模型修复。

repair prompt 必须要求：

```text
Return only a strict JSON array.
Use only allowed sddStageUses enum values.
Use only listed evidence refs.
Do not add prose.
```

#### failed

抛出可诊断错误。

### 3. allowed enum 必须明确写入 prompt

当前真实模型输出失败的主要原因之一是写了无效值：

```text
service_implementation
data_access_layer
business_logic
persistence_layer
```

Prompt 必须明确列出：

```text
sddStageUses allowed values:
- requirement_clarification
- requirement_specification
- design_planning
- implementation_planning
- coding
- review
- validation
```

并明确：

```text
Do not invent other stage names.
```

### 4. LLM 成功定义

当前 `llmSucceeded` 不能只代表“JSON 可解析”。

`generate-capability` 的 LLM 成功必须同时满足：

1. 模型被调用。
2. JSON/schema 通过。
3. `filterCandidateClaims()` 后至少有 1 个 accepted non-OPEN claim。
4. 最终 objects 中至少有一个非 skeleton 默认句式的 LLM claim 对象。

否则命令失败，不得写出 skeleton-only 包。

`buildSkeletonClaims()` 只能作为补齐缺失类型的内部 fallback：

- 允许：LLM 已产生 accepted non-OPEN claim 后，用 skeleton 补齐缺失的 MOD/VER/OPEN 等对象。
- 禁止：LLM 未成功时写出 skeleton-only 知识包。

### 5. Debug/report

继续写：

```text
bootstrap-knowledge/reports/capability-generation.json
bootstrap-knowledge/debug/capability-llm-request.json
bootstrap-knowledge/debug/capability-llm-response.json
```

新增 report 字段：

```json
{
  "llmRuntime": "langgraph",
  "graph": {
    "attempts": 2,
    "repaired": true,
    "validationErrors": []
  }
}
```

### 6. 与现有 agent-read-runtime 的关系

`src/agent-read-runtime/graph-runtime.ts` 继续保留，用于 evidence reading agent。

新 capability runtime 可以复用其中的设计模式，但不要强行复用其 local read tools，因为 capability LLM 输入必须已经被 EvidenceBundle 收敛。

必须保证现有 LangGraph 基础测试仍通过：

```bash
npx vitest run tests/unit/agent-read-runtime/graph-runtime.test.ts
```

## CLI 行为

`generate-capability` 保留现有 LLM 配置参数，但移除 LLM 行为开关：

```text
--llm-config <path>
--model <name>
--base-url <url>
--api-key-env <name>
```

必须删除：

```text
--llm
--require-llm
```

行为：

```text
始终调用 LangGraph
LangGraph 成功：采用 accepted LLM claims，并允许 skeleton 仅补齐缺失对象类型
LangGraph 失败、模型配置缺失、无 accepted non-OPEN claim：命令失败
不得 fallback 到 skeleton-only 成功输出
```

## 真实项目验收

必须运行：

```bash
npm run typecheck
npm run build
npm test
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-langgraph-validation --llm-config D:\workspace\ai-wiki\llm.config.json --verbose
```

如果没有 config 文件，则使用本机实际配置的模型和 API key 环境变量。以下示例使用 `qianfan-code-latest` 和 `OPENAI_API_KEY`：

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-langgraph-validation --model qianfan-code-latest --api-key-env OPENAI_API_KEY --verbose
```

验收条件：

1. 命令成功。
2. 输出显示：

```text
LLM runtime: langgraph
Succeeded: true
```

3. `reports/capability-generation.json` 中：

```json
"llmRuntime": "langgraph"
"llmCalled": true
"llmSucceeded": true
"llmAccepted": >= 1
```

4. 至少一个 CAP/FLOW/CON/TERM 对象 description 来自 LLM，不是 skeleton 默认句式。
5. 所有非 OPEN evidence refs 能在 `evidence/index.jsonl` 找到。
6. 不出现：

```text
MyBatis evidence processing
TERM-MYBATIS-MAPPER
service_implementation
data_access_layer
business_logic
persistence_layer
```

7. `tests/unit/agent-read-runtime/graph-runtime.test.ts` 继续通过。

## 最终回复要求

Claude Code 完成后必须报告：

```text
LLM runtime: langgraph
LLM called: yes/no
LLM succeeded: yes/no
Graph attempts:
Graph repaired: yes/no
LLM accepted claims:
Skeleton added claims:
Generated capability:
Evidence refs verified: yes/no
LangGraph base tests passed: yes/no
Real project command:
```
