export function buildRoleKnowledgeReport(
  entries: Array<{ domain: string; role: string; status: string; warnings: string[] }>,
): string {
  return entries
    .map((entry) => `${entry.domain} ${entry.role} ${entry.status}`)
    .join("\n");
}
