# Bootstrap Knowledge Generator Code Standards

**Date:** 2026-05-20

**Scope:** This standard applies to the standalone `repo-knowledge-generator` CLI project described in the approved design and implementation plan.

## 来源与适配原则

本规范借鉴自以下 `CoPaw` 资产：

- `AGENTS.md`
- `CLAUDE.md`
- `.pre-commit-config.yaml`
- `CONTRIBUTING_zh.md`

但只保留对当前项目有直接价值的规则，明确排除以下无关内容：

- Python 代码风格与 Python 专属工具链
- 多租户、工作区、Console、后端服务等业务私有约束
- 与当前 CLI 项目无关的部署、平台和产品流程

本规范的目标不是照搬母项目，而是形成**适用于 TypeScript / Node.js CLI 项目**的最小强约束集合。

## 代码组织原则

### 单一职责

- 每个目录只承担一类职责：
  - `cli/` 只做命令行入口和参数调度
  - `gitnexus/` 只做 GitNexus 交互
  - `evidence/` 只做证据提取与归一化
  - `generation/` 只做 LLM 调用和对象 draft 生成
  - `packaging/` 只做知识包渲染与写入
  - `schemas/` 只做 runtime schema
- 不要在 `cli/` 写业务逻辑。
- 不要在 `generation/` 里直接操作文件系统。
- 不要在 `packaging/` 里拼装原始 GitNexus 查询。

### 边界清晰

- 所有外部边界数据必须经过 schema 校验：
  - CLI 参数
  - GitNexus 查询结果
  - LLM 输出
  - `manifest.yaml` / `catalog.yaml`
- 不允许跨模块直接绕过适配层：
  - 只有 `gitnexus/` 可以直接调用 `gitnexus` 命令
  - 只有 `generation/llm-client.ts` 可以直接调用模型 API

### 稳定优先

- `v1` 的首要目标是输出结构稳定，不是文案华丽。
- 只要结构、证据和约束能程序化，就不要交给模型自由发挥。

## 命名规范

### 文件与目录

- 目录名使用小写英文。
- TypeScript 源文件统一使用 `kebab-case`：
  - `ensure-index.ts`
  - `build-slice-plan.ts`
  - `render-object.ts`
- 测试文件以 `.test.ts` 结尾。

### 标识符

- 变量、函数使用 `camelCase`
- 类型、接口、类、schema 常量使用 `PascalCase`
- 模块级常量使用 `UPPER_SNAKE_CASE`
- 对象类型值、枚举值使用设计中约定的固定字符串，不自行扩展

### ID 规则

- 知识对象 ID 必须稳定、可预测、可重建
- 采用固定前缀：
  - `TERM-`
  - `CON-`
  - `FLOW-`
  - `MOD-`
  - `OPEN-`
  - `OWN-`
  - `VER-`
  - `DB-`
- 不允许在不同运行中用随机值生成对象 ID

## TypeScript 规范

### 类型安全

- 项目必须启用 `strict` 模式。
- 禁止无约束 `any`。
- 不确定的外部输入一律先用 `unknown`，再收窄。
- 所有对象 schema、evidence bundle、catalog、manifest 必须使用 `zod` 做 runtime 校验。
- 对象类型优先使用判别联合，而不是宽松对象。

### 函数与复杂度

- 普通函数建议参数不超过 `7` 个。
- 普通函数圈复杂度建议不超过 `15`。
- 超过时优先拆 helper，不要继续堆条件分支。
- 重复出现的错误文案、状态文案、字段描述标签，优先提取为模块级常量或小型 helper。

### 副作用控制

- 模块顶层禁止执行重副作用逻辑：
  - 禁止模块加载时访问文件系统
  - 禁止模块加载时调用 GitNexus
  - 禁止模块加载时初始化模型客户端
- 所有副作用必须显式发生在命令执行链里。

## 注释与文档规范

### 语言

- 注释、说明性文档、TODO/FIXME/HACK 统一使用简体中文。
- 代码标识符、文件名、类型名保持英文。

### 注释时机

以下情况必须写注释：

- 非直观的边界约束
- 证据优先级或冲突合并规则
- LLM 输出修复策略
- DB schema 推断降级规则
- 为了稳定性而做的特殊裁剪或 fallback

### 注释内容

- 注释优先解释 **为什么这样做**
- 避免重复代码表面含义
- 不要写“定义变量”“循环遍历”这类无信息量注释

### 特殊标记

- `TODO:` 待完成项
- `FIXME:` 已知问题
- `HACK:` 临时方案或权宜之计

这些标记必须直接描述问题本体，不加空话。

## LLM 相关规范

### Prompt 与生成

- Prompt 必须由程序构造，不允许在业务逻辑中散落拼接长字符串。
- 所有对象生成都必须走：
  - 受控 evidence input
  - 固定 output schema
  - 结构校验
  - 语义校验
- 模型只负责生成内容，不负责决定结构、路径、ID、对象类型。

### 禁止事项

- 禁止让模型直接读取整个仓库源码作为主输入
- 禁止让模型生成最终 markdown 结构后直接落盘
- 禁止把模型推断伪装成确定事实
- 禁止在没有证据时跳过 `OPEN`

## DB 对象专项规范

- 每张表一个 `DB` 对象文件。
- 每个字段必须有：
  - `description_zh`
  - `description_source`
- `description_source` 只能是：
  - `comment`
  - `inferred`
- 表结构优先级必须固定：
  - `DDL > migration > ORM > SQL > inferred`
- 遇到 schema 冲突时：
  - 不静默覆盖
  - 要么记录冲突
  - 要么转成 `OPEN`

## 错误处理规范

- 使用统一错误类型，例如 `AppError`
- 错误必须带机器可识别的 `code`
- CLI 层负责把错误映射到稳定的退出行为
- 禁止裸 `catch` 后静默吞掉异常
- 可部分成功的流程必须在报告里明确列出失败对象

## 测试规范

### 测试框架

- 统一使用 `vitest`

### 测试分层

- `tests/unit/`
  - 纯函数、schema、adapter、builder、renderer
- `tests/integration/`
  - CLI 命令、fixture repo、端到端生成行为

### 覆盖要求

新增或修改以下内容时必须补测试：

- object schema
- evidence merge 规则
- GitNexus fallback 逻辑
- LLM 输出解析与修复
- DB 字段描述来源规则
- package 渲染与 catalog 生成

### 最低本地校验

提交前至少运行：

```bash
npm run typecheck
npm run build
npm test
```

## 质量门禁

虽然 `v1` 不强制先实现完整 pre-commit 体系，但代码必须满足与 `CoPaw` 同类的最小质量门禁思想：

- YAML / JSON / TOML 语法正确
- 不提交尾随空格
- 不提交私钥或敏感密钥
- 类型检查必须通过
- 测试必须通过

如果后续为该项目引入 `.pre-commit-config.yaml`，至少应覆盖：

- `check-yaml`
- `check-json`
- `check-toml`
- `trailing-whitespace`
- `detect-private-key`
- TypeScript type check

## 提交与文档规范

- 提交信息使用 Conventional Commits：
  - `feat(...)`
  - `fix(...)`
  - `docs(...)`
  - `refactor(...)`
  - `test(...)`
  - `chore(...)`
- 对外行为、目录结构、schema、命令面发生变化时，必须同步更新：
  - `design spec`
  - `implementation plan`
  - `README`（如适用）

## 实现时的强约束清单

Claude Code 或其他实现者在开发本项目时，必须优先遵守以下约束：

1. 程序控制结构，模型只填内容。
2. 所有外部边界都必须先做 schema 校验。
3. `OPEN` 是一等输出，不能因为想“更完整”而省略。
4. `DB` 字段描述必须带来源标记。
5. 输出知识包必须可重复生成，避免随机性命名和漂移。
6. 代码组织遵循当前批准的目录边界，不把逻辑堆回 `cli/`。
