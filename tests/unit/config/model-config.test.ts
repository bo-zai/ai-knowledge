import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  loadLlmConfigFile,
  resolveModelConfig,
} from '../../../src/config/model-config.js';
import { LLM_DEFAULTS } from '../../../src/config/defaults.js';

describe('model-config', () => {
  it('loads an explicit JSON config file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llm-config-'));
    const configPath = join(dir, 'custom-llm.json');

    await writeFile(
      configPath,
      JSON.stringify(
        {
          model: 'gpt-4o-mini',
          baseUrl: 'https://example.test/v1',
          apiKeyEnv: 'CUSTOM_KEY',
          apiKey: 'custom-secret',
          concurrency: 5,
          timeout: 60,
          maxRetries: 2,
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = await loadLlmConfigFile(configPath);

    expect(config).toEqual({
      model: 'gpt-4o-mini',
      baseUrl: 'https://example.test/v1',
      apiKeyEnv: 'CUSTOM_KEY',
      apiKey: 'custom-secret',
      concurrency: 5,
      timeout: 60,
      maxRetries: 2,
    });
  });

  it('resolves config with file config', () => {
    const resolved = resolveModelConfig({
      fileConfig: {
        model: 'file-model',
        baseUrl: 'https://file.test/v1',
        apiKeyEnv: 'FILE_KEY',
        concurrency: 4,
        timeout: 90,
        maxRetries: 2,
      },
    });

    expect(resolved).toEqual({
      model: 'file-model',
      baseUrl: 'https://file.test/v1',
      apiKeyEnv: 'FILE_KEY',
      apiKey: '',
      concurrency: 4,
      timeoutMs: 90000,
      maxRetries: 2,
    });
  });

  it('uses defaults when no file config provided', () => {
    const resolved = resolveModelConfig({});

    expect(resolved).toEqual({
      model: LLM_DEFAULTS.model,
      baseUrl: LLM_DEFAULTS.baseUrl,
      apiKeyEnv: LLM_DEFAULTS.apiKeyEnv,
      apiKey: '',
      concurrency: LLM_DEFAULTS.concurrency,
      timeoutMs: LLM_DEFAULTS.timeoutSeconds * 1000,
      maxRetries: LLM_DEFAULTS.maxRetries,
    });
  });

  it('falls back to defaults for invalid concurrency', () => {
    const resolved = resolveModelConfig({
      fileConfig: {
        concurrency: 0,
      },
    });

    expect(resolved.concurrency).toBe(LLM_DEFAULTS.concurrency);
  });

  it('falls back to defaults for invalid timeout', () => {
    const resolved = resolveModelConfig({
      fileConfig: {
        timeout: -1,
      },
    });

    expect(resolved.timeoutMs).toBe(LLM_DEFAULTS.timeoutSeconds * 1000);
  });
});