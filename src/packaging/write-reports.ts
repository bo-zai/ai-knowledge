import { ensureDir, writeText } from "../shared/fs.js";
import YAML from "yaml";

export interface GenerationReport {
  totalObjects: number;
  succeeded: number;
  failed: number;
  failures: Array<{ id: string; type: string; error: string }>;
  warnings: Array<{ id: string; message: string }>;
  // 新增统计
  objectCountsByType?: Record<
    string,
    { attempted: number; succeeded: number; failed: number }
  >;
  dbCoverage?: {
    tablesFound: number;
    tablesGenerated: number;
    fieldsWithCommentSource: number;
    fieldsWithInferredSource: number;
    inferredFieldGaps: number;
  };
  sliceCoverage?: {
    totalSlices: number;
    slicesProcessed: number;
    slicesWithObjects: number;
  };
}

export async function writeReports(input: {
  repoPath: string;
  bootstrapDir: string;
  report: GenerationReport;
}): Promise<void> {
  const reportsPath = `${input.repoPath}/${input.bootstrapDir}/.internal/reports`;

  await ensureDir(reportsPath);

  // 写入 generation-summary.md
  const summary = buildSummaryMarkdown(input.report);
  await writeText(`${reportsPath}/generation-summary.md`, summary);

  // 写入 coverage-report.yaml
  const coverage = buildCoverageYaml(input.report);
  await writeText(`${reportsPath}/coverage-report.yaml`, coverage);

  // 写入 object-stats.yaml（新增）
  const stats = buildObjectStats(input.report);
  await writeText(`${reportsPath}/object-stats.yaml`, stats);
}

function buildSummaryMarkdown(report: GenerationReport): string {
  const lines = [
    "# Generation Summary",
    "",
    `**Total Objects:** ${report.totalObjects}`,
    `**Succeeded:** ${report.succeeded}`,
    `**Failed:** ${report.failed}`,
    `**Warnings:** ${report.warnings.length}`,
    "",
  ];

  // DB Coverage 统计
  if (report.dbCoverage) {
    lines.push("## DB Coverage");
    lines.push("");
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Tables Found | ${report.dbCoverage.tablesFound} |`);
    lines.push(`| Tables Generated | ${report.dbCoverage.tablesGenerated} |`);
    lines.push(
      `| Fields with Comment Source | ${report.dbCoverage.fieldsWithCommentSource} |`,
    );
    lines.push(
      `| Fields with Inferred Source | ${report.dbCoverage.fieldsWithInferredSource} |`,
    );
    lines.push(
      `| Inferred Field Gaps | ${report.dbCoverage.inferredFieldGaps} |`,
    );
    lines.push("");
  }

  // Slice Coverage 统计
  if (report.sliceCoverage) {
    lines.push("## Slice Coverage");
    lines.push("");
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Slices | ${report.sliceCoverage.totalSlices} |`);
    lines.push(
      `| Slices Processed | ${report.sliceCoverage.slicesProcessed} |`,
    );
    lines.push(
      `| Slices with Objects | ${report.sliceCoverage.slicesWithObjects} |`,
    );
    lines.push("");
  }

  // 按类型统计
  if (report.objectCountsByType) {
    lines.push("## Object Counts by Type");
    lines.push("");
    lines.push(`| Type | Attempted | Succeeded | Failed |`);
    lines.push(`|------|-----------|-----------|--------|`);
    for (const [type, counts] of Object.entries(report.objectCountsByType)) {
      lines.push(
        `| ${type} | ${counts.attempted} | ${counts.succeeded} | ${counts.failed} |`,
      );
    }
    lines.push("");
  }

  if (report.failures.length > 0) {
    lines.push("## Failures");
    lines.push("");
    for (const failure of report.failures) {
      lines.push(`- **${failure.id}** (${failure.type}): ${failure.error}`);
    }
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of report.warnings) {
      lines.push(`- **${warning.id}**: ${warning.message}`);
    }
    lines.push("");
  }

  // 状态标记
  if (report.failures.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push(
      "**STATUS: PARTIAL** - Some objects failed to generate. Review failures above.",
    );
  } else if (report.succeeded === 0 && report.totalObjects === 0) {
    lines.push("---");
    lines.push("");
    lines.push(
      "**STATUS: EMPTY** - No objects were generated. Check evidence extraction.",
    );
  } else if (report.succeeded === report.totalObjects) {
    lines.push("---");
    lines.push("");
    lines.push("**STATUS: COMPLETE** - All objects generated successfully.");
  }

  return lines.join("\n");
}

function buildCoverageYaml(report: GenerationReport): string {
  const data = {
    success_rate: `${report.succeeded}/${report.totalObjects}`,
    success_percentage:
      report.totalObjects > 0
        ? Math.round((report.succeeded / report.totalObjects) * 100)
        : 0,
    failures: report.failures,
    warnings: report.warnings,
    db_coverage: report.dbCoverage,
    slice_coverage: report.sliceCoverage,
    object_counts_by_type: report.objectCountsByType,
    is_partial: report.failures.length > 0,
    is_empty: report.succeeded === 0 && report.totalObjects === 0,
  };

  return YAML.stringify(data);
}

function buildObjectStats(report: GenerationReport): string {
  const data = {
    generated_at: new Date().toISOString(),
    summary: {
      total: report.totalObjects,
      succeeded: report.succeeded,
      failed: report.failed,
      warnings: report.warnings.length,
    },
    by_type: report.objectCountsByType ?? {},
    failure_details: report.failures,
    warning_details: report.warnings,
  };

  return YAML.stringify(data);
}
