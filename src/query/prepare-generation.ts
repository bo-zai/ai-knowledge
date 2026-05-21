/**
 * Knowledge Generation Preflight Module
 *
 * Provides unified preflight analysis check for all knowledge generation commands.
 * This module ensures that graph data (analysis index) is ready before generation.
 */

import { logger } from '../shared/logger.js';
import { hasIndex, runAnalysis } from './index-service.js';

export type AnalysisState = 'reused' | 'created' | 'rebuilt' | 'skipped_for_mock';

export interface PreflightInput {
  repoPath: string;
  forceAnalyze?: boolean;
  mockMode?: boolean;
}

export interface PreflightResult {
  analysisState: AnalysisState;
  hadIndex: boolean;
}

/**
 * Unified preflight analysis check for knowledge generation.
 *
 * Rules:
 * 1. If mockMode, skip analysis (return skipped_for_mock)
 * 2. If forceAnalyze, rebuild index (return rebuilt)
 * 3. If no index, create new index (return created)
 * 4. If index exists, reuse it (return reused)
 */
export async function prepareKnowledgeGeneration(input: PreflightInput): Promise<PreflightResult> {
  const { repoPath, forceAnalyze = false, mockMode = false } = input;

  logger.info('Checking analysis state...');

  if (mockMode) {
    logger.info('Mock mode: skipping analysis');
    return {
      analysisState: 'skipped_for_mock',
      hadIndex: false,
    };
  }

  const hadIndex = await hasIndex(repoPath);

  if (forceAnalyze) {
    logger.info('Force analyze: rebuilding index');
    await runAnalysis(repoPath, { force: true });
    return {
      analysisState: 'rebuilt',
      hadIndex,
    };
  }

  if (!hadIndex) {
    logger.info('No index found: creating new index');
    await runAnalysis(repoPath, { force: false });
    return {
      analysisState: 'created',
      hadIndex: false,
    };
  }

  logger.info('Index found: reusing existing index');
  return {
    analysisState: 'reused',
    hadIndex: true,
  };
}