import type { SliceEvidenceBundle } from "./types.js";

export function buildOwnEvidence(input: {
  componentName: string;
  ownerType: string;
  ownerName: string;
  scopeItems: string[];
}): SliceEvidenceBundle {
  return {
    slice: {
      id: `ownership:${input.componentName}`,
      kind: "community",
      title: `Ownership: ${input.componentName}`,
      scope: input.componentName,
      seed: input.componentName,
    },
    facts: [
      {
        id: "F-001",
        claim: `${input.componentName} is owned by ${input.ownerName} (${input.ownerType})`,
        source_kind: "analysis-runtime",
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
