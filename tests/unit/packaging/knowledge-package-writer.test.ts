import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeKnowledgePackage } from '../../../src/packaging/knowledge-package-writer';
import type { PackageLayout } from '../../../src/knowledge/init-directory';

describe('writeKnowledgePackage', () => {
  it('writes db and capability objects into design-aligned directories', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'knowledge-package-writer-'));

    // Create directory structure (simulate initDirectoryStructure)
    const packageRoot = resolve(outputRoot, 'ai-knowledge');
    await mkdir(join(packageRoot, 'objects'), { recursive: true });
    await mkdir(join(packageRoot, 'objects/_共享'), { recursive: true });
    await mkdir(join(packageRoot, 'evidence'), { recursive: true });
    await mkdir(join(packageRoot, 'reports'), { recursive: true });

    const layout: PackageLayout = {
      packageRoot,
      objectsDir: join(packageRoot, 'objects'),
      sharedDir: join(packageRoot, 'objects/_共享'),
      evidenceDir: join(packageRoot, 'evidence'),
      reportsDir: join(packageRoot, 'reports'),
      catalogPath: join(packageRoot, 'catalog.yaml'),
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

    const catalog = await readFile(join(outputRoot, 'ai-knowledge', 'catalog.yaml'), 'utf-8');
    expect(catalog).toContain('knowledge: all');
    expect(catalog).toContain('DB-users');
    expect(catalog).toContain('CAP-ORDER');

    const report = await readFile(join(outputRoot, 'ai-knowledge', 'reports', 'generation.json'), 'utf-8');
    expect(report).toContain('"knowledge": "all"');
    expect(report).toContain('"db"');
    expect(report).toContain('"capability"');
  });
});
