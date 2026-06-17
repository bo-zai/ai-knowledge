import { describe, it, expect } from "vitest";
import { resolveModelConfig } from "../../src/config/model-config.js";
import { LLM_DEFAULTS } from "../../src/config/defaults.js";

describe("resolveModelConfig", () => {
  it("should use defaults when no file config provided", () => {
    const result = resolveModelConfig({});
    expect(result.model).toBe(LLM_DEFAULTS.model);
    expect(result.baseUrl).toBe(LLM_DEFAULTS.baseUrl);
    expect(result.apiKeyEnv).toBeUndefined(); // apiKeyEnv is optional, no default
    expect(result.concurrency).toBe(LLM_DEFAULTS.concurrency);
    expect(result.timeoutMs).toBe(LLM_DEFAULTS.timeoutSeconds * 1000);
    expect(result.maxRetries).toBe(LLM_DEFAULTS.maxRetries);
  });

  it("should override values from file config", () => {
    const result = resolveModelConfig({
      fileConfig: {
        model: "custom-model",
        concurrency: 5,
        timeout: 60,
        maxRetries: 2,
      },
    });
    expect(result.model).toBe("custom-model");
    expect(result.concurrency).toBe(5);
    expect(result.timeoutMs).toBe(60000);
    expect(result.maxRetries).toBe(2);
  });

  it("should fallback to defaults for invalid concurrency", () => {
    const result = resolveModelConfig({
      fileConfig: { concurrency: 0 },
    });
    expect(result.concurrency).toBe(LLM_DEFAULTS.concurrency);
  });

  it("should fallback to defaults for invalid timeout", () => {
    const result = resolveModelConfig({
      fileConfig: { timeout: -1 },
    });
    expect(result.timeoutMs).toBe(LLM_DEFAULTS.timeoutSeconds * 1000);
  });
});
