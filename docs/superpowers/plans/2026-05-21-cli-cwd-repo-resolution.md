# CLI 当前仓库自动解析实现计划

## 目标

让 `repo-knowledge-generator` 的：

- `generate`
- `status`
- `clean`

支持像 `GitNexus` 一样默认基于当前工作目录解析目标仓库，同时保留 `--repo` 的兼容支持。

## 实施范围

只做 CLI 仓库路径解析改造，不改：

- DB 知识生成逻辑
- LLM 调用逻辑
- 知识对象 schema
- 日志格式

## Task 1: 新增统一 repo 解析器

新增共享模块，例如：

- `src/shared/resolve-target-repo.ts`

实现统一规则：

1. `--repo` 优先
2. 其次位置参数 `[path]`
3. 其次 `cwd` 的 git root
4. 最后回退到 `cwd`

输出至少包含：

- `repoPath`
- `source`

## Task 2: 改造 CLI 命令注册

修改 `src/cli/index.ts`：

- `generate` 增加可选位置参数 `[path]`
- `status` 增加可选位置参数 `[path]`
- `clean` 增加可选位置参数 `[path]`
- 把 `requiredOption('--repo <path>')` 改为普通 `option('--repo <path>')`

同时保留原有：

- `--repo`
- `--slice`
- `--llm-config`
- 其它命令参数

## Task 3: 改造 generate 主流程

修改 `src/cli/generate.ts`：

- 接收位置参数与可选 `repo`
- 在主流程开始处统一调用 resolver
- 后续一律使用解析后的 `repoPath`

保证：

- 原有显式 `--repo` 不回退
- 单表 DB 生成路径不受影响

## Task 4: 改造 status / clean

修改：

- `src/cli/status.ts`
- `src/cli/clean.ts`

要求：

- 不再假设 `repo` 是必填参数
- 统一调用 resolver
- 行为与 `generate` 保持一致

## Task 5: 更新帮助文案与 README

更新：

- `src/cli/index.ts` 的命令描述
- `README.md`
- [docs/manual-db-generation-music-education-app.md](</D:/workspace/ai-wiki/docs/manual-db-generation-music-education-app.md>)

重点说明：

- `--repo` 可选
- 支持位置参数
- 不传时默认当前工作目录

## Task 6: 最小验证

优先做实际命令验证，不要求补很多测试代码。

至少验证：

1. 旧用法：

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-app --llm-config llm.config.json
```

2. 位置参数用法：

```powershell
node dist/cli/index.js generate D:\workspace\other_project\music-education-app --llm-config llm.config.json
```

3. 当前目录默认用法：

```powershell
cd D:\workspace\other_project\music-education-app
node D:\workspace\ai-wiki\dist\cli\index.js generate --llm-config D:\workspace\ai-wiki\llm.config.json
```

4. `status` 默认当前目录用法

5. `clean` 默认当前目录用法

## Task 7: 完成前验收

完成前至少运行：

```powershell
npm run typecheck
npm run build
npm test
```

并做一轮手工命令验证，确认：

- `music-education-app` 在当前目录模式下能正常命中目标仓库
- 不需要再显式传 `--repo`
