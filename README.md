# Repo Knowledge Generator

一个独立的 TypeScript/Node.js CLI 工具，用于从 GitNexus 证据和 OpenAI-compatible LLM 生成 `bootstrap-knowledge/` 知识包。

## 安装

```bash
npm install
npm run build
```

## 使用

```bash
# 生成 bootstrap knowledge package
repo-knowledge-generator generate --repo <path>

# 查看状态
repo-knowledge-generator status --repo <path>

# 清理
repo-knowledge-generator clean --repo <path>
```

## 开发

```bash
npm run dev        # 开发模式运行
npm test           # 运行测试
npm run typecheck  # 类型检查
npm run build      # 构建
```