/**
 * 测试 Message 数组功能
 *
 * 验证：
 * 1. V2 Provider 支持 message 数组调用
 * 2. JSON 解析失败后重试使用对话历史
 */

import OpenAI from "openai";
import { resolveModelConfig } from "../src/config/model-config.js";
import { createOpenAiClaimsProvider } from "../src/generation/llm-provider-factory.js";
import { callLlmForJson } from "../src/generation/llm-json-client.js";
import type { LlmMessage } from "../src/generation/llm-types.js";

async function main() {
  console.log("=== 测试 Message 数组功能 ===\n");

  // 1. 加载模型配置
  const modelConfig = resolveModelConfig({});
  console.log("模型配置:", {
    model: modelConfig.model,
    baseUrl: modelConfig.baseUrl,
  });

  // 2. 创建 OpenAI 客户端
  const client = new OpenAI({
    baseURL: modelConfig.baseUrl,
    apiKey: modelConfig.apiKey,
    timeout: 120000,
  });

  // 3. 创建 Provider
  const provider = createOpenAiClaimsProvider(client, modelConfig.model);
  console.log("Provider 创建成功\n");

  // 4. 测试 1: 直接使用 message 数组调用
  console.log("--- 测试 1: Message 数组模式 ---");
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: "你是一个 JSON 数据生成助手。只输出纯 JSON，不要任何其他文字。",
    },
    {
      role: "user",
      content: "生成一个简单的用户信息对象，包含 name 和 age 字段。",
    },
  ];

  try {
    const result1 = await provider({ messages });
    console.log("结果:", result1.rawText.slice(0, 200));
    console.log("模型:", result1.model);
    console.log("\n");
  } catch (error) {
    console.error("测试 1 失败:", error);
  }

  // 5. 测试 2: 多轮对话（模拟第一次失败后的修复）
  console.log("--- 测试 2: 多轮对话模式 ---");
  const multiTurnMessages: LlmMessage[] = [
    {
      role: "system",
      content: "你是一个 JSON 数据生成助手。只输出纯 JSON，不要任何其他文字。",
    },
    {
      role: "user",
      content:
        "生成一个产品信息对象，包含 product_name、price、category 字段。",
    },
    {
      role: "assistant",
      content:
        '好的，我来生成产品信息：\n```json\n{\n  "product_name": "智能手表",\n  "price": 299,\n  "category": "电子产品"\n}\n```',
    },
    {
      role: "user",
      content:
        "你的输出被 markdown 代码块包裹了。请直接输出纯 JSON，去掉 ```json 和 ``` 标记。",
    },
  ];

  try {
    const result2 = await provider({ messages: multiTurnMessages });
    console.log("多轮对话结果:", result2.rawText.slice(0, 200));
    console.log("\n");
  } catch (error) {
    console.error("测试 2 失败:", error);
  }

  // 6. 测试 3: callLlmForJson 使用 message 数组 + 重试机制
  console.log("--- 测试 3: callLlmForJson 重试机制 ---");
  try {
    const result3 = await callLlmForJson({
      // 使用 message 数组模式
      messages: [
        {
          role: "system",
          content:
            "你是一个知识生成助手。输出纯 JSON 数组，不要 markdown 包裹。",
        },
        {
          role: "user",
          content:
            '生成一个概念对象数组，包含 concept_name 和 summary_zh 字段。示例：\n[{"concept_name": "用户", "summary_zh": "系统使用者"}]',
        },
      ],
      claimsProvider: provider,
      knowledgeType: "CONCEPT",
      maxRetries: 3,
      timeout: 60000,
      logLabel: "Concept Test",
    });

    console.log("callLlmForJson 结果:");
    console.log("- 成功:", result3.success);
    console.log("- 来源:", result3.successSource);
    console.log("- 重试次数:", result3.retryAttempt);
    console.log("- 使用降级:", result3.fallbackUsed);
    console.log("- 数据:", JSON.stringify(result3.data, null, 2).slice(0, 300));
    console.log("- 调用次数:", result3.llmStats.totalCalls);
    console.log("- 错误历史:", result3.errorHistory.length);
  } catch (error) {
    console.error("测试 3 失败:", error);
  }

  console.log("\n=== 测试完成 ===");
}

main().catch(console.error);
