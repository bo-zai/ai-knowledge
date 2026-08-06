import type { ParsedDocument } from "./documents.js";

export type DomainCandidate = {
  domainKey: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type DocumentChunk = {
  id: string;
  document_id: string;
  heading_path: string[];
  text: string;
  element_ids: string[];
  start_order: number;
  end_order: number;
  page_start?: number;
  page_end?: number;
  inferred_date?: string;
  inferred_version?: string;
  domain_candidates: DomainCandidate[];
  chunk_kind:
    | "revision_history"
    | "requirement"
    | "business_rule"
    | "flow"
    | "acceptance"
    | "table"
    | "background"
    | "unknown";
};

export function buildDocumentChunks(input: {
  document: ParsedDocument;
}): DocumentChunk[] {
  const text = input.document.text;
  const revisionChunk: DocumentChunk | undefined = text.includes("修订记录")
    ? {
        id: `${input.document.id}#revision`,
        document_id: input.document.id,
        heading_path: ["修订记录"],
        text,
        element_ids: [],
        start_order: 0,
        end_order: 0,
        chunk_kind: "revision_history",
        domain_candidates: [],
      }
    : undefined;

  const bodyChunk: DocumentChunk = {
    id: `${input.document.id}#body`,
    document_id: input.document.id,
    heading_path: [],
    text,
    element_ids: [],
    start_order: 0,
    end_order: 0,
    chunk_kind: "requirement",
    domain_candidates: [],
  };

  return revisionChunk ? [revisionChunk, bodyChunk] : [bodyChunk];
}
