import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeKnowledgePackage } from '../../../src/packaging/knowledge-package-writer';

describe('writeKnowledgePackage', () => {
  it('writes db and capability objects into design-aligned directories', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'knowledge-package-writer-'));

    await writeKnowledgePackage({
      outputRoot,
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

    const catalog = await readFile(join(outputRoot, 'bootstrap-knowledge', 'catalog.yaml'), 'utf-8');
    expect(catalog).toContain('knowledge: all');
    expect(catalog).toContain('DB-users');
    expect(catalog).toContain('CAP-ORDER');

    const report = await readFile(join(outputRoot, 'bootstrap-knowledge', 'reports', 'generation.json'), 'utf-8');
    expect(report).toContain('"knowledge": "all"');
    expect(report).toContain('"db"');
    expect(report).toContain('"capability"');
  });
});
