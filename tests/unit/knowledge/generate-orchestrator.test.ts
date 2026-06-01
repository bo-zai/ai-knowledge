import { describe, expect, it, vi } from 'vitest';
import { runGenerateOrchestration } from '../../../src/knowledge/generate-orchestrator';
import type { KnowledgePackageContribution } from '../../../src/packaging/knowledge-package-contribution';
import type { GraphStatus } from '../../../src/query/prepare-generation';
import type { PackageLayout } from '../../../src/knowledge/init-directory';

function contribution(stage: 'db' | 'capability'): KnowledgePackageContribution {
  return {
    stage,
    files: [{ path: `objects/${stage}/${stage}.yaml`, content: stage }],
    objects: [{ id: `${stage.toUpperCase()}-1`, type: stage === 'db' ? 'DB' : 'CAP', path: `objects/${stage}/${stage}.yaml` }],
    report: { stage, ran: true, succeeded: 1, failed: 0, details: {} },
    warnings: [],
  };
}

const mockGraphStatus: GraphStatus = {
  status: 'reused',
  nodeCount: 100,
  edgeCount: 50,
  analyzedAt: '2026-01-01T00:00:00Z',
};

const mockLayout: PackageLayout = {
  packageRoot: '/out/bootstrap-knowledge',
  objectsDir: '/out/bootstrap-knowledge/objects',
  sharedDir: '/out/bootstrap-knowledge/objects/_共享',
  evidenceDir: '/out/bootstrap-knowledge/evidence',
  reportsDir: '/out/bootstrap-knowledge/reports',
  catalogPath: '/out/bootstrap-knowledge/catalog.yaml',
};

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
        scope: { knowledge: 'all', inferred: true, inferredFrom: 'default', warnings: [] },
        graphStatus: mockGraphStatus,
        layout: mockLayout,
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
          warnings: [],
        },
        graphStatus: mockGraphStatus,
        layout: mockLayout,
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
          warnings: [],
        },
        graphStatus: mockGraphStatus,
        layout: mockLayout,
        llm: {},
      },
      deps,
    });

    expect(deps.runDb).not.toHaveBeenCalled();
    expect(deps.runCapability).toHaveBeenCalledTimes(1);
    expect(deps.writePackage).toHaveBeenCalledTimes(1);
  });
});
