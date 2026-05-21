import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  loadDefaultLlmConfigFile,
  loadLlmConfigFile,
  resolveModelConfig,
} from '../../../src/config/model-config.js';

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
    });
  });

  it('loads the default llm.config.json from the working directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llm-default-config-'));
    const configPath = join(dir, 'llm.config.json');

    await writeFile(
      configPath,
      JSON.stringify(
        {
          model: 'local-model',
          baseUrl: 'https://gateway.test/v1',
          apiKeyEnv: 'LOCAL_KEY',
          apiKey: 'local-secret',
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = await loadDefaultLlmConfigFile(dir);

    expect(config).toEqual({
      model: 'local-model',
      baseUrl: 'https://gateway.test/v1',
      apiKeyEnv: 'LOCAL_KEY',
      apiKey: 'local-secret',
    });
  });

  it('resolves config with cli arguments overriding file config', () => {
    const resolved = resolveModelConfig({
      model: 'cli-model',
      baseUrl: 'https://cli.test/v1',
      apiKeyEnv: 'CLI_KEY',
      fileConfig: {
        model: 'file-model',
        baseUrl: 'https://file.test/v1',
        apiKeyEnv: 'FILE_KEY',
      },
      env: {
        CLI_KEY: 'cli-secret',
        FILE_KEY: 'file-secret',
      },
    });

    expect(resolved).toEqual({
      model: 'cli-model',
      baseUrl: 'https://cli.test/v1',
      apiKeyEnv: 'CLI_KEY',
      apiKey: 'cli-secret',
    });
  });

  it('falls back to file config before defaults', () => {
    const resolved = resolveModelConfig({
      fileConfig: {
        model: 'file-model',
        baseUrl: 'https://file.test/v1',
        apiKeyEnv: 'FILE_KEY',
        apiKey: 'file-secret-direct',
      },
      env: {
        FILE_KEY: 'file-secret',
      },
    });

    expect(resolved).toEqual({
      model: 'file-model',
      baseUrl: 'https://file.test/v1',
      apiKeyEnv: 'FILE_KEY',
      apiKey: 'file-secret-direct',
    });
  });

  it('prefers direct apiKey over env-derived apiKey', () => {
    const resolved = resolveModelConfig({
      apiKey: 'direct-secret',
      apiKeyEnv: 'ENV_KEY',
      env: {
        ENV_KEY: 'env-secret',
      },
    });

    expect(resolved).toEqual({
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'ENV_KEY',
      apiKey: 'direct-secret',
    });
  });
});
