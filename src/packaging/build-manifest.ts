export function buildManifest(input: {
  repoId: string;
  repoRoot: string;
  generatedAt: string;
  gitnexusVersion: string;
}) {
  return {
    schema_version: 1,
    knowledge_pack_type: 'bootstrap',
    repo_id: input.repoId,
    repo_root: input.repoRoot,
    generated_at: input.generatedAt,
    gitnexus_version: input.gitnexusVersion,
    object_types: ['TERM', 'CON', 'FLOW', 'MOD', 'OPEN', 'OWN', 'VER', 'DB'],
  };
}