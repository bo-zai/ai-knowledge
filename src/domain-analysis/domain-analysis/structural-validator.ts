import type {
  DomainAnalysisInput,
  StructuralValidationResult,
} from "../types.js";
import type {
  DomainDefinition,
  PartitionCandidate,
} from "../../partitioning/types.js";
import type { RelationAdjudicationDecision } from "../../partition/llm-adjudication/relation/types.js";

type SubjectClassification =
  DomainAnalysisInput["subjectClassifications"][number];

export function validateDomainDefinitions(params: {
  input: DomainAnalysisInput;
  decisions: DomainDefinition[];
}): StructuralValidationResult {
  const { input, decisions } = params;
  const warnings: string[] = [];
  const candidateById = new Map(
    input.evidenceBundle.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  const classificationById = new Map(
    input.subjectClassifications.map((item) => [item.candidateId, item]),
  );
  const assignedCoreCandidates = new Set<string>();
  const normalized: DomainDefinition[] = [];

  for (const decision of decisions) {
    const seenCandidates = new Set<string>();
    const coreCandidateIds = decision.coreCandidateIds.filter((candidateId) => {
      if (seenCandidates.has(candidateId)) {
        return false;
      }
      seenCandidates.add(candidateId);
      const classification = classificationById.get(candidateId);
      if (!classification || classification.subjectType !== "business-root") {
        warnings.push(
          `核心候选 ${candidateId} 被降级，因为它不是 business-root`,
        );
        return false;
      }
      if (assignedCoreCandidates.has(candidateId)) {
        warnings.push(`核心候选 ${candidateId} 重复出现在多个业务域中，已去重`);
        return false;
      }
      assignedCoreCandidates.add(candidateId);
      return true;
    });
    if (coreCandidateIds.length === 0) {
      promoteFallbackCoreCandidates({
        decision,
        supportingCandidateIds: decision.supportingCandidateIds,
        classificationById,
        assignedCoreCandidates,
        output: coreCandidateIds,
        warnings,
      });
    }

    const supportingCandidateIds = decision.supportingCandidateIds.filter(
      (candidateId) => {
        if (coreCandidateIds.includes(candidateId)) {
          return false;
        }
        if (seenCandidates.has(candidateId)) {
          return false;
        }
        seenCandidates.add(candidateId);
        return candidateById.has(candidateId);
      },
    );

    if (coreCandidateIds.length === 0) {
      warnings.push(`业务域 ${decision.domainName} 没有有效核心候选，已跳过`);
      continue;
    }

    const coreTables = buildCoreTables(coreCandidateIds, candidateById);
    const supportingTables = [
      ...new Set([
        ...decision.supportingTables,
        ...buildSupportingTables(supportingCandidateIds, candidateById),
      ]),
    ].filter((tableName) => !coreTables.includes(tableName));

    normalized.push({
      ...decision,
      coreCandidateIds,
      supportingCandidateIds,
      coreTables,
      supportingTables,
    });
  }

  preserveIndependentRootGroups({
    input,
    decisions: normalized,
    candidateById,
    classificationById,
    warnings,
  });

  promoteIndependentSupportingRoots({
    input,
    decisions: normalized,
    candidateById,
    classificationById,
    warnings,
  });

  mergeOwnedRootDecisions({
    input,
    decisions: normalized,
    candidateById,
    warnings,
  });

  collapseWeakRootDecisions({
    input,
    decisions: normalized,
    candidateById,
    warnings,
  });

  const uncoveredRootCandidates = input.rootCandidates.filter(
    (candidateId) => !assignedCoreCandidates.has(candidateId),
  );
  for (const candidateId of uncoveredRootCandidates) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) {
      continue;
    }
    const attachment = findBestDecisionAttachment({
      sourceDecision: createStandaloneDecision(candidate),
      candidate,
      decisions: normalized,
      dependencyScores: buildDependencyScoreMap(input),
    });

    if (attachment) {
      const targetDecision = attachment.decision;
      if (
        !targetDecision.supportingCandidateIds.includes(candidate.candidateId)
      ) {
        targetDecision.supportingCandidateIds.push(candidate.candidateId);
      }
      targetDecision.supportingTables = [
        ...new Set([
          ...targetDecision.supportingTables,
          candidate.anchorTable,
          ...candidate.coreTableNames,
          ...candidate.supportingTableNames,
        ]),
      ].filter(
        (tableName) =>
          isValidDomainTableName(tableName) &&
          !targetDecision.coreTables.includes(tableName),
      );
      warnings.push(
        `核心候选 ${candidateId} 未被模型纳入结果，已按结构依赖挂载到 ${targetDecision.domainName}`,
      );
      continue;
    }

    const classification = classificationById.get(candidateId);
    if (shouldCollapseWeakRootCandidate(candidate, classification)) {
      warnings.push(
        `核心候选 ${candidateId} 未被模型纳入结果，且证据较弱，已跳过独立补域`,
      );
      continue;
    }

    warnings.push(
      `核心候选 ${candidateId} 未被模型纳入结果，已自动补为独立业务域`,
    );
    normalized.push(createStandaloneDecision(candidate));
  }

  addUncoveredIndependentLifecycleCandidates({
    decisions: normalized,
    candidates: input.evidenceBundle.candidates,
    classificationById,
    warnings,
  });

  return {
    decisions: normalized,
    warnings,
  };
}

function buildCoreTables(
  candidateIds: string[],
  candidateById: Map<string, PartitionCandidate>,
): string[] {
  const orderedTables: string[] = [];
  for (const candidateId of candidateIds) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) {
      continue;
    }
    orderedTables.push(candidate.anchorTable, ...candidate.coreTableNames);
  }
  return [...new Set(orderedTables)].filter(isValidDomainTableName);
}

function buildSupportingTables(
  candidateIds: string[],
  candidateById: Map<string, PartitionCandidate>,
): string[] {
  const orderedTables: string[] = [];
  for (const candidateId of candidateIds) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) {
      continue;
    }
    orderedTables.push(candidate.anchorTable, ...candidate.coreTableNames);
    orderedTables.push(...candidate.supportingTableNames);
  }
  return [...new Set(orderedTables)].filter(isValidDomainTableName);
}

function createStandaloneDecision(
  candidate: PartitionCandidate,
): DomainDefinition {
  return {
    domainName: candidate.anchorTable,
    confidence: 0.3,
    coreCandidateIds: [candidate.candidateId],
    supportingCandidateIds: [],
    excludedCandidateIds: [],
    coreTables: candidate.coreTableNames.filter(isValidDomainTableName),
    supportingTables: candidate.supportingTableNames.filter(
      isValidDomainTableName,
    ),
    crossDomainDependencies: [],
    reasoning: "模型未覆盖该业务主体，结构校验阶段按独立业务域补齐",
  };
}

function addUncoveredIndependentLifecycleCandidates(params: {
  decisions: DomainDefinition[];
  candidates: PartitionCandidate[];
  classificationById: Map<string, SubjectClassification>;
  warnings: string[];
}): void {
  const { decisions, candidates, classificationById, warnings } = params;
  const coveredCandidateIds = new Set(
    decisions.flatMap((decision) => [
      ...decision.coreCandidateIds,
      ...decision.supportingCandidateIds,
    ]),
  );

  for (const candidate of candidates) {
    if (coveredCandidateIds.has(candidate.candidateId)) {
      continue;
    }

    const classification = classificationById.get(candidate.candidateId);
    if (!isIndependentLifecycleRoot(candidate, classification)) {
      continue;
    }

    decisions.push(createStandaloneDecision(candidate));
    coveredCandidateIds.add(candidate.candidateId);
    warnings.push(
      `候选 ${candidate.candidateId} 具备独立生命周期但未被模型覆盖，已自动补为独立业务域`,
    );
  }
}

function preserveIndependentRootGroups(params: {
  input: DomainAnalysisInput;
  decisions: DomainDefinition[];
  candidateById: Map<string, PartitionCandidate>;
  classificationById: Map<string, SubjectClassification>;
  warnings: string[];
}): void {
  const { input, decisions, candidateById, classificationById, warnings } =
    params;
  const relationDecisionMap = buildRelationDecisionMap(input);
  const dependencyScores = buildDependencyScoreMap(input);
  const nextDecisions: DomainDefinition[] = [];

  for (const decision of decisions) {
    if (decision.coreCandidateIds.length <= 1) {
      nextDecisions.push(decision);
      continue;
    }

    const splitPlan = splitCoreCandidatesByMergeEvidence({
      coreCandidateIds: decision.coreCandidateIds,
      candidateById,
      classificationById,
      relationDecisionMap,
    });
    if (splitPlan.coreGroups.length <= 1) {
      nextDecisions.push(decision);
      continue;
    }

    const splitDecisions = splitPlan.coreGroups.map((coreCandidateIds) =>
      createSplitDecision({
        sourceDecision: decision,
        coreCandidateIds,
        candidateById,
        classificationById,
      }),
    );
    assignSupportingCandidatesToSplitDecisions({
      supportingCandidateIds: [
        ...decision.supportingCandidateIds,
        ...splitPlan.dependentCoreCandidateIds,
      ],
      splitDecisions,
      candidateById,
      dependencyScores,
      relationDecisionMap,
    });
    addCrossDependenciesBetweenSplitDecisions({
      splitDecisions,
      dependencyScores,
      relationDecisionMap,
    });
    nextDecisions.push(...splitDecisions);
    warnings.push(
      `业务域 ${decision.domainName} 包含多个缺少合并证据的独立核心候选，已拆分为 ${splitDecisions.length} 个业务域`,
    );
  }

  decisions.length = 0;
  decisions.push(...nextDecisions);
}

function mergeOwnedRootDecisions(params: {
  input: DomainAnalysisInput;
  decisions: DomainDefinition[];
  candidateById: Map<string, PartitionCandidate>;
  warnings: string[];
}): void {
  const { input, decisions, candidateById, warnings } = params;
  const relationDecisionMap = buildRelationDecisionMap(input);

  for (const relationDecision of relationDecisionMap.values()) {
    if (relationDecision.decisionType !== "ownership") {
      continue;
    }

    const candidateIds = extractCandidateIdsFromRelationId(
      relationDecision.relationId,
    );
    if (candidateIds.length !== 2) {
      continue;
    }

    const left = findDecisionByCoreCandidate(decisions, candidateIds[0]);
    const right = findDecisionByCoreCandidate(decisions, candidateIds[1]);
    if (!left || !right || left.decision === right.decision) {
      continue;
    }

    const leftCandidate = candidateById.get(candidateIds[0]);
    const rightCandidate = candidateById.get(candidateIds[1]);
    if (!leftCandidate || !rightCandidate) {
      continue;
    }

    const parentCandidateId = chooseOwnershipParentCandidate(
      leftCandidate,
      rightCandidate,
    );
    const parentDecision =
      parentCandidateId === leftCandidate.candidateId
        ? left.decision
        : right.decision;
    const childDecision =
      parentDecision === left.decision ? right.decision : left.decision;

    mergeDecisionIntoParent(parentDecision, childDecision, candidateById);
    decisions.splice(decisions.indexOf(childDecision), 1);
    warnings.push(
      `业务域 ${childDecision.domainName} 与 ${parentDecision.domainName} 存在 ownership 关系，已合并到父业务域`,
    );
  }
}

function promoteIndependentSupportingRoots(params: {
  input: DomainAnalysisInput;
  decisions: DomainDefinition[];
  candidateById: Map<string, PartitionCandidate>;
  classificationById: Map<string, SubjectClassification>;
  warnings: string[];
}): void {
  const { input, decisions, candidateById, classificationById, warnings } =
    params;
  const relationDecisionMap = buildRelationDecisionMap(input);
  const promotedDecisions: DomainDefinition[] = [];

  for (const decision of decisions) {
    const remainingSupportingCandidateIds: string[] = [];
    for (const candidateId of decision.supportingCandidateIds) {
      const candidate = candidateById.get(candidateId);
      const classification = classificationById.get(candidateId);
      if (
        candidate &&
        isIndependentLifecycleRoot(candidate, classification) &&
        !hasMergeRelationToDecision(candidateId, decision, relationDecisionMap)
      ) {
        promotedDecisions.push(
          createSplitDecision({
            sourceDecision: decision,
            coreCandidateIds: [candidateId],
            candidateById,
            classificationById,
          }),
        );
        warnings.push(
          `支撑候选 ${candidateId} 具备独立生命周期，已从 ${decision.domainName} 提升为独立业务域`,
        );
        continue;
      }

      remainingSupportingCandidateIds.push(candidateId);
    }

    decision.supportingCandidateIds = remainingSupportingCandidateIds;
    decision.supportingTables = buildSupportingTables(
      remainingSupportingCandidateIds,
      candidateById,
    ).filter((tableName) => !decision.coreTables.includes(tableName));
  }

  decisions.push(...promotedDecisions);
}

function hasMergeRelationToDecision(
  candidateId: string,
  decision: DomainDefinition,
  relationDecisionMap: Map<string, RelationAdjudicationDecision>,
): boolean {
  return decision.coreCandidateIds.some((coreCandidateId) => {
    const relationDecision = relationDecisionMap.get(
      buildCandidatePairKey(candidateId, coreCandidateId),
    );
    return (
      relationDecision?.decisionType === "ownership" ||
      relationDecision?.decisionType === "shared-master-data"
    );
  });
}

function findDecisionByCoreCandidate(
  decisions: DomainDefinition[],
  candidateId: string,
): { decision: DomainDefinition; candidateId: string } | undefined {
  const decision = decisions.find((item) =>
    item.coreCandidateIds.includes(candidateId),
  );
  return decision ? { decision, candidateId } : undefined;
}

function chooseOwnershipParentCandidate(
  leftCandidate: PartitionCandidate,
  rightCandidate: PartitionCandidate,
): string {
  const leftScore = scoreOwnershipParent(leftCandidate, rightCandidate);
  const rightScore = scoreOwnershipParent(rightCandidate, leftCandidate);
  return leftScore >= rightScore
    ? leftCandidate.candidateId
    : rightCandidate.candidateId;
}

function scoreOwnershipParent(
  parentCandidate: PartitionCandidate,
  childCandidate: PartitionCandidate,
): number {
  let score = 0;
  if (
    isTableNamePrefixOf(parentCandidate.anchorTable, childCandidate.anchorTable)
  ) {
    score += 6;
  }
  if (
    childCandidate.dependencyTableNames.includes(parentCandidate.anchorTable)
  ) {
    score += 4;
  }
  if (parentCandidate.entryPoints.length >= childCandidate.entryPoints.length) {
    score += 1;
  }
  score -= splitTableNameTokens(parentCandidate.anchorTable).length;
  return score;
}

function mergeDecisionIntoParent(
  parentDecision: DomainDefinition,
  childDecision: DomainDefinition,
  candidateById: Map<string, PartitionCandidate>,
): void {
  parentDecision.coreCandidateIds = [
    ...new Set([
      ...parentDecision.coreCandidateIds,
      ...childDecision.coreCandidateIds,
    ]),
  ];
  parentDecision.supportingCandidateIds = [
    ...new Set([
      ...parentDecision.supportingCandidateIds,
      ...childDecision.supportingCandidateIds,
    ]),
  ].filter(
    (candidateId) => !parentDecision.coreCandidateIds.includes(candidateId),
  );
  parentDecision.excludedCandidateIds = [
    ...new Set([
      ...parentDecision.excludedCandidateIds,
      ...childDecision.excludedCandidateIds,
    ]),
  ];
  parentDecision.coreTables = buildCoreTables(
    parentDecision.coreCandidateIds,
    candidateById,
  );
  parentDecision.supportingTables = [
    ...new Set([
      ...parentDecision.supportingTables,
      ...childDecision.supportingTables,
      ...buildSupportingTables(
        parentDecision.supportingCandidateIds,
        candidateById,
      ),
    ]),
  ].filter(
    (tableName) =>
      isValidDomainTableName(tableName) &&
      !parentDecision.coreTables.includes(tableName),
  );
  parentDecision.crossDomainDependencies = [
    ...parentDecision.crossDomainDependencies,
    ...childDecision.crossDomainDependencies,
  ].filter(
    (dependency) => dependency.targetDomainHint !== parentDecision.domainName,
  );
  parentDecision.confidence = Math.min(
    parentDecision.confidence,
    childDecision.confidence,
  );
}

function isTableNamePrefixOf(
  parentTableName: string,
  childTableName: string,
): boolean {
  const parentTokens = splitTableNameTokens(parentTableName);
  const childTokens = splitTableNameTokens(childTableName);
  if (parentTokens.length === 0 || parentTokens.length >= childTokens.length) {
    return false;
  }

  return parentTokens.every((token, index) => childTokens[index] === token);
}

function splitTableNameTokens(tableName: string): string[] {
  return tableName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function splitCoreCandidatesByMergeEvidence(params: {
  coreCandidateIds: string[];
  candidateById: Map<string, PartitionCandidate>;
  classificationById: Map<string, SubjectClassification>;
  relationDecisionMap: Map<string, RelationAdjudicationDecision>;
}): {
  coreGroups: string[][];
  dependentCoreCandidateIds: string[];
} {
  const {
    coreCandidateIds,
    candidateById,
    classificationById,
    relationDecisionMap,
  } = params;
  const independentCoreCandidateIds = coreCandidateIds.filter((candidateId) => {
    const candidate = candidateById.get(candidateId);
    return (
      Boolean(candidate) &&
      isIndependentLifecycleRoot(candidate, classificationById.get(candidateId))
    );
  });
  const dependentCoreCandidateIds = coreCandidateIds.filter(
    (candidateId) => !independentCoreCandidateIds.includes(candidateId),
  );
  const parent = new Map(
    independentCoreCandidateIds.map((candidateId) => [
      candidateId,
      candidateId,
    ]),
  );

  if (independentCoreCandidateIds.length <= 1) {
    return {
      coreGroups: [coreCandidateIds],
      dependentCoreCandidateIds: [],
    };
  }

  for (
    let leftIndex = 0;
    leftIndex < independentCoreCandidateIds.length;
    leftIndex += 1
  ) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < independentCoreCandidateIds.length;
      rightIndex += 1
    ) {
      const leftId = independentCoreCandidateIds[leftIndex];
      const rightId = independentCoreCandidateIds[rightIndex];
      const leftCandidate = candidateById.get(leftId);
      const rightCandidate = candidateById.get(rightId);
      if (!leftCandidate || !rightCandidate) {
        continue;
      }

      if (
        shouldMergeCoreCandidates({
          leftId,
          rightId,
          leftCandidate,
          rightCandidate,
          leftClassification: classificationById.get(leftId),
          rightClassification: classificationById.get(rightId),
          relationDecisionMap,
        })
      ) {
        union(parent, leftId, rightId);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const candidateId of independentCoreCandidateIds) {
    const root = findParent(parent, candidateId);
    const group = groups.get(root) ?? [];
    group.push(candidateId);
    groups.set(root, group);
  }

  return {
    coreGroups: [...groups.values()],
    dependentCoreCandidateIds,
  };
}

function shouldMergeCoreCandidates(params: {
  leftId: string;
  rightId: string;
  leftCandidate: PartitionCandidate;
  rightCandidate: PartitionCandidate;
  leftClassification?: SubjectClassification;
  rightClassification?: SubjectClassification;
  relationDecisionMap: Map<string, RelationAdjudicationDecision>;
}): boolean {
  const {
    leftId,
    rightId,
    leftCandidate,
    rightCandidate,
    leftClassification,
    rightClassification,
    relationDecisionMap,
  } = params;
  const relationDecision = relationDecisionMap.get(
    buildCandidatePairKey(leftId, rightId),
  );
  if (relationDecision?.decisionType === "ownership") {
    return true;
  }
  if (relationDecision?.decisionType === "shared-master-data") {
    return true;
  }

  const leftIndependent = isIndependentLifecycleRoot(
    leftCandidate,
    leftClassification,
  );
  const rightIndependent = isIndependentLifecycleRoot(
    rightCandidate,
    rightClassification,
  );
  if (leftIndependent && rightIndependent) {
    return false;
  }

  return (
    hasDominantOwnershipShape(leftCandidate, rightCandidate) ||
    hasDominantOwnershipShape(rightCandidate, leftCandidate)
  );
}

function isIndependentLifecycleRoot(
  candidate: PartitionCandidate,
  classification?: SubjectClassification,
): boolean {
  if (
    classification?.subjectType === "noise-or-aggregation" ||
    classification?.subjectType === "business-support"
  ) {
    return false;
  }
  if (
    candidate.anchorQuality !== "high" ||
    candidate.ownedTableNames.length === 0
  ) {
    return false;
  }
  if (candidate.isInfrastructureCandidate) {
    return false;
  }

  return hasLifecycleEntrySurface(candidate) || hasWriteDataSurface(candidate);
}

function hasLifecycleEntrySurface(candidate: PartitionCandidate): boolean {
  const methodNames = candidate.entryPoints.map((entryPoint) =>
    entryPoint.methodName.toLowerCase(),
  );
  const hasCreate = methodNames.some((methodName) =>
    /create|add|save|insert|register|submit/.test(methodName),
  );
  const hasUpdate = methodNames.some((methodName) =>
    /update|edit|modify|status|enable|disable|delete|remove/.test(methodName),
  );
  const hasRead = methodNames.some((methodName) =>
    /list|page|get|detail|query|search|select/.test(methodName),
  );

  return (
    candidate.entryPoints.length >= 3 &&
    ((hasRead && (hasCreate || hasUpdate)) || (hasCreate && hasUpdate))
  );
}

function hasWriteDataSurface(candidate: PartitionCandidate): boolean {
  const operations = candidate.mappers.flatMap(
    (mapper) => mapper.operations ?? [],
  );
  return (
    operations.includes("insert") ||
    operations.includes("update") ||
    operations.includes("delete")
  );
}

function hasDominantOwnershipShape(
  ownerCandidate: PartitionCandidate,
  childCandidate: PartitionCandidate,
): boolean {
  if (childCandidate.entryPoints.length > 2) {
    return false;
  }

  const ownerTables = new Set([
    ownerCandidate.anchorTable,
    ...ownerCandidate.ownedTableNames,
    ...ownerCandidate.coreTableNames,
  ]);
  return childCandidate.dependencyTableNames.some((tableName) =>
    ownerTables.has(tableName),
  );
}

function createSplitDecision(params: {
  sourceDecision: DomainDefinition;
  coreCandidateIds: string[];
  candidateById: Map<string, PartitionCandidate>;
  classificationById: Map<string, SubjectClassification>;
}): DomainDefinition {
  const {
    sourceDecision,
    coreCandidateIds,
    candidateById,
    classificationById,
  } = params;
  const primaryCandidate = candidateById.get(coreCandidateIds[0]);
  const primaryClassification = classificationById.get(coreCandidateIds[0]);
  const coreTables = buildCoreTables(coreCandidateIds, candidateById);

  return {
    ...sourceDecision,
    domainName:
      primaryClassification?.suggestedDomainName ||
      primaryCandidate?.anchorTable ||
      sourceDecision.domainName,
    confidence: Math.min(
      sourceDecision.confidence,
      primaryClassification?.confidence ?? sourceDecision.confidence,
    ),
    coreCandidateIds,
    supportingCandidateIds: [],
    excludedCandidateIds: [...sourceDecision.excludedCandidateIds],
    coreTables,
    supportingTables: [],
    crossDomainDependencies: [],
    reasoning:
      coreCandidateIds.length === sourceDecision.coreCandidateIds.length
        ? sourceDecision.reasoning
        : "结构校验识别到该核心候选具备独立生命周期，按独立业务域保留",
  };
}

function assignSupportingCandidatesToSplitDecisions(params: {
  supportingCandidateIds: string[];
  splitDecisions: DomainDefinition[];
  candidateById: Map<string, PartitionCandidate>;
  dependencyScores: Map<string, number>;
  relationDecisionMap: Map<string, RelationAdjudicationDecision>;
}): void {
  const {
    supportingCandidateIds,
    splitDecisions,
    candidateById,
    dependencyScores,
    relationDecisionMap,
  } = params;

  for (const candidateId of supportingCandidateIds) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) {
      continue;
    }

    const targetDecision = splitDecisions
      .map((decision) => ({
        decision,
        score: scoreSupportingCandidateAttachment(
          candidate,
          decision,
          dependencyScores,
          relationDecisionMap,
        ),
      }))
      .sort((left, right) => right.score - left.score)[0]?.decision;
    if (!targetDecision) {
      continue;
    }

    targetDecision.supportingCandidateIds.push(candidateId);
    targetDecision.supportingTables = [
      ...new Set([
        ...targetDecision.supportingTables,
        candidate.anchorTable,
        ...candidate.coreTableNames,
        ...candidate.supportingTableNames,
      ]),
    ].filter(
      (tableName) =>
        isValidDomainTableName(tableName) &&
        !targetDecision.coreTables.includes(tableName),
    );
  }
}

function scoreSupportingCandidateAttachment(
  candidate: PartitionCandidate,
  decision: DomainDefinition,
  dependencyScores: Map<string, number>,
  relationDecisionMap: Map<string, RelationAdjudicationDecision>,
): number {
  const decisionTables = new Set(decision.coreTables);
  const tableOverlap = [
    candidate.anchorTable,
    ...candidate.coreTableNames,
    ...candidate.supportingTableNames,
    ...candidate.dependencyTableNames,
  ].filter((tableName) => decisionTables.has(tableName)).length;
  const dependencyScore = decision.coreCandidateIds.reduce(
    (score, coreCandidateId) => {
      const relationDecision = relationDecisionMap.get(
        buildCandidatePairKey(candidate.candidateId, coreCandidateId),
      );
      const relationBonus =
        relationDecision?.decisionType === "ownership"
          ? 8
          : relationDecision?.decisionType === "reference"
            ? 3
            : relationDecision?.decisionType === "shared-master-data"
              ? 2
              : 0;
      return (
        score +
        (dependencyScores.get(`${candidate.candidateId}:${coreCandidateId}`) ??
          0) +
        relationBonus
      );
    },
    0,
  );

  return tableOverlap * 4 + dependencyScore;
}

function addCrossDependenciesBetweenSplitDecisions(params: {
  splitDecisions: DomainDefinition[];
  dependencyScores: Map<string, number>;
  relationDecisionMap: Map<string, RelationAdjudicationDecision>;
}): void {
  const { splitDecisions, dependencyScores, relationDecisionMap } = params;

  for (const sourceDecision of splitDecisions) {
    for (const targetDecision of splitDecisions) {
      if (sourceDecision === targetDecision) {
        continue;
      }

      const relation = findRelationBetweenDecisions(
        sourceDecision,
        targetDecision,
        dependencyScores,
        relationDecisionMap,
      );
      if (!relation) {
        continue;
      }

      sourceDecision.crossDomainDependencies.push({
        targetDomainHint: targetDecision.domainName,
        relationType: "weak_identity_reference",
        evidence: [relation],
      });
    }
  }
}

function findRelationBetweenDecisions(
  sourceDecision: DomainDefinition,
  targetDecision: DomainDefinition,
  dependencyScores: Map<string, number>,
  relationDecisionMap: Map<string, RelationAdjudicationDecision>,
): string | undefined {
  for (const sourceCandidateId of sourceDecision.coreCandidateIds) {
    for (const targetCandidateId of targetDecision.coreCandidateIds) {
      const relationDecision = relationDecisionMap.get(
        buildCandidatePairKey(sourceCandidateId, targetCandidateId),
      );
      if (relationDecision?.decisionType === "reference") {
        return relationDecision.reasoning;
      }
      const relationScore =
        dependencyScores.get(`${sourceCandidateId}:${targetCandidateId}`) ??
        dependencyScores.get(`${targetCandidateId}:${sourceCandidateId}`) ??
        0;
      if (relationScore > 0) {
        return `候选 ${sourceCandidateId} 与 ${targetCandidateId} 存在结构依赖，score=${relationScore}`;
      }
    }
  }

  return undefined;
}

function buildRelationDecisionMap(
  input: DomainAnalysisInput,
): Map<string, RelationAdjudicationDecision> {
  const map = new Map<string, RelationAdjudicationDecision>();
  for (const decision of input.relationDecisions ?? []) {
    const candidates = extractCandidateIdsFromRelationId(decision.relationId);
    if (candidates.length !== 2) {
      continue;
    }
    map.set(
      buildCandidatePairKey(candidates[0], candidates[1]),
      normalizeRelationDecision(decision),
    );
  }

  return map;
}

function normalizeRelationDecision(
  decision: RelationAdjudicationDecision,
): RelationAdjudicationDecision {
  if (
    decision.decisionType === "reference" &&
    decision.confidence >= 0.7 &&
    hasOwnershipReasoning(decision.reasoning)
  ) {
    return {
      ...decision,
      decisionType: "ownership",
    };
  }

  return decision;
}

function hasOwnershipReasoning(reasoning: string): boolean {
  const normalized = reasoning.toLowerCase();
  return normalized.includes("ownership") || normalized.includes("拥有关系");
}

function extractCandidateIdsFromRelationId(relationId: string): string[] {
  return relationId.match(/candidate_[a-z0-9_]+/g) ?? [];
}

function buildCandidatePairKey(leftId: string, rightId: string): string {
  return [leftId, rightId].sort().join("<->");
}

function findParent(parent: Map<string, string>, candidateId: string): string {
  const currentParent = parent.get(candidateId);
  if (!currentParent || currentParent === candidateId) {
    return candidateId;
  }

  const root = findParent(parent, currentParent);
  parent.set(candidateId, root);
  return root;
}

function union(
  parent: Map<string, string>,
  leftId: string,
  rightId: string,
): void {
  const leftRoot = findParent(parent, leftId);
  const rightRoot = findParent(parent, rightId);
  if (leftRoot !== rightRoot) {
    parent.set(rightRoot, leftRoot);
  }
}

function collapseWeakRootDecisions(params: {
  input: DomainAnalysisInput;
  decisions: DomainDefinition[];
  candidateById: Map<string, PartitionCandidate>;
  warnings: string[];
}): void {
  const { input, decisions, candidateById, warnings } = params;
  const classificationById = new Map(
    input.subjectClassifications.map((item) => [item.candidateId, item]),
  );
  const dependencyScores = buildDependencyScoreMap(input);

  const collapsibleDecisions = decisions
    .filter((decision) => decision.coreCandidateIds.length === 1)
    .map((decision) => ({
      decision,
      candidate: candidateById.get(decision.coreCandidateIds[0]),
      classification: classificationById.get(decision.coreCandidateIds[0]),
    }))
    .filter(
      (
        item,
      ): item is {
        decision: DomainDefinition;
        candidate: PartitionCandidate;
        classification: NonNullable<ReturnType<typeof classificationById.get>>;
      } => Boolean(item.candidate) && Boolean(item.classification),
    )
    .filter(({ candidate, classification }) =>
      shouldCollapseWeakRootCandidate(candidate, classification),
    );

  for (const { decision, candidate } of collapsibleDecisions) {
    const attachment = findBestDecisionAttachment({
      sourceDecision: decision,
      candidate,
      decisions,
      dependencyScores,
    });
    if (!attachment) {
      continue;
    }

    const targetDecision = attachment.decision;
    if (
      !targetDecision.supportingCandidateIds.includes(candidate.candidateId)
    ) {
      targetDecision.supportingCandidateIds.push(candidate.candidateId);
    }
    targetDecision.supportingTables = [
      ...new Set([
        ...targetDecision.supportingTables,
        candidate.anchorTable,
        ...candidate.coreTableNames,
        ...candidate.supportingTableNames,
      ]),
    ].filter(
      (tableName) =>
        isValidDomainTableName(tableName) &&
        !targetDecision.coreTables.includes(tableName),
    );

    decision.coreCandidateIds = [];
    decision.supportingCandidateIds = [];
    decision.coreTables = [];
    decision.supportingTables = [];
    warnings.push(
      `弱根候选 ${candidate.candidateId} 已按结构依赖挂载到 ${targetDecision.domainName}`,
    );
  }

  const remaining = decisions.filter(
    (decision) => decision.coreCandidateIds.length > 0,
  );
  decisions.length = 0;
  decisions.push(...remaining);
}

function shouldCollapseWeakRootCandidate(
  candidate: PartitionCandidate,
  classification?: SubjectClassification,
): boolean {
  if (isIndependentLifecycleRoot(candidate, classification)) {
    return false;
  }

  const isSmallCandidate =
    candidate.tables.length <= 2 &&
    candidate.entryPoints.length <= 5 &&
    candidate.services.length <= 2 &&
    candidate.mappers.length <= 2;
  const isWeakAnchor = candidate.anchorQuality !== "high";
  const isThinBusinessSurface = candidate.coreTableNames.length <= 2;

  return (
    isSmallCandidate &&
    (isWeakAnchor ||
      isThinBusinessSurface ||
      (classification?.confidence ?? 0) < 0.9)
  );
}

function isValidDomainTableName(tableName: string): boolean {
  const normalized = tableName.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "unknown";
}

function findBestDecisionAttachment(params: {
  sourceDecision: DomainDefinition;
  candidate: PartitionCandidate;
  decisions: DomainDefinition[];
  dependencyScores: Map<string, number>;
}): { decision: DomainDefinition; score: number } | undefined {
  const { sourceDecision, candidate, decisions, dependencyScores } = params;
  const scored = decisions
    .filter((decision) => decision.domainName !== sourceDecision.domainName)
    .map((decision) => {
      const tableOverlap = decision.coreTables.filter(
        (tableName) =>
          candidate.coreTableNames.includes(tableName) ||
          candidate.supportingTableNames.includes(tableName) ||
          candidate.anchorTable === tableName,
      ).length;
      const dependencyScore = decision.coreCandidateIds.reduce(
        (score, candidateId) => {
          return (
            score +
            (dependencyScores.get(`${candidate.candidateId}:${candidateId}`) ??
              0)
          );
        },
        0,
      );
      const sizePenalty =
        candidate.entryPoints.length <= 3 && candidate.tables.length <= 2
          ? 2
          : 0;

      return {
        decision,
        score: tableOverlap * 4 + dependencyScore * 2 + sizePenalty,
      };
    })
    .sort((left, right) => right.score - left.score)[0];

  return scored && scored.score >= 5 ? scored : undefined;
}

function buildDependencyScoreMap(
  input: DomainAnalysisInput,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const entry of input.dependencySignals) {
    scores.set(
      `${entry.sourceCandidateId}:${entry.targetCandidateId}`,
      entry.relationScore,
    );
    scores.set(
      `${entry.targetCandidateId}:${entry.sourceCandidateId}`,
      entry.relationScore,
    );
  }
  return scores;
}

function promoteFallbackCoreCandidates(params: {
  decision: DomainDefinition;
  supportingCandidateIds: string[];
  classificationById: Map<string, SubjectClassification>;
  assignedCoreCandidates: Set<string>;
  output: string[];
  warnings: string[];
}): void {
  const {
    decision,
    supportingCandidateIds,
    classificationById,
    assignedCoreCandidates,
    output,
    warnings,
  } = params;
  const promotable = supportingCandidateIds
    .map((candidateId) => ({
      candidateId,
      classification: classificationById.get(candidateId),
    }))
    .filter(
      (
        item,
      ): item is {
        candidateId: string;
        classification: SubjectClassification;
      } =>
        item.classification?.subjectType === "business-root" &&
        !assignedCoreCandidates.has(item.candidateId),
    )
    .sort(
      (left, right) =>
        right.classification.confidence - left.classification.confidence,
    );

  for (const item of promotable) {
    output.push(item.candidateId);
    assignedCoreCandidates.add(item.candidateId);
    warnings.push(
      `业务域 ${decision.domainName} 缺少有效核心候选，已从 supportingCandidateIds 提升 ${item.candidateId} 为核心`,
    );
  }
}
