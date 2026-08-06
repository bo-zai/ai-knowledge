export type ParsedDocument = {
  id: string;
  path: string;
  text: string;
};

export function normalizeDocumentText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export function createParsedDocument(input: {
  id: string;
  path: string;
  text: string;
}): ParsedDocument {
  return {
    id: input.id,
    path: input.path,
    text: normalizeDocumentText(input.text),
  };
}
