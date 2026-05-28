import { z } from 'zod';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';

export const CandidateClaimSchema = z.object({
  suggestedType: z.enum(['CAP', 'TERM', 'FLOW', 'MOD', 'CON', 'VER', 'OPEN']),
  claimText: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  evidenceRefs: z.array(z.string()),
  decisionPoints: z.array(z.string()),
  sddStageUses: z.array(z.enum([
    'requirement_clarification',
    'requirement_specification',
    'design_planning',
    'implementation_planning',
    'coding',
    'review',
    'validation',
  ])),
  unsupportedParts: z.array(z.string()),
  blockedDecisions: z.array(z.string()),
  objectHints: z.object({
    canonicalTerm: z.string().optional(),
    subject: z.string().optional(),
    modulePath: z.string().optional(),
    contractKind: z.enum(['schema', 'sql', 'api', 'event', 'output']).optional(),
  }).optional(),
});

export type CandidateClaim = z.infer<typeof CandidateClaimSchema>;

function collectBundleRefs(bundle: EvidenceBundle): Set<string> {
  const refs = new Set<string>();
  bundle.entryPoints.forEach(e => refs.add(e.ref));
  bundle.flowTraces.forEach(e => refs.add(e.ref));
  bundle.behaviorSlices.forEach(e => refs.add(e.ref));
  bundle.dataContracts.forEach(e => refs.add(e.ref));
  bundle.moduleSurfaces.forEach(e => refs.add(e.ref));
  bundle.validationAnchors.forEach(e => refs.add(e.ref));
  bundle.docs.forEach(e => refs.add(e.ref));
  return refs;
}

export function filterCandidateClaims(claims: CandidateClaim[], bundle: EvidenceBundle): CandidateClaim[] {
  const validRefs = collectBundleRefs(bundle);

  return claims.filter(claim => {
    // OPEN claim 必须有 blockedDecisions
    if (claim.suggestedType === 'OPEN') {
      if (claim.blockedDecisions.length === 0) {
        return false;
      }
      return true;
    }

    // 非 OPEN claim 必须有 evidence refs
    if (claim.evidenceRefs.length === 0) {
      return false;
    }

    // 非 OPEN claim 的 evidence refs 必须存在于 bundle
    for (const ref of claim.evidenceRefs) {
      if (!validRefs.has(ref)) {
        return false;
      }
    }

    // 非 OPEN claim 的 confidence 不能是 low
    if (claim.confidence === 'low') {
      return false;
    }

    return true;
  });
}

export function buildCapabilityClaimPrompt(bundle: EvidenceBundle): string {
  const lines: string[] = [
    'Generate candidate claims for a capability knowledge object.',
    '',
    'HARD RULES:',
    '- use only bundle evidence',
    '- every non-OPEN claim cites evidence refs',
    '- missing evidence becomes OPEN',
    '- do not create object IDs or file paths',
    '- low confidence non-OPEN claims are rejected',
    '',
    'CAPABILITY HINTS:',
    `- name candidates: ${bundle.capabilityHints.nameCandidates.join(', ')}`,
    `- related terms: ${bundle.capabilityHints.relatedTerms.join(', ')}`,
  ];

  if (bundle.capabilityHints.summaryHint) {
    lines.push(`- summary hint: ${bundle.capabilityHints.summaryHint}`);
  }

  lines.push('');
  lines.push('AVAILABLE EVIDENCE REFS:');
  bundle.entryPoints.forEach(e => lines.push(`- ${e.ref}: ${e.kind} entry "${e.name}" at ${e.location}`));
  bundle.behaviorSlices.forEach(e => lines.push(`- ${e.ref}: behavior "${e.verb} ${e.object}" at ${e.location}`));
  bundle.dataContracts.forEach(e => lines.push(`- ${e.ref}: ${e.kind} contract "${e.name}" at ${e.location}`));
  bundle.moduleSurfaces.forEach(e => lines.push(`- ${e.ref}: module surface at ${e.rootPath}`));
  bundle.validationAnchors.forEach(e => lines.push(`- ${e.ref}: validation anchor "${e.name}" at ${e.location}`));
  bundle.flowTraces.forEach(e => lines.push(`- ${e.ref}: flow trace with ${e.steps.length} steps`));

  if (bundle.negativeEvidence.length > 0) {
    lines.push('');
    lines.push('NEGATIVE EVIDENCE:');
    bundle.negativeEvidence.forEach(n => lines.push(`- ${n.id}: ${n.kind} - ${n.description}`));
  }

  if (bundle.openQuestions.length > 0) {
    lines.push('');
    lines.push('OPEN QUESTION SEEDS:');
    bundle.openQuestions.forEach(q => lines.push(`- ${q.id}: ${q.question}`));
  }

  lines.push('');
  lines.push('OUTPUT FORMAT:');
  lines.push('Return JSON array of claims with fields:');
  lines.push('suggestedType, claimText, confidence, evidenceRefs, decisionPoints, sddStageUses, unsupportedParts, blockedDecisions');
  lines.push('');
  lines.push('Generate claims now.');

  return lines.join('\n');
}