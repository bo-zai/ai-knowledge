import { createAnalysisArtifactWriter } from "../../../domain-analysis/artifacts/analysis-artifact-writer.js";
import { buildRelationAdjudicationInput } from "./build-relation-adjudication-input.js";
import { createRelationAdjudicationAgent } from "./relation-adjudication-agent.js";
import type {
  RelationAdjudicationOutput,
  RelationAdjudicationStageInput,
} from "./types.js";

export async function runRelationAdjudication(
  input: RelationAdjudicationStageInput,
): Promise<RelationAdjudicationOutput> {
  const artifactWriter = createAnalysisArtifactWriter(input.repoPath);
  const stageInput = buildRelationAdjudicationInput(input.relationGraph);
  await artifactWriter.writeJsonArtifact?.(
    "relation-adjudication-input.json",
    stageInput,
  );

  const agent = createRelationAdjudicationAgent(input.repoPath);
  const stageResult = await agent.analyze(stageInput);
  await artifactWriter.writeJsonArtifact?.(
    "relation-adjudication-output.json",
    stageResult,
  );
  return stageResult;
}
