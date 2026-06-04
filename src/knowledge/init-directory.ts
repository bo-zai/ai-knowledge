/**
 * Directory Structure Initialization
 *
 * Creates the knowledge package output directory skeleton before generation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../shared/logger.js';
import { DEFAULT_KNOWLEDGE_DIR } from '../config/defaults.js';

/**
 * Package layout with paths to key directories and files.
 */
export interface PackageLayout {
  packageRoot: string;       // {outputRoot}/ai-knowledge
  objectsDir: string;        // {packageRoot}/objects
  sharedDir: string;         // {packageRoot}/objects/_共享（兼容）
  evidenceDir: string;       // {packageRoot}/evidence
  reportsDir: string;        // {packageRoot}/reports
  catalogPath: string;       // {packageRoot}/catalog.yaml
}

/**
 * Initialize the knowledge package directory structure.
 *
 * Creates empty directory skeleton (no knowledge files yet).
 * Domain directories are created later during generation.
 */
export async function initDirectoryStructure(outputRoot: string): Promise<PackageLayout> {
  const packageRoot = path.resolve(outputRoot, DEFAULT_KNOWLEDGE_DIR);

  // Safety check: must be ai-knowledge
  if (path.basename(packageRoot) !== DEFAULT_KNOWLEDGE_DIR) {
    throw new Error(`Refusing to initialize invalid package root: ${packageRoot} (basename must be '${DEFAULT_KNOWLEDGE_DIR}')`);
  }

  logger.info(`Initializing directory structure at ${packageRoot}`);

  // Clean old output
  await fs.rm(packageRoot, { recursive: true, force: true });

  // Create directory skeleton
  await fs.mkdir(packageRoot, { recursive: true });
  const objectsDir = path.join(packageRoot, 'objects');
  const sharedDir = path.join(objectsDir, '_共享');
  const evidenceDir = path.join(packageRoot, 'evidence');
  const reportsDir = path.join(packageRoot, 'reports');

  await fs.mkdir(objectsDir, { recursive: true });
  await fs.mkdir(sharedDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });

  const catalogPath = path.join(packageRoot, 'catalog.yaml');

  logger.info('Directory structure initialized');

  return {
    packageRoot,
    objectsDir,
    sharedDir,
    evidenceDir,
    reportsDir,
    catalogPath,
  };
}