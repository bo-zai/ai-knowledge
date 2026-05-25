# OpenAI-Compatible Streaming Implementation Plan

## 目标

为当前项目增加 OpenAI-compatible 流式调用能力，并保持现有知识生成主链稳定：

- `streaming-first`
- `non-streaming fallback`
- 记录 streaming/fallback 元数据
- 不改对象 schema 与知识包格式

## 任务拆分

### Task 1: 扩展 LLM 客户端返回结构

修改：

- [src/generation/llm-client.ts](/D:/workspace/ai-wiki/src/generation/llm-client.ts)

工作：

1. 定义 `LlmGenerationResult`
2. 将 `generateWithClient()` 返回值从 `string` 改为结构化结果
3. 先保留现有非流式实现作为 fallback helper

完成标准：

- `generateWithClient` 类型稳定
- 还未接 streaming 前，项目可编译

### Task 2: 接入 OpenAI-compatible streaming

修改：

- [src/generation/llm-client.ts](/D:/workspace/ai-wiki/src/generation/llm-client.ts)

工作：

1. 使用 `client.chat.completions.create({ stream: true })`
2. 通过 `for await ... of stream` 读取 chunk
3. 聚合：
   - `text`
   - `startedAt`
   - `firstChunkAt`
   - `finishedAt`
   - `durationMs`
   - `chunks`

完成标准：

- 可以返回 `mode: 'streaming'`
- 空 chunk 不会污染最终文本

### Task 3: 增加 non-streaming fallback

修改：

- [src/generation/llm-client.ts](/D:/workspace/ai-wiki/src/generation/llm-client.ts)

工作：

1. 在这些场景 fallback：
   - 流式抛错
   - 没收到文本 chunk
   - 最终文本为空
2. fallback 到现有 `chat.completions.create(...)`
3. 返回：
   - `mode: 'non_streaming_fallback'`
   - `streamError`

完成标准：

- provider 不支持 streaming 时不至于直接失败
- fallback 后上层仍能拿到完整文本

### Task 4: 对接 generate 主链

修改：

- [src/cli/generate.ts](/D:/workspace/ai-wiki/src/cli/generate.ts)

工作：

1. 接收 `LlmGenerationResult`
2. 用 `result.text` 替代当前 `rawText`
3. 把 LLM 元数据写进 `trace.response.llm`
4. 保持 `parseGeneratorOutput` / schema 校验 / markdown 渲染逻辑不变

完成标准：

- 现有对象生成主链不需要大改
- debug trace 能区分 streaming 与 fallback

### Task 5: 更新日志写入

修改：

- [src/packaging/write-debug-logs.ts](/D:/workspace/ai-wiki/src/packaging/write-debug-logs.ts)
- 相关 trace 类型定义文件

工作：

1. 在日志中新增：
   - `mode`
   - `startedAt`
   - `firstChunkAt`
   - `finishedAt`
   - `durationMs`
   - `chunks`
   - `streamError`
2. 不记录每个 chunk 全量文本

完成标准：

- `.knowledge/<repoId>/<date>.log` 能直接看出是否走了 streaming
- fallback 原因可见

### Task 6: 增加可选 streaming 开关

修改：

- [src/config/model-config.ts](/D:/workspace/ai-wiki/src/config/model-config.ts)
- [src/cli/index.ts](/D:/workspace/ai-wiki/src/cli/index.ts)
- [src/cli/generate.ts](/D:/workspace/ai-wiki/src/cli/generate.ts)
- [llm.config.json](/D:/workspace/ai-wiki/llm.config.json)

工作：

1. 支持配置：
   - `streaming: true | false`
2. 支持 CLI 显式覆盖
3. 默认 `true`

完成标准：

- 某些 provider streaming 不稳时可快速关闭

### Task 7: 最小验证

不要扩写大量测试代码，优先真实验证。

验证步骤：

1. `npm run typecheck`
2. `npm run build`
3. 对 3 张真实表运行：
   - `auth_menu`
   - `mall_category`
   - `music_user`
4. 检查：
   - 对象能成功落盘
   - 日志里出现 streaming 元数据
   - 若 provider 不支持流式，则能看到 fallback 元数据

可选补充：

- 只写少量 `llm-client` 单元测试，覆盖：
  - 正常 streaming 聚合
  - fallback 分支

## 实施顺序

按这个顺序做，避免一开始改太散：

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7

## 注意事项

1. 不要改对象 schema
2. 不要把上层改成 chunk 驱动 UI
3. 不要改成 `responses` API
4. 不要写大量新测试
5. 保持 mock/test model 路径可用

## 验收口径

完成后必须满足：

1. 当前项目默认走 streaming
2. streaming 失败能 fallback
3. 三张真实表单表生成不回退
4. 日志里能明确看出 streaming/fallback 模式
