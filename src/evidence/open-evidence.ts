import type { SliceEvidenceBundle } from "./types.js";

export function buildOpenEvidence(input: {
  questionId: string;
  question: string;
  context: string;
  impact: string;
  reason: string;
}): SliceEvidenceBundle {
  return {
    slice: {
      id: `open:${input.questionId}`,
      kind: "community",
      title: input.question,
      scope: input.questionId,
      seed: input.questionId,
    },
    facts: [],
    symbols: [],
    relations: [],
    snippets: [],
    tables: [],
    tests: [],
    gaps: [
      {
        id: "G-001",
        kind: "open-question",
        question: input.question,
        reason: input.reason,
      },
    ],
  };
}
