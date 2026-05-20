import type { SliceEvidenceBundle } from './types.js';

export function buildVerEvidence(input: {
  componentName: string;
  version: string;
  versionKind: string;
  changelog: string[];
}): SliceEvidenceBundle {
  return {
    slice: {
      id: `version:${input.componentName}`,
      kind: 'tool',
      title: `Version: ${input.componentName}`,
      scope: input.componentName,
      seed: input.componentName,
    },
    facts: [
      {
        id: 'F-001',
        claim: `${input.componentName} version is ${input.version}`,
        source_kind: 'gitnexus',
        refs: [{ file: input.componentName }],
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