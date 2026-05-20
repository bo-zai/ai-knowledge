# AGENTS.md

## 项目定位

这是一个独立 CLI 项目，用于给其他代码仓库生成 `bootstrap-knowledge/` 知识包。

核心原则：

- `GitNexus` 负责提供结构化代码图谱和执行流证据
- 程序负责控制输入输出结构、schema 校验和落盘
- `LLM` 只负责生成知识内容，不负责决定结构

## 当前架构

初始化阶段采用如下目录边界：

```text
src/
├── cli/            命令行入口与子命令注册
├── config/         配置与环境变量解析
├── shared/         通用工具与错误类型
├── schemas/        运行时 schema 定义
├── gitnexus/       GitNexus 交互适配层
├── slicing/        切片发现与计划构建
├── evidence/       证据提取与归一化
├── generation/     LLM 调用与对象生成
└── packaging/      知识包渲染与写入
```

## 代码规范

### 结构边界

- 不要在 `cli/` 写业务逻辑
- 不要让 `generation/` 直接操作文件系统
- 不要绕过 `gitnexus/` 适配层直接调用 GitNexus
- 所有外部边界数据必须先做 schema 校验

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