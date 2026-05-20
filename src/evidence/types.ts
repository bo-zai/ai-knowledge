export interface FactRef {
  file: string;
  symbol?: string;
  lines?: string;
}

export interface EvidenceFact {
  id: string;
  claim: string;
  source_kind: string;
  refs: FactRef[];
}

export interface SliceEvidenceBundle {
  slice: {
    id: string;
    kind: 'route' | 'process' | 'tool' | 'community' | 'database';
    title: string;
    scope: string;
    seed: string;
  };
  facts: EvidenceFact[];
  symbols: Array<{ id: string; name: string; kind: string; file: string; lines?: string; role?: string }>;
  relations: Array<{ type: string; from: string; to: string; reason?: string }>;
  snippets: Array<{ id: string; file: string; lines?: string; content: string }>;
  tables: string[];
  tests: string[];
  gaps: Array<{ id: string; kind: string; question: string; reason: string }>;
}