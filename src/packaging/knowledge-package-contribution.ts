import type { KnowledgeType } from '../schemas/knowledge-type.js';

export interface KnowledgePackageFile {
  path: string;
  content: string;
}

export interface KnowledgePackageObjectRef {
  id: string;
  type: KnowledgeType | string;
  path: string;
  sliceIds?: string[];
}

export interface KnowledgePackageStageReport {
  stage: string;
  ran: boolean;
  succeeded: number;
  failed: number;
  details: Record<string, unknown>;
}

export interface KnowledgePackageContribution {
  stage: string;
  files: KnowledgePackageFile[];
  objects: KnowledgePackageObjectRef[];
  report: KnowledgePackageStageReport;
  warnings: string[];
}