import type { EvidenceBundle } from "../evidence-bundle-schema.js";
import type { EvidenceGroup } from "../type-evidence-builder.js";
import type { GenerateTarget } from "../../knowledge/generate-scope.js";
import type { ReadOnlyQueryExecutor } from "../../engine/lbug/read-only-session.js";

/**
 * BOUNDARY: Query config files, grouped by config type for multiple boundary extraction.
 */
export async function queryBoundaryEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const repoName = repoPath.split("/").pop() || "unknown";

  const configCypher = `
    MATCH (f:File) WHERE f.name =~ '(?i).*(config|properties|yaml|yml)$'
    RETURN f.name as name, f.filePath as filePath
    LIMIT 20
  `;
  const configResults = await executeQuery(configCypher);

  if (configResults.length === 0) {
    return [];
  }

  // 按配置类型分组关键词
  const configTypeKeywords: Record<string, string[]> = {
    支付: ["pay", "wxpay", "alipay", "payment"],
    短信: ["sms", "message", "notify"],
    缓存: ["redis", "cache", "memcache"],
    数据库: ["db", "mysql", "datasource", "jdbc"],
    存储: ["oss", "storage", "file", "upload"],
    定时任务: ["job", "schedule", "quartz", "task"],
    安全: ["security", "auth", "login", "token"],
    通用: ["application", "config", "bootstrap"],
  };

  const groups: EvidenceGroup[] = [];
  let groupIdx = 0;

  for (const row of configResults) {
    const filePath = (row.filePath as string) || "";
    const fileName = (row.name as string) || "";

    // 确定配置类型
    let configType = "通用";
    for (const [type, keywords] of Object.entries(configTypeKeywords)) {
      if (
        keywords.some(
          (k) =>
            fileName.toLowerCase().includes(k) ||
            filePath.toLowerCase().includes(k),
        )
      ) {
        configType = type;
        break;
      }
    }

    groupIdx++;
    groups.push({
      groupId: `BOUNDARY-${configType}-${groupIdx}`,
      packagePath: `config/${configType}`,
      bundle: {
        bundleId: `BUNDLE-BOUNDARY-${configType}`,
        candidateId: `CAND-BOUNDARY-${groupIdx}`,
        repoProfile: { name: repoName },
        confidence: 0.6,
        risks: ["boundary_requires_manual_review"],
        capabilityHints: { nameCandidates: [], relatedTerms: [configType] },
        entryPoints: [],
        behaviorSlices: [],
        dataContracts: [],
        validationAnchors: [],
        moduleSurfaces: [],
        flowTraces: [],
        docs: [
          {
            ref: `evidence://doc/DOC-${String(groupIdx).padStart(3, "0")}`,
            location: filePath,
            kind: "docs",
            excerpt: `${configType}配置文件: ${fileName}`,
          },
        ],
        negativeEvidence: [],
        openQuestions: [],
      },
    });
  }

  return groups;
}
