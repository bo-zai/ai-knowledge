import type { SliceSeed, SliceKind } from './types.js';

export function discoverSlices(input: {
  routes: string[];
  processes: string[];
  tools: string[];
  communities: string[];
  tables: string[];
}): SliceSeed[] {
  return [
    ...input.routes.map((value) => ({ id: `route:${value}`, kind: 'route' as const, title: value, source: value })),
    ...input.processes.map((value) => ({ id: `process:${value}`, kind: 'process' as const, title: value, source: value })),
    ...input.tools.map((value) => ({ id: `tool:${value}`, kind: 'tool' as const, title: value, source: value })),
    ...input.communities.map((value) => ({ id: `community:${value}`, kind: 'community' as const, title: value, source: value })),
    ...input.tables.map((value) => ({ id: `database:${value}`, kind: 'database' as const, title: value, source: value })),
  ];
}

export function countByKind(slices: SliceSeed[]): Record<SliceKind, number> {
  const counts: Record<SliceKind, number> = {
    route: 0,
    process: 0,
    tool: 0,
    community: 0,
    database: 0,
  };
  for (const slice of slices) {
    counts[slice.kind]++;
  }
  return counts;
}