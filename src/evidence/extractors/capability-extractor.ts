import type { EvidenceBundle } from '../evidence-bundle-schema.js';
import type { EvidenceGroup } from '../type-evidence-builder.js';
import type { GenerateTarget } from '../../knowledge/generate-scope.js';
import type { ReadOnlyQueryExecutor } from '../../engine/lbug/read-only-session.js';
import { extractPackagePath } from './shared.js';

/**
 * CAPABILITY: Query Controller methods grouped by Controller class.
 * Each Controller is treated as a separate group (one capability domain).
 */
export async function queryCapabilityEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND m.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  const controllerCypher = `
    MATCH (c:Class) WHERE c.name =~ '(?i).*Controller$'
    AND NOT c.filePath =~ '(?i).*(test|spec|node_modules).*'
    MATCH (c)-[r:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
    WHERE true ${targetFilter}
    RETURN c.name as className, m.name as methodName, c.filePath as filePath,
           m.returnType as returnType, m.parameterCount as parameterCount, m.startLine as startLine
    ORDER BY c.name, m.name
    LIMIT 60
  `;
  const controllerResults = await executeQuery(controllerCypher);

  // Group by Controller class
  const controllerGroups = new Map<string, Array<{
    className: string;
    methodName: string;
    filePath: string;
    returnType?: string;
    parameterCount?: number;
    startLine: number;
  }>>();

  for (const row of controllerResults) {
    const className = row.className as string;
    if (!controllerGroups.has(className)) {
      controllerGroups.set(className, []);
    }
    controllerGroups.get(className)!.push(row as any);
  }

  const groups: EvidenceGroup[] = [];

  for (const [className, methods] of controllerGroups.entries()) {
    // Skip technical controllers
    if (className.toLowerCase().includes('health') || className.toLowerCase().includes('upload')) {
      continue;
    }

    const packagePath = extractPackagePath(methods[0].filePath);
    const groupId = `CAPABILITY-${className}`;
    const bundleId = `BUNDLE-CAPABILITY-${className}`.toUpperCase();

    const entryPoints: EvidenceBundle['entryPoints'] = methods.map((m, idx) => ({
      ref: `evidence://entry/EP-${String(idx + 1).padStart(3, '0')}`,
      kind: 'http',
      location: m.filePath,
      name: `${m.className}.${m.methodName}`,
      signature: m.returnType ? `${m.returnType}(${m.parameterCount || 0} params)` : '',
      startLine: m.startLine,
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-CAPABILITY-${className}`,
        repoProfile: { name: repoName },
        confidence: 0.8,
        risks: [],
        capabilityHints: {
          nameCandidates: [className.replace(/Controller$/i, '')],
          relatedTerms: [],
        },
        entryPoints,
        behaviorSlices: [],
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