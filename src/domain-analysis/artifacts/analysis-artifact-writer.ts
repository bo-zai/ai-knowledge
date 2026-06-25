import fs from "fs/promises";
import path from "path";
import type {
  CandidateProfilingInput,
  CandidateProfilingResult,
  CrossDomainAnalysisResult,
  CrossDomainAnalysisInput,
  DomainAnalysisInput,
  DomainAnalysisResult,
  DomainEvidenceBundle,
  GlobalReconciliationInput,
  GlobalReconciliationResult,
  LocalClusterAnalysisInput,
  LocalClusterAnalysisResult,
  PartitionAnalysisInput,
  PartitionAnalysisResult,
  StructuralValidationResult,
  SubjectCandidateAnalysisInput,
  SubjectCandidateAnalysisResult,
} from "../types.js";
import type {
  DomainBoundaryFinalResult,
  DomainBoundaryPlan,
} from "../domain-boundary/types.js";
import type {
  EvidenceAtom,
  EvidenceBundleContainer,
} from "../../partition/evidence/types.js";
import type { SubjectRelationGraph } from "../../partition/relation-inference/types.js";
import type { SubjectCandidate as PartitionSubjectCandidate } from "../../partition/subject-discovery/types.js";

export class AnalysisArtifactWriter {
  constructor(private readonly repoPath: string) {}

  async writeJsonArtifact(fileName: string, value: unknown): Promise<void> {
    await this.writeJson(fileName, value);
  }

  async writeEvidenceBundle(bundle: DomainEvidenceBundle): Promise<void> {
    await this.writeJson("legacy-evidence-bundle.json", bundle);
    await this.writeJson(
      "candidate-dependency-matrix.json",
      bundle.dependencyMatrix,
    );
  }

  async writeCanonicalEvidenceAtoms(atoms: EvidenceAtom[]): Promise<void> {
    await this.writeJson("evidence-atoms.json", atoms);
  }

  async writeCanonicalEvidenceBundle(
    bundle: EvidenceBundleContainer,
  ): Promise<void> {
    await this.writeJson("evidence-bundle.json", bundle);
  }

  async writeSubjectCandidates(
    candidates: PartitionSubjectCandidate[],
  ): Promise<void> {
    await this.writeJson("subject-candidates.json", candidates);
  }

  async writeSubjectRelations(
    relationGraph: SubjectRelationGraph,
  ): Promise<void> {
    await this.writeJson("subject-relations.json", relationGraph);
  }

  async writePartitionAnalysisInput(
    input: PartitionAnalysisInput,
  ): Promise<void> {
    await this.writeJson("llm-analysis-input.json", input);
  }

  async writePartitionAnalysisOutput(
    result: PartitionAnalysisResult,
  ): Promise<void> {
    await this.writeJson("llm-analysis-output.json", result);
  }

  async writeSubjectCandidateAnalysisInput(
    input: SubjectCandidateAnalysisInput,
  ): Promise<void> {
    await this.writeJson("candidate-roots.json", input);
  }

  async writeSubjectCandidateAnalysisOutput(
    result: SubjectCandidateAnalysisResult,
  ): Promise<void> {
    await this.writeJson("candidate-roots-output.json", result);
  }

  async writeDomainAnalysisInput(input: DomainAnalysisInput): Promise<void> {
    await this.writeJson("domain-analysis-input.json", input);
  }

  async writeDomainAnalysisRawOutput(value: unknown): Promise<void> {
    await this.writeJson("domain-analysis-output.raw.json", value);
  }

  async writeDomainAnalysisOutput(result: DomainAnalysisResult): Promise<void> {
    await this.writeJson("domain-analysis-output.normalized.json", result);
  }

  async writeDomainBoundaryPlan(plan: DomainBoundaryPlan): Promise<void> {
    await this.writeJson("domain-boundary-plan.json", plan);
  }

  async writeDomainBoundaryFinal(
    result: DomainBoundaryFinalResult,
  ): Promise<void> {
    await this.writeJson("domain-boundary-final.json", result);
    await this.writeJson("domain-boundary-conflicts.json", result.conflicts);
  }

  async writeStructuralValidationOutput(
    result: StructuralValidationResult,
  ): Promise<void> {
    await this.writeJson("domain-analysis-validation.json", result);
  }

  async writeCandidateProfilingInput(
    input: CandidateProfilingInput,
  ): Promise<void> {
    await this.writeJson("candidate-profiling-input.json", input);
  }

  async writeCandidateProfilingOutput(
    result: CandidateProfilingResult,
  ): Promise<void> {
    await this.writeJson("candidate-profiling-output.json", result);
  }

  async writeLocalClusterAnalysisInput(
    input: LocalClusterAnalysisInput,
  ): Promise<void> {
    await this.writeJson("local-cluster-analysis-input.json", input);
  }

  async writeLocalClusterAnalysisOutput(
    result: LocalClusterAnalysisResult,
  ): Promise<void> {
    await this.writeJson("local-cluster-analysis-output.json", result);
  }

  async writeGlobalReconciliationInput(
    input: GlobalReconciliationInput,
  ): Promise<void> {
    await this.writeJson("global-reconciliation-input.json", input);
  }

  async writeGlobalReconciliationOutput(
    result: GlobalReconciliationResult,
  ): Promise<void> {
    await this.writeJson("global-reconciliation-output.json", result);
  }

  async writeCrossDomainAnalysisOutput(
    result: CrossDomainAnalysisResult,
  ): Promise<void> {
    await this.writeJson("cross-domain-analysis-output.json", result);
  }

  async writeCrossDomainAnalysisInput(
    input: CrossDomainAnalysisInput,
  ): Promise<void> {
    await this.writeJson("cross-domain-analysis-input.json", input);
  }

  private async writeJson(fileName: string, value: unknown): Promise<void> {
    const outputDir = path.join(this.repoPath, ".knowledge", "domain-analysis");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(
      path.join(outputDir, fileName),
      JSON.stringify(value, createArtifactReplacer(), 2),
      "utf-8",
    );
  }
}

export function createAnalysisArtifactWriter(
  repoPath: string,
): AnalysisArtifactWriter {
  return new AnalysisArtifactWriter(repoPath);
}

function createArtifactReplacer(): (key: string, value: unknown) => unknown {
  return (_key: string, value: unknown): unknown => {
    if (value instanceof Map) {
      return Object.fromEntries(value.entries());
    }
    if (value instanceof Set) {
      return [...value];
    }
    return value;
  };
}
