import type { EvidenceBundle } from '../evidence-bundle-schema.js';
import type { EvidenceGroup } from '../type-evidence-builder.js';
import type { GenerateTarget } from '../../knowledge/generate-scope.js';
import type { ReadOnlyQueryExecutor } from '../../engine/lbug/read-only-session.js';
import { extractPackagePath, groupByPackagePath } from './shared.js';

/**
 * CONSTRAINT: Query exceptions and throws grouped by package.
 */
export async function queryConstraintEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND c.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  const exceptionCypher = `
    MATCH (c:Class) WHERE c.name =~ '(?i).*(Exception|Error)$' ${targetFilter}
    RETURN c.name as name, c.filePath as filePath
    LIMIT 20
  `;
  const exceptionResults = await executeQuery(exceptionCypher);

  const throwCypher = `
    MATCH (f:Function) WHERE f.content CONTAINS 'throw'
    RETURN f.name as name, f.filePath as filePath
    LIMIT 15
  `;
  const throwResults = await executeQuery(throwCypher);

  const allResults = [
    ...exceptionResults.map(r => ({ ...r, verb: 'define' })),
    ...throwResults.map(r => ({ ...r, verb: 'throw' })),
  ] as Array<{ name: string; filePath: string; verb: string }>;

  if (allResults.length === 0) {
    return [];
  }

  const packageGroups = groupByPackagePath(allResults, 8);

  const groups: EvidenceGroup[] = [];

  for (const [packagePath, rows] of packageGroups.entries()) {
    const groupId = `CONSTRAINT-${packagePath.replace(/[\/]/g, '-')}`;
    const bundleId = `BUNDLE-CONSTRAINT-${packagePath.replace(/[\/]/g, '-')}`.toUpperCase();

    const behaviorSlices: EvidenceBundle['behaviorSlices'] = rows.map((row, idx) => ({
      ref: `evidence://behavior/BEH-${String(idx + 1).padStart(3, '0')}`,
      location: row.filePath,
      verb: row.verb,
      object: row.name,
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-CONSTRAINT-${packagePath}`,
        repoProfile: { name: repoName },
        confidence: 0.65,
        risks: [],
        capabilityHints: { nameCandidates: [], relatedTerms: [] },
        entryPoints: [],
        behaviorSlices,
        dataContracts: [],
        validationAnchors: [],
        moduleSurfaces: [],
        flowTraces: [],
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      },
    });
  }

  return groups;
}