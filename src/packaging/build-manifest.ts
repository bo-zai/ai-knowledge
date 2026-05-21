export function buildManifest(input: {
  repoId: string;
  repoRoot: string;
  generatedAt: string;
  analysisVersion: string;
}) {
  return {
    schema_version: 1,
    knowledge_pack_type: 'bootstrap',
    repo_id: input.repoId,
    repo_root: input.repoRoot,
    generated_at: input.generatedAt,
    analysis_version: input.analysisVersion,
    object_types: ['TERM', 'CON', 'FLOW', 'MOD', 'OPEN', 'OWN', 'VER', 'DB'],
  };
}