import { describe, expect, it } from 'vitest';
import {
  runCapabilityKnowledgePipeline,
} from '../../../src/knowledge/capability-knowledge-pipeline.js';
import type { CandidateClaim } from '../../../src/generation/capability-claim-generator.js';

describe('runCapabilityKnowledgePipeline', () => {
  it('generates files for targeted DB knowledge capability', async () => {
    // 使用 OPEN claims，因为它们不需要 evidence refs
    const mockClaims: CandidateClaim[] = [
      {
        suggestedType: 'OPEN',
        claimText: 'Cannot determine field description source',
        confidence: 'low',
        evidenceRefs: [],
        decisionPoints: [],
        sddStageUses: ['requirement_clarification'],
        unsupportedParts: ['Field description inference'],
        blockedDecisions: ['Cannot decide inference acceptability'],
      },
      {
        suggestedType: 'OPEN',
        claimText: 'Need to verify DB ownership contract',
        confidence: 'low',
        evidenceRefs: [],
        decisionPoints: [],
        sddStageUses: ['design_planning'],
        unsupportedParts: ['External DB contract'],
        blockedDecisions: ['Cannot proceed with external coordination'],
      },
    ];

    const result = await runCapabilityKnowledgePipeline({
      repoRoot: '.',
      targetTerms: ['db', 'mybatis', 'knowledge'],
      targetPaths: ['src/mybatis', 'src/evidence', 'src/knowledge', 'src/schemas'],
      claimsProvider: async () => mockClaims,
    });

    expect(result.files.length).toBeGreaterThan(0);

    // 验证 catalog
    const catalog = result.files.find(f => f.path === 'catalog.yaml');
    expect(catalog).toBeDefined();

    // 验证 OPEN 对象 (至少一个)
    const open = result.files.find(f => f.path.includes('objects/open/OPEN-'));
    expect(open).toBeDefined();

    // 验证 capability view
    const view = result.files.find(f => f.path.startsWith('views/capabilities/') && f.path.endsWith('.md'));
    expect(view).toBeDefined();
  });

  it('returns no files when no candidate found', async () => {
    const result = await runCapabilityKnowledgePipeline({
      repoRoot: '.',
      targetTerms: [],
      targetPaths: [],
      claimsProvider: async () => [],
    });

    expect(result.files.length).toBe(0);
  });

  it('includes pipeline metadata', async () => {
    const mockClaims: CandidateClaim[] = [
      {
        suggestedType: 'OPEN',
        claimText: 'Test question',
        confidence: 'low',
        evidenceRefs: [],
        decisionPoints: [],
        sddStageUses: [],
        unsupportedParts: [],
        blockedDecisions: ['blocked'],
      },
    ];

    const result = await runCapabilityKnowledgePipeline({
      repoRoot: '.',
      targetTerms: ['test'],
      targetPaths: ['src/test'],
      claimsProvider: async () => mockClaims,
    });

    expect(result.metadata.capabilityId).toBeDefined();
    expect(result.metadata.confidence).toBeGreaterThanOrEqual(0);
  });
});