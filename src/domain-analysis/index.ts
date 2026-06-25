export type {
  CandidateProfile,
  CandidateProfilingInput,
  CandidateProfilingResult,
  CandidateEvidenceBundle,
  CrossDomainAnalysisInput,
  CrossDomainAnalysisResult,
  DomainAnalysisContext,
  DomainDependencyMatrixEntry,
  DomainEvidenceBundle,
  GlobalReconciliationInput,
  GlobalReconciliationResult,
  LocalAnalysisCluster,
  LocalClusterAnalysisInput,
  LocalClusterAnalysisResult,
  PartitionAnalysisInput,
  PartitionAnalysisResult,
} from "./types.js";

export {
  AnalysisArtifactWriter,
  createAnalysisArtifactWriter,
} from "./artifacts/analysis-artifact-writer.js";
export { buildCandidateProfilingInput } from "./candidate-profiling/candidate-profiling-builder.js";
export {
  CandidateProfilingAgent,
  createCandidateProfilingAgent,
} from "./candidate-profiling/candidate-profiling-agent.js";
export { runCandidateProfiling } from "./candidate-profiling/run-candidate-profiling.js";
export {
  DomainEvidenceBuilder,
  createDomainEvidenceBuilder,
} from "./evidence-builder/domain-evidence-builder.js";
export type { DomainEvidenceSource } from "./evidence-sources/types.js";
export {
  CandidateSchemaSource,
  createCandidateSchemaSource,
} from "./evidence-sources/candidate-schema-source.js";
export {
  CodeUsageSource,
  createCodeUsageSource,
} from "./evidence-sources/code-usage-source.js";
export {
  MapperSqlSource,
  createMapperSqlSource,
} from "./evidence-sources/mapper-sql-source.js";
export {
  ProjectDocSource,
  createProjectDocSource,
} from "./evidence-sources/project-doc-source.js";
export {
  DatabaseDdlSource,
  createDatabaseDdlSource,
} from "./evidence-sources/database-ddl-source.js";
export {
  DatabaseInstanceSource,
  createDatabaseInstanceSource,
} from "./evidence-sources/database-instance-source.js";
export {
  PartitionAnalysisAgent,
  createPartitionAnalysisAgent,
} from "./partition-analysis/partition-analysis-agent.js";
export { runPartitionAnalysis } from "./partition-analysis/run-partition-analysis.js";
export {
  SubjectCandidateAnalysisAgent,
  createSubjectCandidateAnalysisAgent,
} from "./subject-candidate-analysis/subject-candidate-analysis-agent.js";
export { runSubjectCandidateAnalysis } from "./subject-candidate-analysis/run-subject-candidate-analysis.js";
export {
  DomainAnalysisAgent,
  createDomainAnalysisAgent,
} from "./domain-analysis/domain-analysis-agent.js";
export { runDomainAnalysis } from "./domain-analysis/run-domain-analysis.js";
export { planDomainBoundaries } from "./domain-boundary/index.js";
export type {
  BoundaryCandidateDecision,
  BoundaryCandidateRole,
  DomainBoundaryFinalResult,
  DomainBoundaryPlan,
} from "./domain-boundary/index.js";
export { buildLocalAnalysisClusters } from "./local-cluster-analysis/local-cluster-builder.js";
export {
  LocalClusterAnalysisAgent,
  createLocalClusterAnalysisAgent,
} from "./local-cluster-analysis/local-cluster-analysis-agent.js";
export { runLocalClusterAnalysis } from "./local-cluster-analysis/run-local-cluster-analysis.js";
export {
  GlobalReconciliationAgent,
  createGlobalReconciliationAgent,
} from "./global-reconciliation/global-reconciliation-agent.js";
export { runGlobalReconciliation } from "./global-reconciliation/run-global-reconciliation.js";
export {
  CrossDomainAnalysisAgent,
  createCrossDomainAnalysisAgent,
} from "./cross-domain-analysis/cross-domain-analysis-agent.js";
export { runCrossDomainAnalysis } from "./cross-domain-analysis/run-cross-domain-analysis.js";
export { runBusinessDomainPartition as runBusinessDomainPipeline } from "../partition/business-domain/index.js";
export type {
  BusinessDomainPartitionInput as BusinessDomainPipelineInput,
  BusinessDomainPartitionResult as BusinessDomainPipelineResult,
} from "../partition/business-domain/index.js";
