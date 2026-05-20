import type { SliceEvidenceBundle } from './types.js';

export function buildRouteEvidence(input: {
  route: string;
  handler_file: string;
  response_keys: string[];
  error_keys: string[];
  middleware: string[];
}): SliceEvidenceBundle {
  return {
    slice: {
      id: `route:${input.route}`,
      kind: 'route',
      title: input.route,
      scope: input.handler_file,
      seed: input.route,
    },
    facts: [
      {
        id: 'F-001',
        claim: `Route ${input.route} is handled by ${input.handler_file}`,
        source_kind: 'gitnexus',
        refs: [{ file: input.handler_file }],
      },
      {
        id: 'F-002',
        claim: `Route ${input.route} returns keys: ${input.response_keys.join(', ')}`,
        source_kind: 'gitnexus',
        refs: [{ file: input.handler_file }],
      },
    ],
    symbols: [
      {
        id: `S-${input.route}-handler`,
        name: input.handler_file,
        kind: 'function',
        file: input.handler_file,
        role: 'handler',
      },
    ],
    relations: [],
    snippets: [],
    tables: [],
    tests: [],
    gaps: [],
  };
}