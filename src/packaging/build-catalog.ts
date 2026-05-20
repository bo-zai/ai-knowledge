export interface CatalogEntry {
  type: string;
  path: string;
  slice_ids: string[];
  status?: string;
  maturity?: string;
}

export interface Catalog {
  schema_version: number;
  retrieval_order: string[];
  objects: Record<string, CatalogEntry>;
  object_counts_by_type: Record<string, number>;
  total_object_count: number;
}

export function buildCatalog(input: {
  retrievalOrder: string[];
  objects: Array<{ id: string; type: string; path: string; slice_ids: string[]; status?: string; maturity?: string }>;
}): Catalog {
  const objectCounts: Record<string, number> = {};

  const entries = Object.fromEntries(
    input.objects.map((object) => {
      // 统计类型
      objectCounts[object.type] = (objectCounts[object.type] ?? 0) + 1;

      return [
        object.id,
        {
          type: object.type,
          path: object.path,
          slice_ids: object.slice_ids,
          status: object.status ?? 'fact',
          maturity: object.maturity ?? 'bootstrap',
        },
      ];
    }),
  );

  return {
    schema_version: 1,
    retrieval_order: input.retrievalOrder,
    objects: entries,
    object_counts_by_type: objectCounts,
    total_object_count: input.objects.length,
  };
}