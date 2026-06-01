# AGENTS.md

## 项目定位

这是一个独立 CLI 项目，用于给其他代码仓库生成 `bootstrap-knowledge/` 知识包。

核心原则：

- 项目内嵌的解析与索引引擎负责提供结构化代码图谱和执行流证据
- 程序负责控制输入输出结构、schema 校验和落盘
- `LLM` 只负责生成知识内容，不负责决定结构

## 当前架构

初始化阶段采用如下目录边界：

```text
src/
├── cli/            命令行入口与子命令注册
├── config/         配置与环境变量解析
├── engine/         内嵌解析、索引、查询底座
├── query/          查询与上下文扩展
├── mybatis/        MyBatis 解析与 SQL / 表证据提取
├── knowledge/      知识生成主流程协调
├── shared/         通用工具与错误类型
├── schemas/        运行时 schema 定义
├── slicing/        切片发现与计划构建
├── evidence/       证据提取与归一化
├── generation/     LLM 调用与对象生成
└── packaging/      知识包渲染与写入
```

## 代码规范

### 结构边界

- 不要在 `cli/` 写业务逻辑
- 不要让 `generation/` 直接操作文件系统
- 不要绕过 `query/`、`engine/`、`mybatis/` 直接在上层拼底层索引或 SQL 解析逻辑
- 所有外部边界数据必须先做 schema 校验
- 不要使用 `git worktree` 形式开发代码，统一直接在当前工作区修改

### 命名

- 目录名使用小写英文
- TypeScript 文件使用 `kebab-case`
- 变量和函数使用 `camelCase`
- 类型、接口、schema 常量使用 `PascalCase`
- 模块级常量使用 `UPPER_SNAKE_CASE`

### 类型与复杂度

- 项目必须保持 `strict` TypeScript
- 禁止无约束 `any`
- 函数参数建议不超过 `7`
- 圈复杂度建议不超过 `15`
- 重复字面量优先提取为常量或小型 helper

### 注释

- 注释统一使用简体中文
- 注释重点写"为什么这样做"
- 不写显而易见的注释
- `TODO`、`FIXME`、`HACK` 使用标准前缀

### LLM 约束

- 不能让模型直接扫整个仓库作为主输入
- 不能让模型决定对象 ID、路径和对象类型
- 不能把推断伪装成事实
- 不能吞掉 `OPEN`

### DB 约束

- 每张表一个 `DB` 对象
- 每个字段都必须有：
  - `description_zh`
  - `description_source`
- `description_source` 只能是：
  - `comment`
  - `inferred`

## 最低交付校验

提交前至少运行：

```bash
npm run typecheck
npm run build
npm test
```

## 提交规范

- 使用 Conventional Commits
- 对结构、schema、命令面改动，要同步更新文档

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ai-knowledge** (12929 symbols, 16681 relationships, 236 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/ai-knowledge/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ai-knowledge/clusters` | All functional areas |
| `gitnexus://repo/ai-knowledge/processes` | All execution flows |
| `gitnexus://repo/ai-knowledge/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
