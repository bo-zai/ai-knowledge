import type { EvidenceBundle } from "../evidence-bundle-schema.js";
import type { EvidenceGroup } from "../type-evidence-builder.js";
import type { GenerateTarget } from "../../knowledge/generate-scope.js";
import type { ReadOnlyQueryExecutor } from "../../engine/lbug/read-only-session.js";

/**
 * EXTERNAL: Query external dependencies (single group).
 */
export async function queryExternalEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split("/").pop() || "unknown";

  const importCypher = `
    MATCH (f:File) WHERE f.content =~ '(?i).*(alipay|wechat|wxpay|oss|sms|okhttp|feign).*'
    RETURN f.name as fileName, f.filePath as filePath
    LIMIT 15
  `;
  const importResults = await executeQuery(importCypher);

  if (importResults.length === 0) {
    return [];
  }

  const behaviorSlices: EvidenceBundle["behaviorSlices"] = importResults.map(
    (row, idx) => ({
      ref: `evidence://behavior/BEH-${String(idx + 1).padStart(3, "0")}`,
      location: (row.filePath as string) || "",
      verb: "import",
      object: row.fileName as string,
    }),
  );

  return [
    {
      groupId: "EXTERNAL-deps",
      packagePath: "external",
      bundle: {
        bundleId: "BUNDLE-EXTERNAL",
        candidateId: "CAND-EXTERNAL",
        repoProfile: { name: repoName },
        confidence: 0.6,
        risks: [],
        capabilityHints: { nameCandidates: [], relatedTerms: [] },
        entryPoints: [],
        behaviorSlices,
        dataContracts: [],
        validationAnchors: [],
        moduleSurfaces: [],
        flowTraces: [],
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      },
    },
  ];
}
