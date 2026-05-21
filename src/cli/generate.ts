import type OpenAI from 'openai';
import { logger, setLogLevel } from '../shared/logger.js';
import { getEnvVar } from '../config/env.js';
import {
  resolveModelConfig,
  createOpenAiClient,
  loadDefaultLlmConfigFile,
  loadLlmConfigFile,
} from '../config/model-config.js';
import { buildManifest } from '../packaging/build-manifest.js';
import { buildCatalog } from '../packaging/build-catalog.js';
import { writePackage } from '../packaging/write-package.js';
import { writeReports, type GenerationReport } from '../packaging/write-reports.js';
import { writeDebugLogs, type SliceDebugTrace } from '../packaging/write-debug-logs.js';
import { renderObjectMarkdown, renderConMarkdown } from '../packaging/render-object.js';
import { DEFAULT_BOOTSTRAP_DIR } from '../config/defaults.js';
import { ensureIndex, hasIndex, discoverSlices, type DiscoveryResult } from '../query/index-service.js';
import { buildSlicePlan, extractSliceSeedsFromDiscoveryOutput } from '../slicing/build-slice-plan.js';
import {
  buildRepoEvidenceBundle,
  buildRouteSliceEvidence,
  buildProcessSliceEvidence,
  buildModuleSliceEvidence,
  buildDatabaseSliceEvidence,
} from '../evidence/bundle-builder.js';
import type { SliceEvidenceBundle } from '../evidence/types.js';
import {
  buildDbTableBundle,
  buildAllDbTableBundles,
  type DbTableEvidenceBundle,
} from '../evidence/db-bundle-builder.js';
import { generateWithClient } from '../generation/llm-client.js';
import type { GeneratorOutput } from '../generation/parse-output.js';
import { parseGeneratorOutput } from '../generation/parse-output.js';
import { withRetry } from '../generation/retry.js';
import { buildDbPrompt } from '../generation/object-generators/db-generator.js';
import { buildConPrompt } from '../generation/object-generators/contract-generator.js';
import { buildTermPrompt } from '../generation/object-generators/term-generator.js';
import { buildFlowPrompt } from '../generation/object-generators/flow-generator.js';
import { buildModPrompt } from '../generation/object-generators/mod-generator.js';
import { buildOpenPrompt } from '../generation/object-generators/open-generator.js';
import { buildOwnPrompt } from '../generation/object-generators/own-generator.js';
import { buildVerPrompt } from '../generation/object-generators/ver-generator.js';
import { dbObjectSchema } from '../schemas/db.js';
import { conObjectSchema } from '../schemas/contract.js';
import { termObjectSchema } from '../schemas/term.js';
import { flowObjectSchema } from '../schemas/flow.js';
import { modObjectSchema } from '../schemas/mod.js';
import { openObjectSchema } from '../schemas/open.js';
import { ownObjectSchema } from '../schemas/own.js';
import { verObjectSchema } from '../schemas/ver.js';
import { generateObjectId } from '../shared/ids.js';
import { getRepoBasename, getRepoId } from '../shared/path-utils.js';
import YAML from 'yaml';
import type { SliceKind, SliceSeed } from '../slicing/types.js';

interface GenerateOptions {
  repo: string;
  slice?: string;
  llmConfig?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  forceAnalyze?: boolean;
  verbose?: boolean;
}

// Orchestration dependencies - 用于测试时注入 fake
export interface OrchestrationDeps {
  repoPath: string;
  bootstrapDir: string;
  modelConfig: { baseUrl: string; apiKey: string; model: string };
  gitnexus: {
    ensureIndex: (repoPath: string) => Promise<void>;
    query: (command: string) => Promise<string>;
  };
  llm: {
    generate: (system: string, user: string) => Promise<string>;
  };
  now: () => string;
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  if (options.verbose) {
    setLogLevel('debug');
  }

  const repoPath = options.repo;
  const bootstrapDir = DEFAULT_BOOTSTRAP_DIR;
  const fileConfig = options.llmConfig
    ? await loadLlmConfigFile(options.llmConfig)
    : await loadDefaultLlmConfigFile();

  const resolvedConfig = resolveModelConfig({
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv,
    model: options.model,
    fileConfig,
  });
  const apiKey = resolvedConfig.apiKey || getEnvVar(resolvedConfig.apiKeyEnv);
  const modelConfig = {
    ...resolvedConfig,
    apiKey,
  };
  const mockMode = isMockModel(modelConfig.model);
  const sliceFilter = parseSliceFilter(options.slice);
  const repoId = getRepoId(repoPath);
  const runId = buildRunId();

  logger.info(`Generating bootstrap-knowledge for ${repoPath}`);

  // 1. Ensure index (only if needed for route/process discovery)
  // For database-only slices, we can skip the embedded engine entirely
  const isDatabaseOnly = sliceFilter?.kind === 'database' && sliceFilter.target.length > 0;

  if (!mockMode && !isDatabaseOnly) {
    await ensureIndex(repoPath, { force: options.forceAnalyze });
  }

  // 2. Discover database-first slices from real MyBatis evidence.
  const dbBundles = await buildDbBundlesForGeneration(repoPath, sliceFilter);
  const dbBundleMap = new Map(dbBundles.map((bundle) => [bundle.table.toLowerCase(), bundle]));

  let sliceSeeds = {
    routes: [] as string[],
    processes: [] as string[],
    tools: [] as string[],
    communities: [] as string[],
    tables: dbBundles.map((bundle) => bundle.table),
  };

  // Keep backward-compatible route/process discovery as best effort only.
  if (!mockMode && shouldQueryAdditionalSlices(sliceFilter)) {
    try {
      const discovered = await discoverSlices(repoPath);
      sliceSeeds = {
        routes: discovered.routes.map(r => `${r.method} ${r.path}`),
        processes: discovered.processes.map(p => p.name),
        tools: discovered.tools.map(t => t.name),
        communities: discovered.communities.map(c => c.name),
        tables: [...new Set([...sliceSeeds.tables, ...discovered.tables.map(t => t.name)])],
      };
    } catch (error) {
      logger.warn(`Slice discovery failed, continuing with DB slices only: ${String(error)}`);
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

  // 3. Build evidence
  const repoEvidence = buildRepoEvidenceBundle({
    repoPath,
    repoName: getRepoBasename(repoPath),
  });

  // 4. Generate objects
  const client = mockMode ? null : await createOpenAiClient(modelConfig);
  const generatedObjects: Array<{ id: string; type: string; content: string; frontmatter: Record<string, unknown> }> = [];
  const failures: Array<{ id: string; type: string; error: string }> = [];
  const warnings: Array<{ id: string; message: string }> = [];
  const retrievalOrder: string[] = [];
  const debugTraces: SliceDebugTrace[] = [];

  //  简化实现：根据切片类型生成对象
  for (const slice of slicePlan.slices) {
    try {
      // 构建切片特定证据
      const sliceEvidence = buildSliceSpecificEvidence(slice, repoPath, dbBundleMap);
      // 组合仓库上下文和切片特定证据
      const combinedEvidence = {
        repo: repoEvidence,
        slice: sliceEvidence,
        db_bundle: slice.kind === 'database' ? dbBundleMap.get(slice.title.toLowerCase()) ?? null : null,
      };

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
        retrievalOrder.push(generation.objectResult.id);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      failures.push({
        id: generateObjectId('OPEN', slice.id),
        type: 'OPEN',
        error: errorMsg,
      });
      debugTraces.push({
        sliceId: slice.id,
        sliceKind: slice.kind,
        sliceTitle: slice.title,
        objectType: inferObjectType(slice.kind),
        mode: isMockModel(modelConfig.model) ? 'mock' : 'llm',
        status: 'error',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        request: {
          systemPrompt: '',
          userPrompt: '',
        },
        response: {},
        error: errorMsg,
      });
      logger.warn(`Failed to generate object for slice ${slice.id}: ${errorMsg}`);
    }
  }

  // 5. Build manifest and catalog
  const generatedAt = new Date().toISOString();
  const manifest = buildManifest({
    repoId: getRepoBasename(repoPath),
    repoRoot: repoPath,
    generatedAt,
    gitnexusVersion: '1.0.0',
  });

  const catalog = buildCatalog({
    retrievalOrder,
    objects: generatedObjects.map((obj) => ({
      id: obj.id,
      type: obj.type,
      path: getObjectPath(obj.type, obj.id),
      slice_ids: Array.isArray(obj.frontmatter.slice_ids) ? (obj.frontmatter.slice_ids as string[]) : [],
    })),
  });

  // 6. Write package
  await writePackage({
    repoPath,
    bootstrapDir,
    manifest,
    catalog,
    objects: generatedObjects.map((obj) => ({
      id: obj.id,
      type: obj.type,
      content: obj.content,
    })),
  });

  // 7. Write reports
  const report: GenerationReport = {
    totalObjects: slicePlan.slices.length,
    succeeded: generatedObjects.length,
    failed: failures.length,
    failures,
    warnings,
  };

  await writeReports({
    repoPath,
    bootstrapDir,
    report,
  });

  await writeDebugLogs({
    repoId,
    repoPath,
    runId,
    model: modelConfig.model,
    traces: debugTraces,
  });

  logger.info(`Bootstrap-knowledge generated at ${repoPath}/${bootstrapDir}`);
  logger.info(`Objects: ${generatedObjects.length} succeeded, ${failures.length} failed`);
}

async function generateObjectForSlice(
  slice: { id: string; kind: string; title: string },
  evidence: unknown,
  client: OpenAI | null,
  model: string,
  repoPath: string,
): Promise<{
  objectResult: { id: string; type: string; content: string; frontmatter: Record<string, unknown> } | null;
  trace: SliceDebugTrace;
}> {
  // 根据切片类型选择 generator
  const promptBuilder = getPromptBuilderForSliceKind(slice.kind);
  if (!promptBuilder) {
    logger.warn(`No generator for slice kind ${slice.kind}`);
    const now = new Date().toISOString();
    return {
      objectResult: null,
      trace: {
        sliceId: slice.id,
        sliceKind: slice.kind,
        sliceTitle: slice.title,
        objectType: 'OPEN',
        mode: isMockModel(model) ? 'mock' : 'llm',
        status: 'error',
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        request: {
          systemPrompt: '',
          userPrompt: '',
        },
        response: {},
        error: `No generator for slice kind ${slice.kind}`,
      },
    };
  }

  const { system, user } = promptBuilder({
    slice,
    evidence,
    repoPath,
  });
  const objectType = inferObjectType(slice.kind);
  const startedAt = new Date();
  let rawText: string | undefined;
  let parsedOutput: GeneratorOutput | undefined;

  const output = isMockModel(model)
    ? buildMockGeneratorOutput(slice, evidence, objectType)
    : await withRetry(
        async () => {
          if (!client) {
            throw new Error('OpenAI client is not available');
          }
          rawText = await generateWithClient(client, model, system, user);
          parsedOutput = parseGeneratorOutput(rawText);
          return parsedOutput;
        },
        { maxRetries: 3, delayMs: 1000 },
      );
  if (isMockModel(model)) {
    parsedOutput = output;
    rawText = JSON.stringify(output);
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
        mode: isMockModel(model) ? 'mock' : 'llm',
        status: 'empty',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAtForOutput.toISOString(),
        durationMs: finishedAtForOutput.getTime() - startedAt.getTime(),
        request: {
          systemPrompt: system,
          userPrompt: user,
        },
        response: {
          rawText,
          parsedOutput,
          warnings: output.warnings,
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
    status: 'fact',
    maturity: 'bootstrap',
    scope: slice.id,
    repo: getRepoBasename(repoPath),
    slice_ids: [slice.id],
    evidence_primary: [slice.id],
    evidence_secondary: [],
    stale_if: [],
    generated_by: 'repo-knowledge-generator',
    generated_at: generatedAt,
  };
  const candidateObject = {
    ...(typeof draft === 'object' && draft !== null ? draft : {}),
    ...frontmatter,
    id: objectId,
    type: objectType,
  };

  // 验证 schema
  const validated = validateObject(candidateObject, objectType);
  if (!validated) {
    logger.warn(`Invalid object for slice ${slice.id}`);
    const finishedAt = new Date();
    return {
      objectResult: null,
      trace: {
        sliceId: slice.id,
        sliceKind: slice.kind,
        sliceTitle: slice.title,
        objectType,
        mode: isMockModel(model) ? 'mock' : 'llm',
        status: 'validation_failed',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        request: {
          systemPrompt: system,
          userPrompt: user,
        },
        response: {
          rawText,
          parsedOutput,
          warnings: output.warnings,
        },
        validation: {
          passed: false,
          error: 'Schema validation failed',
        },
      },
    };
  }

  // 渲染 markdown
  let content: string;
  if (objectType === 'CON' && validated) {
    content = renderConMarkdown(validated as ReturnType<typeof conObjectSchema.parse>);
  } else {
    content = renderObjectMarkdown({
      frontmatter,
      body: YAML.stringify(stripCommonFields(validated as Record<string, unknown>)),
    });
  }

  const finishedAt = new Date();
  return {
    objectResult: { id: objectId, type: objectType, content, frontmatter },
    trace: {
      sliceId: slice.id,
      sliceKind: slice.kind,
      sliceTitle: slice.title,
      objectType,
      mode: isMockModel(model) ? 'mock' : 'llm',
      status: 'success',
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      request: {
        systemPrompt: system,
        userPrompt: user,
      },
      response: {
        rawText,
        parsedOutput,
        warnings: output.warnings,
      },
      validation: {
        passed: true,
      },
    },
  };
}

function getPromptBuilderForSliceKind(kind: string): ((input: unknown) => { system: string; user: string }) | null {
  // Special handling for database - it expects structured input
  if (kind === 'database') {
    return (input: unknown) => buildDbPrompt(input as Parameters<typeof buildDbPrompt>[0]);
  }

  const builders: Record<string, (input: unknown) => { system: string; user: string }> = {
    route: buildConPrompt,
    process: buildFlowPrompt,
    tool: buildModPrompt,
    community: buildTermPrompt,
  };
  return builders[kind] ?? null;
}

function inferObjectType(sliceKind: string): 'CON' | 'FLOW' | 'MOD' | 'TERM' | 'DB' | 'OWN' | 'VER' | 'OPEN' {
  const mapping: Record<string, 'CON' | 'FLOW' | 'MOD' | 'TERM' | 'DB'> = {
    route: 'CON',
    process: 'FLOW',
    tool: 'MOD',
    community: 'TERM',
    database: 'DB',
  };
  return mapping[sliceKind] ?? 'OPEN';
}

/**
 * Build slice-specific evidence based on slice kind.
 * This replaces the previous approach of using a shared repository bundle for all slices.
 */
function buildSliceSpecificEvidence(
  slice: { id: string; kind: string; title: string },
  repoPath: string,
  dbBundleMap: Map<string, DbTableEvidenceBundle>,
): SliceEvidenceBundle {
  switch (slice.kind) {
    case 'route':
      // 解析路由 ID 获取 method 和 path
      const routeParts = slice.id.replace('route:', '').split(':');
      const method = routeParts[0] ?? 'GET';
      const path = routeParts[1] ?? slice.title;
      return buildRouteSliceEvidence({
        route: slice.title,
        handlerFile: `${repoPath}/src/routes/${path.replace(/\//g, '_')}.ts`,
        method,
        path,
        middleware: [],
        responseShape: [],
        errorShape: [],
        tests: [],
      });

    case 'process':
      return buildProcessSliceEvidence({
        processName: slice.title,
        entryFile: `${repoPath}/src/processes/${slice.title.toLowerCase()}.ts`,
        steps: [
          { order: 1, action: 'start', actor: 'system', file: `${repoPath}/src/processes/${slice.title.toLowerCase()}.ts` },
        ],
        outcomes: [],
        errorHandling: [],
      });

    case 'tool':
      return buildModuleSliceEvidence({
        moduleName: slice.title,
        filePath: `${repoPath}/src/tools/${slice.title.toLowerCase()}.ts`,
        exports: [{ name: slice.title, kind: 'function' }],
        imports: [],
        dependsOn: [],
        usedBy: [],
      });

    case 'database':
      const dbBundle = dbBundleMap.get(slice.title.toLowerCase());
      if (dbBundle) {
        return buildDatabaseSliceEvidence({
          tableName: dbBundle.table,
          schemaName: 'public',
          sourceFile: dbBundle.mapperBindings[0]?.mapperFile ?? repoPath,
          sourceKind: 'orm',
          fields:
            dbBundle.fieldCandidates.length > 0
              ? dbBundle.fieldCandidates.map((field) => ({
                  name: field.name,
                  type: field.type ?? 'unknown',
                  description: field.name,
                  source: field.source === 'inferred' ? 'inferred' : 'comment',
                }))
              : [
                  {
                    name: 'id',
                    type: 'unknown',
                    description: 'id',
                    source: 'inferred',
                  },
                ],
          primaryKey: [],
          foreignKeys: [],
          readBy: dbBundle.mapperBindings
            .filter((binding) => binding.statementType === 'select')
            .map((binding) => `${binding.namespace}.${binding.methodId}`),
          writeBy: dbBundle.mapperBindings
            .filter((binding) => binding.statementType !== 'select')
            .map((binding) => `${binding.namespace}.${binding.methodId}`),
        });
      }

      return buildDatabaseSliceEvidence({
        tableName: slice.title,
        schemaName: 'public',
        sourceFile: `${repoPath}/src/db/schema/${slice.title}.ts`,
        sourceKind: 'orm',
        fields: [],
        primaryKey: [],
        foreignKeys: [],
        readBy: [],
        writeBy: [],
      });

    case 'community':
      // Community slices (TERM) 使用简化的证据
      return {
        slice: {
          id: slice.id,
          kind: 'community',
          title: slice.title,
          scope: slice.title,
          seed: slice.title,
        },
        facts: [
          {
            id: 'F-TERM-001',
            claim: `术语 ${slice.title} 在仓库中被使用`,
            source_kind: 'gitnexus',
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
            id: 'G-TERM-001',
            kind: 'missing-definition',
            question: `术语 ${slice.title} 的具体定义是什么？`,
            reason: '未从代码中提取到术语定义',
          },
        ],
      };

    default:
      // 未知的 slice kind 返回带有 gap 的空证据
      return {
        slice: {
          id: slice.id,
          kind: 'route',
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
            kind: 'unknown-slice-kind',
            question: `如何处理 ${slice.kind} 类型的切片？`,
            reason: `未知的切片类型: ${slice.kind}`,
          },
        ],
      };
  }
}

function validateObject(draft: unknown, objectType: string): unknown | null {
  try {
    switch (objectType) {
      case 'DB':
        return dbObjectSchema.parse(draft);
      case 'CON':
        return conObjectSchema.parse(draft);
      case 'TERM':
        return termObjectSchema.parse(draft);
      case 'FLOW':
        return flowObjectSchema.parse(draft);
      case 'MOD':
        return modObjectSchema.parse(draft);
      case 'OPEN':
        return openObjectSchema.parse(draft);
      case 'OWN':
        return ownObjectSchema.parse(draft);
      case 'VER':
        return verObjectSchema.parse(draft);
      default:
        logger.warn(`Unknown object type for validation: ${objectType}`);
        return null;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`Schema validation failed for type ${objectType}: ${errorMsg}`);
    return null;
  }
}

function getObjectPath(type: string, id: string): string {
  const typeDirs: Record<string, string> = {
    TERM: 'terms',
    CON: 'contracts',
    FLOW: 'flows',
    MOD: 'modules',
    OPEN: 'open',
    OWN: 'ownership',
    VER: 'validation',
    DB: 'db',
  };
  return `objects/${typeDirs[type] ?? 'unknown'}/${id}.md`;
}

function isMockModel(model: string): boolean {
  return model.startsWith('test-');
}

interface SliceFilter {
  kind?: SliceKind;
  raw: string;
  target: string;
}

function parseSliceFilter(value?: string): SliceFilter | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }

  const [prefix, rest] = normalized.split(':', 2);
  const knownKinds: SliceKind[] = ['route', 'process', 'tool', 'community', 'database'];
  if (knownKinds.includes(prefix as SliceKind) && rest) {
    return {
      kind: prefix as SliceKind,
      raw: normalized,
      target: rest.trim().toLowerCase(),
    };
  }

  return {
    raw: normalized,
    target: normalized.toLowerCase(),
  };
}

function shouldQueryAdditionalSlices(filter: SliceFilter | null): boolean {
  return !filter || filter.kind !== 'database';
}

async function buildDbBundlesForGeneration(repoPath: string, filter: SliceFilter | null): Promise<DbTableEvidenceBundle[]> {
  if (filter?.kind === 'database' && filter.target.length > 0) {
    return [await buildDbTableBundle(repoPath, filter.target)];
  }
  return buildAllDbTableBundles(repoPath);
}

function applySliceFilter(slices: SliceSeed[], filter: SliceFilter | null): SliceSeed[] {
  if (!filter) {
    return slices;
  }

  return slices.filter((slice) => {
    if (filter.kind && slice.kind !== filter.kind) {
      return false;
    }

    const idValue = slice.id.toLowerCase();
    const titleValue = slice.title.toLowerCase();
    const sourceValue = slice.source?.toLowerCase();

    if (filter.kind) {
      return titleValue === filter.target || sourceValue === filter.target || idValue === filter.raw.toLowerCase();
    }

    return idValue === filter.target || titleValue === filter.target || sourceValue === filter.target;
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

function stripCommonFields(object: Record<string, unknown>): Record<string, unknown> {
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

function buildMockGeneratorOutput(
  slice: { id: string; kind: string; title: string },
  evidence: unknown,
  objectType: 'CON' | 'FLOW' | 'MOD' | 'TERM' | 'DB' | 'OWN' | 'VER' | 'OPEN',
): GeneratorOutput {
  const payload = (evidence ?? {}) as {
    slice?: SliceEvidenceBundle;
    db_bundle?: DbTableEvidenceBundle | null;
  };

  const baseWarnings = [{ message: 'mock-model-output' }];

  switch (objectType) {
    case 'DB': {
      const dbBundle = payload.db_bundle;
      const fields =
        dbBundle && dbBundle.fieldCandidates.length > 0
          ? dbBundle.fieldCandidates.map((field) => ({
              name: field.name,
              type: field.type ?? 'unknown',
              nullable: true,
              default: null,
              description_zh: field.javaFieldComment || field.mappedJavaProperty || field.name,
              description_source: field.javaFieldComment ? 'comment' : 'inferred',
              constraints: [],
            }))
          : [
              {
                name: 'id',
                type: 'unknown',
                nullable: true,
                default: null,
                description_zh: '主键',
                description_source: 'inferred',
                constraints: [],
              },
            ];

      return {
        objects: [
          {
            table_name: dbBundle?.table ?? slice.title,
            table_name_zh: `${dbBundle?.table ?? slice.title}表`,
            schema_name: 'public',
            source_kind: 'mapper',
            primary_key: [],
            indexes: [],
            foreign_keys: [],
            read_by_direct:
              dbBundle?.directStatements
                .filter((s) => s.statementType === 'select')
                .map((s) => s.id) ?? [],
            read_by_joined:
              dbBundle?.joinedStatements
                .filter((s) => s.statementType === 'select')
                .map((s) => s.id) ?? [],
            write_by_direct:
              dbBundle?.directStatements
                .filter((s) => s.statementType !== 'select')
                .map((s) => s.id) ?? [],
            write_by_joined:
              dbBundle?.joinedStatements
                .filter((s) => s.statementType !== 'select')
                .map((s) => s.id) ?? [],
            fields,
            gaps: [],
          },
        ],
        warnings: baseWarnings,
      };
    }
    case 'CON':
      return {
        objects: [
          {
            interface_kind: 'route',
            interface_name: slice.title,
            interface_name_zh: `${slice.title}接口`,
            producer: slice.title,
            producer_zh: '路由处理器',
            consumers: [],
            input_shape: [],
            input_description_zh: '当前未提取到输入字段',
            output_shape: [],
            output_description_zh: '当前未提取到输出字段',
            middleware: [],
            related_routes: [slice.title],
            related_tools: [],
            entry_file: payload.slice?.facts[0]?.refs[0]?.file ?? slice.title,
          },
        ],
        warnings: baseWarnings,
      };
    case 'FLOW':
      return {
        objects: [
          {
            flow_name: slice.title,
            flow_name_zh: `${slice.title}流程`,
            trigger: slice.id,
            trigger_zh: '触发该流程的入口',
            steps: [
              {
                order: 1,
                action: 'start',
                action_zh: '开始处理',
                actor: 'system',
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
    case 'MOD':
      return {
        objects: [
          {
            module_name: slice.title,
            module_name_zh: `${slice.title}模块`,
            responsibility_zh: '承载当前切片相关逻辑',
            module_kind: 'utility',
            exports: [],
            imports: [],
            depends_on: [],
            used_by: [],
          },
        ],
        warnings: baseWarnings,
      };
    case 'TERM':
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
    case 'OPEN':
      return {
        objects: [
          {
            question: `${slice.title} 仍有待确认信息`,
            question_zh: `${slice.title} 仍有待确认信息`,
            context_zh: 'mock 模式下未连接真实模型，保留开放问题',
            impact: 'medium',
          },
        ],
        warnings: baseWarnings,
      };
    case 'OWN':
      return {
        objects: [
          {
            owner_type: 'shared',
            owner_name: slice.title,
            owner_name_zh: slice.title,
            responsibility_zh: '当前切片的默认责任边界',
            scope_items: [slice.id],
          },
        ],
        warnings: baseWarnings,
      };
    case 'VER':
      return {
        objects: [
          {
            version_name: slice.title,
            version_name_zh: slice.title,
            version_value: 'bootstrap',
            version_kind: 'tool',
            changelog_zh: 'mock 模式下生成的占位版本信息',
            breaking_changes: [],
          },
        ],
        warnings: baseWarnings,
      };
  }
}

function buildRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
