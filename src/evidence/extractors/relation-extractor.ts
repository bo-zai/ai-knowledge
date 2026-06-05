import type { EvidenceBundle } from '../evidence-bundle-schema.js';
import type { EvidenceGroup } from '../type-evidence-builder.js';
import type { GenerateTarget } from '../../knowledge/generate-scope.js';
import type { ReadOnlyQueryExecutor } from '../../engine/lbug/read-only-session.js';
import { extractPackagePath } from './shared.js';

/**
 * RELATION: Query Service call relations grouped by source Service.
 */
export async function queryRelationEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split('/').pop() || 'unknown';

  const callCypher = `
    MATCH (s1:Class) WHERE s1.name =~ '(?i).*Service$'
    MATCH (s2:Class) WHERE s2.name =~ '(?i).*Service$' AND s1 <> s2
    MATCH (s1)-[r1:CodeRelation {type: 'CONTAINS'}]->(f1:Function)
    MATCH (f1)-[r2:CodeRelation {type: 'CALLS'}]->(f2:Function)
    MATCH (s2)-[r3:CodeRelation {type: 'CONTAINS'}]->(f2)
    RETURN s1.name as fromService, s2.name as toService,
           f1.name as fromMethod, f2.name as toMethod,
           f1.filePath as filePath
    LIMIT 40
  `;
  const callResults = await executeQuery(callCypher);

  if (callResults.length === 0) {
    return [];
  }

  // Group by source Service
  const serviceGroups = new Map<string, Array<{
    fromService: string;
    toService: string;
    fromMethod: string;
    toMethod: string;
    filePath: string;
  }>>();

  for (const row of callResults) {
    const fromService = row.fromService as string;
    if (!serviceGroups.has(fromService)) {
      serviceGroups.set(fromService, []);
    }
    serviceGroups.get(fromService)!.push(row as any);
  }

  const groups: EvidenceGroup[] = [];

  for (const [serviceName, calls] of serviceGroups.entries()) {
    const packagePath = extractPackagePath(calls[0].filePath);
    const groupId = `RELATION-${serviceName}`;
    const bundleId = `BUNDLE-RELATION-${serviceName}`.toUpperCase();

    const flowTraces: EvidenceBundle['flowTraces'] = calls.map((c, idx) => ({
      ref: `evidence://flow/FLOW-${String(idx + 1).padStart(3, '0')}`,
      steps: [
        { action: `${c.fromService}.${c.fromMethod}`, location: c.filePath },
        { action: `${c.toService}.${c.toMethod}` },
      ],
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-RELATION-${serviceName}`,
        repoProfile: { name: repoName },
        confidence: 0.7,
        risks: [],
        capabilityHints: { nameCandidates: [], relatedTerms: [] },
        entryPoints: [],
        behaviorSlices: [],
        dataContracts: [],
        validationAnchors: [],
        moduleSurfaces: [],
        flowTraces,
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      },
    });
  }

  return groups;
}