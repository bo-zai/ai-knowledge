import { createAnalysisArtifactWriter } from "../../../domain-analysis/artifacts/analysis-artifact-writer.js";
import type { DomainAnalysisInput } from "../../../domain-analysis/types.js";
import { buildDomainAssemblyInput } from "./build-domain-assembly-input.js";
import { createDomainAssemblyAgent } from "./domain-assembly-agent.js";
import type { DomainAssemblyOutput } from "./types.js";

export async function runDomainAssembly(
  repoPath: string,
  input: DomainAnalysisInput,
): Promise<DomainAssemblyOutput> {
  const artifactWriter = createAnalysisArtifactWriter(repoPath);
  const assemblyInput = buildDomainAssemblyInput(input);
  await artifactWriter.writeJsonArtifact(
    "domain-assembly-input.json",
    assemblyInput,
  );

  const agent = createDomainAssemblyAgent(repoPath);
  const result = await agent.analyze(assemblyInput);
  await artifactWriter.writeJsonArtifact("domain-assembly-output.json", result);
  return result;
}
