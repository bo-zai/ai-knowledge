import { describe, expect, it } from 'vitest';
import {
  buildCapabilityKnowledgeFiles,
  buildCapabilityView,
} from '../../../src/packaging/capability-knowledge-writer.js';
import type { KnowledgeObject } from '../../../src/knowledge/capability-object-assembler.js';

describe('buildCapabilityKnowledgeFiles', () => {
  const objects: KnowledgeObject[] = [
    {
      id: 'CAP-DB-KNOWLEDGE-GENERATION',
      type: 'CAP',
      description: 'DB knowledge generation capability',
      evidencePrimary: ['evidence://behavior/BEH-001'],
      evidenceSupporting: [],
      decisionPoints: ['Which fields to include'],
      sddStageUses: ['requirement_clarification'],
      unsupportedParts: [],
      blockedDecisions: [],
      metadata: { canonicalTerm: 'DB knowledge generation' },
    },
    {
      id: 'FLOW-DB-KNOWLEDGE-GENERATION',
      type: 'FLOW',
      description: 'Flow: collect mappers -> generate object',
      evidencePrimary: ['evidence://flow/FLOW-001'],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: ['design_planning'],
      unsupportedParts: [],
      blockedDecisions: [],
      metadata: { steps: [] },
    },
    {
      id: 'MOD-SRC-MYBATIS',
      type: 'MOD',
      description: 'MyBatis evidence module',
      evidencePrimary: ['evidence://module/MOD-001'],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: ['coding'],
      unsupportedParts: [],
      blockedDecisions: [],
      metadata: { rootPath: 'src/mybatis' },
    },
    {
      id: 'CON-DBOBJECTSCHEMA',
      type: 'CON',
      description: 'DB object schema contract',
      evidencePrimary: ['evidence://contract/CON-001'],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: ['review'],
      unsupportedParts: [],
      blockedDecisions: [],
      metadata: { kind: 'schema', fields: ['id', 'name'] },
    },
    {
      id: 'VER-DB-KNOWLEDGE-GENERATION',
      type: 'VER',
      description: 'Test validation for DB object generation',
      evidencePrimary: ['evidence://validation/VAL-001'],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: ['validation'],
      unsupportedParts: [],
      blockedDecisions: [],
      metadata: { kind: 'test' },
    },
    {
      id: 'OPEN-FIELD-DESCRIPTION-SOURCE',
      type: 'OPEN',
      description: 'Cannot determine source of field descriptions',
      evidencePrimary: [],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: ['requirement_clarification'],
      unsupportedParts: ['Field description inference'],
      blockedDecisions: ['Cannot decide inference acceptability'],
      metadata: {},
    },
  ];

  it('generates catalog.yaml', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-DB-KNOWLEDGE-GENERATION',
    });

    const catalogFile = files.find(f => f.path === 'catalog.yaml');
    expect(catalogFile).toBeDefined();
    expect(catalogFile?.content).toContain('version: 1');
    expect(catalogFile?.content).toContain('CAP-DB-KNOWLEDGE-GENERATION');
  });

  it('generates object files under objects/<type-dir>/', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-DB-KNOWLEDGE-GENERATION',
    });

    const capFile = files.find(f => f.path.includes('objects/capabilities/CAP-DB-KNOWLEDGE-GENERATION'));
    expect(capFile).toBeDefined();

    const flowFile = files.find(f => f.path.includes('objects/flows/'));
    expect(flowFile).toBeDefined();

    const modFile = files.find(f => f.path.includes('objects/modules/'));
    expect(modFile).toBeDefined();

    const conFile = files.find(f => f.path.includes('objects/contracts/'));
    expect(conFile).toBeDefined();

    const verFile = files.find(f => f.path.includes('objects/validation/'));
    expect(verFile).toBeDefined();

    const openFile = files.find(f => f.path.includes('objects/open/'));
    expect(openFile).toBeDefined();
  });

  it('generates capability view under views/capabilities/', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-DB-KNOWLEDGE-GENERATION',
    });

    const viewFile = files.find(f => f.path === 'views/capabilities/CAP-DB-KNOWLEDGE-GENERATION.md');
    expect(viewFile).toBeDefined();
  });

  it('capability view includes required headings', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-DB-KNOWLEDGE-GENERATION',
    });

    const viewFile = files.find(f => f.path === 'views/capabilities/CAP-DB-KNOWLEDGE-GENERATION.md');
    expect(viewFile?.content).toContain('## Purpose');
    expect(viewFile?.content).toContain('## Terms');
    expect(viewFile?.content).toContain('## Current Flow');
    expect(viewFile?.content).toContain('## Code Surface');
    expect(viewFile?.content).toContain('## Contracts');
    expect(viewFile?.content).toContain('## Validation');
    expect(viewFile?.content).toContain('## Unknowns');
  });
});

describe('buildCapabilityView', () => {
  const objects: KnowledgeObject[] = [
    {
      id: 'CAP-TEST',
      type: 'CAP',
      description: 'Test capability',
      evidencePrimary: ['evidence://test'],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
      metadata: {},
    },
    {
      id: 'FLOW-TEST',
      type: 'FLOW',
      description: 'Test flow',
      evidencePrimary: ['evidence://test'],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
      metadata: {},
    },
    {
      id: 'OPEN-TEST',
      type: 'OPEN',
      description: 'Test unknown',
      evidencePrimary: [],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: ['blocked'],
      metadata: {},
    },
  ];

  it('only references object IDs, no new facts', () => {
    const view = buildCapabilityView(objects, 'CAP-TEST');

    // 应该只引用对象 ID
    expect(view).toContain('CAP-TEST');
    expect(view).toContain('FLOW-TEST');
    expect(view).toContain('OPEN-TEST');

    // 不应该复制描述作为事实
    expect(view).not.toContain('Test capability\n');
  });

  it('includes navigation summary', () => {
    const view = buildCapabilityView(objects, 'CAP-TEST');
    expect(view).toContain('# CAP-TEST');
  });
});