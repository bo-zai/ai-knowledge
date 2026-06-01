# Full Capability Knowledge MVP Spec

## 目标

基于现有代码最小改动，实现 `--knowledge capability` 在未指定 `--target` 时，为 `D:\workspace\other_project\music-education-app` 生成多份业务功能知识 Markdown。

现有单能力生成链路已经可用：

```text
src/cli/generate.ts
-> runCapabilityKnowledgePipeline
-> discoverCapabilities
-> buildEvidenceBundle
-> createCapabilityLlmClaimsProvider
-> assembleCapabilityKnowledgeObjects
-> buildCapabilityKnowledgeFiles
-> writeKnowledgePackage
```

MVP 不重写这条链路，只在外层循环调用它。

## 当前代码事实

### 命令入口

文件：`src/cli/generate.ts`

当前 `runCapability` 中：

```ts
const capTerms = input.scope.target?.kind === 'capability' ? [input.scope.target.value] : targetTerms;
const capPaths = targetPaths.length > 0 ? targetPaths : ['src'];

result = await runCapabilityKnowledgePipeline({
  repoRoot: input.repoPath,
  targetTerms: capTerms,
  targetPaths: capPaths,
  claimsProvider,
  llmMode: { requested: true, required: true, model: capResolvedConfig.model },
});
```

问题：

- 无 `--target` 时 `capTerms = []`，`capPaths = ['src']`。
- `runCapabilityKnowledgePipeline` 只选一个 top candidate。
- 所以全项目只生成一个能力。

### 单能力 pipeline

文件：`src/knowledge/capability-knowledge-pipeline.ts`

当前逻辑：

```ts
const candidates = await discoverCapabilities(discoveryInput);
topCandidate = candidates.sort((a, b) => b.confidence - a.confidence)[0];
bundle = buildEvidenceBundle(topCandidate, repoName);
providerClaims = await claimsProvider(bundle);
objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
files = buildCapabilityKnowledgeFiles({ objects, capabilityId, evidenceIndex, report, debug });
```

该逻辑可复用，不在 MVP 中重写。

### packaging

文件：`src/packaging/knowledge-package-writer.ts`

当前 `writeKnowledgePackage` 会：

- 清空并重建 `bootstrap-knowledge/`
- 写全局 `catalog.yaml`
- 写 `reports/generation.json`
- 写 contribution.files
- 跳过 contribution 内的 `catalog.yaml`

MVP 应利用它合并多能力文件。

## MVP 设计

### 命令语义

不新增参数。

```bash
rkg generate <repo> --knowledge capability
```

表示：生成全量业务功能知识 MVP。

```bash
rkg generate <repo> --knowledge capability --target capability:order
```

表示：生成单个能力知识，保持现有逻辑。

旧参数 `--terms` / `--paths` 也保持单能力逻辑。

### 静态业务能力清单

新增文件：

```text
src/slicing/capability-mvp-inventory.ts
```

它只提供 `music-education-app` 的 MVP 能力清单：

- 商品浏览与搜索
- 购物车管理
- 订单管理
- 支付与回调
- 优惠券领取与使用
- 教学内容浏览
- 课程安排
- 录音提交与作品管理
- 录音评分
- 用户登录与资料

每个能力提供：

```ts
id
name
targetTerms
targetPaths
```

这些字段直接喂给现有 `runCapabilityKnowledgePipeline`。

### 多能力 wrapper

新增文件：

```text
src/knowledge/full-capability-mvp-pipeline.ts
```

职责：

1. 读取静态 inventory。
2. 对每个 item 调用现有 `runCapabilityKnowledgePipeline`。
3. 收集所有能力生成的 files。
4. 把每个能力的 `reports/capability-generation.json` 改名为 `reports/capabilities/<item.id>.json`，避免覆盖。
5. 把每个能力的 debug 文件放入 `debug/<item.id>/`，避免覆盖。
6. 丢弃每个单能力生成的 `catalog.yaml`，使用 `writeKnowledgePackage` 生成全局 catalog。
7. 生成 `reports/capability-inventory.json`，记录成功和失败。
8. 单个能力失败时继续下一个。

### generate.ts 分支

在 `src/cli/generate.ts` 的 `runCapability` 中判断：

```ts
const legacySingleRequested = targetTerms.length > 0 || targetPaths.length > 0;
const targetSingleRequested = input.scope.target?.kind === 'capability';
const fullCapabilityRequested = !legacySingleRequested && !targetSingleRequested;
```

如果 `fullCapabilityRequested`，调用 `runFullCapabilityMvpPipeline`。

否则保持现有单能力逻辑。

### 输出

输出目录仍由现有 `writeKnowledgePackage` 生成：

```text
bootstrap-knowledge/
├── catalog.yaml
├── objects/
├── views/capabilities/
├── evidence/index.jsonl
├── reports/
│   ├── generation.json
│   ├── capability-inventory.json
│   └── capabilities/
└── debug/
```

MVP 不要求完整 `maps/`。

## 验证方式

禁止写任何单元测试代码。

只做真实项目验证：

```bash
npm run build
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --knowledge capability --out D:\tmp\music-education-app-capability-mvp --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

检查：

```powershell
Get-ChildItem D:\tmp\music-education-app-capability-mvp\bootstrap-knowledge\views\capabilities -Filter *.md
Get-Content D:\tmp\music-education-app-capability-mvp\bootstrap-knowledge\reports\capability-inventory.json
Get-Content D:\tmp\music-education-app-capability-mvp\bootstrap-knowledge\catalog.yaml
```

验收标准：

- 至少生成 6 个 capability Markdown。
- 输出不是单个能力。
- 不按 Controller 方法一比一生成。
- 失败能力记录在 `capability-inventory.json`，不阻断其他能力。
- Markdown 至少能说明业务目标、当前行为、代码锚点、验证或未知项。

## 非目标

- 不实现自动业务聚类。
- 不实现完整 `maps/`。
- 不实现完整 `activation` catalog。
- 不做跨能力对象去重优化。
- 不扩展对象类型。
- 不实现 freshness。
