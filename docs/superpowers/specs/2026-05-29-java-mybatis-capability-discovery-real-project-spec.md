# Java/MyBatis 业务功能知识真实项目生成 Spec

## 背景

`generate-capability` 已经具备 CLI、skeleton claims、catalog capability mapping 和 capability view 生成能力，但真实项目验证失败：

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms db,mybatis,knowledge --paths src/main,src/test --out D:\tmp\music-education-app-capability-validation --verbose
```

输出：

```text
No capability knowledge files generated
```

根因是 `src/slicing/capability-discovery.ts` 当前只扫描：

```ts
/\.(ts|js|tsx|jsx)$/
```

而强制验证项目 `D:\workspace\other_project\music-education-app` 是 Maven/Java 项目，主要代码位于：

```text
src/main/java
src/main/resources
src/test
```

因此当前实现只能在 TS fixture 中生成 capability 知识，不能在真实 Java/MyBatis 项目中逆向生成业务功能知识。

## 目标

让 `generate-capability` 能在真实 Java/Maven/Spring/MyBatis 项目 `D:\workspace\other_project\music-education-app` 下生成 AI-first、evidence-backed、capability-oriented 的业务功能知识包。

必须满足：

```text
真实 Java 项目
-> 发现业务功能候选
-> 构建 EvidenceBundle
-> skeleton/LLM claim
-> 生成 CAP / FLOW / MOD / CON / VER / OPEN
-> 写入 bootstrap-knowledge/catalog.yaml、objects、views/capabilities
```

## 非目标

- 不引入 Java AST 解析器。
- 不重写已有 DB/MyBatis table evidence 生成流程。
- 不做 full repo 多 capability 自动聚类。
- 不做 OpenSpec/spec-kit/Kiro adapter。
- 不要求业务功能名称完美，但必须来自真实 Java/MyBatis/Spring 证据。

## 必须支持的 Java 项目信号

### 1. 文件扫描

`capability-discovery` 必须扫描：

```text
.ts .js .tsx .jsx
.java
.xml
.yml .yaml
.properties
.md .txt
```

其中：

- `.java` 用于 entry/behavior/data/test signals。
- MyBatis `.xml` 用于 data/contract signals。
- 配置文件用于 doc/config signals。
- Markdown/txt 用于辅助术语，不单独作为 fact。

### 2. EntrySignal

Java/Spring 项目至少识别：

```java
@RestController
@Controller
@RequestMapping
@GetMapping
@PostMapping
@PutMapping
@DeleteMapping
@PatchMapping
@Service
@Component
@Scheduled
```

输出应包含：

- kind: `http` / `handler` / `job` / `service`
- location
- name
- signature 或 route 信息

### 3. BehaviorSignal

Java 方法识别：

```java
public User getUser(...)
private void updateOrder(...)
protected List<Course> queryCourseList(...)
```

重点识别动词：

```text
get query find list search load save create add insert update modify delete remove parse build generate validate handle process pay refund order
```

### 4. DataSignal

Java/MyBatis 项目至少识别：

- Java class/interface/enum
- DTO/VO/BO/Entity/Mapper/Service/Controller 类名
- Java 字段
- MyBatis mapper XML statement：
  - `<select>`
  - `<insert>`
  - `<update>`
  - `<delete>`
  - namespace
  - statement id
  - SQL table names if easy to extract

### 5. TestSignal

识别 Java 测试：

```java
@Test
class XxxTest
void shouldDoSomething()
```

以及现有 TS/JS tests。

### 6. DocSignal

识别：

```text
AGENTS.md
CLAUDE.md
README.md
HELP.md
需求文档.txt
doc/**
```

DocSignal 只用于术语、命名、OPEN 线索。不能单独生成 fact。

## Empty Generation 规则

`generate-capability` 如果没有生成任何文件，必须失败：

```text
exitCode != 0
```

或者抛出错误：

```text
No capability knowledge files generated for target repository
```

只有显式 `--allow-empty` 才允许成功空输出。本次不要求实现 `--allow-empty`。

## 输出验收

真实项目命令示例：

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-validation --verbose
```

必须生成：

```text
D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\catalog.yaml
D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\views\capabilities\CAP-*.md
D:\tmp\music-education-app-capability-validation\bootstrap-knowledge\objects\capabilities\CAP-*.yaml
```

至少包含 5 类对象：

```text
CAP
FLOW
MOD
CON
VER
OPEN
```

如果真实项目缺少测试证据，VER 可以来自 deterministic validation anchor，但必须明确 evidence 或 OPEN 限制。

## 方案符合性要求

生成内容必须符合我们讨论的方案：

1. AI-first：不是长篇人类 wiki，而是对象 + view + catalog。
2. Evidence-backed：非 OPEN 对象必须有 evidence refs。
3. Capability-oriented：以 `CAP-*` 为入口组织功能知识。
4. Stage-addressable：对象必须保留 `sddStageUses`。
5. Tool-adaptable：catalog 必须有 `sdd_stage_mapping` 和 capability 路由。
6. Unknown-safe：缺证据的判断进入 OPEN，不伪装成 fact。

## 验收标准

1. Java/Maven/Spring/MyBatis fixture 测试通过。
2. `generate-capability` 空输出时失败。
3. `npm run typecheck` 通过。
4. `npm run build` 通过。
5. `npm test` 通过。
6. 真实项目 `D:\workspace\other_project\music-education-app` 生成成功。
7. 最终回复必须包含真实项目验证摘要：

```text
Real project validated: D:\workspace\other_project\music-education-app
Command used:
Output path:
Generated capability:
Object types:
Catalog capability mapping:
Capability view:
Evidence refs:
```

