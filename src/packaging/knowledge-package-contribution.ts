export interface KnowledgePackageFile {
  path: string;
  content: string;
}

export interface KnowledgePackageObjectRef {
  id: string;
  type: string;
  path: string;
  sliceIds?: string[];
}

export interface KnowledgePackageStageReport {
  stage: 'db' | 'capability';
  ran: boolean;
  succeeded: number;
  failed: number;
  details: Record<string, unknown>;
}

export interface KnowledgePackageContribution {
  stage: 'db' | 'capability';
  files: KnowledgePackageFile[];
  objects: KnowledgePackageObjectRef[];
  report: KnowledgePackageStageReport;
  warnings: string[];
}
