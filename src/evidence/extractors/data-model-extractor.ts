import type { EvidenceBundle } from '../evidence-bundle-schema.js';
import type { EvidenceGroup } from '../type-evidence-builder.js';
import type { GenerateTarget } from '../../knowledge/generate-scope.js';
import type { ReadOnlyQueryExecutor } from '../../engine/lbug/read-only-session.js';
import { extractPackagePath, groupByPackagePath } from './shared.js';

/**
 * DATA_MODEL: Query entity classes grouped by package.
 */
export async function queryDataModelEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND c.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  const entityCypher = `
    MATCH (c:Class)-[r:CodeRelation {type: 'CONTAINS'}]->(p:Property)
    WHERE c.name =~ '(?i).*(DO|Entity|Model|VO)$' ${targetFilter}
    RETURN c.name as entityName, c.filePath as filePath, collect(p.name) as fields
    LIMIT 30
  `;
  const entityResults = await executeQuery(entityCypher);

  const packageGroups = groupByPackagePath(
    entityResults as Array<{ entityName: string; filePath: string; fields: string[] }>,
    6,
  );

  const groups: EvidenceGroup[] = [];

  for (const [packagePath, rows] of packageGroups.entries()) {
    const groupId = `DATA_MODEL-${packagePath.replace(/[\/]/g, '-')}`;
    const bundleId = `BUNDLE-DATA_MODEL-${packagePath.replace(/[\/]/g, '-')}`.toUpperCase();

    const dataContracts: EvidenceBundle['dataContracts'] = rows.map((row, idx) => ({
      ref: `evidence://contract/CON-${String(idx + 1).padStart(3, '0')}`,
      kind: 'schema',
      location: row.filePath,
      name: row.entityName,
      fields: row.fields || [],
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-DATA_MODEL-${packagePath}`,
        repoProfile: { name: repoName },
        confidence: 0.75,
        risks: [],
        capabilityHints: {
          nameCandidates: rows.map(r => r.entityName),
          relatedTerms: [],
        },
        entryPoints: [],
        behaviorSlices: [],
        dataContracts,
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