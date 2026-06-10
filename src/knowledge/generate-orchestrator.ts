import { logger } from '../shared/logger.js';
import type { ResolvedGenerateScope, GenerateTarget } from './generate-scope.js';
import { getGenerationOrder } from './generate-scope.js';
import type { KnowledgePackageContribution } from '../packaging/knowledge-package-contribution.js';
import type { GraphStatus } from '../query/prepare-generation.js';
import type { PackageLayout } from './init-directory.js';
import type { KnowledgeType } from '../schemas/knowledge-type.js';
import type { EvidenceGroup } from '../evidence/type-evidence-builder.js';
import { buildEvidenceBundlesByPackage } from '../evidence/type-evidence-builder.js';
import type { ModuleTopology } from '../schemas/module.js';

export interface GenerateOrchestrationInput {
  repoPath: string;
  outputRoot: string;
  scope: ResolvedGenerateScope;
  graphStatus: GraphStatus;
  layout: PackageLayout;
  forceAnalyze?: boolean;
  verbose?: boolean;
  llm: {
    model?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    llmConfig?: string;
  };
  /** 模块拓扑信息（多模块项目） */
  moduleTopology?: ModuleTopology;
}

/**
 * Dependencies for generation orchestration.
 * runGeneratorForType now returns multiple contributions (one per evidence group).
 */
export interface GenerateOrchestrationDeps {
  runGeneratorForType: (input: GenerateTypeInput) => Promise<KnowledgePackageContribution[]>;
  writePackage: (input: {
    layout: PackageLayout;
    knowledge: ResolvedGenerateScope['knowledge'];
    target?: GenerateTarget;
    contributions: KnowledgePackageContribution[];
  }) => Promise<void>;
}

export interface GenerateTypeInput {
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
  /** Pre-built evidence groups to skip database access (for parallel LLM generation) */
  preparedEvidenceGroups?: EvidenceGroup[];
  /** 模块拓扑信息（多模块项目） */
  moduleTopology?: ModuleTopology;
}

/**
 * Orchestrate knowledge generation following design doc phases:
 * - Phase 1 (sequential types): CONCEPT → DATA_MODEL → CAPABILITY
 *   - Each type's evidence groups are processed in parallel
 * - Phase 2 (parallel types): BOUNDARY, EXTERNAL, CONSTRAINT, RELATION, WORKFLOW
 */
export async function runGenerateOrchestration(input: {
  input: GenerateOrchestrationInput;
  deps: GenerateOrchestrationDeps;
}): Promise<{ contributions: KnowledgePackageContribution[] }> {
  const { scope, repoPath, layout, graphStatus, verbose, llm, moduleTopology } = input.input;
  const contributions: KnowledgePackageContribution[] = [];

  const types = scope.types;
  if (types.length === 0) {
    logger.warn('No knowledge types to generate');
    return { contributions };
  }

  // Get generation order (array of type arrays per phase)
  const phases = getGenerationOrder(types);

  // Track generated names for phase dependencies
  const generatedNames: Record<string, string[]> = {
    concept: [],
    dataModel: [],
    capability: [],
  };
  const tagPool: string[] = [];

  logger.info(`Generating ${types.length} knowledge types in ${phases.length} phases`);

  for (const [phaseIndex, phaseTypes] of phases.entries()) {
    logger.info(`Phase ${phaseIndex + 1}: ${phaseTypes.join(', ')}`);

    // Build dependencies from previous phases
    const dependencies = {
      conceptNames: generatedNames.concept,
      dataModelNames: generatedNames.dataModel,
      capabilityNames: generatedNames.capability,
      tagPool,
    };

    if (phaseIndex < 3) {
      // Phase 1: Sequential type execution, but each type's groups are parallel
      for (const type of phaseTypes) {
        try {
          // runGeneratorForType returns multiple contributions (parallel groups)
          const typeContributions = await input.deps.runGeneratorForType({
            repoPath,
            type,
            target: scope.target?.kind === type ? scope.target : undefined,
            layout,
            graphStatus,
            verbose,
            llm,
            dependencies,
            moduleTopology,
          });

          // Merge all contributions from this type
          for (const contribution of typeContributions) {
            contributions.push(contribution);
            updateGeneratedNames(generatedNames, tagPool, contribution);
          }

          // Log summary for this type
          const succeeded = typeContributions.filter(c => c.report.succeeded > 0).length;
          const failed = typeContributions.filter(c => c.report.failed > 0).length;
          logger.info(`${type}: ${succeeded} groups succeeded, ${failed} failed`);

        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(`${type} generation failed: ${msg}`);
          throw error;
        }
      }
    } else {
      // Phase 2: All types can run in parallel for LLM generation,
      // but evidence queries must be sequential to avoid database lock conflicts on Windows.
      // First, sequentially build evidence for all types
      const evidenceResults: Array<{ type: KnowledgeType; groups: EvidenceGroup[] }> = [];

      for (const type of phaseTypes) {
        try {
          // Build evidence bundles - this opens the database
          const evidenceGroups = await buildEvidenceBundlesByPackage({
            repoPath,
            type,
            target: scope.target?.kind === type ? scope.target : undefined,
            graphStatus,
          });
          evidenceResults.push({ type, groups: evidenceGroups });
          logger.info(`${type}: ${evidenceGroups.length} evidence groups prepared`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(`${type} evidence preparation failed: ${msg}`);
          evidenceResults.push({ type, groups: [] });
        }
      }

      // Then, run LLM generation for all types in parallel (no database access needed)
      const typeResults = await Promise.allSettled(
        evidenceResults.map(({ type, groups }) => {
          if (groups.length === 0) {
            // Return failed contribution for empty evidence
            return Promise.resolve([{
              stage: type.toLowerCase(),
              files: [],
              objects: [],
              report: {
                stage: type.toLowerCase(),
                ran: true,
                succeeded: 0,
                failed: 1,
                details: { error: 'no_evidence_found' },
              },
              warnings: ['no_evidence_found'],
            }] as KnowledgePackageContribution[]);
          }

          // Run LLM generation with prepared evidence
          return input.deps.runGeneratorForType({
            repoPath,
            type,
            target: scope.target?.kind === type ? scope.target : undefined,
            layout,
            graphStatus,
            verbose,
            llm,
            dependencies,
            // Pass prepared evidence groups to avoid database access
            preparedEvidenceGroups: groups,
            moduleTopology,
          });
        }),
      );

      for (const [i, result] of typeResults.entries()) {
        const type = phaseTypes[i];
        if (result.status === 'fulfilled') {
          for (const contribution of result.value) {
            contributions.push(contribution);
            updateGeneratedNames(generatedNames, tagPool, contribution);
          }
        } else {
          const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          logger.error(`${type} generation failed: ${msg}`);
          // Add failed contribution
          contributions.push({
            stage: type.toLowerCase(),
            files: [],
            objects: [],
            report: {
              stage: type.toLowerCase(),
              ran: true,
              succeeded: 0,
              failed: 1,
              details: { error: msg },
            },
            warnings: [msg],
          });
        }
      }
    }
  }

  logger.info(`Writing package with ${contributions.length} contributions...`);

  // Write final package
  await input.deps.writePackage({
    layout,
    knowledge: scope.knowledge,
    target: scope.target,
    contributions,
  });

  logger.info('Package written successfully');

  // Print summary
  printSummary(contributions);

  return { contributions };
}

function updateGeneratedNames(
  generatedNames: Record<string, string[]>,
  tagPool: string[],
  contribution: KnowledgePackageContribution,
): void {
  // Extract names from generated objects
  for (const obj of contribution.objects) {
    const name = obj.id;
    if (obj.type === 'CONCEPT' || obj.type === 'TERM') {
      generatedNames.concept.push(name);
    } else if (obj.type === 'DATA_MODEL' || obj.type === 'DB') {
      generatedNames.dataModel.push(name);
    } else if (obj.type === 'CAPABILITY' || obj.type === 'CAP') {
      generatedNames.capability.push(name);
    }
  }

  // Extract tags
  for (const obj of contribution.objects) {
    const tags = (obj as unknown as Record<string, unknown>).tags;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (typeof tag === 'string' && !tagPool.includes(tag)) {
          tagPool.push(tag);
        }
      }
    }
  }
}

function printSummary(contributions: KnowledgePackageContribution[]): void {
  // Group by stage
  const stageSummary = new Map<string, { succeeded: number; failed: number }>();

  for (const c of contributions) {
    const stage = c.stage;
    if (!stageSummary.has(stage)) {
      stageSummary.set(stage, { succeeded: 0, failed: 0 });
    }
    const summary = stageSummary.get(stage)!;
    summary.succeeded += c.report.succeeded;
    summary.failed += c.report.failed;
  }

  for (const [stage, summary] of stageSummary.entries()) {
    logger.info(`${stage} stage: ${summary.succeeded} succeeded, ${summary.failed} failed`);
  }
}