import type { SliceEvidenceBundle } from "./types.js";

export function buildProcessEvidence(input: {
  processName: string;
  entryFile: string;
  participants: string[];
  steps: Array<{ order: number; action: string; actor: string }>;
}): SliceEvidenceBundle {
  return {
    slice: {
      id: `process:${input.processName}`,
      kind: "process",
      title: input.processName,
      scope: input.entryFile,
      seed: input.processName,
    },
    facts: [
      {
        id: "F-001",
        claim: `Process ${input.processName} starts at ${input.entryFile}`,
        source_kind: "analysis-runtime",
        refs: [{ file: input.entryFile }],
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
