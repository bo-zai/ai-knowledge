# music-education-app 手动生成 DB 知识步骤

## 目标

为以下仓库生成 `bootstrap-knowledge/`，并重点查看其中的 `DB` 知识对象：

- `D:\workspace\other_project\music-education-app`

## 前置条件

在 `D:\workspace\ai-wiki` 下确认：

1. `llm.config.json` 已正确配置
2. 依赖已安装
3. CLI 已构建成功

如不确定，可先执行：

```powershell
cd D:\workspace\ai-wiki
npm run build
```

## 执行步骤

### 1. 进入项目目录

```powershell
cd D:\workspace\ai-wiki
```

### 2. 可选，先清理旧产物

```powershell
node dist/cli/index.js clean --repo D:\workspace\other_project\music-education-app
```

### 3. 生成知识包

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-app --llm-config llm.config.json
```

## 结果位置

### 知识包目录

```text
D:\workspace\other_project\music-education-app\bootstrap-knowledge
```

### DB 知识对象目录

```text
D:\workspace\other_project\music-education-app\bootstrap-knowledge\objects\db
```

### 调试日志

```text
C:\Users\dengquanbo\.knowledge\music-education-app\YYYY-MM-DD.log
```

## 生成后检查

### 1. 查看是否生成了 DB 文件

```powershell
Get-ChildItem D:\workspace\other_project\music-education-app\bootstrap-knowledge\objects\db
```

### 2. 查看生成汇总

```powershell
Get-Content D:\workspace\other_project\music-education-app\bootstrap-knowledge\reports\generation-summary.md
```

### 3. 查看状态

```powershell
node dist/cli/index.js status --repo D:\workspace\other_project\music-education-app
```

## 单表生成

如果只想生成某一张表：

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-app --slice database:<表名> --llm-config llm.config.json
```

例如：

```powershell
node dist/cli/index.js generate --repo D:\workspace\other_project\music-education-app --slice database:music_user --llm-config llm.config.json
```

## 关于 --repo

当前版本里，`--repo` 是必填参数，不能省略。

原因：

- `generate` 使用了 `requiredOption('--repo <path>')`
- `status` 使用了 `requiredOption('--repo <path>')`
- `clean` 使用了 `requiredOption('--repo <path>')`

如果不传，CLI 会直接报参数缺失。

## 额外说明

对于 `music-education-*` 项目，当前代码会自动尝试发现同级的：

- `music-education-core`

因此在目录结构正常时，不需要你手动额外指定 core 仓库路径。
