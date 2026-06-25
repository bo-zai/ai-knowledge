import type { EvidenceBundle } from "../../evidence/evidence-bundle-schema.js";
import type { KnowledgePackageFile } from "../../packaging/knowledge-package-contribution.js";
import type { EvidenceIndexItem } from "../../packaging/capability-knowledge-writer.js";
import type { CapabilityDocBehavior } from "../../knowledge/capability-doc-model.js";
import type { FlowCandidate } from "../capability-clustering/types.js";

const MAX_CORE_FLOW_LINKS = 5;
const CORE_FLOW_RATIO = 0.25;
const SUPPORTING_FLOW_RATIO = 0.6;
const CORE_SCORE_THRESHOLD = 0.55;
const SUPPORTING_SCORE_THRESHOLD = 0.35;

export type CapabilityFlowPriority = "core" | "supporting" | "reference";

export interface CapabilityFlowNavigationInput {
  capabilityId: string;
  capabilityTitle: string;
  domainKey?: string;
  domainName?: string;
  flows: FlowCandidate[];
  evidenceBundle: EvidenceBundle;
  evidenceIndex: EvidenceIndexItem[];
}

export interface CapabilityFlowNavigationFile {
  flowId: string;
  flowName: string;
  priority: CapabilityFlowPriority;
  rankScore: number;
  path: string;
  content: string;
}

export function buildCapabilityFlowNavigationFiles(
  input: CapabilityFlowNavigationInput,
): CapabilityFlowNavigationFile[] {
  const rankedFlows = rankFlows(input.flows);
  return rankedFlows.map((ranked) => ({
    flowId: ranked.flow.id,
    flowName: ranked.flow.name,
    priority: ranked.priority,
    rankScore: ranked.rankScore,
    path: `functions/${ranked.flow.id}.md`,
    content: buildFlowMarkdown(input, ranked.flow, ranked),
  }));
}

export function appendCapabilityFlowNavigationSection(input: {
  markdown: string;
  flows: CapabilityFlowNavigationFile[];
  linkPrefix: string;
}): string {
  const coreFlows = input.flows.filter((flow) => flow.priority === "core");
  if (coreFlows.length === 0) return input.markdown;
  const supportingCount = input.flows.filter(
    (flow) => flow.priority === "supporting",
  ).length;
  const referenceCount = input.flows.filter(
    (flow) => flow.priority === "reference",
  ).length;

  const lines = [
    "",
    "## 聚类识别的功能入口",
    "",
    "以下是统一能力聚类结果中优先阅读的核心功能入口；完整入口仍写入 `functions/` 目录用于回检。",
    "",
  ];

  for (const flow of coreFlows.slice(0, MAX_CORE_FLOW_LINKS)) {
    lines.push(
      `- [${flow.flowName}](${input.linkPrefix}/${flow.flowId}.md)（priority=${flow.priority}, score=${flow.rankScore.toFixed(2)}）`,
    );
  }

  if (supportingCount > 0 || referenceCount > 0) {
    lines.push("");
    lines.push(
      `其他入口：supporting ${supportingCount} 个，reference ${referenceCount} 个。需要完整排查时查看 functions 目录。`,
    );
  }

  return `${input.markdown.trimEnd()}\n${lines.join("\n")}\n`;
}

export function toKnowledgePackageFiles(
  files: CapabilityFlowNavigationFile[],
): KnowledgePackageFile[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content,
  }));
}

export function buildCapabilityFlowBehaviors(input: {
  flows: FlowCandidate[];
  flowFiles: CapabilityFlowNavigationFile[];
  evidenceIndex: EvidenceIndexItem[];
}): CapabilityDocBehavior[] {
  const fileByFlowId = new Map(
    input.flowFiles.map((file) => [file.flowId, file]),
  );
  return rankFlows(input.flows).map((ranked) => {
    const flowFile = fileByFlowId.get(ranked.flow.id);
    const evidenceRefs = dedupe([
      ...ranked.flow.entryRefs,
      ...ranked.flow.behaviorRefs,
      ...ranked.flow.contractRefs,
    ]);
    return {
      title: ranked.flow.name,
      summary: buildFlowBehaviorSummary(ranked.flow, ranked),
      steps: buildFlowBehaviorSteps(ranked.flow, input.evidenceIndex),
      evidenceRefs,
      functionDocName: flowFile ? `${flowFile.flowId}.md` : undefined,
    };
  });
}

function buildFlowMarkdown(
  input: CapabilityFlowNavigationInput,
  flow: FlowCandidate,
  ranked: RankedFlowCandidate,
): string {
  const candidate = input.evidenceBundle.functionCandidates?.find(
    (item) => item.canonicalName === flow.name,
  );
  const entryEvidence = collectEvidence(input.evidenceIndex, flow.entryRefs);
  const behaviorEvidence = collectEvidence(
    input.evidenceIndex,
    flow.behaviorRefs,
  );
  const contractEvidence = collectEvidence(
    input.evidenceIndex,
    flow.contractRefs,
  );
  const moduleEvidence = collectEvidence(input.evidenceIndex, flow.moduleRefs);

  const lines: string[] = [];
  lines.push(`# ${flow.name}`);
  lines.push("");
  lines.push(
    `> 所属 capability：${input.capabilityTitle} (${input.capabilityId})`,
  );
  if (input.domainName || input.domainKey) {
    lines.push(`> 所属业务域：${input.domainName ?? "-"}`);
    lines.push(`> 业务域Key：${input.domainKey ?? "-"}`);
  }
  lines.push(`> 生成时间：${new Date().toISOString()}`);
  lines.push("");

  lines.push("## 1. 功能定位");
  lines.push("");
  lines.push(
    candidate?.summary ??
      "该功能入口由代码入口、行为切片和数据契约证据聚类得到。",
  );
  lines.push("");
  lines.push(`- 写操作：${flow.isWrite ? "是" : "否"}`);
  lines.push(
    `- 状态变化：${flow.hasStateTransition ? "可能涉及" : "未从命名和证据中稳定识别"}`,
  );
  lines.push(`- 导航优先级：${ranked.priority}`);
  lines.push(`- 综合排序分：${formatScore(ranked.rankScore)}`);
  lines.push(`- 核心度：${formatScore(flow.scores.businessCore)}`);
  lines.push(`- 导航必要性：${formatScore(flow.scores.navigationNeed)}`);
  lines.push(`- 近期变更活跃度：${formatScore(flow.scores.changeActivity)}`);
  lines.push("");

  lines.push("## 2. 入口锚点");
  lines.push("");
  pushEvidenceTable(
    lines,
    entryEvidence,
    "当前功能没有独立入口证据，需从所属 capability 的入口继续追踪。",
  );
  lines.push("");

  lines.push("## 3. 行为线索");
  lines.push("");
  pushEvidenceTable(
    lines,
    behaviorEvidence,
    "当前功能没有稳定行为切片，需阅读入口方法和调用链补全行为。",
  );
  lines.push("");

  lines.push("## 4. 数据与契约");
  lines.push("");
  pushEvidenceTable(
    lines,
    contractEvidence,
    "当前功能没有绑定到独立数据契约，涉及数据变更时必须重新确认表、SQL 或接口契约。",
  );
  lines.push("");

  lines.push("## 5. 改动定位");
  lines.push("");
  pushEvidenceTable(
    lines,
    moduleEvidence,
    "当前功能没有稳定模块边界证据，修改前需要从入口反向定位服务和数据访问层。",
  );
  lines.push("");

  lines.push("## 6. 使用建议");
  lines.push("");
  lines.push(
    "- 需求提到该入口、同名动作或关联数据对象时，先读本文件再进入 capability 文档。",
  );
  lines.push(
    "- 本文件只提供导航证据，不替代代码阅读；涉及业务规则、状态机、权限和外部调用时必须回到源码核对。",
  );
  lines.push(
    "- 如果入口证据和实际调用链不一致，以当前代码为准，并把知识视为过期候选。",
  );
  lines.push("");

  return lines.join("\n");
}

function buildFlowBehaviorSummary(
  flow: FlowCandidate,
  ranked: RankedFlowCandidate,
): string {
  const operation = flow.isWrite ? "写操作" : "只读/查询操作";
  const transition = flow.hasStateTransition ? "，可能涉及状态变化" : "";
  return `${flow.name} 是聚类识别出的 ${operation}${transition}；priority=${ranked.priority}, score=${formatScore(ranked.rankScore)}。`;
}

function buildFlowBehaviorSteps(
  flow: FlowCandidate,
  evidenceIndex: EvidenceIndexItem[],
): CapabilityDocBehavior["steps"] {
  const entryEvidence = collectEvidence(evidenceIndex, flow.entryRefs);
  if (entryEvidence.length === 0) {
    return [
      {
        step: "从所属 capability 的入口继续追踪当前行为",
        evidenceRefs: flow.entryRefs,
      },
    ];
  }
  return entryEvidence.map((entry) => ({
    step: `从 ${entry.name ?? entry.location ?? entry.ref} 进入该功能`,
    evidenceRefs: [entry.ref],
  }));
}

function collectEvidence(
  evidenceIndex: EvidenceIndexItem[],
  refs: string[],
): EvidenceIndexItem[] {
  const refSet = new Set(refs);
  return evidenceIndex.filter((item) => refSet.has(item.ref));
}

function pushEvidenceTable(
  lines: string[],
  evidence: EvidenceIndexItem[],
  fallback: string,
): void {
  if (evidence.length === 0) {
    lines.push(`- ${fallback}`);
    return;
  }

  lines.push("| 证据 | 类型 | 位置 | 说明 |");
  lines.push("| --- | --- | --- | --- |");
  for (const item of evidence) {
    lines.push(
      `| ${escapeCell(item.ref)} | ${escapeCell(item.kind)} | ${escapeCell(item.location ?? "-")} | ${escapeCell(item.summary ?? item.name ?? "-")} |`,
    );
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

interface RankedFlowCandidate {
  flow: FlowCandidate;
  priority: CapabilityFlowPriority;
  rankScore: number;
}

function rankFlows(flows: FlowCandidate[]): RankedFlowCandidate[] {
  const sorted = flows
    .map((flow) => ({
      flow,
      rankScore: calculateRankScore(flow),
    }))
    .sort((left, right) => right.rankScore - left.rankScore);

  const coreLimit = Math.min(
    MAX_CORE_FLOW_LINKS,
    Math.max(1, Math.ceil(sorted.length * CORE_FLOW_RATIO)),
  );
  const supportingLimit = Math.max(
    coreLimit,
    Math.ceil(sorted.length * SUPPORTING_FLOW_RATIO),
  );

  return sorted.map((item, index) => ({
    ...item,
    priority: determinePriority({
      rankScore: item.rankScore,
      index,
      coreLimit,
      supportingLimit,
    }),
  }));
}

function determinePriority(input: {
  rankScore: number;
  index: number;
  coreLimit: number;
  supportingLimit: number;
}): CapabilityFlowPriority {
  if (
    input.index < input.coreLimit &&
    (input.index === 0 || input.rankScore >= CORE_SCORE_THRESHOLD)
  ) {
    return "core";
  }
  if (
    input.index < input.supportingLimit ||
    input.rankScore >= SUPPORTING_SCORE_THRESHOLD
  ) {
    return "supporting";
  }
  return "reference";
}

function calculateRankScore(flow: FlowCandidate): number {
  const operationWeight = flow.isWrite ? 0.08 : 0;
  const stateWeight = flow.hasStateTransition ? 0.12 : 0;
  return clamp01(
    flow.scores.businessCore * 0.5 +
      flow.scores.navigationNeed * 0.25 +
      flow.scores.changeActivity * 0.05 +
      operationWeight +
      stateWeight,
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))];
}
