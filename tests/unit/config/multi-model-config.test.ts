import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type MultiModelsFile,
  type ValidatedModelConfig,
  resolveApiKey,
  validateModelConfig,
  loadMultiModelsFile,
  getValidatedModels,
  selectModelForTask,
  getFallbackModel,
} from "../../../src/config/multi-model-config.js";

describe("multi-model-config", () => {
  // ── resolveApiKey 测试 ───────────────────────────────────────────────

  describe("resolveApiKey", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("直接返回不带环境变量的 API Key", () => {
      expect(resolveApiKey("sk-test-123")).toBe("sk-test-123");
      expect(resolveApiKey("simple-key")).toBe("simple-key");
    });

    it("解析 ${ENV_VAR} 格式的环境变量", () => {
      process.env.MY_API_KEY = "resolved-key-123";
      expect(resolveApiKey("${MY_API_KEY}")).toBe("resolved-key-123");
    });

    it("解析嵌入环境变量的字符串", () => {
      process.env.PREFIX = "prefix";
      process.env.SUFFIX = "suffix";
      expect(resolveApiKey("${PREFIX}-middle-${SUFFIX}")).toBe(
        "prefix-middle-suffix",
      );
    });

    it("环境变量未设置时保留原始值", () => {
      const result = resolveApiKey("${NON_EXISTENT_VAR}");
      expect(result).toBe("${NON_EXISTENT_VAR}");
    });

    it("空字符串返回空", () => {
      expect(resolveApiKey("")).toBe("");
    });

    it("undefined 返回空", () => {
      expect(resolveApiKey(undefined)).toBe("");
    });
  });

  // ── validateModelConfig 测试 ─────────────────────────────────────────

  describe("validateModelConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("验证有效的模型配置", () => {
      process.env.TEST_KEY = "test-api-key";

      const config = {
        id: "model-1",
        name: "Test Model",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4",
        apiKey: "${TEST_KEY}",
      };

      const result = validateModelConfig(config);

      expect(result.isValid).toBe(true);
      expect(result.validationError).toBeUndefined();
      expect(result.apiKey).toBe("test-api-key");
      expect(result.maxTokens).toBe(128000); // 默认值
    });

    it("本地模型不需要 API Key", () => {
      const config = {
        id: "local-1",
        name: "Local Model",
        baseUrl: "http://localhost:11434/v1",
        model: "llama2",
        tier: "local" as const,
      };

      const result = validateModelConfig(config);

      expect(result.isValid).toBe(true);
    });

    it("拒绝无效的 baseUrl", () => {
      const config = {
        id: "model-1",
        name: "Test",
        baseUrl: "not-a-url",
        model: "gpt-4",
        apiKey: "key",
      };

      const result = validateModelConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.validationError).toContain("baseUrl");
    });

    it("接受 http 和 https 协议", () => {
      const httpsConfig = {
        id: "model-1",
        name: "HTTPS Model",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4",
        apiKey: "key",
      };

      const httpConfig = {
        id: "model-2",
        name: "HTTP Model",
        baseUrl: "http://localhost:11434/v1",
        model: "local-model",
        apiKey: "key",
      };

      expect(validateModelConfig(httpsConfig).isValid).toBe(true);
      expect(validateModelConfig(httpConfig).isValid).toBe(true);
    });

    it("拒绝空白的必填字段", () => {
      const config = {
        id: "",
        name: "",
        baseUrl: "https://api.example.com/v1",
        model: "",
        apiKey: "key",
      };

      const result = validateModelConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.validationError).toContain("id 不能为空");
      expect(result.validationError).toContain("name 不能为空");
      expect(result.validationError).toContain("model 不能为空");
    });

    it("验证并修正 maxTokens 范围", () => {
      const tooHigh = {
        id: "model-1",
        name: "Test",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4",
        apiKey: "key",
        maxTokens: 2000000,
      };

      const tooLow = {
        id: "model-2",
        name: "Test",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4",
        apiKey: "key",
        maxTokens: 1000,
      };

      expect(validateModelConfig(tooHigh).maxTokens).toBe(1000000); // MAX_MAX_TOKENS
      expect(validateModelConfig(tooLow).maxTokens).toBe(32000); // MIN_MAX_TOKENS
    });

    it("非本地模型缺少 apiKey 时无效", () => {
      const config = {
        id: "model-1",
        name: "Test",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4",
        tier: "premium" as const,
      };

      const result = validateModelConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.validationError).toContain("apiKey");
    });
  });

  // ── loadMultiModelsFile 测试 ──────────────────────────────────────────

  describe("loadMultiModelsFile", () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "multi-model-config-"));
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    it("加载有效的配置文件", async () => {
      const configPath = join(testDir, "models.json");
      const config: MultiModelsFile = {
        models: [
          {
            id: "gpt-4",
            name: "GPT-4",
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4",
            apiKey: "sk-test",
          },
        ],
        routing: {
          defaultModel: "gpt-4",
        },
      };

      await writeFile(configPath, JSON.stringify(config), "utf8");

      const result = await loadMultiModelsFile(configPath);

      expect(result.models).toHaveLength(1);
      expect(result.models[0]?.id).toBe("gpt-4");
      expect(result.routing?.defaultModel).toBe("gpt-4");
    });

    it("文件不存在时返回空配置", async () => {
      const result = await loadMultiModelsFile(
        join(testDir, "nonexistent.json"),
      );

      expect(result.models).toEqual([]);
    });

    it("无效 JSON 时返回空配置", async () => {
      const configPath = join(testDir, "invalid.json");
      await writeFile(configPath, "not valid json", "utf8");

      const result = await loadMultiModelsFile(configPath);

      expect(result.models).toEqual([]);
    });

    it("models 字段不是数组时返回空配置", async () => {
      const configPath = join(testDir, "invalid-structure.json");
      await writeFile(
        configPath,
        JSON.stringify({ models: "not-array" }),
        "utf8",
      );

      const result = await loadMultiModelsFile(configPath);

      expect(result.models).toEqual([]);
    });
  });

  // ── getValidatedModels 测试 ──────────────────────────────────────────

  describe("getValidatedModels", () => {
    it("过滤并返回有效模型", () => {
      const configFile: MultiModelsFile = {
        models: [
          {
            id: "valid-model",
            name: "Valid",
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4",
            apiKey: "key",
          },
          {
            id: "",
            name: "Invalid",
            baseUrl: "https://api.example.com/v1",
            model: "gpt-4",
            apiKey: "key",
          },
        ],
      };

      const result = getValidatedModels(configFile);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("valid-model");
    });

    it("所有模型无效时返回空数组", () => {
      const configFile: MultiModelsFile = {
        models: [{ id: "", name: "", baseUrl: "", model: "", apiKey: "" }],
      };

      const result = getValidatedModels(configFile);

      expect(result).toEqual([]);
    });
  });

  // ── selectModelForTask 测试 ──────────────────────────────────────────

  describe("selectModelForTask", () => {
    const createValidModels = (): ValidatedModelConfig[] => [
      {
        id: "premium-model",
        name: "Premium",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4",
        apiKey: "key",
        isValid: true,
        tier: "premium",
      },
      {
        id: "economy-model",
        name: "Economy",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-3.5-turbo",
        apiKey: "key",
        isValid: true,
        tier: "economy",
      },
      {
        id: "default-model",
        name: "Default",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4-turbo",
        apiKey: "key",
        isValid: true,
      },
    ];

    it("使用指定模型 ID", () => {
      const configFile: MultiModelsFile = {
        models: [],
        routing: {
          rules: [
            { taskType: "generation", preferredModelId: "premium-model" },
          ],
        },
      };

      const result = selectModelForTask(
        configFile,
        "generation",
        createValidModels(),
      );

      expect(result?.id).toBe("premium-model");
    });

    it("使用偏好层级", () => {
      const configFile: MultiModelsFile = {
        models: [],
        routing: {
          rules: [{ taskType: "analysis", preferredTier: "economy" }],
        },
      };

      const result = selectModelForTask(
        configFile,
        "analysis",
        createValidModels(),
      );

      expect(result?.id).toBe("economy-model");
    });

    it("使用默认模型", () => {
      const configFile: MultiModelsFile = {
        models: [],
        routing: {
          defaultModel: "default-model",
        },
      };

      const result = selectModelForTask(
        configFile,
        "unknown-task",
        createValidModels(),
      );

      expect(result?.id).toBe("default-model");
    });

    it("无匹配规则时返回第一个可用模型", () => {
      const configFile: MultiModelsFile = {
        models: [],
      };

      const result = selectModelForTask(
        configFile,
        "unknown-task",
        createValidModels(),
      );

      expect(result?.id).toBe("premium-model");
    });

    it("指定模型不存在时降级", () => {
      const configFile: MultiModelsFile = {
        models: [],
        routing: {
          rules: [{ taskType: "generation", preferredModelId: "nonexistent" }],
        },
      };

      const result = selectModelForTask(
        configFile,
        "generation",
        createValidModels(),
      );

      // 降级到第一个可用模型
      expect(result?.id).toBe("premium-model");
    });

    it("空验证模型列表时返回 null", () => {
      const configFile: MultiModelsFile = { models: [] };

      const result = selectModelForTask(configFile, "generation", []);

      expect(result).toBeNull();
    });
  });

  // ── getFallbackModel 测试 ────────────────────────────────────────────

  describe("getFallbackModel", () => {
    const createValidModels = (): ValidatedModelConfig[] => [
      {
        id: "primary",
        name: "Primary",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-4",
        apiKey: "key",
        isValid: true,
      },
      {
        id: "fallback",
        name: "Fallback",
        baseUrl: "https://api.example.com/v1",
        model: "gpt-3.5-turbo",
        apiKey: "key",
        isValid: true,
      },
    ];

    it("返回配置的备用模型", () => {
      const configFile: MultiModelsFile = {
        models: [],
        routing: { fallbackModel: "fallback" },
      };

      const result = getFallbackModel(configFile, createValidModels());

      expect(result?.id).toBe("fallback");
    });

    it("备用模型不存在时返回最后一个模型", () => {
      const configFile: MultiModelsFile = {
        models: [],
        routing: { fallbackModel: "nonexistent" },
      };

      const models = createValidModels();
      const result = getFallbackModel(configFile, models);

      expect(result?.id).toBe("fallback");
    });

    it("无配置时返回最后一个模型", () => {
      const configFile: MultiModelsFile = { models: [] };
      const models = createValidModels();

      const result = getFallbackModel(configFile, models);

      expect(result?.id).toBe("fallback");
    });

    it("只有一个模型时返回 null", () => {
      const configFile: MultiModelsFile = { models: [] };
      const models: ValidatedModelConfig[] = [
        {
          id: "only",
          name: "Only",
          baseUrl: "https://api.example.com/v1",
          model: "gpt-4",
          apiKey: "key",
          isValid: true,
        },
      ];

      const result = getFallbackModel(configFile, models);

      expect(result).toBeNull();
    });
  });
});
