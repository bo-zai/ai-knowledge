# Target-Aware 业务功能知识质量修复 Spec

## 背景

当前 `generate-capability` 已经能在真实 Java/Maven/MyBatis 项目下生成 capability-oriented 知识包：

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --verbose
```

生成结果：

```text
Generated 9 files for capability: CAP-MYBATIS-EVIDENCE-PROCESSING
Object types: CAP, FLOW, MOD, CON, VER, OPEN, OPEN
```

但输出语义质量不达标：

- `CAP` 是 MyBatis evidence processing
- `FLOW` 来自 `LogAop` / `RateLimitAspect`
- `CON` 是 `CON-LOGAOP`
- `MOD` 是整个 `src/main/java`

这说明当前实现只是“从路径抽取一批信号后套 skeleton”，还不是我们讨论的“从业务功能代码逆向生成知识”。核心缺口是：

1. discovery 没有按目标术语进行 ranking/filtering。
2. skeleton claim 总是取第一个 flow/module/contract/validation。
3. 横切模块 AOP/config/interceptor/job 等容易排在业务模块前面。
4. evidence ref 没有可回溯 source map。

## 目标

让 `generate-capability` 在真实项目 `D:\workspace\other_project\music-education-app` 上，针对：

```text
--terms course,goods,order,mybatis
--paths src/main/java,src/main/resources,src/test
```

生成的 capability 知识包语义上对齐目标业务域，至少优先包含 Course/Goods/Order/MyBatis 相关 Controller/Service/Mapper/XML/Test 证据，而不是 AOP/Config/Util 等横切模块。

## 非目标

- 不做 full repo 多 capability 聚类。
- 不引入 Java AST parser。
- 不做完整调用图。
- 不做 LLM 生成业务摘要。
- 不要求一次生成多个 CAP；MVP 仍可生成一个 target capability。

## 质量要求

### 1. Target-aware Signal Ranking

所有信号必须计算 target relevance：

```ts
targetRelevance: number
```

匹配来源：

- 文件路径命中 target terms
- 类名/方法名/mapper namespace 命中 target terms
- MyBatis statement id / SQL table 命中 target terms
- 测试名命中 target terms
- 相关模块角色是 Controller/Service/Mapper/XML

### 2. 横切模块降权

以下模块默认降权，除非 target terms 明确命中：

```text
aop
aspect
config
interceptor
filter
util
utils
common
job
listener
event
bootstrap
security
auth
logging
log
rateLimit
```

例如 `LogAop`、`RateLimitAspect` 不应在 `course,goods,order,mybatis` 目标下成为 FLOW 或 CON 的首选证据。

### 3. EvidenceBundle 必须排序后再截断

`buildEvidenceBundle()` 中：

- `entryPoints`
- `behaviorSlices`
- `dataContracts`
- `moduleSurfaces`
- `validationAnchors`
- `flowTraces`

必须使用 relevance 排序后再取 top N。

### 4. Skeleton Claims 必须选最相关证据

`buildSkeletonClaims()` 不能无脑取 `[0]`，除非 `[0]` 已经是排序后的最高相关项。

优先级：

- CAP：优先 entry/behavior/contract 中 target relevance 最高的 evidence
- FLOW：优先 target 相关 controller/service/mapper 方法组成的 flow
- MOD：优先具体业务模块路径，不是整个 `src/main/java`
- CON：优先 MyBatis XML / Mapper / DTO / Request / VO / Entity，而不是 AOP 类
- VER：优先 target 相关测试

### 5. Module Surface 粒度收敛

真实项目中 `MOD-SRC-MAIN-JAVA` 太粗。至少要按二级/三级目录或角色拆分：

```text
src/main/java/.../controller
src/main/java/.../service
src/main/java/.../mapper
src/main/resources/mapper
src/test/...
```

针对 `course,goods,order,mybatis`，优先生成：

```text
MOD-COURSE
MOD-GOODS
MOD-ORDER
MOD-MYBATIS-MAPPER
```

MVP 只需要生成一个最相关 MOD，但不能是整个 `src/main/java`。

### 6. Evidence Source Map

输出包必须包含：

```text
bootstrap-knowledge/evidence/index.jsonl
```

每行记录：

```json
{
  "ref": "evidence://behavior/BEH-001",
  "kind": "behavior",
  "location": "src/main/java/...",
  "name": "getCourseDetail",
  "summary": "..."
}
```

对象中的 `evidencePrimary` 必须能在 `evidence/index.jsonl` 找到对应 ref。

## 真实项目验收

必须在：

```text
D:\workspace\other_project\music-education-app
```

运行：

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --verbose
```

验收条件：

1. 命令成功。
2. 生成 `bootstrap-knowledge/evidence/index.jsonl`。
3. `catalog.yaml` 有 capability routing。
4. capability view 引用 CAP/FLOW/MOD/CON/VER/OPEN。
5. `FLOW` / `CON` / `MOD` 至少一个对象或 evidence source 命中：
   - `Course`
   - `Goods`
   - `Order`
   - `Mapper`
   - MyBatis XML
6. 输出中不应再以 `LogAop`、`RateLimitAspect` 作为首选 `FLOW` 或 `CON`。
7. 非 OPEN 对象的 evidence refs 都能在 `evidence/index.jsonl` 中找到。

## 验收标准

1. 新增 target-aware ranking 单元测试。
2. 新增横切模块降权测试。
3. 新增 Java/MyBatis integration fixture 中 AOP 在前、Course/Goods/Order 在后时仍选择业务证据的测试。
4. 新增 evidence index 输出测试。
5. `npm run typecheck` 通过。
6. `npm run build` 通过。
7. `npm test` 通过。
8. 真实项目验证通过，并在最终回复中列出：

```text
Generated capability:
Selected FLOW evidence:
Selected CON evidence:
Selected MOD evidence:
Evidence index path:
AOP selected as primary: yes/no
```

