# RKG (Repo Knowledge Generator)

一个独立的 TypeScript/Node.js CLI 工具，用于从嵌入式分析引擎和 OpenAI-compatible LLM 生成 `bootstrap-knowledge/` 知识包。

## 安装

```bash
npm install
npm run build
npm link  # 全局安装 rkg 命令
```

## 使用

```bash
# 先配置 llm.config.json，或设置 OPENAI_API_KEY 环境变量

# 在项目目录中直接运行（使用 cwd git root）
rkg generate

# 或指定路径
rkg generate <path>
rkg status <path>
rkg clean <path>

# 或使用 --repo 显式指定
rkg generate --repo <path>
rkg status --repo <path>
rkg clean --repo <path>
```

## 开发

```bash
npm run dev        # 开发模式运行
npm test           # 运行测试
npm run typecheck  # 类型检查
npm run build      # 构建
```

## LLM 配置

默认会读取项目根目录的 `llm.config.json`：

```json
{
  "model": "gpt-4o",
  "baseUrl": "https://api.openai.com/v1",
  "apiKeyEnv": "OPENAI_API_KEY"
}
```

你可以使用两种方式提供 API key。

方式 1：直接写在 `llm.config.json`：

```json
{
  "model": "glm-5",
  "baseUrl": "https://coding.dashscope.aliyuncs.com/v1",
  "apiKey": "your-direct-api-key"
}
```

方式 2：在 `llm.config.json` 里配置环境变量名，再在环境变量里提供真实 key，例如 PowerShell：

```powershell
$env:OPENAI_API_KEY="your-key"
```

也可以用命令行覆盖文件配置：

```bash
rkg generate --llm-config ./llm.config.json
rkg generate --model gpt-4o --base-url https://api.openai.com/v1 --api-key-env OPENAI_API_KEY
```
