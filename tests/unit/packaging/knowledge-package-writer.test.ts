import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeKnowledgePackage } from '../../../src/packaging/knowledge-package-writer';
import type { PackageLayout, KnowledgeDir } from '../../../src/knowledge/init-directory';

describe('writeKnowledgePackage', () => {
  it('writes db and capability objects into design-aligned directories', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'knowledge-package-writer-'));

    // Create directory structure (simulate initDirectoryStructure)
    const packageRoot = resolve(outputRoot, 'ai-knowledge');
    await mkdir(join(packageRoot, 'capabilities'), { recursive: true });
    await mkdir(join(packageRoot, 'concepts'), { recursive: true });
    await mkdir(join(packageRoot, 'boundaries'), { recursive: true });
    await mkdir(join(packageRoot, 'external-systems'), { recursive: true });
    await mkdir(join(packageRoot, 'constraints'), { recursive: true });
    await mkdir(join(packageRoot, 'relations'), { recursive: true });
    await mkdir(join(packageRoot, 'data-model'), { recursive: true });
    await mkdir(join(packageRoot, 'workflows'), { recursive: true });
    await mkdir(join(packageRoot, '.internal', 'reports'), { recursive: true });

    const knowledgeDirs: Record<KnowledgeDir, string> = {
      capabilities: join(packageRoot, 'capabilities'),
      concepts: join(packageRoot, 'concepts'),
      boundaries: join(packageRoot, 'boundaries'),
      'external-systems': join(packageRoot, 'external-systems'),
      constraints: join(packageRoot, 'constraints'),
      relations: join(packageRoot, 'relations'),
      'data-model': join(packageRoot, 'data-model'),
      workflows: join(packageRoot, 'workflows'),
    };

    const layout: PackageLayout = {
      packageRoot,
      indexMdPath: join(packageRoot, 'index.md'),
      knowledgeDirs,
      reportsDir: join(packageRoot, '.internal', 'reports'),
    };

    await writeKnowledgePackage({
      layout,
      knowledge: 'all',
      target: undefined,
      contributions: [
        {
          stage: 'db',
          files: [{ path: 'objects/db/DB-users.yaml', content: 'id: DB-users\n' }],
          objects: [{ id: 'DB-users', type: 'DB', path: 'objects/db/DB-users.yaml' }],
          report: { stage: 'db', ran: true, succeeded: 1, failed: 0, details: {} },
          warnings: [],
        },
        {
          stage: 'capability',
          files: [{ path: 'objects/capabilities/CAP-ORDER.yaml', content: 'id: CAP-ORDER\n' }],
          objects: [{ id: 'CAP-ORDER', type: 'CAP', path: 'objects/capabilities/CAP-ORDER.yaml' }],
          report: { stage: 'capability', ran: true, succeeded: 1, failed: 0, details: {} },
          warnings: [],
        },
      ],
    });

    const report = await readFile(join(outputRoot, 'ai-knowledge', '.internal', 'reports', 'generation.json'), 'utf-8');
    expect(report).toContain('"knowledge": "all"');
    expect(report).toContain('"db"');
    expect(report).toContain('"capability"');
  });
});
