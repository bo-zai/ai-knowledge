import type OpenAI from 'openai';
import { logger, setLogLevel } from '../shared/logger.js';
import { getEnvVar } from '../config/env.js';
import { resolveModelConfig, createOpenAiClient } from '../config/model-config.js';
import { buildManifest } from '../packaging/build-manifest.js';
import { buildCatalog } from '../packaging/build-catalog.js';
import { writePackage } from '../packaging/write-package.js';
import { writeReports, type GenerationReport } from '../packaging/write-reports.js';
import { renderObjectMarkdown, renderConMarkdown } from '../packaging/render-object.js';
import { DEFAULT_BOOTSTRAP_DIR } from '../config/defaults.js';
import { ensureGitNexusIndex, checkGitNexusIndex } from '../gitnexus/ensure-index.js';
import { runGitNexus } from '../gitnexus/commands.js';
import { buildSlicePlan, extractSliceSeedsFromGitNexus } from '../slicing/build-slice-plan.js';
import {
  buildRepoEvidenceBundle,
  buildRouteSliceEvidence,
  buildProcessSliceEvidence,
  buildModuleSliceEvidence,
  buildDatabaseSliceEvidence,
} from '../evidence/bundle-builder.js';
import type { SliceEvidenceBundle } from '../evidence/types.js';
import { generateWithClient } from '../generation/llm-client.js';
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
import { getRepoBasename } from '../shared/path-utils.js';
import YAML from 'yaml';

interface GenerateOptions {
  repo: string;
  slice?: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
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
  const apiKey = getEnvVar(options.apiKeyEnv);

  const modelConfig = resolveModelConfig({
    baseUrl: options.baseUrl,
    apiKey,
    model: options.model,
  });

  logger.info(`Generating bootstrap-knowledge for ${repoPath}`);

  // 1. Ensure GitNexus index
  const execGitNexus = runGitNexus;
  const hasIndex = async (path: string) => checkGitNexusIndex(path, execGitNexus);

  if (!options.forceAnalyze) {
    await ensureGitNexusIndex({
      repoPath,
      execGitNexus,
      hasIndex,
    });
  } else {
    await execGitNexus(['analyze', repoPath], repoPath);
  }

  // 2. Discover slices
  const gitnexusResult = await execGitNexus(['list', repoPath], repoPath);
  const sliceSeeds = extractSliceSeedsFromGitNexus(gitnexusResult.stdout);
  const slicePlan = buildSlicePlan(sliceSeeds);

  logger.info(`Discovered ${slicePlan.total_count} slices`);

  // 3. Build evidence
  const repoEvidence = buildRepoEvidenceBundle({
    repoPath,
    repoName: getRepoBasename(repoPath),
  });

  // 4. Generate objects
  const client = await createOpenAiClient(modelConfig);
  const generatedObjects: Array<{ id: string; type: string; content: string; frontmatter: Record<string, unknown> }> = [];
  const failures: Array<{ id: string; type: string; error: string }> = [];
  const warnings: Array<{ id: string; message: string }> = [];
  const retrievalOrder: string[] = [];

  //  简化实现：根据切片类型生成对象
  for (const slice of slicePlan.slices) {
    try {
      // 构建切片特定证据
      const sliceEvidence = buildSliceSpecificEvidence(slice, repoPath);
      // 组合仓库上下文和切片特定证据
      const combinedEvidence = {
        repo: repoEvidence,
        slice: sliceEvidence,
      };

      const objectResult = await generateObjectForSlice(slice, combinedEvidence, client, modelConfig.model, repoPath);
      if (objectResult) {
        generatedObjects.push(objectResult);
        retrievalOrder.push(objectResult.id);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      failures.push({
        id: generateObjectId('OPEN', slice.id),
        type: 'OPEN',
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
      slice_ids: [obj.id],
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

  logger.info(`Bootstrap-knowledge generated at ${repoPath}/${bootstrapDir}`);
  logger.info(`Objects: ${generatedObjects.length} succeeded, ${failures.length} failed`);
}

async function generateObjectForSlice(
  slice: { id: string; kind: string; title: string },
  evidence: unknown,
  client: OpenAI,
  model: string,
  repoPath: string,
): Promise<{ id: string; type: string; content: string; frontmatter: Record<string, unknown> } | null> {
  // 根据切片类型选择 generator
  const promptBuilder = getPromptBuilderForSliceKind(slice.kind);
  if (!promptBuilder) {
    logger.warn(`No generator for slice kind ${slice.kind}`);
    return null;
  }

  const { system, user } = promptBuilder({
    slice,
    evidence,
    repoPath,
  });

  const output = await withRetry(
    async () => {
      const raw = await generateWithClient(client, model, system, user);
      return parseGeneratorOutput(raw);
    },
    { maxRetries: 3, delayMs: 1000 },
  );

  if (output.objects.length === 0) {
    return null;
  }

  const draft = output.objects[0];
  const objectType = inferObjectType(slice.kind);

  // 验证 schema
  const validated = validateObject(draft, objectType);
  if (!validated) {
    logger.warn(`Invalid object for slice ${slice.id}`);
    return null;
  }

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
    generated_at: new Date().toISOString(),
  };

  // 渲染 markdown
  let content: string;
  if (objectType === 'CON' && validated) {
    content = renderConMarkdown(validated as ReturnType<typeof conObjectSchema.parse>);
  } else {
    content = renderObjectMarkdown({
      frontmatter,
      body: YAML.stringify(draft),
    });
  }

  return { id: objectId, type: objectType, content, frontmatter };
}

function getPromptBuilderForSliceKind(kind: string): ((input: unknown) => { system: string; user: string }) | null {
  const builders: Record<string, (input: unknown) => { system: string; user: string }> = {
    route: buildConPrompt,
    process: buildFlowPrompt,
    tool: buildModPrompt,
    community: buildTermPrompt,
    database: buildDbPrompt,
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