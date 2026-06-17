/**
 * Result Map Resolver
 *
 * Resolves resultMap definitions and provides column/property mappings.
 */

import type {
  ResultMapDef,
  MapperDocument,
  ResolvedStatement,
} from "./types.js";

/**
 * Find a resultMap by ID in mapper document.
 */
export function findResultMap(
  mapper: MapperDocument,
  resultMapId?: string,
): ResultMapDef | null {
  if (!resultMapId) return null;
  return mapper.resultMaps.find((rm) => rm.id === resultMapId) || null;
}

/**
 * Get all column names from a resultMap.
 */
export function getResultMapColumns(resultMap: ResultMapDef): string[] {
  return resultMap.mappings.map((m) => m.column);
}

/**
 * Get all property names from a resultMap.
 */
export function getResultMapProperties(resultMap: ResultMapDef): string[] {
  return resultMap.mappings.map((m) => m.property);
}

/**
 * Find property for a given column in resultMap.
 */
export function findPropertyForColumn(
  resultMap: ResultMapDef,
  column: string,
): string | null {
  const mapping = resultMap.mappings.find((m) => m.column === column);
  return mapping?.property || null;
}

/**
 * Find column for a given property in resultMap.
 */
export function findColumnForProperty(
  resultMap: ResultMapDef,
  property: string,
): string | null {
  const mapping = resultMap.mappings.find((m) => m.property === property);
  return mapping?.column || null;
}

/**
 * Get result mapping info for a statement.
 * Returns null if statement uses resultType (not resultMap).
 */
export function getStatementResultMapping(
  statement: ResolvedStatement,
  mapper: MapperDocument,
): ResultMapDef | null {
  if (!statement.resultMap) return null;
  return findResultMap(mapper, statement.resultMap);
}

/**
 * Extract all resultMap info from mapper as a lookup table.
 */
export function buildResultMapLookup(
  mapper: MapperDocument,
): Map<string, ResultMapDef> {
  const lookup = new Map<string, ResultMapDef>();
  for (const rm of mapper.resultMaps) {
    lookup.set(rm.id, rm);
  }
  return lookup;
}
