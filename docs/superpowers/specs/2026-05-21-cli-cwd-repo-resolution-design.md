# CLI 当前仓库自动解析设计

## 背景

当前 `repo-knowledge-generator` 的 CLI 要求：

- `generate --repo <path>`
- `status --repo <path>`
- `clean --repo <path>`

这和 `GitNexus` 的使用体验不一致。`GitNexus` 默认以当前工作目录为起点解析目标仓库：

- 若命令传入显式路径，则使用显式路径
- 若未传路径，则优先解析 `process.cwd()` 所在的 git root
- 若无法解析 git root，则再决定是否报错或退回到当前目录

用户希望本项目也具备类似体验，便于在目标仓库目录下直接执行命令，而不必重复填写 `--repo`。

## 目标

让以下命令都支持“默认当前仓库”：

- `generate`
- `status`
- `clean`

并且满足：

- 继续兼容现有 `--repo <path>` 用法
- 支持像 `GitNexus` 一样，在目标仓库目录下直接执行
- 不改变知识包输出格式
- 不改变 DB 生成逻辑

## 非目标

本次不做：

- 修改知识对象 schema
- 修改 LLM 调用逻辑
- 修改日志结构
- 修改 `bootstrap-knowledge/` 目录结构
- 改写现有脚本为纯位置参数模式

## 设计原则

### 1. 向后兼容优先

当前所有显式传 `--repo` 的命令和脚本必须继续可用。

因此本次不移除 `--repo`，而是把它从“必填”改成“可选覆盖项”。

### 2. 当前工作目录优先服务手动使用

用户手动使用时，应允许：

```powershell
cd D:\workspace\other_project\music-education-app
node D:\workspace\ai-wiki\dist\cli\index.js generate --llm-config D:\workspace\ai-wiki\llm.config.json
```

而不必再手动写：

```powershell
--repo D:\workspace\other_project\music-education-app
```

### 3. 路径解析规则必须统一

`generate`、`status`、`clean` 不能各自实现一套 repo 推断逻辑。

应提取统一的 repo 解析函数。

## 方案选择

### 方案 A：只保留 `--repo`

- 优点：实现最简单
- 缺点：不满足用户目标

不采用。

### 方案 B：改成纯位置参数 `[path]`，删除 `--repo`

- 优点：和 `GitNexus analyze [path]` 更像
- 缺点：会破坏现有调用方式，兼容性差

不采用。

### 方案 C：同时支持 `--repo` 和可选位置参数，并允许默认当前仓库

- 优点：
  - 兼容现有调用
  - 体验接近 `GitNexus`
  - 便于后续逐步收敛 CLI 风格
- 缺点：
  - 需要定义清晰优先级

采用本方案。

## 命令面设计

### generate

从当前：

```text
generate --repo <path>
```

调整为：

```text
generate [path]
```

并继续支持：

```text
generate --repo <path>
```

### status

从当前：

```text
status --repo <path>
```

调整为：

```text
status [path]
```

并继续支持：

```text
status --repo <path>
```

### clean

从当前：

```text
clean --repo <path>
```

调整为：

```text
clean [path]
```

并继续支持：

```text
clean --repo <path>
```

## 目标仓库解析规则

新增统一规则：

1. 若提供 `--repo <path>`，使用 `--repo`
2. 否则若提供位置参数 `[path]`，使用该路径
3. 否则：
   - 若 `process.cwd()` 位于 git 仓库内，则使用 git root
   - 若不在 git 仓库内，则直接使用 `process.cwd()`

这条规则适用于：

- `generate`
- `status`
- `clean`

## 为什么非 git 目录也要支持回退到 cwd

本项目的核心能力是“给一个代码目录生成知识包”，并不天然要求目标目录一定是 git 仓库。

因此与 `GitNexus analyze` 不同，本项目在未显式传路径时，如果当前目录不是 git 仓库，不应直接报错，而应：

- 将 `cwd` 视为目标 repo path

这样更符合知识生成器的定位。

## 新增共享能力

新增一个统一的 repo 路径解析模块，例如：

- `src/shared/resolve-target-repo.ts`

职责：

- 接收：
  - `repoOption?: string`
  - `positionalPath?: string`
  - `cwd?: string`
- 返回：
  - 规范化后的目标 repo 路径
  - 解析来源：
    - `repo_option`
    - `positional_path`
    - `cwd_git_root`
    - `cwd_fallback`

解析来源需要保留，便于：

- debug 日志
- 后续 status 输出
- 单元测试断言

## CLI 接口变化

### Commander 注册层

需要把：

- `requiredOption('--repo <path>')`

改成：

- `option('--repo <path>')`
- 并给命令增加可选位置参数 `[path]`

### generate 的 options 结构

需要从“只接收 `repo`”改成：

- `repo?: string`
- `path?: string`

实际执行前统一走 resolver。

### status / clean 同理

都必须改成通过统一 resolver 获取目标仓库。

## 文档与帮助文本

CLI help 文本需要同步更新：

- 明确说明 path 是可选的
- 明确说明不传时默认当前工作目录
- 明确说明 `--repo` 仍可用，且优先级高于位置参数

README 和手动操作文档也要同步更新。

## 测试与验证要求

本次重点不是大量新增测试，而是保证现有行为不回退。

最低验证包括：

1. `generate --repo <path>` 继续可用
2. `generate <path>` 可用
3. 在目标仓库目录下执行 `generate`，可自动命中当前仓库
4. `status`、`clean` 同样支持默认当前目录
5. 对 `music-education-app` 手工用法可简化为：

```powershell
cd D:\workspace\other_project\music-education-app
node D:\workspace\ai-wiki\dist\cli\index.js generate --llm-config D:\workspace\ai-wiki\llm.config.json
```

## 验收标准

满足以下条件即算完成：

- CLI 不再强制要求 `--repo`
- 仍兼容旧命令格式
- 位置参数和当前目录推断都能正常工作
- `generate/status/clean` 三个命令行为一致
- `music-education-app` 手动执行步骤可简化，不必显式传 `--repo`
