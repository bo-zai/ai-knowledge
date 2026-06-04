import type { KnowledgeType } from '../schemas/knowledge-type.js';
import type { EvidenceBundle } from './evidence-bundle-schema.js';
import type { GraphStatus } from '../query/prepare-generation.js';
import type { GenerateTarget } from '../knowledge/generate-scope.js';
import { getStoragePaths } from '../engine/storage/repo-manager.js';
import { initLbug, executeQuery, closeLbug } from '../engine/lbug/lbug-adapter.js';
import { logger } from '../shared/logger.js';

export interface BuildEvidenceInput {
  repoPath: string;
  type: KnowledgeType;
  target?: GenerateTarget;
  graphStatus: GraphStatus;
}

/**
 * Evidence group for batched LLM generation.
 * Each group contains evidence from the same package/directory.
 */
export interface EvidenceGroup {
  groupId: string;
  packagePath: string;
  bundle: EvidenceBundle;
}

/**
 * Build evidence bundles grouped by package path for a knowledge type.
 * Returns multiple groups for parallel LLM generation.
 */
export async function buildEvidenceBundlesByPackage(
  input: BuildEvidenceInput,
): Promise<EvidenceGroup[]> {
  const { type, target, repoPath } = input;
  const { lbugPath } = getStoragePaths(repoPath);

  try {
    logger.info(`Opening graph for ${type} evidence: ${lbugPath}`);
    await initLbug(lbugPath);

    let groups: EvidenceGroup[];

    switch (type) {
      case 'CONCEPT':
        groups = await queryConceptEvidenceByPackage(repoPath, target);
        break;
      case 'DATA_MODEL':
        groups = await queryDataModelEvidenceByPackage(repoPath, target);
        break;
      case 'CAPABILITY':
        groups = await queryCapabilityEvidenceByPackage(repoPath, target);
        break;
      case 'BOUNDARY':
        groups = await queryBoundaryEvidenceByPackage(repoPath, target);
        break;
      case 'EXTERNAL':
        groups = await queryExternalEvidenceByPackage(repoPath, target);
        break;
      case 'CONSTRAINT':
        groups = await queryConstraintEvidenceByPackage(repoPath, target);
        break;
      case 'RELATION':
        groups = await queryRelationEvidenceByPackage(repoPath, target);
        break;
      case 'WORKFLOW':
        groups = await queryWorkflowEvidenceByPackage(repoPath, target);
        break;
      default:
        groups = [];
    }

    await closeLbug();

    logger.info(`Built ${groups.length} evidence groups for ${type}`);
    return groups;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`Graph query failed for ${type}: ${msg}`);
    return [];
  }
}

/**
 * Legacy single-bundle function for backward compatibility.
 * @deprecated Use buildEvidenceBundlesByPackage instead.
 */
export async function buildMinimalEvidenceBundle(
  input: BuildEvidenceInput,
): Promise<EvidenceBundle> {
  const groups = await buildEvidenceBundlesByPackage(input);

  if (groups.length === 0) {
    return createEmptyBundle(input.type, input.target);
  }

  // Merge all groups into single bundle
  return mergeGroupsToBundle(groups, input.type, input.target);
}

function createEmptyBundle(type: KnowledgeType, target?: GenerateTarget): EvidenceBundle {
  const targetId = target ? `-${target.value.toLowerCase().replace(/\s+/g, '-')}` : '';
  const bundleId = `BUNDLE-${type}${targetId}`.toUpperCase();

  return {
    bundleId,
    candidateId: `CAND-${type}`,
    repoProfile: { name: 'unknown' },
    confidence: 0.3,
    risks: ['no_evidence_found'],
    capabilityHints: { nameCandidates: target ? [target.value] : [], relatedTerms: [] },
    entryPoints: [],
    behaviorSlices: [],
    dataContracts: [],
    validationAnchors: [],
    moduleSurfaces: [],
    flowTraces: [],
    docs: [],
    negativeEvidence: [],
    openQuestions: [],
  };
}

function mergeGroupsToBundle(groups: EvidenceGroup[], type: KnowledgeType, target?: GenerateTarget): EvidenceBundle {
  const targetId = target ? `-${target.value.toLowerCase().replace(/\s+/g, '-')}` : '';
  const bundleId = `BUNDLE-${type}${targetId}`.toUpperCase();

  const merged: EvidenceBundle = {
    bundleId,
    candidateId: `CAND-${type}`,
    repoProfile: { name: groups[0]?.bundle.repoProfile?.name || 'unknown' },
    confidence: Math.max(...groups.map(g => g.bundle.confidence)),
    risks: groups.flatMap(g => g.bundle.risks),
    capabilityHints: {
      nameCandidates: groups.flatMap(g => g.bundle.capabilityHints?.nameCandidates || []),
      relatedTerms: groups.flatMap(g => g.bundle.capabilityHints?.relatedTerms || []),
    },
    entryPoints: groups.flatMap(g => g.bundle.entryPoints || []),
    behaviorSlices: groups.flatMap(g => g.bundle.behaviorSlices || []),
    dataContracts: groups.flatMap(g => g.bundle.dataContracts || []),
    validationAnchors: groups.flatMap(g => g.bundle.validationAnchors || []),
    moduleSurfaces: groups.flatMap(g => g.bundle.moduleSurfaces || []),
    flowTraces: groups.flatMap(g => g.bundle.flowTraces || []),
    docs: groups.flatMap(g => g.bundle.docs || []),
    negativeEvidence: groups.flatMap(g => g.bundle.negativeEvidence || []),
    openQuestions: groups.flatMap(g => g.bundle.openQuestions || []),
  };

  return merged;
}

// ============================================================================
// Package path extraction helper
// ============================================================================

/**
 * Extract package path from file path.
 * Example: src/main/java/com/education/music/app/entity/VO/UserVO.java
 *          → entity/VO
 */
function extractPackagePath(filePath: string): string {
  const parts = filePath.split('/');

  // Find significant directories (exclude src/main/java, test, etc.)
  const significantParts = parts.filter(p =>
    !['src', 'main', 'java', 'test', 'kotlin', 'com', 'org', 'app', 'music', 'education'].includes(p.toLowerCase())
  );

  // Take last 2-3 meaningful directories
  if (significantParts.length >= 2) {
    return significantParts.slice(-2).join('/');
  }
  if (significantParts.length === 1) {
    return significantParts[0];
  }

  // Fallback: use parent directory of file
  return parts.slice(-2, -1).join('/') || 'root';
}

/**
 * Group raw results by package path.
 */
function groupByPackagePath<T extends { filePath: string }>(
  results: T[],
  maxGroupSize: number = 8,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const row of results) {
    const packagePath = extractPackagePath(row.filePath as string);

    if (!groups.has(packagePath)) {
      groups.set(packagePath, []);
    }

    const group = groups.get(packagePath)!;

    // Split large groups
    if (group.length >= maxGroupSize) {
      const subGroupId = `${packagePath}-${groups.size}`;
      groups.set(subGroupId, [row]);
    } else {
      group.push(row);
    }
  }

  return groups;
}

// ============================================================================
// Per-type evidence queries with grouping
// ============================================================================

/**
 * CONCEPT: Query business entities grouped by package.
 * VO/DTO/Req/Resp/Property classes are grouped by their directory.
 */
async function queryConceptEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND c.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  // Query business data objects
  const dataObjCypher = `
    MATCH (c:Class) WHERE c.name =~ '(?i).*(VO|DTO|Req|Resp|Property|Param|Config)$' ${targetFilter}
    RETURN c.name as name, c.filePath as filePath
    LIMIT 30
  `;
  const dataObjResults = await executeQuery(dataObjCypher);

  // Query entity directory classes
  const entityDirCypher = `
    MATCH (c:Class) WHERE c.filePath =~ '(?i).*entity.*' ${targetFilter}
    AND NOT c.filePath =~ '(?i).*test.*'
    RETURN c.name as name, c.filePath as filePath
    LIMIT 30
  `;
  const entityDirResults = await executeQuery(entityDirCypher);

  // Combine and group by package
  const allResults = [...dataObjResults, ...entityDirResults] as Array<{ name: string; filePath: string }>;
  const packageGroups = groupByPackagePath(allResults, 6);

  const groups: EvidenceGroup[] = [];

  for (const [packagePath, rows] of packageGroups.entries()) {
    const groupId = `CONCEPT-${packagePath.replace(/[\/]/g, '-')}`;
    const bundleId = `BUNDLE-CONCEPT-${packagePath.replace(/[\/]/g, '-')}`.toUpperCase();

    const dataContracts: EvidenceBundle['dataContracts'] = rows.map((row, idx) => ({
      ref: `evidence://contract/CON-${String(idx + 1).padStart(3, '0')}`,
      kind: 'type',
      location: row.filePath,
      name: row.name,
      fields: [],
    }));

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-CONCEPT-${packagePath}`,
        repoProfile: { name: repoName },
        confidence: 0.7,
        risks: [],
        capabilityHints: {
          nameCandidates: rows.map(r => r.name),
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

/**
 * DATA_MODEL: Query entity classes grouped by package.
 */
async function queryDataModelEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
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

/**
 * CAPABILITY: Query Controller methods grouped by Controller class.
 * Each Controller is treated as a separate group (one capability domain).
 */
async function queryCapabilityEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND m.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  const controllerCypher = `
    MATCH (c:Class) WHERE c.name =~ '(?i).*Controller$'
    MATCH (c)-[r:CodeRelation {type: 'CONTAINS'}]->(m:Method)
    WHERE true ${targetFilter}
    RETURN c.name as className, m.name as methodName, c.filePath as filePath,
           m.returnType as returnType, m.parameterCount as parameterCount, m.startLine as startLine
    ORDER BY c.name, m.name
    LIMIT 60
  `;
  const controllerResults = await executeQuery(controllerCypher);

  // Group by Controller class (each Controller = one capability domain)
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

/**
 * BOUNDARY: Query config files (single group, typically small).
 */
async function queryBoundaryEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split('/').pop() || 'unknown';

  const configCypher = `
    MATCH (f:File) WHERE f.name =~ '(?i).*(config|properties|yaml|yml)$'
    RETURN f.name as name, f.filePath as filePath
    LIMIT 10
  `;
  const configResults = await executeQuery(configCypher);

  if (configResults.length === 0) {
    return [];
  }

  const docs: EvidenceBundle['docs'] = configResults.map((row, idx) => ({
    ref: `evidence://doc/DOC-${String(idx + 1).padStart(3, '0')}`,
    location: row.filePath as string || '',
    kind: 'docs',
    excerpt: `Configuration file: ${row.name}`,
  }));

  return [{
    groupId: 'BOUNDARY-configs',
    packagePath: 'config',
    bundle: {
      bundleId: 'BUNDLE-BOUNDARY',
      candidateId: 'CAND-BOUNDARY',
      repoProfile: { name: repoName },
      confidence: 0.5,
      risks: ['boundary_requires_manual_review'],
      capabilityHints: { nameCandidates: [], relatedTerms: [] },
      entryPoints: [],
      behaviorSlices: [],
      dataContracts: [],
      validationAnchors: [],
      moduleSurfaces: [],
      flowTraces: [],
      docs,
      negativeEvidence: [],
      openQuestions: [],
    },
  }];
}

/**
 * EXTERNAL: Query external dependencies (single group).
 */
async function queryExternalEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split('/').pop() || 'unknown';

  const importCypher = `
    MATCH (f:File) WHERE f.content =~ '(?i).*(alipay|wechat|wxpay|oss|sms|okhttp|feign).*'
    RETURN f.name as fileName, f.filePath as filePath
    LIMIT 15
  `;
  const importResults = await executeQuery(importCypher);

  if (importResults.length === 0) {
    return [];
  }

  const behaviorSlices: EvidenceBundle['behaviorSlices'] = importResults.map((row, idx) => ({
    ref: `evidence://behavior/BEH-${String(idx + 1).padStart(3, '0')}`,
    location: row.filePath as string || '',
    verb: 'import',
    object: row.fileName as string,
  }));

  return [{
    groupId: 'EXTERNAL-deps',
    packagePath: 'external',
    bundle: {
      bundleId: 'BUNDLE-EXTERNAL',
      candidateId: 'CAND-EXTERNAL',
      repoProfile: { name: repoName },
      confidence: 0.6,
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
  }];
}

/**
 * CONSTRAINT: Query exceptions and throws grouped by package.
 */
async function queryConstraintEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
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

/**
 * RELATION: Query Service call relations grouped by source Service.
 */
async function queryRelationEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
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

/**
 * WORKFLOW: Query Controller->Service chains grouped by Controller.
 */
async function queryWorkflowEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
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