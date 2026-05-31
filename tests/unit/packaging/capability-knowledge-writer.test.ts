import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildCapabilityKnowledgeFiles,
  buildCapabilityView,
  type EvidenceIndexItem,
} from '../../../src/packaging/capability-knowledge-writer.js';
import { writeCapabilityKnowledgePackage } from '../../../src/packaging/capability-knowledge-writer.js';
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

  it('capability view includes required business knowledge sections', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-DB-KNOWLEDGE-GENERATION',
    });

    const viewFile = files.find(f => f.path === 'views/capabilities/CAP-DB-KNOWLEDGE-GENERATION.md');
    expect(viewFile?.content).toContain('## Requirement Intent');
    expect(viewFile?.content).toContain('## Current Behavior');
    expect(viewFile?.content).toContain('## Business Terms');
    expect(viewFile?.content).toContain('## Contracts');
    expect(viewFile?.content).toContain('## Code Anchors');
    expect(viewFile?.content).toContain('## Validation');
    expect(viewFile?.content).toContain('## Unknowns and Escalation');
  });

  it('catalog includes capability routing mapping', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-DB-KNOWLEDGE-GENERATION',
    });

    const catalog = files.find(f => f.path === 'catalog.yaml')?.content ?? '';
    expect(catalog).toContain('capabilities:');
    expect(catalog).toContain('CAP-DB-KNOWLEDGE-GENERATION:');
    expect(catalog).toContain('view: views/capabilities/CAP-DB-KNOWLEDGE-GENERATION.md');
    expect(catalog).toContain('objects:');
    expect(catalog).toContain('- CAP-DB-KNOWLEDGE-GENERATION');
    expect(catalog).toContain('- FLOW-DB-KNOWLEDGE-GENERATION');
    expect(catalog).toContain('- MOD-SRC-MYBATIS');
  });

  it('catalog capability section lists all generated objects', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-DB-KNOWLEDGE-GENERATION',
    });

    const catalog = files.find(f => f.path === 'catalog.yaml')?.content ?? '';
    expect(catalog).toContain('- CON-DBOBJECTSCHEMA');
    expect(catalog).toContain('- VER-DB-KNOWLEDGE-GENERATION');
    expect(catalog).toContain('- OPEN-FIELD-DESCRIPTION-SOURCE');
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

  it('includes object ID and description on each line', () => {
    const view = buildCapabilityView(objects, 'CAP-TEST');

    // 每行包含对象 ID 和简短描述
    expect(view).toContain('- CAP-TEST: Test capability');
    expect(view).toContain('- FLOW-TEST: Test flow');
    expect(view).toContain('- OPEN-TEST: Test unknown');
  });

  it('builds capability view using business knowledge sections', () => {
    const view = buildCapabilityView(objects, 'CAP-TEST');

    expect(view).toContain('## Requirement Intent');
    expect(view).toContain('## Current Behavior');
    expect(view).toContain('## Business Terms');
    expect(view).toContain('## Contracts');
    expect(view).toContain('## Code Anchors');
    expect(view).toContain('## Validation');
    expect(view).toContain('## Unknowns and Escalation');
  });

  it('includes navigation summary', () => {
    const view = buildCapabilityView(objects, 'CAP-TEST');
    expect(view).toContain('# CAP-TEST');
  });
});

describe('evidence index', () => {
  const objects: KnowledgeObject[] = [
    {
      id: 'CAP-COURSE-MANAGEMENT',
      type: 'CAP',
      description: 'Course management capability',
      evidencePrimary: ['evidence://entry/EP-001'],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
      metadata: {},
    },
    {
      id: 'FLOW-COURSE-MANAGEMENT',
      type: 'FLOW',
      description: 'Course flow',
      evidencePrimary: ['evidence://flow/FLOW-001'],
      evidenceSupporting: [],
      decisionPoints: [],
      sddStageUses: [],
      unsupportedParts: [],
      blockedDecisions: [],
      metadata: {},
    },
  ];

  const evidenceIndex: EvidenceIndexItem[] = [
    { ref: 'evidence://entry/EP-001', kind: 'entry', location: 'src/main/java/com/demo/controller/CourseController.java', name: 'getCourse', targetRelevance: 0.9 },
    { ref: 'evidence://flow/FLOW-001', kind: 'flow', name: 'flow trace', summary: 'getCourse -> selectCourse', targetRelevance: 0.85 },
    { ref: 'evidence://contract/CON-001', kind: 'contract', location: 'src/main/resources/mapper/CourseMapper.xml', name: 'selectCourse', targetRelevance: 0.8 },
    { ref: 'evidence://module/MOD-001', kind: 'module', location: 'src/main/java/com/demo/controller', name: 'src/main/java/com/demo/controller', targetRelevance: 0.75 },
    { ref: 'evidence://validation/VAL-001', kind: 'validation', location: 'src/test/java/com/demo/service/CourseServiceTest.java', name: 'shouldLoadCourse', targetRelevance: 0.7 },
  ];

  it('generates evidence/index.jsonl when evidenceIndex is provided', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-COURSE-MANAGEMENT',
      evidenceIndex,
    });

    const indexFile = files.find(f => f.path === 'evidence/index.jsonl');
    expect(indexFile).toBeDefined();
  });

  it('evidence index contains refs from input', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-COURSE-MANAGEMENT',
      evidenceIndex,
    });

    const indexFile = files.find(f => f.path === 'evidence/index.jsonl');
    const content = indexFile?.content ?? '';

    expect(content).toContain('evidence://entry/EP-001');
    expect(content).toContain('evidence://flow/FLOW-001');
    expect(content).toContain('evidence://contract/CON-001');
  });

  it('evidence index is valid JSONL (one JSON object per line)', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-COURSE-MANAGEMENT',
      evidenceIndex,
    });

    const indexFile = files.find(f => f.path === 'evidence/index.jsonl');
    const lines = (indexFile?.content ?? '').trim().split('\n');

    expect(lines.length).toBe(evidenceIndex.length);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty('ref');
      expect(parsed).toHaveProperty('kind');
    }
  });

  it('evidence index includes targetRelevance when present', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-COURSE-MANAGEMENT',
      evidenceIndex,
    });

    const indexFile = files.find(f => f.path === 'evidence/index.jsonl');
    const lines = (indexFile?.content ?? '').trim().split('\n');

    const entryLine = lines.find(l => l.includes('EP-001'));
    const parsed = JSON.parse(entryLine ?? '{}');
    expect(parsed.targetRelevance).toBe(0.9);
  });

  it('does not generate evidence/index.jsonl when evidenceIndex is empty or undefined', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-COURSE-MANAGEMENT',
    });

    const indexFile = files.find(f => f.path === 'evidence/index.jsonl');
    expect(indexFile).toBeUndefined();
  });
});

describe('report with LangGraph metadata', () => {
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
  ];

  it('includes llmRuntime and graph in report JSON', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-TEST',
      report: {
        mode: 'llm',
        llmRequested: true,
        llmRequired: true,
        llmCalled: true,
        llmSucceeded: true,
        llmRuntime: 'langgraph',
        model: 'test-model',
        graph: {
          attempts: 2,
          repaired: true,
          validationErrors: ['Invalid JSON at index 0'],
        },
        claimCounts: { llmRaw: 5, llmAccepted: 3, skeletonAdded: 2, final: 5 },
        warnings: [],
      },
    });

    const reportFile = files.find(f => f.path === 'reports/capability-generation.json');
    expect(reportFile).toBeDefined();

    const report = JSON.parse(reportFile!.content);
    expect(report.llmRuntime).toBe('langgraph');
    expect(report.graph).toEqual({
      attempts: 2,
      repaired: true,
      validationErrors: ['Invalid JSON at index 0'],
    });
  });

  it('includes objectSourceCounts and requiredBusinessObjects in report', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-TEST',
      report: {
        mode: 'llm',
        llmRequested: true,
        llmRequired: true,
        llmCalled: true,
        llmSucceeded: true,
        llmRuntime: 'langgraph',
        model: 'test-model',
        claimCounts: { llmRaw: 5, llmAccepted: 3, skeletonAdded: 2, final: 5 },
        objectSourceCounts: { llm: 3, skeleton: 2, evidence_seed: 1 },
        requiredBusinessObjects: {
          capFromLlm: true,
          flowOrConFromLlm: true,
          modPresent: true,
          verOrValidationOpenPresent: true,
        },
        warnings: [],
      },
    });

    const reportFile = files.find(f => f.path === 'reports/capability-generation.json');
    expect(reportFile).toBeDefined();

    const report = JSON.parse(reportFile!.content);
    expect(report.objectSourceCounts).toEqual({ llm: 3, skeleton: 2, evidence_seed: 1 });
    expect(report.requiredBusinessObjects).toEqual({
      capFromLlm: true,
      flowOrConFromLlm: true,
      modPresent: true,
      verOrValidationOpenPresent: true,
    });
  });

  it('includes graphTrace in debug JSON', () => {
    const files = buildCapabilityKnowledgeFiles({
      objects,
      capabilityId: 'CAP-TEST',
      debug: {
        request: { model: 'test-model', systemPrompt: 'system', userPrompt: 'user' },
        response: { rawText: '[]' },
        graphTrace: {
          attempts: 1,
          repaired: false,
          validationErrors: [],
        },
      },
    });

    const debugFile = files.find(f => f.path === 'debug/capability-llm-request.json');
    expect(debugFile).toBeDefined();
  });
});

describe('writeCapabilityKnowledgePackage', () => {
  it('removes stale files from previous bootstrap-knowledge output before writing', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'capability-clean-output-'));
    const staleFile = join(outputRoot, 'bootstrap-knowledge', 'objects', 'contracts', 'CON-LOGAOP.yaml');
    await mkdir(dirname(staleFile), { recursive: true });
    await writeFile(staleFile, 'id: CON-LOGAOP\n');

    await writeCapabilityKnowledgePackage({
      outputRoot,
      capabilityId: 'CAP-GOODS-ORDER-CAPABILITY',
      objects: [
        {
          id: 'CAP-GOODS-ORDER-CAPABILITY',
          type: 'CAP',
          description: 'Goods Order capability',
          evidencePrimary: ['evidence://entry/EP-001'],
          evidenceSupporting: [],
          decisionPoints: ['matched_capability'],
          sddStageUses: ['requirement_clarification'],
          unsupportedParts: [],
          blockedDecisions: [],
          metadata: { canonicalTerm: 'Goods Order capability' },
        },
      ],
      evidenceIndex: [
        {
          ref: 'evidence://entry/EP-001',
          kind: 'entry',
          location: 'src/main/java/demo/OrderGoodsService.java',
          name: 'OrderGoodsService',
        },
      ],
    });

    await expect(access(staleFile)).rejects.toThrow();
    await expect(access(join(outputRoot, 'bootstrap-knowledge', 'catalog.yaml'))).resolves.toBeUndefined();
  });
});