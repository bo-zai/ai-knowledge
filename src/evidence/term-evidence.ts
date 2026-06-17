import type { SliceEvidenceBundle } from "./types.js";

export function buildTermEvidence(input: {
  term: string;
  definition: string;
  usedIn: string[];
}): SliceEvidenceBundle {
  return {
    slice: {
      id: `term:${input.term}`,
      kind: "community",
      title: input.term,
      scope: input.term,
      seed: input.term,
    },
    facts: [
      {
        id: "F-001",
        claim: `Term ${input.term} means: ${input.definition}`,
        source_kind: "analysis-runtime",
        refs: [],
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
