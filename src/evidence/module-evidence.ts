import type { SliceEvidenceBundle } from './types.js';

export function buildModuleEvidence(input: {
  moduleName: string;
  filePath: string;
  exports: string[];
  imports: string[];
}): SliceEvidenceBundle {
  return {
    slice: {
      id: `module:${input.moduleName}`,
      kind: 'tool',
      title: input.moduleName,
      scope: input.filePath,
      seed: input.moduleName,
    },
    facts: [
      {
        id: 'F-001',
        claim: `Module ${input.moduleName} is defined in ${input.filePath}`,
        source_kind: 'analysis-runtime',
        refs: [{ file: input.filePath }],
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