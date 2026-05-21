import type { SlicePlan, SliceSeed } from './types.js';
import { discoverSlices, countByKind } from './discover-slices.js';

/**
 * Normalized slice discovery output structure.
 * Used by embedded runtime discovery functions.
 */
export interface NormalizedSliceDiscovery {
  routes: Array<{ id: string; method: string; path: string }>;
  processes: Array<{ id: string; name: string }>;
  tools: Array<{ id: string; name: string }>;
  communities: Array<{ id: string; name: string }>;
  tables: Array<{ id: string; name: string }>;
  gaps?: Array<{ kind: 'route' | 'process' | 'tool' | 'community' | 'table'; reason: string; raw_line?: string }>;
}

export function buildSlicePlan(input: {
  routes: string[];
  processes: string[];
  tools: string[];
  communities: string[];
  tables: string[];
}): SlicePlan {
  const slices = discoverSlices(input);
  const by_kind = countByKind(slices);
  return {
    slices,
    total_count: slices.length,
    by_kind,
  };
}

/**
 * Build slice plan from normalized discovery output.
 * This is the preferred entry point when using embedded runtime.
 */
export function buildSlicePlanFromNormalized(discovery: NormalizedSliceDiscovery): SlicePlan {
  const slices: SliceSeed[] = [];

  // Convert normalized routes to slice seeds
  for (const route of discovery.routes) {
    slices.push({
      id: route.id,
      kind: 'route',
      title: `${route.method} ${route.path}`,
    });
  }

  // Convert normalized processes
  for (const process of discovery.processes) {
    slices.push({
      id: process.id,
      kind: 'process',
      title: process.name,
    });
  }

  // Convert normalized tools
  for (const tool of discovery.tools) {
    slices.push({
      id: tool.id,
      kind: 'tool',
      title: tool.name,
    });
  }

  // Convert normalized communities
  for (const community of discovery.communities) {
    slices.push({
      id: community.id,
      kind: 'community',
      title: community.name,
    });
  }

  // Convert normalized tables
  for (const table of discovery.tables) {
    slices.push({
      id: table.id,
      kind: 'database',
      title: table.name,
    });
  }

  const by_kind = countByKind(slices);

  return {
    slices,
    total_count: slices.length,
    by_kind,
    gaps: discovery.gaps,
  };
}

/**
 * Extract slice seeds from discovery output.
 * Parses text-based discovery output format.
 */
export function extractSliceSeedsFromDiscoveryOutput(discoveryOutput: string): {
  routes: string[];
  processes: string[];
  tools: string[];
  communities: string[];
  tables: string[];
} {
  const lines = discoveryOutput.split('\n');
  const routes: string[] = [];
  const processes: string[] = [];
  const tools: string[] = [];
  const communities: string[] = [];
  const tables: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Route:')) {
      routes.push(trimmed.replace('Route:', '').trim());
    } else if (trimmed.startsWith('Process:')) {
      processes.push(trimmed.replace('Process:', '').trim());
    } else if (trimmed.startsWith('Tool:')) {
      tools.push(trimmed.replace('Tool:', '').trim());
    } else if (trimmed.startsWith('Community:')) {
      communities.push(trimmed.replace('Community:', '').trim());
    } else if (trimmed.startsWith('Table:')) {
      tables.push(trimmed.replace('Table:', '').trim());
    }
  }

  return { routes, processes, tools, communities, tables };
}