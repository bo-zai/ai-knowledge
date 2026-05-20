export function buildCatalog(input: {
  retrievalOrder: string[];
  objects: Array<{ id: string; type: string; path: string; slice_ids: string[] }>;
}) {
  return {
    retrieval_order: input.retrievalOrder,
    objects: Object.fromEntries(
      input.objects.map((object) => [
        object.id,
        { type: object.type, path: object.path, slice_ids: object.slice_ids },
      ]),
    ),
  };
}