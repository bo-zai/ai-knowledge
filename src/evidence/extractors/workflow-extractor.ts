import type { EvidenceBundle } from '../evidence-bundle-schema.js';
import type { EvidenceGroup } from '../type-evidence-builder.js';
import type { GenerateTarget } from '../../knowledge/generate-scope.js';
import type { ReadOnlyQueryExecutor } from '../../engine/lbug/read-only-session.js';
import { extractPackagePath } from './shared.js';

/**
 * WORKFLOW: Query Controller->Service chains grouped by Controller.
 */
export async function queryWorkflowEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split('/').pop() || 'unknown';

  const workflowCypher = `
    MATCH (c:Class) WHERE c.name =~ '(?i).*Controller$'
    MATCH (c)-[r1:CodeRelation {type: 'CONTAINS'}]->(cf:Function)
    MATCH (cf)-[r2:CodeRelation {type: 'CALLS'}]->(sf:Function)
    MATCH (s:Class)-[r3:CodeRelation {type: 'CONTAINS'}]->(sf) WHERE s.name =~ '(?i).*Service$'
    RETURN c.name as controller, s.name as service,
           cf.name as controllerMethod, sf.name as serviceMethod,
           cf.filePath as filePath
    LIMIT 40
  `;
  const workflowResults = await executeQuery(workflowCypher);

  if (workflowResults.length === 0) {
    return [];
  }

  // Group by Controller
  const controllerGroups = new Map<string, Array<{
    controller: string;
    service: string;
    controllerMethod: string;
    serviceMethod: string;
    filePath: string;
  }>>();

  for (const row of workflowResults) {
    const controller = row.controller as string;
    if (!controllerGroups.has(controller)) {
      controllerGroups.set(controller, []);
    }
    controllerGroups.get(controller)!.push(row as any);
  }

  const groups: EvidenceGroup[] = [];

  for (const [controllerName, flows] of controllerGroups.entries()) {
    const packagePath = extractPackagePath(flows[0].filePath);
    const groupId = `WORKFLOW-${controllerName}`;
    const bundleId = `BUNDLE-WORKFLOW-${controllerName}`.toUpperCase();

    const flowTraces: EvidenceBundle['flowTraces'] = flows.map((f, idx) => ({
      ref: `evidence://flow/FLOW-${String(idx + 1).padStart(3, '0')}`,
      steps: [
        { action: `${f.controller}.${f.controllerMethod}`, location: f.filePath },
        { action: `${f.service}.${f.serviceMethod}` },
      ],
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-WORKFLOW-${controllerName}`,
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