import type { SliceEvidenceBundle } from './types.js';

export function buildRepoEvidenceBundle(repoPath: string, repoName: string): SliceEvidenceBundle {
  return {
    slice: {
      id: `repo:${repoName}`,
      kind: 'community',
      title: repoName,
      scope: repoPath,
      seed: repoName,
    },
    facts: [
      {
        id: 'F-REPO-001',
        claim: `Repository ${repoName} exists at ${repoPath}`,
        source_kind: 'filesystem',
        refs: [{ file: repoPath }],
      },
    ],
    symbols: [],
    relations: [],
    snippets: [],
    tables: [],
    tests: [],
    gaps: [],
  };
}