import { buildCapabilityInventory } from "../slicing/capability-inventory.js";
import {
  runCapabilityKnowledgePipeline,
  type CapabilityClaimsProviderResult,
} from "./capability-knowledge-pipeline.js";
import { buildCapabilityKnowledgeFiles } from "../packaging/capability-knowledge-writer.js";
import type { CapabilityDocBehavior } from "./capability-doc-model.js";
import type { EvidenceBundle } from "../evidence/evidence-bundle-schema.js";
import type {
  KnowledgePackageFile,
  KnowledgePackageObjectRef,
} from "../packaging/knowledge-package-contribution.js";
import { TYPE_TO_DIR } from "./type-directory-map.js";
import {
  appendCapabilityFlowNavigationSection,
  buildCapabilityFlowBehaviors,
  buildCapabilityFlowNavigationFiles,
  toKnowledgePackageFiles,
} from "../knowledge-evidence/capability-flow/index.js";

export interface CapabilityBatchItemReport {
  id: string;
  name: string;
  status: "succeeded" | "failed";
  capabilityId?: string;
  primaryDoc?: string;
  compatibilityView?: string;
  objectCount?: number;
  error?: string;
}

export interface CapabilityBatchPipelineResult {
  files: KnowledgePackageFile[];
  objects: KnowledgePackageObjectRef[];
  report: {
    mode: "capability-batch";
    succeeded: number;
    failed: number;
    capabilities: CapabilityBatchItemReport[];
  };
  warnings: string[];
}

export interface CapabilityInventoryPromptResult {
  rawText: string;
  model: string;
}

function rewriteCapabilityFilePath(
  path: string,
  inventoryId: string,
): string | undefined {
  if (path === "catalog.yaml") return undefined;
  if (path === "reports/generation.json") return undefined;
  if (path.startsWith("capabilities/") && path.endsWith(".md")) {
    return `capabilities/${inventoryId}.md`;
  }
  if (path.startsWith("views/capabilities/") && path.endsWith(".md")) {
    return `views/capabilities/${inventoryId}.md`;
  }
  if (path === "reports/capability-generation.json") {
    return `reports/capabilities/${inventoryId}.json`;
  }
  if (path.startsWith("debug/")) {
    return `debug/capabilities/${inventoryId}/${path.replace(/^debug\//, "")}`;
  }
  return path;
}

export async function runCapabilityBatchPipeline(input: {
  repoRoot: string;
  claimsProvider: (
    bundle: EvidenceBundle,
  ) => Promise<CapabilityClaimsProviderResult>;
  inventoryPromptProvider?: (
    systemPrompt: string,
    userPrompt: string,
  ) => Promise<CapabilityInventoryPromptResult>;
  onItemSucceeded?: (item: {
    inventoryId: string;
    inventoryName: string;
    domainKey?: string;
    domainName?: string;
    files: KnowledgePackageFile[];
    result: Awaited<ReturnType<typeof runCapabilityKnowledgePipeline>>;
  }) => Promise<void>;
  model?: string;
}): Promise<CapabilityBatchPipelineResult> {
  console.log("[DEBUG] runCapabilityBatchPipeline: starting");
  // 先做静态聚类，再按需交给 LLM 做业务域归并与核心/辅助动作判定。
  const inventory = await buildCapabilityInventory(
    input.repoRoot,
    input.inventoryPromptProvider,
  );
  console.log(
    `[DEBUG] runCapabilityBatchPipeline: inventory built, ${inventory.length} items`,
  );

  if (inventory.length === 0) {
    throw new Error(
      "No business capabilities discovered in project. Use --target or --terms to specify capability focus.",
    );
  }
  const files: KnowledgePackageFile[] = [];
  const objects: KnowledgePackageObjectRef[] = [];
  const capabilities: CapabilityBatchItemReport[] = [];
  const warnings: string[] = [];

  for (const item of inventory) {
    console.log(`[DEBUG] runCapabilityBatchPipeline: processing ${item.name}`);
    try {
      console.log(
        `[DEBUG] runCapabilityBatchPipeline: calling runCapabilityKnowledgePipeline for ${item.name}`,
      );
      const result = await runCapabilityKnowledgePipeline({
        repoRoot: input.repoRoot,
        targetTerms: item.targetTerms,
        targetPaths: item.targetPaths,
        domainKey: item.domainKey ?? item.id,
        domainName: item.domainName ?? item.name,
        modulePaths: item.targetPaths,
        evidenceBundle: item.evidenceBundle,
        claimsProvider: input.claimsProvider,
        llmMode: { requested: true, required: true, model: input.model },
        shouldWriteLlmFlowFunctionFiles: false,
      });
      console.log(
        `[DEBUG] runCapabilityBatchPipeline: runCapabilityKnowledgePipeline completed for ${item.name}`,
      );

      const sourcePrimaryDoc = result.files.find(
        (file) =>
          file.path.startsWith("capabilities/") && file.path.endsWith(".md"),
      )?.path;
      const sourceCompatibilityView = result.files.find(
        (file) =>
          file.path.startsWith("views/capabilities/") &&
          file.path.endsWith(".md"),
      )?.path;
      const primaryDoc = sourcePrimaryDoc
        ? rewriteCapabilityFilePath(sourcePrimaryDoc, item.id)
        : undefined;
      const compatibilityView = sourceCompatibilityView
        ? rewriteCapabilityFilePath(sourceCompatibilityView, item.id)
        : undefined;
      const capabilityTitle =
        extractCapabilityTitle(result.files) ?? result.metadata.capabilityId;
      const flowFiles = item.evidenceBundle
        ? buildCapabilityFlowNavigationFiles({
            capabilityId: result.metadata.capabilityId,
            capabilityTitle,
            domainKey: item.domainKey,
            domainName: item.domainName,
            flows: item.flowCandidates ?? [],
            evidenceBundle: item.evidenceBundle,
            evidenceIndex: result.evidenceIndex,
          })
        : [];
      const behaviorOverrides = buildCapabilityFlowBehaviors({
        flows: item.flowCandidates ?? [],
        flowFiles,
        evidenceIndex: result.evidenceIndex,
      });
      const rewrittenCapabilityContent = buildRewrittenCapabilityContent({
        result,
        behaviorOverrides,
      });
      const itemFiles: KnowledgePackageFile[] = [];

      for (const file of result.files) {
        const rewritten = rewriteCapabilityFilePath(file.path, item.id);
        if (!rewritten) continue;
        itemFiles.push({
          path: rewritten,
          content: appendFlowLinksIfCapabilityFile({
            path: rewritten,
            content: rewrittenCapabilityContent.get(file.path) ?? file.content,
            flowFiles,
          }),
        });
      }
      itemFiles.push(...toKnowledgePackageFiles(flowFiles));
      files.push(...itemFiles);

      if (input.onItemSucceeded) {
        await input.onItemSucceeded({
          inventoryId: item.id,
          inventoryName: item.name,
          domainKey: item.domainKey,
          domainName: item.domainName,
          files: itemFiles,
          result,
        });
      }

      objects.push(
        ...result.objects.map((obj) => ({
          id: obj.id,
          type: obj.type,
          path: `objects/${TYPE_TO_DIR[obj.type] || "unknown"}/${obj.id}.yaml`,
        })),
      );

      capabilities.push({
        id: item.id,
        name: item.name,
        status: "succeeded",
        capabilityId: result.metadata.capabilityId,
        primaryDoc,
        compatibilityView,
        objectCount: result.objects.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${item.id}: ${message}`);
      capabilities.push({
        id: item.id,
        name: item.name,
        status: "failed",
        error: message,
      });
    }
  }

  const succeeded = capabilities.filter((c) => c.status === "succeeded").length;
  const failed = capabilities.filter((c) => c.status === "failed").length;

  if (succeeded === 0) {
    throw new Error(
      `Capability batch generation failed for all ${inventory.length} capabilities`,
    );
  }

  const report = {
    mode: "capability-batch" as const,
    succeeded,
    failed,
    capabilities,
  };

  files.push({
    path: "reports/capability-inventory.json",
    content: JSON.stringify({ inventory, report }, null, 2) + "\n",
  });

  return { files, objects, report, warnings };
}

function buildRewrittenCapabilityContent(input: {
  result: Awaited<ReturnType<typeof runCapabilityKnowledgePipeline>>;
  behaviorOverrides: CapabilityDocBehavior[];
}): Map<string, string> {
  const files = buildCapabilityKnowledgeFiles({
    objects: input.result.objects,
    capabilityId: input.result.metadata.capabilityId,
    evidenceIndex: input.result.evidenceIndex,
    report: input.result.report,
    debug: input.result.debug,
    options: {
      shouldWriteFlowFunctionFiles: false,
      behaviorOverrides: input.behaviorOverrides,
      shouldExcludeFlowTraceEvidence: true,
    },
  });
  return new Map(
    files
      .filter(
        (file) =>
          (file.path.startsWith("capabilities/") ||
            file.path.startsWith("views/capabilities/")) &&
          file.path.endsWith(".md"),
      )
      .map((file) => [file.path, file.content]),
  );
}

function extractCapabilityTitle(
  files: Array<{ path: string; content: string }>,
): string | undefined {
  const capabilityFile = files.find(
    (file) =>
      file.path.startsWith("capabilities/") && file.path.endsWith(".md"),
  );
  return capabilityFile?.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function appendFlowLinksIfCapabilityFile(input: {
  path: string;
  content: string;
  flowFiles: ReturnType<typeof buildCapabilityFlowNavigationFiles>;
}): string {
  if (input.flowFiles.length === 0) return input.content;
  if (input.path.startsWith("capabilities/") && input.path.endsWith(".md")) {
    return appendCapabilityFlowNavigationSection({
      markdown: input.content,
      flows: input.flowFiles,
      linkPrefix: "../functions",
    });
  }
  if (
    input.path.startsWith("views/capabilities/") &&
    input.path.endsWith(".md")
  ) {
    return appendCapabilityFlowNavigationSection({
      markdown: input.content,
      flows: input.flowFiles,
      linkPrefix: "../../functions",
    });
  }
  return input.content;
}
