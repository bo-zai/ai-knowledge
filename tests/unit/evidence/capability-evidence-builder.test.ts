import { describe, expect, it } from 'vitest';
import {
  EvidenceBundleSchema,
  EvidenceEntryPointSchema,
  EvidenceBehaviorSliceSchema,
  EvidenceDataContractSchema,
  EvidenceFlowTraceSchema,
  EvidenceModuleSurfaceSchema,
  EvidenceValidationAnchorSchema,
  NegativeEvidenceSchema,
  OpenQuestionSeedSchema,
} from '../../../src/evidence/evidence-bundle-schema.js';

describe('EvidenceEntryPointSchema', () => {
  it('accepts valid entry point', () => {
    const entry = EvidenceEntryPointSchema.parse({
      ref: 'evidence://entry/EP-001',
      kind: 'cli',
      location: 'src/cli/generate.ts',
      name: 'generate command',
      signature: 'generate(options: GenerateOptions): Promise<void>',
    });
    expect(entry.ref).toBe('evidence://entry/EP-001');
  });

  it('rejects missing ref', () => {
    expect(() =>
      EvidenceEntryPointSchema.parse({
        kind: 'cli',
        location: 'src/cli/generate.ts',
        name: 'generate command',
      }),
    ).toThrow();
  });
});

describe('EvidenceBehaviorSliceSchema', () => {
  it('accepts valid behavior slice', () => {
    const slice = EvidenceBehaviorSliceSchema.parse({
      ref: 'evidence://behavior/BEH-001',
      location: 'src/generation/db-generator.ts',
      verb: 'generate',
      object: 'db object',
      summary: 'Generates DB knowledge object from MyBatis evidence',
    });
    expect(slice.ref).toBe('evidence://behavior/BEH-001');
  });
});

describe('EvidenceDataContractSchema', () => {
  it('accepts valid data contract', () => {
    const contract = EvidenceDataContractSchema.parse({
      ref: 'evidence://contract/CON-001',
      kind: 'schema',
      location: 'src/schemas/object-schemas.ts',
      name: 'DBObjectSchema',
      fields: ['id', 'name', 'description_zh', 'description_source'],
    });
    expect(contract.ref).toBe('evidence://contract/CON-001');
  });
});

describe('EvidenceFlowTraceSchema', () => {
  it('accepts valid flow trace', () => {
    const flow = EvidenceFlowTraceSchema.parse({
      ref: 'evidence://flow/FLOW-001',
      steps: [
        { action: 'collect mybatis mapper files', location: 'src/mybatis/mapper-reader.ts' },
        { action: 'extract sql evidence', location: 'src/mybatis/sql-evidence.ts' },
        { action: 'generate db object', location: 'src/generation/db-generator.ts' },
      ],
    });
    expect(flow.steps.length).toBe(3);
  });
});

describe('EvidenceModuleSurfaceSchema', () => {
  it('accepts valid module surface', () => {
    const surface = EvidenceModuleSurfaceSchema.parse({
      ref: 'evidence://module/MOD-001',
      rootPath: 'src/mybatis',
      exports: ['extractMyBatisEvidence', 'parseMapperFile'],
      responsibilities: ['MyBatis mapper parsing', 'SQL evidence extraction'],
    });
    expect(surface.rootPath).toBe('src/mybatis');
  });
});

describe('EvidenceValidationAnchorSchema', () => {
  it('accepts valid validation anchor', () => {
    const anchor = EvidenceValidationAnchorSchema.parse({
      ref: 'evidence://validation/VAL-001',
      kind: 'test',
      location: 'tests/unit/generation/db-generator.test.ts',
      name: 'generates valid db object',
      assertion: 'expect(result.id).toBeDefined()',
    });
    expect(anchor.kind).toBe('test');
  });
});

describe('NegativeEvidenceSchema', () => {
  it('accepts valid negative evidence', () => {
    const neg = NegativeEvidenceSchema.parse({
      id: 'NEG-001',
      kind: 'missing_boundary',
      description: 'No explicit external DB ownership contract found',
      impact: 'Cannot determine if DB schema changes require coordination',
    });
    expect(neg.kind).toBe('missing_boundary');
  });
});

describe('OpenQuestionSeedSchema', () => {
  it('accepts valid open question seed', () => {
    const seed = OpenQuestionSeedSchema.parse({
      id: 'OPEN-SEED-001',
      question: 'What is the source of field descriptions?',
      blockedDecisions: ['Cannot determine if description inference is acceptable'],
      minimalNextEvidence: 'Find documentation or comments explaining description_source values',
    });
    expect(seed.question).toContain('source');
  });
});

describe('EvidenceBundleSchema', () => {
  it('accepts minimal valid bundle', () => {
    const bundle = EvidenceBundleSchema.parse({
      bundleId: 'BUNDLE-DB-KNOWLEDGE-001',
      candidateId: 'CAND-DB-KNOWLEDGE-GENERATION',
      repoProfile: {
        name: 'ai-wiki',
        language: 'typescript',
        framework: 'node',
      },
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
        ref: 'evidence://flow/FLOW-001',
        steps: [],
      }],
      behaviorSlices: [{
        ref: 'evidence://behavior/BEH-001',
        location: 'src/generation/db-generator.ts',
        verb: 'generate',
        object: 'db object',
      }],
      dataContracts: [{
        ref: 'evidence://contract/CON-001',
        kind: 'schema',
        location: 'src/schemas/object-schemas.ts',
        name: 'DBObjectSchema',
      }],
      moduleSurfaces: [{
        ref: 'evidence://module/MOD-001',
        rootPath: 'src/mybatis',
        exports: [],
        responsibilities: [],
      }],
      validationAnchors: [{
        ref: 'evidence://validation/VAL-001',
        kind: 'test',
        location: 'tests/unit/generation/db-generator.test.ts',
        name: 'generates valid db object',
      }],
      docs: [],
      negativeEvidence: [{
        id: 'NEG-001',
        kind: 'missing_boundary',
        description: 'No external DB contract',
        impact: 'Cannot determine DB ownership',
      }],
      openQuestions: [{
        id: 'OPEN-SEED-001',
        question: 'What is the source of field descriptions?',
        blockedDecisions: ['Cannot determine inference acceptability'],
        minimalNextEvidence: 'Find documentation about description_source',
      }],
    });

    expect(bundle.bundleId).toBe('BUNDLE-DB-KNOWLEDGE-001');
    expect(bundle.candidateId).toBe('CAND-DB-KNOWLEDGE-GENERATION');
  });

  it('rejects missing bundleId', () => {
    expect(() =>
      EvidenceBundleSchema.parse({
        candidateId: 'CAND-001',
        repoProfile: { name: 'test' },
        confidence: 0.5,
        risks: [],
        capabilityHints: { nameCandidates: ['Test'] },
        entryPoints: [],
        flowTraces: [],
        behaviorSlices: [],
        dataContracts: [],
        moduleSurfaces: [],
        validationAnchors: [],
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      }),
    ).toThrow();
  });

  it('rejects missing candidateId', () => {
    expect(() =>
      EvidenceBundleSchema.parse({
        bundleId: 'BUNDLE-001',
        repoProfile: { name: 'test' },
        confidence: 0.5,
        risks: [],
        capabilityHints: { nameCandidates: ['Test'] },
        entryPoints: [],
        flowTraces: [],
        behaviorSlices: [],
        dataContracts: [],
        moduleSurfaces: [],
        validationAnchors: [],
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      }),
    ).toThrow();
  });
});
