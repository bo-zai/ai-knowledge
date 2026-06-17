/**
 * LLM 调用类型定义
 *
 * 统一的 LLM 消息类型和输入/输出接口
 * 支持 legacy 模式（system/user 分离）和 message 数组模式（多轮对话）
 */

import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * 统一消息类型
 *
 * 兼容 OpenAI ChatCompletionMessageParam 和 LangChain BaseMessage
 */
export interface LlmMessage {
  /** 消息角色 */
  role: "system" | "user" | "assistant" | "tool";
  /** 消息内容 */
  content: string;
  /** 工具消息名称（可选） */
  name?: string;
  /** 工具调用 ID（可选） */
  tool_call_id?: string;
}

/**
 * LLM 调用输入
 *
 * 支持两种模式：
 * 1. Legacy 模式：{ systemPrompt, userPrompt }
 * 2. Message 数组模式：{ messages } 用于多轮对话
 */
export interface LlmCallInput {
  /** Legacy: 系统提示词（与 userPrompt 配合使用） */
  systemPrompt?: string;
  /** Legacy: 用户提示词（与 systemPrompt 配合使用） */
  userPrompt?: string;
  /** Message 数组模式：多轮对话消息列表 */
  messages?: LlmMessage[];
}

/**
 * LLM 调用结果
 */
export interface LlmCallResult {
  /** 原始输出文本 */
  rawText: string;
  /** 使用的模型名称 */
  model: string;
  /** Token 使用统计（可选） */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * 输入归一化结果
 */
export interface NormalizedLlmInput {
  /** 调用模式 */
  mode: "legacy" | "messages";
  /** Legacy 模式：系统提示词 */
  systemPrompt?: string;
  /** Legacy 模式：用户提示词 */
  userPrompt?: string;
  /** Message 数组模式：消息列表 */
  messages?: LlmMessage[];
}

/**
 * 转换 LlmMessage 到 LangChain BaseMessage
 *
 * @param msg - LlmMessage 消息
 * @returns LangChain BaseMessage 实例
 */
export function toLangChainMessage(msg: LlmMessage): BaseMessage {
  switch (msg.role) {
    case "system":
      return new SystemMessage(msg.content);
    case "user":
      return new HumanMessage(msg.content);
    case "assistant":
      return new AIMessage(msg.content);
    case "tool":
      return new ToolMessage({
        content: msg.content,
        name: msg.name ?? "unknown_tool",
        tool_call_id: msg.tool_call_id ?? "",
      });
    default:
      throw new Error(`Unknown message role: ${msg.role}`);
  }
}

/**
 * 转换 LlmMessage 数组到 LangChain BaseMessage 数组
 *
 * @param messages - LlmMessage 数组
 * @returns LangChain BaseMessage 数组
 */
export function toLangChainMessages(messages: LlmMessage[]): BaseMessage[] {
  return messages.map(toLangChainMessage);
}

/**
 * 转换 LlmMessage 到 OpenAI ChatCompletionMessageParam
 *
 * @param msg - LlmMessage 消息
 * @returns OpenAI ChatCompletionMessageParam 实例
 */
export function toOpenAiMessage(msg: LlmMessage): ChatCompletionMessageParam {
  switch (msg.role) {
    case "system":
      return { role: "system", content: msg.content };
    case "user":
      return { role: "user", content: msg.content };
    case "assistant":
      return { role: "assistant", content: msg.content };
    case "tool":
      return {
        role: "tool",
        content: msg.content,
        tool_call_id: msg.tool_call_id ?? "",
      };
    default:
      throw new Error(`Unknown message role: ${msg.role}`);
  }
}

/**
 * 转换 LlmMessage 数组到 OpenAI ChatCompletionMessageParam 数组
 *
 * @param messages - LlmMessage 数组
 * @returns OpenAI ChatCompletionMessageParam 数组
 */
export function toOpenAiMessages(
  messages: LlmMessage[],
): ChatCompletionMessageParam[] {
  return messages.map(toOpenAiMessage);
}

/**
 * 归一化 LLM 输入
 *
 * 判断输入模式并返回标准化结果
 *
 * @param input - LLM 调用输入
 * @returns 归一化结果
 * @throws Error 如果输入无效
 */
export function normalizeLlmInput(input: LlmCallInput): NormalizedLlmInput {
  // Message 数组模式优先
  if (input.messages && input.messages.length > 0) {
    return {
      mode: "messages",
      messages: input.messages,
    };
  }

  // Legacy 模式
  if (input.systemPrompt !== undefined && input.userPrompt !== undefined) {
    return {
      mode: "legacy",
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
    };
  }

  // 无效输入
  throw new Error(
    "Invalid LlmCallInput: must provide either messages array or both systemPrompt and userPrompt",
  );
}

/**
 * 从 Message 数组提取 System Prompt
 *
 * @param messages - LlmMessage 数组
 * @returns 系统提示词或 undefined
 */
export function extractSystemPrompt(
  messages: LlmMessage[],
): string | undefined {
  const systemMsg = messages.find((m) => m.role === "system");
  return systemMsg?.content;
}

/**
 * 从 Message 数组提取最后一个 User Prompt
 *
 * @param messages - LlmMessage 数组
 * @returns 最后一个用户提示词或 undefined
 */
export function extractLastUserPrompt(
  messages: LlmMessage[],
): string | undefined {
  const userMsgs = messages.filter((m) => m.role === "user");
  return userMsgs[userMsgs.length - 1]?.content;
}

/**
 * Legacy 输入转换为 Message 数组
 *
 * 用于将 legacy 模式转换为 message 数组模式
 *
 * @param systemPrompt - 系统提示词
 * @param userPrompt - 用户提示词
 * @returns LlmMessage 数组
 */
export function legacyToMessages(
  systemPrompt: string,
  userPrompt: string,
): LlmMessage[] {
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
}
