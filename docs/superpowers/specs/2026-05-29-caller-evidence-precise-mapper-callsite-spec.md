# Caller Evidence 精确 Mapper Call Site 修复 Spec

## 背景

当前 `src/mybatis/caller-evidence.ts` 会为 MyBatis mapper 方法解析 Java 调用方证据，并把调用方法、调用片段、附近注释和业务 hints 交给 DB 对象生成 prompt。DB 字段中文描述会使用这些 caller evidence 做业务语义消歧。

现有实现中 `buildCallMatcher()` 使用了过宽的匹配分支：

```ts
\\w+\\.methodId(
```

这会在同一个 Java 文件 import 了目标 mapper 时，把任意对象上的同名方法调用当成 mapper 调用。例如：

```java
Object cached = cache.selectById(id);
Object user = userMapper.selectById(id);
```

当前逻辑可能先命中 `cache.selectById(id)`，导致 `callerMethod`、`callSiteSnippet`、附近注释和业务 hints 偏到错误业务上下文。该错误会污染 DB 知识生成，属于 evidence 质量问题。

## 目标

修复 caller evidence 的 call site 识别逻辑，使其优先且默认只匹配确认属于目标 mapper 的变量或类名调用，并在真实项目 `D:\workspace\other_project\music-education-app` 上验证生成结果。

## 非目标

- 不重构整个 Java 解析器。
- 不引入 Java AST 解析依赖。
- 不改变 DB object schema。
- 不改变 LLM prompt 的主要结构。
- 不实现完整 Spring bean 注入解析，只做足够可靠的 mapper 变量名识别。

## 设计要求

### 1. Mapper 变量名必须来自证据

`findCallSite()` 不应再使用任意 `\w+.methodId(` 作为同等优先级匹配。

允许的 mapper receiver 来源：

1. Mapper 类名的小驼峰形式：

```text
UserMapper -> userMapper
QuestionMapper -> questionMapper
```

2. 字段注入或字段声明：

```java
private UserMapper userMapper;
@Autowired
private QuestionMapper questionMapper;
```

3. 构造器或方法参数：

```java
public QuestionService(QuestionMapper questionMapper) { ... }
public void run(QuestionMapper mapper) { ... }
```

4. 类静态调用或少见显式类名调用：

```java
UserMapper.selectById(...)
```

### 2. Fallback 必须降级而不是污染

如果无法识别 mapper receiver：

- 可以不返回 `callSiteSnippet`
- 可以保留 `callerClass`
- `callerMethod` 不应基于不确定 call site 伪造
- 不应使用任意同名方法生成业务上下文

这符合项目原则：不能把推断伪装成事实。

### 3. 多个同名调用时必须选 mapper 调用

如果同一方法或同一文件里同时存在非 mapper 同名调用和 mapper 调用：

```java
cache.selectById(id);
questionMapper.selectById(id);
```

结果必须命中 `questionMapper.selectById(id)`。

### 4. 真实项目验证是强制项

完成后必须在真实项目下验证：

```text
D:\workspace\other_project\music-education-app
```

验证重点：

- 能解析 MyBatis caller evidence。
- 生成 prompt 中的 `callerEvidence.callSiteSnippet` 不应来自明显非 mapper receiver。
- 针对 DB/MyBatis 生成流程，生成的 DB 对象仍满足：
  - 每个字段有 `description_zh`
  - 每个字段有 `description_source`
  - `description_source` 只能是 `comment` 或 `inferred`

## 验收标准

1. 新增回归测试覆盖“非 mapper 同名调用在前，mapper 调用在后”的场景。
2. 新增测试覆盖字段声明或参数名不是默认小驼峰时仍能命中 mapper 调用。
3. `npm run typecheck` 通过。
4. `npm test` 通过。
5. 在 `D:\workspace\other_project\music-education-app` 上运行真实验证命令并记录结果。
6. 验证报告中必须明确列出至少一个 caller evidence 的 `callSiteSnippet`，且 receiver 是 mapper 变量或 mapper 类名。

## 建议实现

在 `src/mybatis/caller-evidence.ts` 中拆出：

```ts
function collectMapperReceivers(content: string, mapperClass: string): string[]
function buildPreciseCallMatcher(receivers: string[], mapperClass: string, methodId: string): RegExp | null
function findCallSite(content: string, mapperClass: string, methodId: string): { index: number; snippet: string } | null
```

`collectMapperReceivers()` 至少识别：

- 默认小驼峰变量名
- 字段声明里的变量名
- 参数声明里的变量名
- mapper 类名

`findCallSite()` 只使用这些 receiver 匹配，不再匹配任意 `\w+`。

## 风险

- Java 语法解析仍是正则级别，不能覆盖所有复杂语法。
- 局部变量赋值、泛型、链式代理等场景可能仍缺证据。
- 但本次修复的目标是防止错误 evidence 污染，而不是覆盖所有可能调用。

