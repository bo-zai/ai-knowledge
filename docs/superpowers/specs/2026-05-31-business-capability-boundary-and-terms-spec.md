# Business Capability Boundary And Terms Spec

## 背景

`generate-capability` 已经可以在真实 Java/Spring/MyBatis 项目上生成 `bootstrap-knowledge/` 知识包，并且上一轮 target-aware ranking 已经解决了 AOP/RateLimit 作为主流程证据的问题。

真实验证命令：

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --verbose
```

当前输出：

```text
Generated 10 files for capability: CAP-MYBATIS-EVIDENCE-PROCESSING
Object types: CAP, FLOW, MOD, CON, VER, OPEN, OPEN
```

当前主 evidence 已经基本命中业务代码：

```text
FLOW: check prod stock and create order -> add add -> find by id
GoodsService.java
OrderGoodsService.java
```

但知识包仍然不符合“业务功能逆向生成知识”的核心目标：

1. `CAP` 仍被命名为 `MyBatis evidence processing`，这是技术处理能力，不是业务能力。
2. capability view 的 `Terms` 仍是 `(none)`，缺少 AI 消费用的业务术语层。
3. 当前只有一个由所有 target terms 拼出的候选，不能清楚表达 business boundary。
4. Windows 路径下 role 判断使用 `/controller/`、`/service/`，role 元数据会丢失。
5. 输出目录不会清理旧文件，重复验证后会残留过期对象，例如 `CON-LOGAOP.yaml`。

本轮修复目标是让生成结果从“技术证据包”升级为“业务能力知识包 MVP”。

## 目标

在真实项目 `D:\workspace\other_project\music-education-app` 上，针对：

```text
--terms course,goods,order,mybatis
--paths src/main/java,src/main/resources,src/test
```

生成的知识包必须满足：

1. capability id/name 不再是 `CAP-MYBATIS-EVIDENCE-PROCESSING`。
2. CAP 的 canonical term 必须来自业务域证据，而不是来自 `mybatis`、`db`、`sql` 等技术上下文词。
3. capability view 的 `Terms` 必须至少包含与 `course`、`goods`、`order` 中命中的业务术语相关的 TERM 对象。
4. 主 FLOW、MOD、CON、VER 必须继续优先使用业务相关 evidence。
5. 输出目录必须是本次生成结果，不允许保留上一次生成的过期对象。
6. 非 OPEN 对象的 `evidencePrimary` 必须都能在 `evidence/index.jsonl` 中找到。

## 非目标

本轮不做以下内容：

- 不做 full repo 多 capability 自动聚类。
- 不引入 Java AST parser。
- 不做完整调用图。
- 不引入 LLM 作为必需依赖。
- 不改变 `bootstrap-knowledge/` 顶层包格式。
- 不让 CLI 承担业务逻辑。

说明：长期方案应支持一个仓库生成多个业务 capability，但本轮先保证单 target capability 是业务命名、业务术语、业务 evidence，而不是技术命名。

## 业务能力边界规则

### 1. Target Terms 分类

`targetTerms` 必须被拆成两类：

#### Business Terms

用于决定 capability 名称、TERM 对象、业务边界。

示例：

```text
course
goods
order
student
teacher
member
coupon
cart
pay
refund
```

#### Technical Context Terms

只能作为 evidence 类型/技术上下文加权，不能单独决定 capability 名称。

初始集合：

```text
mybatis
mapper
xml
sql
db
database
table
schema
knowledge
evidence
capability
bootstrap
```

对于输入：

```text
course,goods,order,mybatis
```

业务 terms 是：

```text
course, goods, order
```

技术 context terms 是：

```text
mybatis
```

### 2. Capability Name 生成

不能再使用如下硬编码：

```ts
if (targetTerms.includes('mybatis')) {
  nameCandidates.push('MyBatis evidence processing');
}
```

必须从高相关业务 evidence 中生成名称。

推荐规则：

1. 从 target terms 中过滤掉 technical context terms。
2. 统计高相关 evidence 的 `matchedTerms`。
3. 优先选择命中最多、且同时出现在 entry/behavior/data/module 中的业务 terms。
4. 如果 `goods` 和 `order` 同时在 top behavior 或 top entry 中出现，则 capability 名称优先包含 `Goods Order`。
5. 如果 `course`、`goods`、`order` 都有强 evidence，可以使用组合名称 `Course Goods Order capability`。
6. 如果只有技术 context terms，没有业务 terms，则 fallback 为 `<Best evidence name> capability`，不能 fallback 为 `<tech> evidence processing`。

真实项目可接受名称示例：

```text
Goods Order capability
Course Goods Order capability
Mall Order Goods capability
```

不可接受名称：

```text
MyBatis evidence processing
DB knowledge generation
SQL evidence processing
Mapper knowledge generation
```

### 3. TERM 对象生成

当前 skeleton claims 没有 TERM，导致 capability view 中：

```text
## Terms
- (none)
```

本轮必须生成 deterministic TERM claims。

TERM 来源：

1. business target terms。
2. 高相关 entry/behavior/data/validation evidence 的 `matchedTerms`。
3. 高相关 data contract 名称中的业务词，例如 `OrderGoodsVO` -> `order`, `goods`。

每个 TERM 对象必须：

- type: `TERM`
- description: 描述该术语在本 capability 中的证据来源，而不是百科解释。
- evidencePrimary: 至少一个非 OPEN evidence ref。
- metadata 至少包含：

```yaml
canonicalTerm: goods
source: target_term | evidence_match | data_contract
matchedEvidenceCount: 3
```

### 4. Windows 路径归一化

所有路径角色判断必须先做归一化：

```ts
function normalizePathForMatch(input: string): string {
  return input.replace(/\\/g, '/').toLowerCase();
}
```

以下判断不能直接对 Windows `path.relative()` 结果使用 `/controller/`：

```ts
relative.includes('/controller/')
relative.includes('/service/')
relative.includes('/mapper/')
```

必须改为：

```ts
const normalizedRelative = normalizePathForMatch(relative);
normalizedRelative.includes('/controller/')
```

### 5. 输出目录清理

`writeCapabilityKnowledgePackage()` 写入前必须清理：

```text
<outputRoot>/bootstrap-knowledge
```

安全要求：

1. 只能删除 `path.resolve(outputRoot, 'bootstrap-knowledge')`。
2. 不能删除 `outputRoot` 本身。
3. 如果 resolved path 的 basename 不是 `bootstrap-knowledge`，必须抛错。
4. 使用 `fs.rm(packageRoot, { recursive: true, force: true })` 前必须做 path 校验。

清理后，真实验证目录中不能残留旧对象，例如上一轮的：

```text
objects/contracts/CON-LOGAOP.yaml
objects/modules/MOD-SRC-MAIN-JAVA.yaml
```

除非它们被本次 `catalog.yaml` 显式引用。

## 生成链路要求

目标链路：

```text
CLI
-> runCapabilityKnowledgePipeline
-> discoverCapabilities
   -> scan signals
   -> classify target terms
   -> rank target evidence
   -> derive business capability hints
-> buildEvidenceBundle
-> buildSkeletonClaims
   -> CAP
   -> TERM
   -> FLOW
   -> MOD
   -> CON
   -> VER
   -> OPEN
-> assembleCapabilityKnowledgeObjects
-> buildCapabilityKnowledgeFiles
-> writeCapabilityKnowledgePackage
   -> clean bootstrap-knowledge
   -> write new package
```

## 真实项目验收

必须在真实项目运行：

```bash
npm run typecheck
npm run build
npm test
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --verbose
```

验收检查：

```bash
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\catalog.yaml
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\views\capabilities\*.md
Get-Content D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\evidence\index.jsonl | Select-Object -First 80
rg -n "MYBATIS-EVIDENCE-PROCESSING|MyBatis evidence processing|CON-LOGAOP|MOD-SRC-MAIN-JAVA|LogAop|RateLimitAspect" D:\tmp\music-education-app-capability-validation\bootstrap-knowledge
rg -n "TERM-|Course|Goods|Order|goods|order|course" D:\tmp\music-education-app-capability-validation\bootstrap-knowledge
```

必须满足：

1. 命令成功。
2. `catalog.yaml` 中 capability id 不包含 `MYBATIS-EVIDENCE-PROCESSING`。
3. CAP description 不包含 `MyBatis evidence processing is a discovered business capability`。
4. capability view `Terms` 不是 `(none)`。
5. 至少生成 2 个 TERM 对象。
6. 主 FLOW evidence 仍命中 `GoodsService.java` / `OrderGoodsService.java` / `CourseService.java` / Controller / Mapper 中的至少一个。
7. 主 CON evidence 不能是 `LogAop`、`RateLimitAspect`。
8. 输出目录中不残留未被 catalog 引用的 `CON-LOGAOP.yaml` 或 `MOD-SRC-MAIN-JAVA.yaml`。
9. 所有非 OPEN 对象的 `evidencePrimary` ref 都能在 `evidence/index.jsonl` 中找到。

## 单元测试要求

至少新增或更新以下测试：

1. `discoverCapabilities()` 将 `mybatis` 分类为 technical context，不作为 capability name。
2. `discoverCapabilities()` 对 `course,goods,order,mybatis` 生成业务名称。
3. Windows 反斜杠路径下 role 识别正常。
4. `buildSkeletonClaims()` 生成 TERM claims。
5. `assembleCapabilityKnowledgeObjects()` 将 TERM metadata 写入对象。
6. `writeCapabilityKnowledgePackage()` 写入前清理旧 `bootstrap-knowledge`。
7. integration fixture 确认 view 中 Terms 不为空，且 capability id 不含 `MYBATIS-EVIDENCE-PROCESSING`。

## 最终回复要求

Claude Code 完成后必须在最终回复中列出：

```text
Generated capability:
Capability name contains technical-only term: yes/no
TERM objects:
Selected FLOW evidence:
Selected CON evidence:
Selected MOD evidence:
Stale LogAop object remains: yes/no
Evidence refs verified: yes/no
Real project command:
```

