import { ensureDir, writeText } from '../shared/fs.js';

export interface GenerationReport {
  totalObjects: number;
  succeeded: number;
  failed: number;
  failures: Array<{ id: string; type: string; error: string }>;
  warnings: Array<{ id: string; message: string }>;
}

export async function writeReports(input: {
  repoPath: string;
  bootstrapDir: string;
  report: GenerationReport;
}): Promise<void> {
  const reportsPath = `${input.repoPath}/${input.bootstrapDir}/reports`;

  await ensureDir(reportsPath);

  // 写入 generation-summary.md
  const summary = buildSummaryMarkdown(input.report);
  await writeText(`${reportsPath}/generation-summary.md`, summary);

  // 写入 coverage-report.yaml
  const coverage = buildCoverageYaml(input.report);
  await writeText(`${reportsPath}/coverage-report.yaml`, coverage);
}

function buildSummaryMarkdown(report: GenerationReport): string {
  const lines = [
    '# Generation Summary',
    '',
    `**Total Objects:** ${report.totalObjects}`,
    `**Succeeded:** ${report.succeeded}`,
    `**Failed:** ${report.failed}`,
    '',
  ];

  if (report.failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const failure of report.failures) {
      lines.push(`- **${failure.id}** (${failure.type}): ${failure.error}`);
    }
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of report.warnings) {
      lines.push(`- ${warning.id}: ${warning.message}`);
    }
  }

  return lines.join('\n');
}

function buildCoverageYaml(report: GenerationReport): string {
  return `success_rate: ${report.succeeded}/${report.totalObjects}
failures:
${report.failures.map((f) => `  - id: ${f.id}\n    type: ${f.type}\n    error: ${f.error}`).join('\n')}
warnings:
${report.warnings.map((w) => `  - id: ${w.id}\n    message: ${w.message}`).join('\n')}
`;
}