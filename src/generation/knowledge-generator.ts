import type { KnowledgeType } from "../schemas/knowledge-type.js";
import type { EvidenceBundle } from "../evidence/evidence-bundle-schema.js";
import type { EvidenceGroup } from "../evidence/type-evidence-builder.js";
import { buildPromptFramework, type PromptConfig } from "./prompt-framework.js";
import type { KnowledgePackageContribution } from "../packaging/knowledge-package-contribution.js";
import { deriveDomainKey } from "../packaging/domain-registry.js";
import type { PackageLayout } from "../knowledge/init-directory.js";
import type { GraphStatus } from "../query/prepare-generation.js";
import type { GenerateTarget } from "../knowledge/generate-scope.js";
import { TYPE_TO_DIR } from "../knowledge/type-directory-map.js";
import pLimit from "p-limit";
import { logger } from "../shared/logger.js";
import type { LlmCallInput, LlmCallResult } from "./llm-types.js";

/**
 * LLM Claims Provider Interface
 *
 * 统一接口，支持两种调用方式：
 * - Legacy: (systemPrompt, userPrompt) - 现有代码继续使用
 * - Messages: ({ messages }) - 多轮对话场景
 *
 * Provider 实现时内部根据参数类型自动处理
 */
export interface LlmClaimsProvider {
  /** Legacy 调用 */
  (
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{
    rawText: string;
    model: string;
    usage?: { promptTokens: number; completionTokens: number };
  }>;
  /** Message 数组调用（可选） */
  (input: LlmCallInput): Promise<LlmCallResult>;
}

/**
 * Knowledge Generator Input
 */
export interface KnowledgeGeneratorInput {
  repoPath: string;
  type: KnowledgeType;
  target?: GenerateTarget;
  layout: PackageLayout;
  graphStatus: GraphStatus;
  verbose?: boolean;
  llm: {
    model?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    llmConfig?: string;
  };
  dependencies?: {
    conceptNames?: string[];
    dataModelNames?: string[];
    capabilityNames?: string[];
    tagPool?: string[];
  };
}

/**
 * Knowledge Generator Result
 */
export interface KnowledgeGeneratorResult {
  objects: KnowledgeObject[];
  files: Array<{ path: string; content: string }>;
  warnings: string[];
}

export interface KnowledgeObject {
  id: string;
  type: KnowledgeType;
  [key: string]: unknown;
}

function enrichObjectForType(
  type: KnowledgeType,
  obj: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  if (type === "CONCEPT") {
    const aliases = Array.isArray(obj.aliases)
      ? obj.aliases.filter((item): item is string => typeof item === "string")
      : [];
    const kebabAlias = aliases.find((alias) => /^[a-z][a-z0-9-]*$/.test(alias));
    const domainName =
      typeof obj.concept_name === "string"
        ? obj.concept_name
        : typeof obj.name_zh === "string"
          ? obj.name_zh
          : id;

    return {
      ...obj,
      domain_key: deriveDomainKey({
        domainKey: kebabAlias,
        domainName,
        conceptId: id,
      }),
      domain_name: domainName,
      capability_refs: Array.isArray(obj.capability_refs)
        ? obj.capability_refs
        : [],
    };
  }

  if (type === "CAPABILITY") {
    const domainName =
      typeof obj.domain_name === "string"
        ? obj.domain_name
        : typeof obj.capability_name === "string"
          ? obj.capability_name
          : id;

    return {
      ...obj,
      domain_key: deriveDomainKey({
        domainKey:
          typeof obj.domain_key === "string" ? obj.domain_key : undefined,
        domainName,
        capabilityId: id,
      }),
      domain_name: domainName,
    };
  }

  return obj;
}

/**
 * Run knowledge generation for a single type
 */
export async function runKnowledgeGenerator(
  input: KnowledgeGeneratorInput,
  evidenceBundle: EvidenceBundle,
  claimsProvider: LlmClaimsProvider,
): Promise<KnowledgePackageContribution> {
  const { type, dependencies, verbose } = input;

  // Build prompt using framework
  const promptConfig: PromptConfig = {
    objectType: type,
    strategy: "bootstrap",
    phase: getPhaseForType(type),
    dependencies,
    evidence: evidenceBundle,
  };

  const { system, user } = buildPromptFramework(promptConfig);

  if (verbose) {
    console.log(`Generating ${type} knowledge...`);
    console.log(`  System prompt length: ${system.length}`);
    console.log(`  User prompt length: ${user.length}`);
  }

  // Call LLM
  const llmResult = await claimsProvider(system, user);
  const rawText = llmResult.rawText;

  if (verbose) {
    console.log(`  LLM response length: ${rawText.length}`);
    console.log(`  LLM response preview: ${rawText.slice(0, 200)}...`);
  }

  // Parse LLM response
  const parsed = parseLlmResponse(rawText);

  // Convert to contribution
  // ID 优先级：1. 显式 id 字段（英文） 2. aliases 中的英文名 3. name 字段 4. 时间戳备用
  const sourceObjects = normalizeParsedObjects(
    type,
    evidenceBundle,
    parsed.objects.length > 0
      ? parsed.objects
      : buildFallbackObjects(type, evidenceBundle),
  );
  const objects: KnowledgeObject[] = sourceObjects.map(
    (obj: Record<string, unknown>, index: number) => {
      // 尝试从 aliases 中提取英文名（ASCII字符）
      // 确保 aliases 是数组（LLM 可能返回字符串）
      const aliasesRaw = obj.aliases;
      const aliases = Array.isArray(aliasesRaw)
        ? aliasesRaw
        : typeof aliasesRaw === "string"
          ? [aliasesRaw]
          : undefined;
      const englishAlias = aliases?.find((a) => /^[\w\-]+$/.test(a));

      const stableConceptId = getStablePartitionConceptId(
        type,
        evidenceBundle,
        index,
        sourceObjects.length,
      );
      const id =
        stableConceptId ||
        extractEnglishId(obj.id as string) ||
        englishAlias ||
        extractEnglishId(obj[getNameField(type)] as string) ||
        `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const enriched = enrichObjectForType(type, obj, id);
      const knowledgeObject: KnowledgeObject = {
        id,
        type,
        ...enriched,
        ...(stableConceptId ? { domain_key: stableConceptId } : {}),
      };
      return stableConceptId
        ? constrainPartitionConceptObject(knowledgeObject, evidenceBundle)
        : knowledgeObject;
    },
  );

  const files: Array<{ path: string; content: string }> = [];
  const dirName = TYPE_TO_DIR[type] || type.toLowerCase();
  for (const obj of objects) {
    const filePath = `${dirName}/${obj.id}.md`;
    const content = objectToMarkdown(obj);
    files.push({ path: filePath, content });
  }

  const stageName = type.toLowerCase();
  return {
    stage: stageName,
    objects: objects.map((o) => ({
      id: o.id,
      type: o.type,
      path: `${dirName}/${o.id}.md`,
    })),
    files,
    report: {
      stage: stageName,
      ran: true,
      succeeded: objects.length,
      failed: objects.length === 0 ? 1 : 0,
      details: {
        model: llmResult.model,
        objectCount: objects.length,
        warnings: parsed.warnings,
      },
    },
    warnings: parsed.warnings,
  };
}

function normalizeParsedObjects(
  type: KnowledgeType,
  bundle: EvidenceBundle,
  objects: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (!isPartitionScopedConcept(type, bundle) || objects.length <= 1) {
    return objects;
  }

  return [mergeKnowledgeObjects(objects)];
}

function buildFallbackObjects(
  type: KnowledgeType,
  bundle: EvidenceBundle,
): Record<string, unknown>[] {
  if (!isPartitionScopedConcept(type, bundle)) {
    return [];
  }

  const primaryName = getPrimaryDomainName(bundle);
  const conceptName = humanizeIdentifier(primaryName);
  const evidence = [
    ...bundle.entryPoints.map(
      (entry) => entry.sourceLocation ?? entry.location,
    ),
    ...bundle.dataContracts.map(
      (contract) => contract.location || contract.name,
    ),
  ].filter((item, index, array) => item && array.indexOf(item) === index);

  return [
    {
      concept_name: conceptName,
      domain_name: conceptName,
      aliases: [
        toStableKebabId(primaryName),
        primaryName,
        ...bundle.capabilityHints.nameCandidates.slice(0, 3),
      ].filter((item, index, array) => item && array.indexOf(item) === index),
      summary_zh: `${conceptName}是由当前分区证据识别出的业务域，后续可基于代码入口、数据契约和调用链继续补充业务细节。`,
      business_meaning_zh: `${conceptName}聚合了该分区内高相关的入口点与数据契约，用于作为 concept/capability 知识生成的稳定业务边界。`,
      code_manifestation: [
        ...bundle.entryPoints.map((entry) => ({
          kind: entry.kind,
          name: entry.name,
          location: entry.sourceLocation ?? entry.location,
        })),
        ...bundle.dataContracts.map((contract) => ({
          kind: contract.kind,
          name: contract.name,
          location: contract.location,
        })),
      ],
      evidence,
      tags: ["自动兜底", "待回检"],
    },
  ];
}

function constrainPartitionConceptObject(
  obj: KnowledgeObject,
  bundle: EvidenceBundle,
): KnowledgeObject {
  return {
    ...obj,
    code_manifestation: buildEvidenceManifestation(bundle),
    evidence: buildEvidenceLocations(bundle),
  };
}

function buildEvidenceManifestation(
  bundle: EvidenceBundle,
): Array<Record<string, string>> {
  return [
    ...bundle.entryPoints.map((entry) => ({
      kind: entry.kind,
      name: entry.name,
      location: formatEntryLocation(entry),
    })),
    ...bundle.dataContracts.map((contract) => ({
      kind: contract.kind,
      name: contract.name,
      location: contract.location,
    })),
  ];
}

function buildEvidenceLocations(bundle: EvidenceBundle): string[] {
  return mergeArrays(
    bundle.entryPoints.map(formatEntryLocation),
    bundle.dataContracts.map((contract) => contract.location || contract.name),
  ).filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

function formatEntryLocation(
  entry: EvidenceBundle["entryPoints"][number],
): string {
  const location = entry.sourceLocation ?? entry.location;
  const methodName = entry.name.includes(".")
    ? entry.name.slice(entry.name.lastIndexOf(".") + 1)
    : "";
  return methodName ? `${location}#${methodName}` : location;
}

function getPrimaryDomainName(bundle: EvidenceBundle): string {
  const primaryContract = bundle.dataContracts.find(
    (contract) =>
      contract.kind === "table" &&
      (contract.customData?.tableRole === "primary" ||
        contract.customData?.source === "partition"),
  );
  return (
    primaryContract?.name ??
    bundle.capabilityHints.nameCandidates[0] ??
    bundle.candidateId.replace(/^CAND-CONCEPT-domain-/, "")
  );
}

function humanizeIdentifier(value: string): string {
  return toStableKebabId(value).split("-").filter(Boolean).join(" ");
}

function isPartitionScopedConcept(
  type: KnowledgeType,
  bundle: EvidenceBundle,
): boolean {
  return (
    type === "CONCEPT" && bundle.candidateId.startsWith("CAND-CONCEPT-domain-")
  );
}

function mergeKnowledgeObjects(
  objects: Record<string, unknown>[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...objects[0] };

  for (const obj of objects.slice(1)) {
    for (const [key, value] of Object.entries(obj)) {
      const existing = merged[key];
      if (Array.isArray(existing) || Array.isArray(value)) {
        merged[key] = mergeArrays(
          Array.isArray(existing)
            ? existing
            : existing === undefined
              ? []
              : [existing],
          Array.isArray(value) ? value : value === undefined ? [] : [value],
        );
        continue;
      }

      if (existing === undefined || existing === null || existing === "") {
        merged[key] = value;
      }
    }
  }

  return merged;
}

function mergeArrays(left: unknown[], right: unknown[]): unknown[] {
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const item of [...left, ...right]) {
    const key = typeof item === "string" ? item : JSON.stringify(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function getStablePartitionConceptId(
  type: KnowledgeType,
  bundle: EvidenceBundle,
  objectIndex: number,
  objectCount: number,
): string | undefined {
  if (
    type !== "CONCEPT" ||
    !bundle.candidateId.startsWith("CAND-CONCEPT-domain-")
  ) {
    return undefined;
  }

  const primaryContract = bundle.dataContracts.find(
    (contract) =>
      contract.kind === "table" &&
      (contract.customData?.tableRole === "primary" ||
        contract.customData?.source === "partition"),
  );
  const base = toStableKebabId(
    primaryContract?.name ??
      bundle.candidateId.replace(/^CAND-CONCEPT-domain-/, ""),
  );

  if (!base) {
    return undefined;
  }

  return objectCount > 1 ? `${base}-${objectIndex + 1}` : base;
}

function toStableKebabId(value: string): string {
  return value
    .replace(/^domain[:_-]+/, "")
    .replace(/_[a-f0-9]{8}$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Run knowledge generation for multiple evidence groups in parallel.
 * Each group is processed by a separate LLM call.
 * Uses concurrency limit to avoid rate limiting.
 */
export async function runKnowledgeGeneratorForGroups(
  input: KnowledgeGeneratorInput,
  evidenceGroups: EvidenceGroup[],
  claimsProvider: LlmClaimsProvider,
): Promise<KnowledgePackageContribution[]> {
  const { type, verbose } = input;

  if (evidenceGroups.length === 0) {
    return [];
  }

  // Use all evidence groups (debug limit removed)
  const groupsToProcess = evidenceGroups;

  if (verbose) {
    console.log(
      `Generating ${type} knowledge for ${groupsToProcess.length} groups...`,
    );
  }

  // 限制并发数为 3，避免速率限制
  const limit = pLimit(3);
  const contributions: KnowledgePackageContribution[] = [];

  // 使用 p-limit 控制并发
  const tasks = groupsToProcess.map((group, idx) =>
    limit(async () => {
      logger.debug(
        `Processing group ${idx + 1}/${groupsToProcess.length}: ${group.groupId}`,
      );
      const result = await runWithTimeout(
        () => runKnowledgeGenerator(input, group.bundle, claimsProvider),
        TASK_TIMEOUT_MS,
      );
      // Add groupId to report details
      result.report.details = {
        ...result.report.details,
        groupId: group.groupId,
        packagePath: group.packagePath,
      };
      logger.debug(
        `Completed group ${idx + 1}/${groupsToProcess.length}: ${result.report.succeeded} succeeded`,
      );
      return result;
    }),
  );

  // 执行所有任务（受并发限制）
  const results = await Promise.allSettled(tasks);

  logger.debug(`All ${results.length} tasks completed`);

  for (const [idx, result] of results.entries()) {
    if (result.status === "fulfilled") {
      contributions.push(result.value);
    } else {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      const group = evidenceGroups[idx];
      logger.error(`Group ${group.groupId} failed: ${msg}`);
      contributions.push({
        stage: type.toLowerCase(),
        files: [],
        objects: [],
        report: {
          stage: type.toLowerCase(),
          ran: true,
          succeeded: 0,
          failed: 1,
          details: {
            groupId: group.groupId,
            packagePath: group.packagePath,
            error: msg,
          },
        },
        warnings: [msg],
      });
    }
  }

  return contributions;
}

const TASK_TIMEOUT_MS = 300_000;

async function runWithTimeout<T>(
  taskFactory: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      taskFactory(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Task timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function getPhaseForType(type: KnowledgeType): PromptConfig["phase"] {
  if (type === "CONCEPT") return "concept";
  if (type === "DATA_MODEL") return "data_model";
  if (type === "CAPABILITY") return "capability";
  return "parallel";
}

function getNameField(type: KnowledgeType): string {
  const nameFields: Record<KnowledgeType, string> = {
    ARCHITECTURE: "architecture_overview_name",
    CAPABILITY: "domain_name",
    CONCEPT: "concept_name",
    BOUNDARY: "boundary_title",
    EXTERNAL: "external_system_name",
    CONSTRAINT: "constraint_name",
    RELATION: "relation_name",
    DATA_MODEL: "aggregate_name",
    WORKFLOW: "workflow_name",
  };
  return nameFields[type];
}

/**
 * 提取英文标识符（仅ASCII字符）作为有效的文件名ID。
 * 如果输入包含非ASCII字符（如中文），返回空字符串。
 */
function extractEnglishId(name: string | undefined): string {
  if (!name) return "";
  // 仅保留ASCII字符
  const asciiPart = name.replace(/[^\w\-]/g, "");
  return asciiPart.toLowerCase();
}

interface ParsedLlmResponse {
  objects: Record<string, unknown>[];
  warnings: string[];
}

function parseLlmResponse(rawText: string): ParsedLlmResponse {
  const warnings: string[] = [];

  for (const jsonText of extractJsonCandidates(rawText)) {
    const parsed =
      tryParseJson(jsonText) ??
      tryParseJson(escapeControlCharsInJsonStrings(jsonText));
    if (!parsed) {
      continue;
    }

    if (Array.isArray(parsed)) {
      return { objects: parsed, warnings };
    }

    if (parsed.objects && Array.isArray(parsed.objects)) {
      return { objects: parsed.objects, warnings: parsed.warnings || [] };
    }

    // Single object
    return { objects: [parsed], warnings };
  }

  warnings.push("Failed to parse LLM response: no valid JSON object found");
  warnings.push(`Raw response (first 500 chars): ${rawText.slice(0, 500)}`);
  return { objects: [], warnings };
}

function tryParseJson(jsonText: string): unknown | undefined {
  try {
    return JSON.parse(jsonText);
  } catch {
    return undefined;
  }
}

function extractJsonCandidates(rawText: string): string[] {
  const trimmed = rawText.trim();
  const candidates: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(trimmed)) !== null) {
    if (fenceMatch[1]?.trim()) {
      candidates.push(fenceMatch[1].trim());
    }
  }

  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (char !== "{" && char !== "[") {
      continue;
    }
    const end = findJsonEnd(trimmed, index);
    if (end <= index) {
      continue;
    }
    const candidate = trimmed.slice(index, end + 1).trim();
    if (looksLikeKnowledgeJson(candidate)) {
      candidates.push(candidate);
    }
  }

  candidates.push(trimmed);
  return [...new Set(candidates)].sort(scoreJsonCandidate);
}

function scoreJsonCandidate(left: string, right: string): number {
  return getJsonCandidateScore(right) - getJsonCandidateScore(left);
}

function getJsonCandidateScore(candidate: string): number {
  let score = 0;
  for (const token of [
    '"objects"',
    '"concept_name"',
    '"domain_name"',
    '"name_zh"',
    '"summary_zh"',
    '"type"',
  ]) {
    if (candidate.includes(token)) {
      score += 10;
    }
  }
  if (candidate.trim().startsWith("{") || candidate.trim().startsWith("[")) {
    score += 2;
  }
  return score;
}

function looksLikeKnowledgeJson(candidate: string): boolean {
  return getJsonCandidateScore(candidate) >= 10;
}

function findJsonEnd(text: string, start: number): number {
  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === opening) {
      depth++;
    } else if (char === closing) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return text.length - 1;
}

function escapeControlCharsInJsonStrings(jsonText: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of jsonText) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      result += char;
      inString = !inString;
      continue;
    }
    if (inString && char === "\n") {
      result += "\\n";
      continue;
    }
    if (inString && char === "\r") {
      result += "\\r";
      continue;
    }
    if (inString && char === "\t") {
      result += "\\t";
      continue;
    }
    result += char;
  }

  return result;
}

function objectToYaml(obj: KnowledgeObject): string {
  const lines: string[] = [];
  lines.push(`id: ${obj.id}`);
  lines.push(`type: ${obj.type}`);

  for (const [key, value] of Object.entries(obj)) {
    if (key === "id" || key === "type") continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (typeof value[0] === "object") {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${JSON.stringify(item)}`);
        }
      } else {
        lines.push(
          `${key}: [${value.map((v) => JSON.stringify(v)).join(", ")}]`,
        );
      }
    } else if (typeof value === "object" && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === "string") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  return lines.join("\n") + "\n";
}

function objectToMarkdown(obj: KnowledgeObject): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  // 标题行
  const nameZh =
    (obj as any).concept_name ||
    (obj as any).name_zh ||
    (obj as any).domain_name ||
    (obj as any).summary_zh ||
    obj.id;
  lines.push(`# ${nameZh}`);
  lines.push("");
  lines.push(`> 类型：${obj.type}`);
  lines.push(`> 生成时间：${timestamp}`);
  if (obj.type === "CONCEPT") {
    const domainName = (obj as any).domain_name || nameZh;
    const domainKey = (obj as any).domain_key || obj.id;
    lines.push(`> 业务域名：${domainName}`);
    lines.push(`> 业务域Key：${domainKey}`);
  }
  lines.push("");

  // 一句话定位
  if ((obj as any).summary_zh) {
    lines.push(`## 一句话定位`);
    lines.push("");
    lines.push((obj as any).summary_zh);
    lines.push("");
  }

  // 别名
  const aliases = (obj as any).aliases;
  if (aliases && (Array.isArray(aliases) ? aliases.length > 0 : aliases)) {
    lines.push(`## 别名`);
    lines.push("");
    lines.push("代码中的英文命名和业务术语中的其他叫法：");
    lines.push("");
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];
    for (const alias of aliasList) {
      lines.push(`- ${alias}`);
    }
    lines.push("");
  }

  // 详细描述
  for (const [key, value] of Object.entries(obj)) {
    if (
      key === "id" ||
      key === "type" ||
      key === "name_zh" ||
      key === "summary_zh" ||
      key === "aliases" ||
      key === "tags" ||
      key === "concept_name" ||
      key === "domain_name" ||
      key === "domain_key"
    )
      continue;

    if (key.endsWith("_zh") && typeof value === "string") {
      const sectionName = key.replace(/_zh$/, "").replace(/_/g, " ");
      lines.push(`## ${sectionName}`);
      lines.push("");
      lines.push(value);
      lines.push("");
    } else if (Array.isArray(value) && value.length > 0) {
      const sectionName = key.replace(/_/g, " ");
      lines.push(`## ${sectionName}`);
      lines.push("");
      if (typeof value[0] === "object") {
        lines.push("| 字段 | 值 |");
        lines.push("|------|------|");
        for (const item of value) {
          if (typeof item === "object") {
            const itemEntries = Object.entries(item).slice(0, 4);
            for (const [k, v] of itemEntries) {
              lines.push(
                `| ${k} | ${typeof v === "string" ? v : JSON.stringify(v)} |`,
              );
            }
            lines.push("");
          }
        }
      } else {
        for (const item of value) {
          lines.push(`- ${item}`);
        }
        lines.push("");
      }
    }
  }

  // 标签
  const tags = (obj as any).tags;
  if (tags && Array.isArray(tags) && tags.length > 0) {
    lines.push(`## 标签`);
    lines.push("");
    lines.push(tags.join("、"));
  }

  return lines.join("\n");
}
