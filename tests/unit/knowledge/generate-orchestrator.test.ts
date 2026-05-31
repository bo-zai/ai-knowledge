import { describe, expect, it, vi } from 'vitest';
import { runGenerateOrchestration } from '../../../src/knowledge/generate-orchestrator';
import type { KnowledgePackageContribution } from '../../../src/packaging/knowledge-package-contribution';

function contribution(stage: 'db' | 'capability'): KnowledgePackageContribution {
  return {
    stage,
    files: [{ path: `objects/${stage}/${stage}.yaml`, content: stage }],
    objects: [{ id: `${stage.toUpperCase()}-1`, type: stage === 'db' ? 'DB' : 'CAP', path: `objects/${stage}/${stage}.yaml` }],
    report: { stage, ran: true, succeeded: 1, failed: 0, details: {} },
    warnings: [],
  };
}

describe('runGenerateOrchestration', () => {
  it('defaults to all and writes once', async () => {
    const deps = {
      runDb: vi.fn().mockResolvedValue(contribution('db')),
      runCapability: vi.fn().mockResolvedValue(contribution('capability')),
      writePackage: vi.fn().mockResolvedValue(undefined),
    };

    await runGenerateOrchestration({
      input: {
        repoPath: '/repo',
        outputRoot: '/out',
        scope: { knowledge: 'all', inferred: true, inferredFrom: 'default', legacyArgsUsed: [], warnings: [] },
        llm: {},
      },
      deps,
    });

    expect(deps.runDb).toHaveBeenCalledTimes(1);
    expect(deps.runCapability).toHaveBeenCalledTimes(1);
    expect(deps.writePackage).toHaveBeenCalledTimes(1);
  });

  it('runs only db stage for db target', async () => {
    const deps = {
      runDb: vi.fn().mockResolvedValue(contribution('db')),
      runCapability: vi.fn().mockResolvedValue(contribution('capability')),
      writePackage: vi.fn().mockResolvedValue(undefined),
    };

    await runGenerateOrchestration({
      input: {
        repoPath: '/repo',
        outputRoot: '/out',
        scope: {
          knowledge: 'db',
          inferred: false,
          inferredFrom: 'explicit',
          target: { kind: 'db', value: 'users' },
          legacyArgsUsed: [],
          warnings: [],
        },
        llm: {},
      },
      deps,
    });

    expect(deps.runDb).toHaveBeenCalledTimes(1);
    expect(deps.runCapability).not.toHaveBeenCalled();
    expect(deps.writePackage).toHaveBeenCalledTimes(1);
  });

  it('runs only capability stage for capability target in all knowledge', async () => {
    const deps = {
      runDb: vi.fn().mockResolvedValue(contribution('db')),
      runCapability: vi.fn().mockResolvedValue(contribution('capability')),
      writePackage: vi.fn().mockResolvedValue(undefined),
    };

    await runGenerateOrchestration({
      input: {
        repoPath: '/repo',
        outputRoot: '/out',
        scope: {
          knowledge: 'all',
          inferred: false,
          inferredFrom: 'explicit',
          target: { kind: 'capability', value: 'order' },
          legacyArgsUsed: [],
          warnings: [],
        },
        llm: {},
      },
      deps,
    });

    expect(deps.runDb).not.toHaveBeenCalled();
    expect(deps.runCapability).toHaveBeenCalledTimes(1);
    expect(deps.writePackage).toHaveBeenCalledTimes(1);
  });
});
