import type OpenAI from "openai";
import type { ModelConfig } from "../config/model-config.js";
import path from "path";
import { logger } from "../shared/logger.js";
import { discoverSlices } from "../query/index-service.js";
import { buildSlicePlan } from "../slicing/build-slice-plan.js";
import {
  buildRepoEvidenceBundle,
  buildRouteSliceEvidence,
  buildProcessSliceEvidence,
  buildModuleSliceEvidence,
  buildDatabaseSliceEvidence,
} from "../evidence/bundle-builder.js";
import type { SliceEvidenceBundle } from "../evidence/types.js";
import {
  buildDbTableBundle,
  buildAllDbTableBundles,
  type DbTableEvidenceBundle,
} from "../evidence/db-bundle-builder.js";
import {
  generateWithClient,
  type LlmGenerationResult,
} from "../generation/llm-client.js";
import type { GeneratorOutput } from "../generation/parse-output.js";
import { parseGeneratorOutput } from "../generation/parse-output.js";
import { withRetry } from "../generation/retry.js";
import { buildDbPrompt } from "../generation/object-generators/db-generator.js";
import { buildConPrompt } from "../generation/object-generators/contract-generator.js";
import { buildTermPrompt } from "../generation/object-generators/term-generator.js";
import { buildFlowPrompt } from "../generation/object-generators/flow-generator.js";
import { buildModPrompt } from "../generation/object-generators/mod-generator.js";
import { buildOpenPrompt } from "../generation/object-generators/open-generator.js";
import { buildOwnPrompt } from "../generation/object-generators/own-generator.js";
import { buildVerPrompt } from "../generation/object-generators/ver-generator.js";
import { dbObjectSchema } from "../schemas/db.js";
import { conObjectSchema } from "../schemas/contract.js";
import { termObjectSchema } from "../schemas/term.js";
import { flowObjectSchema } from "../schemas/flow.js";
import { modObjectSchema } from "../schemas/mod.js";
import { openObjectSchema } from "../schemas/open.js";
import { ownObjectSchema } from "../schemas/own.js";
import { verObjectSchema } from "../schemas/ver.js";
import { generateObjectId } from "../shared/ids.js";
import { getRepoBasename } from "../shared/path-utils.js";
import YAML from "yaml";
import type { SliceKind, SliceSeed } from "../slicing/types.js";
import type { GenerateTarget } from "./generate-scope.js";
import type {
  KnowledgePackageContribution,
  KnowledgePackageStageReport,
} from "../packaging/knowledge-package-contribution.js";
import type { SliceDebugTrace } from "../packaging/write-debug-logs.js";
import type { GraphStatus } from "../query/prepare-generation.js";
import { TYPE_TO_DIR, getDirForType } from "./type-directory-map.js";

export interface RunDbKnowledgePipelineInput {
  repoPath: string;
  target?: GenerateTarget;
  graphStatus: GraphStatus;
  verbose?: boolean;
  modelConfig: ModelConfig;
  /** 关联仓库路径（如核心库仓库），用于数据模型证据补充 */
  companionRepoPath?: string;
}

/**
 * 获取关联仓库路径
 *
 * 通用逻辑：优先使用传入的参数，否则返回 undefined
 * 不做特定项目判断，确保通用性
 */
async function resolveCompanionRepoPath(
  repoPath: string,
  companionRepoPath?: string,
): Promise<string | undefined> {
  if (!companionRepoPath) {
    return undefined;
  }

  // 验证传入的路径是否存在
  const fs = await import("fs/promises");
  try {
    const stat = await fs.stat(companionRepoPath);
    return stat.isDirectory() ? companionRepoPath : undefined;
  } catch {
    logger.warn(`Companion repo path "${companionRepoPath}" does not exist`);
    return undefined;
  }
}

interface SliceFilter {
  kind?: SliceKind;
  raw: string;
  target: string;
}

function parseSliceFilter(value?: string): SliceFilter | null {
  if (!value) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;

  const [prefix, rest] = normalized.split(":", 2);
  const knownKinds: SliceKind[] = [
    "route",
    "process",
    "tool",
    "community",
    "database",
  ];
  if (knownKinds.includes(prefix as SliceKind) && rest) {
    return {
      kind: prefix as SliceKind,
      raw: normalized,
      target: rest.trim().toLowerCase(),
    };
  }
  return { raw: normalized, target: normalized.toLowerCase() };
}

function shouldQueryAdditionalSlices(filter: SliceFilter | null): boolean {
  return !filter || filter.kind !== "database";
}

async function buildDbBundlesForGeneration(
  repoPath: string,
  filter: SliceFilter | null,
  coreRepoPath?: string,
): Promise<DbTableEvidenceBundle[]> {
  if (filter?.kind === "database" && filter.target.length > 0) {
    return [await buildDbTableBundle(repoPath, filter.target, coreRepoPath)];
  }
  return buildAllDbTableBundles(repoPath, coreRepoPath);
}

function applySliceFilter(
  slices: SliceSeed[],
  filter: SliceFilter | null,
): SliceSeed[] {
  if (!filter) return slices;
  return slices.filter((slice) => {
    if (filter.kind && slice.kind !== filter.kind) return false;
    const idValue = slice.id.toLowerCase();
    const titleValue = slice.title.toLowerCase();
    const sourceValue = slice.source?.toLowerCase();
    if (filter.kind) {
      return (
        titleValue === filter.target ||
        sourceValue === filter.target ||
        idValue === filter.raw.toLowerCase()
      );
    }
    return (
      idValue === filter.target ||
      titleValue === filter.target ||
      sourceValue === filter.target
    );
  });
}

function countSlicesByKind(slices: SliceSeed[]): Record<SliceKind, number> {
  return slices.reduce<Record<SliceKind, number>>(
    (counts, slice) => {
      counts[slice.kind] += 1;
      return counts;
    },
    { route: 0, process: 0, tool: 0, community: 0, database: 0 },
  );
}

function isMockModel(model: string): boolean {
  return model.startsWith("test-");
}

function inferObjectType(
  sliceKind: string,
): "CON" | "FLOW" | "MOD" | "TERM" | "DB" | "OWN" | "VER" | "OPEN" {
  const mapping: Record<string, "CON" | "FLOW" | "MOD" | "TERM" | "DB"> = {
    route: "CON",
    process: "FLOW",
    tool: "MOD",
    community: "TERM",
    database: "DB",
  };
  return mapping[sliceKind] ?? "OPEN";
}

function getObjectPath(type: string, id: string): string {
  return `objects/${getDirForType(type as any)}/${id}.md`;
}

function getPromptBuilderForSliceKind(
  kind: string,
): ((input: unknown) => { system: string; user: string }) | null {
  if (kind === "database") {
    return (input: unknown) =>
      buildDbPrompt(input as Parameters<typeof buildDbPrompt>[0]);
  }
  const builders: Record<
    string,
    (input: unknown) => { system: string; user: string }
  > = {
    route: buildConPrompt,
    process: buildFlowPrompt,
    tool: buildModPrompt,
    community: buildTermPrompt,
  };
  return builders[kind] ?? null;
}

function validateObject(draft: unknown, objectType: string): unknown | null {
  try {
    switch (objectType) {
      case "DB":
        return dbObjectSchema.parse(draft);
      case "CON":
        return conObjectSchema.parse(draft);
      case "TERM":
        return termObjectSchema.parse(draft);
      case "FLOW":
        return flowObjectSchema.parse(draft);
      case "MOD":
        return modObjectSchema.parse(draft);
      case "OPEN":
        return openObjectSchema.parse(draft);
      case "OWN":
        return ownObjectSchema.parse(draft);
      case "VER":
        return verObjectSchema.parse(draft);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function stripCommonFields(
  object: Record<string, unknown>,
): Record<string, unknown> {
  const {
    id: _id,
    type: _type,
    title: _title,
    status: _status,
    maturity: _maturity,
    scope: _scope,
    repo: _repo,
    slice_ids: _sliceIds,
    evidence_primary: _evidencePrimary,
    evidence_secondary: _evidenceSecondary,
    stale_if: _staleIf,
    generated_by: _generatedBy,
    generated_at: _generatedAt,
    ...rest
  } = object;
  return rest;
}

function renderObjectMarkdown(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const fmLines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      fmLines.push(`${key}: [${value.join(", ")}]`);
    } else {
      fmLines.push(`${key}: ${value}`);
    }
  }
  fmLines.push("---", "", body);
  return fmLines.join("\n");
}

function renderConMarkdown(
  validated: ReturnType<typeof conObjectSchema.parse>,
): string {
  const frontmatter = {
    id: (validated as Record<string, unknown>).id,
    type: (validated as Record<string, unknown>).type,
    title: (validated as Record<string, unknown>).title,
  };
  return renderObjectMarkdown(
    frontmatter,
    YAML.stringify(stripCommonFields(validated as Record<string, unknown>)),
  );
}

function buildSliceSpecificEvidence(
  slice: { id: string; kind: string; title: string },
  repoPath: string,
  dbBundleMap: Map<string, DbTableEvidenceBundle>,
): SliceEvidenceBundle {
  switch (slice.kind) {
    case "route": {
      const routeParts = slice.id.replace("route:", "").split(":");
      const method = routeParts[0] ?? "GET";
      const routePath = routeParts[1] ?? slice.title;
      return buildRouteSliceEvidence({
        route: slice.title,
        handlerFile: `${repoPath}/src/routes/${routePath.replace(/\//g, "_")}.ts`,
        method,
        path: routePath,
        middleware: [],
        responseShape: [],
        errorShape: [],
        tests: [],
      });
    }
    case "process":
      return buildProcessSliceEvidence({
        processName: slice.title,
        entryFile: `${repoPath}/src/processes/${slice.title.toLowerCase()}.ts`,
        steps: [
          {
            order: 1,
            action: "start",
            actor: "system",
            file: `${repoPath}/src/processes/${slice.title.toLowerCase()}.ts`,
          },
        ],
        outcomes: [],
        errorHandling: [],
      });
    case "tool":
      return buildModuleSliceEvidence({
        moduleName: slice.title,
        filePath: `${repoPath}/src/tools/${slice.title.toLowerCase()}.ts`,
        exports: [{ name: slice.title, kind: "function" }],
        imports: [],
        dependsOn: [],
        usedBy: [],
      });
    case "database": {
      const dbBundle = dbBundleMap.get(slice.title.toLowerCase());
      if (dbBundle) {
        return buildDatabaseSliceEvidence({
          tableName: dbBundle.table,
          schemaName: "public",
          sourceFile: dbBundle.mapperBindings[0]?.mapperFile ?? repoPath,
          sourceKind: "orm",
          fields:
            dbBundle.fieldCandidates.length > 0
              ? dbBundle.fieldCandidates.map((field) => ({
                  name: field.name,
                  type: field.type ?? "unknown",
                  description: field.name,
                  source: field.source === "inferred" ? "inferred" : "comment",
                }))
              : [
                  {
                    name: "id",
                    type: "unknown",
                    description: "id",
                    source: "inferred",
                  },
                ],
          primaryKey: [],
          foreignKeys: [],
          readBy: dbBundle.mapperBindings
            .filter((b) => b.statementType === "select")
            .map((b) => `${b.namespace}.${b.methodId}`),
          writeBy: dbBundle.mapperBindings
            .filter((b) => b.statementType !== "select")
            .map((b) => `${b.namespace}.${b.methodId}`),
        });
      }
      return buildDatabaseSliceEvidence({
        tableName: slice.title,
        schemaName: "public",
        sourceFile: `${repoPath}/src/db/schema/${slice.title}.ts`,
        sourceKind: "orm",
        fields: [],
        primaryKey: [],
        foreignKeys: [],
        readBy: [],
        writeBy: [],
      });
    }
    case "community":
      return {
        slice: {
          id: slice.id,
          kind: "community",
          title: slice.title,
          scope: slice.title,
          seed: slice.title,
        },
        facts: [
          {
            id: "F-TERM-001",
            claim: `术语 ${slice.title} 在仓库中被使用`,
            source_kind: "analysis-runtime",
            refs: [{ file: repoPath }],
          },
        ],
        symbols: [],
        relations: [],
        snippets: [],
        tables: [],
        tests: [],
        gaps: [
          {
            id: "G-TERM-001",
            kind: "missing-definition",
            question: `术语 ${slice.title} 的具体定义是什么？`,
            reason: "未从代码中提取到术语定义",
          },
        ],
      };
    default:
      return {
        slice: {
          id: slice.id,
          kind: "route",
          title: slice.title,
          scope: slice.id,
          seed: slice.id,
        },
        facts: [],
        symbols: [],
        relations: [],
        snippets: [],
        tables: [],
        tests: [],
        gaps: [
          {
            id: `G-${slice.id}-001`,
            kind: "unknown-slice-kind",
            question: `如何处理 ${slice.kind} 类型的切片？`,
            reason: `未知的切片类型: ${slice.kind}`,
          },
        ],
      };
  }
}

interface GenerationErrorMeta {
  message: string;
  finishedAt: string;
  durationMs: number;
}

async function generateObjectForSlice(
  slice: { id: string; kind: string; title: string },
  evidence: unknown,
  client: OpenAI | null,
  model: string,
  repoPath: string,
): Promise<{
  objectResult: {
    id: string;
    type: string;
    content: string;
    frontmatter: Record<string, unknown>;
  } | null;
  trace: SliceDebugTrace;
}> {
  const promptBuilder = getPromptBuilderForSliceKind(slice.kind);
  if (!promptBuilder) {
    const now = new Date().toISOString();
    return {
      objectResult: null,
      trace: {
        sliceId: slice.id,
        sliceKind: slice.kind,
        sliceTitle: slice.title,
        objectType: "OPEN",
        mode: isMockModel(model) ? "mock" : "llm",
        status: "error",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        request: { systemPrompt: "", userPrompt: "" },
        response: {},
        error: `No generator for slice kind ${slice.kind}`,
      },
    };
  }

  const { system, user } = promptBuilder({ slice, evidence, repoPath });
  const objectType = inferObjectType(slice.kind);
  const startedAt = new Date();
  let rawText: string | undefined;
  let parsedOutput: GeneratorOutput | undefined;
  let llmResult: LlmGenerationResult | undefined;

  const output = isMockModel(model)
    ? buildMockGeneratorOutput(slice, evidence, objectType)
    : await withRetry(
        async () => {
          if (!client) throw new Error("OpenAI client is not available");
          llmResult = await generateWithClient(client, model, system, user);
          rawText = llmResult.text;
          parsedOutput = parseGeneratorOutput(rawText);
          return parsedOutput;
        },
        { maxRetries: 3, delayMs: 1000 },
      ).catch((error: unknown) => {
        const finishedAt = new Date();
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          objects: [],
          warnings: [],
          __generationError: {
            message: errorMessage,
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime(),
          },
        } as GeneratorOutput & { __generationError: GenerationErrorMeta };
      });

  if (isMockModel(model)) {
    parsedOutput = output;
    rawText = JSON.stringify(output);
  }

  if ("__generationError" in output) {
    const generationError = output.__generationError as GenerationErrorMeta;
    return {
      objectResult: null,
      trace: {
        sliceId: slice.id,
        sliceKind: slice.kind,
        sliceTitle: slice.title,
        objectType,
        mode: isMockModel(model) ? "mock" : "llm",
        status: "error",
        startedAt: startedAt.toISOString(),
        finishedAt: generationError.finishedAt,
        durationMs: generationError.durationMs,
        request: { systemPrompt: system, userPrompt: user },
        response: { rawText, parsedOutput, warnings: [], llm: llmResult },
        error: generationError.message,
      },
    };
  }

  const finishedAtForOutput = new Date();
  if (output.objects.length === 0) {
    return {
      objectResult: null,
      trace: {
        sliceId: slice.id,
        sliceKind: slice.kind,
        sliceTitle: slice.title,
        objectType,
        mode: isMockModel(model) ? "mock" : "llm",
        status: "empty",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAtForOutput.toISOString(),
        durationMs: finishedAtForOutput.getTime() - startedAt.getTime(),
        request: { systemPrompt: system, userPrompt: user },
        response: {
          rawText,
          parsedOutput,
          warnings: output.warnings,
          llm: llmResult,
        },
      },
    };
  }

  const draft = output.objects[0];
  const generatedAt = new Date().toISOString();
  const objectId = generateObjectId(objectType, slice.id);
  const frontmatter = {
    id: objectId,
    type: objectType,
    title: slice.title,
    status: "fact",
    maturity: "bootstrap",
    scope: slice.id,
    repo: getRepoBasename(repoPath),
    slice_ids: [slice.id],
    evidence_primary: [slice.id],
    evidence_secondary: [],
    stale_if: [],
    generated_by: "repo-knowledge-generator",
    generated_at: generatedAt,
  };

  const candidateObject = {
    ...(typeof draft === "object" && draft !== null ? draft : {}),
    ...frontmatter,
    id: objectId,
    type: objectType,
  };
  const validated = validateObject(candidateObject, objectType);
  if (!validated) {
    const finishedAt = new Date();
    return {
      objectResult: null,
      trace: {
        sliceId: slice.id,
        sliceKind: slice.kind,
        sliceTitle: slice.title,
        objectType,
        mode: isMockModel(model) ? "mock" : "llm",
        status: "validation_failed",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        request: { systemPrompt: system, userPrompt: user },
        response: {
          rawText,
          parsedOutput,
          warnings: output.warnings,
          llm: llmResult,
        },
        validation: { passed: false, error: "Schema validation failed" },
      },
    };
  }

  let content: string;
  if (objectType === "CON" && validated) {
    content = renderConMarkdown(
      validated as ReturnType<typeof conObjectSchema.parse>,
    );
  } else {
    content = renderObjectMarkdown(
      frontmatter,
      YAML.stringify(stripCommonFields(validated as Record<string, unknown>)),
    );
  }

  const finishedAt = new Date();
  return {
    objectResult: { id: objectId, type: objectType, content, frontmatter },
    trace: {
      sliceId: slice.id,
      sliceKind: slice.kind,
      sliceTitle: slice.title,
      objectType,
      mode: isMockModel(model) ? "mock" : "llm",
      status: "success",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      request: { systemPrompt: system, userPrompt: user },
      response: {
        rawText,
        parsedOutput,
        warnings: output.warnings,
        llm: llmResult,
      },
      validation: { passed: true },
    },
  };
}

function buildMockGeneratorOutput(
  slice: { id: string; kind: string; title: string },
  evidence: unknown,
  objectType: "CON" | "FLOW" | "MOD" | "TERM" | "DB" | "OWN" | "VER" | "OPEN",
): GeneratorOutput {
  const payload = (evidence ?? {}) as {
    slice?: SliceEvidenceBundle;
    db_bundle?: DbTableEvidenceBundle | null;
  };
  const baseWarnings = [{ message: "mock-model-output" }];

  switch (objectType) {
    case "DB": {
      const dbBundle = payload.db_bundle;
      const fields =
        dbBundle && dbBundle.fieldCandidates.length > 0
          ? dbBundle.fieldCandidates.map((field) => ({
              name: field.name,
              type: field.type ?? "unknown",
              nullable: true,
              default: null,
              description_zh:
                field.javaFieldComment ||
                field.mappedJavaProperty ||
                field.name,
              description_source: field.javaFieldComment
                ? "comment"
                : "inferred",
              constraints: [],
            }))
          : [
              {
                name: "id",
                type: "unknown",
                nullable: true,
                default: null,
                description_zh: "主键",
                description_source: "inferred",
                constraints: [],
              },
            ];
      return {
        objects: [
          {
            table_name: dbBundle?.table ?? slice.title,
            table_name_zh: `${dbBundle?.table ?? slice.title}表`,
            schema_name: "public",
            source_kind: "mapper",
            primary_key: [],
            indexes: [],
            foreign_keys: [],
            read_by_direct:
              dbBundle?.directStatements
                .filter((s) => s.statementType === "select")
                .map((s) => s.id) ?? [],
            read_by_joined:
              dbBundle?.joinedStatements
                .filter((s) => s.statementType === "select")
                .map((s) => s.id) ?? [],
            write_by_direct:
              dbBundle?.directStatements
                .filter((s) => s.statementType !== "select")
                .map((s) => s.id) ?? [],
            write_by_joined:
              dbBundle?.joinedStatements
                .filter((s) => s.statementType !== "select")
                .map((s) => s.id) ?? [],
            fields,
            gaps: [],
          },
        ],
        warnings: baseWarnings,
      };
    }
    case "CON":
      return {
        objects: [
          {
            interface_kind: "route",
            interface_name: slice.title,
            interface_name_zh: `${slice.title}接口`,
            producer: slice.title,
            producer_zh: "路由处理器",
            consumers: [],
            input_shape: [],
            input_description_zh: "当前未提取到输入字段",
            output_shape: [],
            output_description_zh: "当前未提取到输出字段",
            middleware: [],
            related_routes: [slice.title],
            related_tools: [],
            entry_file: payload.slice?.facts[0]?.refs[0]?.file ?? slice.title,
          },
        ],
        warnings: baseWarnings,
      };
    case "FLOW":
      return {
        objects: [
          {
            flow_name: slice.title,
            flow_name_zh: `${slice.title}流程`,
            trigger: slice.id,
            trigger_zh: "触发该流程的入口",
            steps: [
              {
                order: 1,
                action: "start",
                action_zh: "开始处理",
                actor: "system",
                inputs: [],
                outputs: [],
              },
            ],
            outcomes: [],
            error_handling: [],
          },
        ],
        warnings: baseWarnings,
      };
    case "MOD":
      return {
        objects: [
          {
            module_name: slice.title,
            module_name_zh: `${slice.title}模块`,
            responsibility_zh: "承载当前切片相关逻辑",
            module_kind: "utility",
            exports: [],
            imports: [],
            depends_on: [],
            used_by: [],
          },
        ],
        warnings: baseWarnings,
      };
    case "TERM":
      return {
        objects: [
          {
            term: slice.title,
            term_zh: slice.title,
            definition_zh: `术语 ${slice.title} 在当前仓库中被使用`,
            aliases: [],
            related_terms: [],
            used_in: [slice.id],
          },
        ],
        warnings: baseWarnings,
      };
    case "OPEN":
      return {
        objects: [
          {
            question: `${slice.title} 仍有待确认信息`,
            question_zh: `${slice.title} 仍有待确认信息`,
            context_zh: "mock 模式下未连接真实模型，保留开放问题",
            impact: "medium",
          },
        ],
        warnings: baseWarnings,
      };
    case "OWN":
      return {
        objects: [
          {
            owner_type: "shared",
            owner_name: slice.title,
            owner_name_zh: slice.title,
            responsibility_zh: "当前切片的默认责任边界",
            scope_items: [slice.id],
          },
        ],
        warnings: baseWarnings,
      };
    case "VER":
      return {
        objects: [
          {
            version_name: slice.title,
            version_name_zh: slice.title,
            version_value: "bootstrap",
            version_kind: "tool",
            changelog_zh: "mock 模式下生成的占位版本信息",
            breaking_changes: [],
          },
        ],
        warnings: baseWarnings,
      };
  }
}

export function buildDbStageReport(input: {
  succeeded: number;
  failed: number;
  targetTable?: string;
}): KnowledgePackageStageReport {
  return {
    stage: "db",
    ran: true,
    succeeded: input.succeeded,
    failed: input.failed,
    details: input.targetTable ? { targetTable: input.targetTable } : {},
  };
}

export async function runDbKnowledgePipeline(
  input: RunDbKnowledgePipelineInput,
): Promise<KnowledgePackageContribution> {
  const {
    repoPath,
    target,
    graphStatus,
    verbose,
    modelConfig,
    companionRepoPath,
  } = input;
  const mockMode = isMockModel(modelConfig.model);

  // Build slice filter from target
  let sliceFilter: SliceFilter | null = null;
  if (target?.kind === "DATA_MODEL") {
    sliceFilter = {
      kind: "database",
      raw: `database:${target.value}`,
      target: target.value.toLowerCase(),
    };
  }

  // Graph data already initialized by Step 1a
  logger.info(`Using graph status: ${graphStatus.status}`);

  // 2. Build DB evidence bundles
  const resolvedCompanionRepoPath = await resolveCompanionRepoPath(
    repoPath,
    companionRepoPath,
  );
  logger.info("Building DB evidence bundles...");
  const dbBundles = await buildDbBundlesForGeneration(
    repoPath,
    sliceFilter,
    resolvedCompanionRepoPath,
  );
  logger.info(`Built ${dbBundles.length} DB evidence bundles`);
  const dbBundleMap = new Map(
    dbBundles.map((bundle) => [bundle.table.toLowerCase(), bundle]),
  );

  let sliceSeeds = {
    routes: [] as string[],
    processes: [] as string[],
    tools: [] as string[],
    communities: [] as string[],
    tables: dbBundles.map((bundle) => bundle.table),
  };

  // 3. Additional slice discovery (non-DB specific)
  if (!mockMode && shouldQueryAdditionalSlices(sliceFilter)) {
    try {
      logger.info("Running additional slice discovery...");
      const discovered = await discoverSlices(repoPath);
      sliceSeeds = {
        routes: discovered.routes.map((r) => `${r.method} ${r.path}`),
        processes: discovered.processes.map((p) => p.name),
        tools: discovered.tools.map((t) => t.name),
        communities: discovered.communities.map((c) => c.name),
        tables: [
          ...new Set([
            ...sliceSeeds.tables,
            ...discovered.tables.map((t) => t.name),
          ]),
        ],
      };
    } catch (error) {
      logger.warn(
        `Slice discovery failed, continuing with DB slices only: ${String(error)}`,
      );
    }
  }

  const discoveredPlan = buildSlicePlan(sliceSeeds);
  const filteredSlices = applySliceFilter(discoveredPlan.slices, sliceFilter);
  const slicePlan = {
    ...discoveredPlan,
    slices: filteredSlices,
    total_count: filteredSlices.length,
    by_kind: countSlicesByKind(filteredSlices),
  };

  logger.info(`Discovered ${slicePlan.total_count} slices`);

  if (slicePlan.total_count === 0) {
    logger.warn("No slices matched the current filters");
    return {
      stage: "db",
      files: [],
      objects: [],
      report: buildDbStageReport({
        succeeded: 0,
        failed: 0,
        targetTable: target?.value,
      }),
      warnings: ["No slices matched the current filters"],
    };
  }

  // 4. Build repo evidence
  const repoEvidence = buildRepoEvidenceBundle({
    repoPath,
    repoName: getRepoBasename(repoPath),
  });

  // 5. Generate objects
  const { createOpenAiClient } = await import("../config/model-config.js");
  const client = mockMode ? null : await createOpenAiClient(modelConfig);
  const generatedObjects: Array<{
    id: string;
    type: string;
    content: string;
    frontmatter: Record<string, unknown>;
  }> = [];
  const failures: Array<{ id: string; type: string; error: string }> = [];
  const warnings: string[] = [];
  const debugTraces: SliceDebugTrace[] = [];

  for (const [index, slice] of slicePlan.slices.entries()) {
    const sliceProgress = `slice ${index + 1}/${slicePlan.slices.length} [${slice.kind}] ${slice.title}`;
    try {
      logger.info(`Building evidence for ${sliceProgress}`);
      const sliceEvidence = buildSliceSpecificEvidence(
        slice,
        repoPath,
        dbBundleMap,
      );
      const combinedEvidence = {
        repo: repoEvidence,
        slice: sliceEvidence,
        db_bundle:
          slice.kind === "database"
            ? (dbBundleMap.get(slice.title.toLowerCase()) ?? null)
            : null,
      };

      logger.info(`Generating ${sliceProgress}`);
      const generation = await generateObjectForSlice(
        slice,
        combinedEvidence,
        client,
        modelConfig.model,
        repoPath,
      );
      debugTraces.push(generation.trace);

      if (generation.objectResult) {
        generatedObjects.push(generation.objectResult);
      } else if (
        generation.trace.status === "validation_failed" ||
        generation.trace.status === "error"
      ) {
        const failedObjectType = inferObjectType(slice.kind);
        failures.push({
          id: generateObjectId(failedObjectType, slice.id),
          type: failedObjectType,
          error:
            generation.trace.validation?.error ??
            generation.trace.error ??
            "Object generation failed",
        });
      }
      logger.info(
        `Finished ${sliceProgress} with status ${generation.trace.status} in ${generation.trace.durationMs}ms`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const failedObjectType = inferObjectType(slice.kind);
      failures.push({
        id: generateObjectId(failedObjectType, slice.id),
        type: failedObjectType,
        error: errorMsg,
      });
      debugTraces.push({
        sliceId: slice.id,
        sliceKind: slice.kind,
        sliceTitle: slice.title,
        objectType: failedObjectType,
        mode: mockMode ? "mock" : "llm",
        status: "error",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        request: { systemPrompt: "", userPrompt: "" },
        response: {},
        error: errorMsg,
      });
      logger.warn(`Failed ${sliceProgress}: ${errorMsg}`);
    }
  }

  // 6. Build files from generated objects
  const files = generatedObjects.map((obj) => ({
    path: getObjectPath(obj.type, obj.id),
    content: obj.content,
  }));

  // Add debug traces
  if (debugTraces.length > 0) {
    const repoId = getRepoBasename(repoPath);
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    files.push({
      path: `debug/db-traces-${runId}.json`,
      content:
        JSON.stringify(
          { repoId, model: modelConfig.model, traces: debugTraces },
          null,
          2,
        ) + "\n",
    });
  }

  const objects = generatedObjects.map((obj) => ({
    id: obj.id,
    type: obj.type,
    path: getObjectPath(obj.type, obj.id),
    sliceIds: Array.isArray(obj.frontmatter.slice_ids)
      ? (obj.frontmatter.slice_ids as string[])
      : [],
  }));

  return {
    stage: "db",
    files,
    objects,
    report: buildDbStageReport({
      succeeded: generatedObjects.length,
      failed: failures.length,
      targetTable: target?.value,
    }),
    warnings: [
      ...warnings,
      ...failures.map((f) => `[${f.type}] ${f.id}: ${f.error}`),
    ],
  };
}
