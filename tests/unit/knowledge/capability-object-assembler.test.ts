import { describe, expect, it } from 'vitest';
import {
  makeObjectId,
  assembleCapabilityKnowledgeObjects,
} from '../../../src/knowledge/capability-object-assembler.js';
import type { EvidenceBundle } from '../../../src/evidence/evidence-bundle-schema.js';
import type { CandidateClaim } from '../../../src/generation/capability-claim-generator.js';

describe('makeObjectId', () => {
  it('creates CAP object ID', () => {
    const id = makeObjectId('CAP', 'DB knowledge generation');
    expect(id).toBe('CAP-DB-KNOWLEDGE-GENERATION');
  });

  it('creates FLOW object ID', () => {
    const id = makeObjectId('FLOW', 'DB knowledge generation flow');
    expect(id).toBe('FLOW-DB-KNOWLEDGE-GENERATION-FLOW');
  });

  it('trims punctuation', () => {
    const id = makeObjectId('MOD', 'mybatis/evidence.handler');
    expect(id).toBe('MOD-MYBATIS-EVIDENCE-HANDLER');
  });

  it('replaces non-alphanumeric runs with dash', () => {
    const id = makeObjectId('CON', 'db_object-schema');
    expect(id).toBe('CON-DB-OBJECT-SCHEMA');
  });

  it('handles uppercase input', () => {
    const id = makeObjectId('VER', 'DB Knowledge Generation');
    expect(id).toBe('VER-DB-KNOWLEDGE-GENERATION');
  });
});

describe('assembleCapabilityKnowledgeObjects', () => {
  const bundle: EvidenceBundle = {
    bundleId: 'BUNDLE-001',
    candidateId: 'CAND-DB-KNOWLEDGE-GENERATION',
    repoProfile: { name: 'ai-wiki' },
    confidence: 0.78,
    risks: ['no_external_boundary_found'],
    capabilityHints: {
      nameCandidates: ['DB knowledge generation'],
      relatedTerms: ['db object', 'description source'],
    },
    entryPoints: [{
      ref: 'evidence://entry/EP-001',
      kind: 'cli',
      location: 'src/cli/generate.ts',
      name: 'generate command',
    }],
    flowTraces: [{
      ref: 'evidence://flow/FLOW-EVID-001',
      steps: [
        { action: 'collect mybatis mapper files', location: 'src/mybatis/mapper-reader.ts' },
        { action: 'extract sql evidence', location: 'src/mybatis/sql-evidence.ts' },
        { action: 'generate db object', location: 'src/generation/db-generator.ts' },
      ],
    }],
    behaviorSlices: [{
      ref: 'evidence://behavior/BEH-001',
      location: 'src/generation/db-generator.ts',
      verb: 'generate',
      object: 'db object',
      summary: 'Generates DB knowledge object from MyBatis evidence',
    }],
    dataContracts: [{
      ref: 'evidence://contract/CON-EVID-001',
      kind: 'schema',
      location: 'src/schemas/object-schemas.ts',
      name: 'DBObjectSchema',
      fields: ['id', 'name', 'description_zh', 'description_source'],
    }],
    moduleSurfaces: [{
      ref: 'evidence://module/MOD-001',
      rootPath: 'src/mybatis',
      exports: ['extractMyBatisEvidence', 'parseMapperFile'],
      responsibilities: ['MyBatis mapper parsing', 'SQL evidence extraction'],
    }],
    validationAnchors: [{
      ref: 'evidence://validation/VAL-001',
      kind: 'test',
      location: 'tests/unit/generation/db-generator.test.ts',
      name: 'generates valid db object',
      assertion: 'expect(result.id).toBeDefined()',
    }],
    docs: [],
    negativeEvidence: [{
      id: 'NEG-001',
      kind: 'missing_boundary',
      description: 'No explicit external DB ownership contract found',
      impact: 'Cannot determine if DB schema changes require coordination',
    }],
    openQuestions: [{
      id: 'OPEN-SEED-001',
      question: 'What is the source of field descriptions?',
      blockedDecisions: ['Cannot determine if description inference is acceptable'],
      minimalNextEvidence: 'Find documentation or comments explaining description_source values',
    }],
  };

  const claims: CandidateClaim[] = [
    {
      suggestedType: 'CAP',
      claimText: 'DB knowledge generation capability transforms MyBatis evidence into DB knowledge objects',
      confidence: 'high',
      evidenceRefs: ['evidence://behavior/BEH-001', 'evidence://contract/CON-EVID-001'],
      decisionPoints: ['Which fields to include in DB object', 'How to infer descriptions'],
      sddStageUses: ['requirement_clarification', 'design_planning'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { canonicalTerm: 'DB knowledge generation' },
    },
    {
      suggestedType: 'FLOW',
      claimText: 'Flow: collect mappers -> extract evidence -> generate object',
      confidence: 'high',
      evidenceRefs: ['evidence://flow/FLOW-EVID-001'],
      decisionPoints: [],
      sddStageUses: ['design_planning'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { subject: 'DB knowledge generation' },
    },
    {
      suggestedType: 'MOD',
      claimText: 'MyBatis evidence module handles mapper parsing and SQL extraction',
      confidence: 'high',
      evidenceRefs: ['evidence://module/MOD-001'],
      decisionPoints: [],
      sddStageUses: ['implementation_planning', 'coding'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { modulePath: 'src/mybatis' },
    },
    {
      suggestedType: 'CON',
      claimText: 'DB object schema contract defines the structure of generated DB knowledge objects',
      confidence: 'high',
      evidenceRefs: ['evidence://contract/CON-EVID-001'],
      decisionPoints: [],
      sddStageUses: ['design_planning', 'review'],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { contractKind: 'schema' },
    },
    {
      suggestedType: 'VER',
      claimText: 'Test validation anchor confirms DB object generation produces valid output',
      confidence: 'high',
      evidenceRefs: ['evidence://validation/VAL-001'],
      decisionPoints: [],
      sddStageUses: ['validation', 'review'],
      unsupportedParts: [],
      blockedDecisions: [],
    },
    {
      suggestedType: 'OPEN',
      claimText: 'Cannot determine acceptable sources for field descriptions',
      confidence: 'low',
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: ['requirement_clarification'],
      unsupportedParts: ['Field description inference logic'],
      blockedDecisions: ['Cannot decide if inferred descriptions are acceptable'],
    },
  ];

  it('creates CAP-DB-KNOWLEDGE-GENERATION', () => {
    const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
    const cap = objects.find(o => o.id === 'CAP-DB-KNOWLEDGE-GENERATION');
    expect(cap).toBeDefined();
    expect(cap?.type).toBe('CAP');
  });

  it('creates FLOW-DB-KNOWLEDGE-GENERATION', () => {
    const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
    const flow = objects.find(o => o.id === 'FLOW-DB-KNOWLEDGE-GENERATION');
    expect(flow).toBeDefined();
    expect(flow?.type).toBe('FLOW');
  });

  it('creates MOD-MYBATIS-EVIDENCE', () => {
    const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
    const mod = objects.find(o => o.id.includes('MYBATIS') && o.type === 'MOD');
    expect(mod).toBeDefined();
    expect(mod?.type).toBe('MOD');
  });

  it('creates CON-DB-OBJECT-SCHEMA', () => {
    const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
    const con = objects.find(o => o.id.startsWith('CON-DB'));
    expect(con).toBeDefined();
    expect(con?.type).toBe('CON');
  });

  it('creates VER-DB-KNOWLEDGE-GENERATION', () => {
    const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
    const ver = objects.find(o => o.id.startsWith('VER-DB'));
    expect(ver).toBeDefined();
    expect(ver?.type).toBe('VER');
  });

  it('creates at least one OPEN object', () => {
    const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
    const opens = objects.filter(o => o.type === 'OPEN');
    expect(opens.length).toBeGreaterThanOrEqual(1);
  });

  it('every non-OPEN object has non-empty evidencePrimary', () => {
    const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
    const nonOpens = objects.filter(o => o.type !== 'OPEN');
    for (const obj of nonOpens) {
      expect(obj.evidencePrimary?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('includes claim text as description', () => {
    const objects = assembleCapabilityKnowledgeObjects({ bundle, claims });
    const cap = objects.find(o => o.type === 'CAP');
    expect(cap?.description).toContain('DB knowledge generation');
  });

  it('preserves term metadata from claim object hints', () => {
    const bundle: EvidenceBundle = {
      bundleId: 'BUNDLE-TERM-001',
      candidateId: 'CAND-GOODS-ORDER',
      repoProfile: { name: 'test-repo' },
      confidence: 0.8,
      risks: [],
      capabilityHints: {
        nameCandidates: ['Goods Order capability'],
        relatedTerms: ['goods', 'order'],
      },
      entryPoints: [{
        ref: 'evidence://entry/EP-001',
        kind: 'service',
        location: 'src/main/java/demo/OrderGoodsService.java',
        name: 'OrderGoodsService',
      }],
      flowTraces: [],
      behaviorSlices: [],
      dataContracts: [],
      moduleSurfaces: [],
      validationAnchors: [],
      docs: [],
      negativeEvidence: [],
      openQuestions: [],
    };

    const objects = assembleCapabilityKnowledgeObjects({
      bundle,
      claims: [
        {
          suggestedType: 'TERM',
          claimText: 'goods is a business term evidenced within Goods Order capability.',
          confidence: 'medium',
          evidenceRefs: ['evidence://entry/EP-001'],
          decisionPoints: ['business_vocabulary'],
          sddStageUses: ['requirement_clarification'],
          unsupportedParts: [],
          blockedDecisions: [],
          objectHints: {
            canonicalTerm: 'goods',
            termSource: 'evidence_match',
            matchedEvidenceCount: 2,
          },
        },
      ],
    });

    expect(objects).toHaveLength(1);
    expect(objects[0]!.id).toBe('TERM-GOODS');
    expect(objects[0]!.metadata).toMatchObject({
      canonicalTerm: 'goods',
    });
    expect(objects[0]!.metadata.source).toBe('llm');
  });
});