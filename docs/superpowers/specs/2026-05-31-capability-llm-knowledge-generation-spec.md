# Capability LLM Knowledge Generation Spec

## 背景

当前 `generate-capability` 已经能在真实项目：

```text
D:\workspace\other_project\music-education-app
```

生成业务能力知识包。当前真实输出已经包含：

```text
CAP-ORDER-COURSE-GOODS-CAPABILITY
TERM
FLOW
MOD
CON
VER
OPEN
evidence/index.jsonl
```

但当前业务功能知识内容不是 LLM 生成的，而是 deterministic skeleton 生成：

```text
runCapabilityKnowledgePipeline
-> discoverCapabilities
-> buildEvidenceBundle
-> buildSkeletonClaims
-> assembleCapabilityKnowledgeObjects
-> writeCapabilityKnowledgePackage
```

`buildCapabilityClaimPrompt()` 已经存在，但 `generate-capability` CLI 没有接入模型；`runCapabilityKnowledgePipeline()` 的 `claimsProvider` 也没有被真实 CLI 使用。

本轮要把业务功能知识生成升级为：

```text
程序负责发现业务能力、构造 evidence、决定对象结构和 ID
LLM 只负责基于 evidence 生成候选 claims 的知识内容
程序校验、过滤、合并、落盘
```

## 目标

为 `generate-capability` 实现完整的 LLM 生成链路：

```text
CLI generate-capability
-> 解析 LLM 配置
-> 创建 OpenAI-compatible client
-> discover capabilities
-> build EvidenceBundle
-> LLM 基于 EvidenceBundle 生成 CandidateClaim[]
-> zod schema 校验
-> evidence refs 校验
-> 和 skeleton claims 合并/补齐
-> assemble objects
-> write bootstrap-knowledge
-> 写 generation report/debug trace
```

必须保证：

1. LLM 不能扫描整个仓库。
2. LLM 不能决定对象 ID、对象路径、对象类型集合。
3. LLM 不能引用不存在的 evidence refs。
4. LLM 不能把推断写成事实；缺 evidence 的内容必须进入 OPEN。
5. 非 OPEN 对象必须有合法 evidence refs。
6. 当用户要求必须使用 LLM 时，LLM 失败不能静默降级为 skeleton。
7. 当用户不启用 LLM 时，现有 deterministic skeleton 模式继续可用。

## 非目标

- 不重写 `generate` 命令已有的通用对象生成链路。
- 不引入新的模型 SDK；复用现有 `openai` 依赖和 `src/generation/llm-client.ts`。
- 不让 LLM 直接输出 YAML 文件。
- 不让 LLM 生成 object id。
- 不让 LLM 决定 `catalog.yaml`、目录结构、文件路径。
- 不做多 capability 聚类。

## CLI 行为

项目已有 LLM 配置与调用基础设施：

- `src/config/model-config.ts`
- `src/generation/llm-client.ts`
- `generate` 命令已有 `--llm-config`、`--model`、`--base-url`、`--api-key-env`

本功能不得新增第二套 LLM 配置系统。`generate-capability` 只需要复用既有配置能力，并补充 capability 专用的启用/强制行为。

`generate-capability` 支持参数：

```text
--llm
--require-llm
--llm-config <path>
--model <name>
--base-url <url>
--api-key-env <name>
```

语义：

### 默认模式

不传 `--llm` / `--require-llm`：

```text
不调用 LLM
使用 buildSkeletonClaims
```

### LLM 可选模式

传 `--llm`：

```text
尝试调用 LLM
LLM 成功：使用 LLM claims，并用 skeleton claims 补齐缺失类型
LLM 失败：记录 warning/debug，降级 skeleton claims
```

### LLM 强制模式

传 `--require-llm`：

```text
必须调用 LLM
LLM 配置缺失、API key 缺失、模型调用失败、返回 JSON 无法校验、没有任何非 OPEN claim：命令失败
不得写出 skeleton-only 包
```

`--require-llm` 隐含 `--llm`。

## LLM 配置

复用现有：

- `src/config/model-config.ts`
- `src/generation/llm-client.ts`

不要新增新的 config loader、client wrapper 或模型 SDK。

配置解析优先级：

```text
CLI option
-> llm config file
-> env var
-> defaults
```

示例：

```json
{
  "model": "gpt-4o",
  "baseUrl": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY"
}
```

如果 `--llm` 或 `--require-llm` 启用后缺少 API key：

- `--llm`：warning 后降级 skeleton。
- `--require-llm`：失败并显示缺少的 env name。

## LLM 输入边界

LLM 输入只能包含：

1. `EvidenceBundle` 的摘要。
2. available evidence refs。
3. capability hints。
4. negative evidence。
5. open question seeds。

禁止：

1. 把整个仓库源码传给 LLM。
2. 让 LLM 读取文件路径外的内容。
3. 让 LLM 自己发现对象。
4. 让 LLM 输出文件。

Prompt 必须强调：

```text
- use only bundle evidence
- every non-OPEN claim cites evidence refs
- missing evidence becomes OPEN
- do not create object IDs or file paths
- do not invent facts
- do not mark inference as fact
- return strict JSON only
```

## LLM 输出格式

LLM 必须返回 JSON array：

```json
[
  {
    "suggestedType": "CAP",
    "claimText": "Goods/order purchase capability coordinates stock checks and order goods persistence.",
    "confidence": "medium",
    "evidenceRefs": ["evidence://entry/EP-001", "evidence://behavior/BEH-001"],
    "decisionPoints": ["matched_capability"],
    "sddStageUses": ["requirement_clarification", "requirement_specification"],
    "unsupportedParts": [],
    "blockedDecisions": [],
    "objectHints": {
      "canonicalTerm": "Goods Order capability"
    }
  }
]
```

程序必须使用 `CandidateClaimSchema` 校验每个 claim。

过滤规则继续生效：

1. OPEN 必须有 `blockedDecisions`。
2. 非 OPEN 必须有 `evidenceRefs`。
3. 非 OPEN 的每个 evidence ref 必须存在于 bundle。
4. 非 OPEN 不能是 `low` confidence。
5. LLM claim 的 suggestedType 只能是 `CAP | TERM | FLOW | MOD | CON | VER | OPEN`。

## Claim 合并规则

LLM 成功后：

1. 先过滤 LLM claims。
2. 再生成 skeleton claims。
3. 按类型补齐 skeleton claims，保证至少有：

```text
CAP
TERM
FLOW
MOD
CON
VER
OPEN
```

当 LLM 已生成同类型高质量 claim 时，优先使用 LLM claim。

当 LLM 没有生成某类型时，用 skeleton claim 补齐。

当 LLM 生成无效 refs 或 low confidence 非 OPEN claim 时，丢弃该 claim。

## Debug 与报告

LLM 模式必须写出 debug 信息，至少包括：

```text
bootstrap-knowledge/reports/capability-generation.json
bootstrap-knowledge/debug/capability-llm-request.json
bootstrap-knowledge/debug/capability-llm-response.json
```

报告字段：

```json
{
  "mode": "llm",
  "llmRequested": true,
  "llmRequired": false,
  "llmCalled": true,
  "llmSucceeded": true,
  "model": "gpt-4o",
  "claimCounts": {
    "llmRaw": 8,
    "llmAccepted": 6,
    "skeletonAdded": 2,
    "final": 8
  },
  "warnings": []
}
```

`debug/capability-llm-request.json` 不能包含 API key。

## 真实项目验收

必须在真实项目运行：

```bash
npm run typecheck
npm run build
npm test
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --llm --require-llm --llm-config D:\workspace\ai-wiki\llm.config.json --verbose
```

如果没有 `llm.config.json`，必须使用等价 CLI 参数和环境变量运行，例如：

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --llm --require-llm --model gpt-4o --api-key-env OPENAI_API_KEY --verbose
```

验收条件：

1. 命令成功。
2. 输出中明确显示 LLM mode。
3. `bootstrap-knowledge/reports/capability-generation.json` 存在。
4. report 中：

```json
"llmRequested": true
"llmRequired": true
"llmCalled": true
"llmSucceeded": true
```

5. CAP/FLOW/CON/VER/TERM 中至少 3 类对象的 description 不是 skeleton 默认句式。
6. capability id 仍由程序生成，不能由 LLM 输出。
7. 非 OPEN 对象的 evidence refs 都能在 `evidence/index.jsonl` 中找到。
8. `MyBatis evidence processing` 不能再次成为 CAP。
9. `TERM-MYBATIS-MAPPER` 不能作为业务 TERM 输出；MyBatis 只能出现在 related technical context 或 evidence 中。

## 测试要求

至少新增：

1. LLM provider prompt 构造测试。
2. LLM provider 解析 JSON array 测试。
3. LLM provider 拒绝 invalid JSON 测试。
4. LLM provider 过滤不存在 evidence refs 测试。
5. pipeline 在 `--llm` 可选模式失败时 fallback skeleton 测试。
6. pipeline 在 `--require-llm` 失败时返回错误测试。
7. CLI 解析 `--llm`、`--require-llm`、`--llm-config`、`--model`、`--base-url`、`--api-key-env` 测试。
8. 真实项目命令验收。

## 最终回复要求

Claude Code 完成后必须报告：

```text
LLM called: yes/no
LLM required: yes/no
Model:
Generated capability:
LLM accepted claims:
Skeleton fallback claims:
Objects generated:
Evidence refs verified: yes/no
Report path:
Real project command:
```
