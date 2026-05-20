import { createGitNexusExecutor, runGitNexus } from './commands.js';
import { checkGitNexusIndex, ensureGitNexusIndex } from './ensure-index.js';
import type { GitNexusResult } from './types.js';

/**
 * Normalized slice discovery result from GitNexus.
 */
export interface NormalizedSliceDiscovery {
  routes: NormalizedRoute[];
  processes: NormalizedProcess[];
  tools: NormalizedTool[];
  communities: NormalizedCommunity[];
  tables: NormalizedTable[];
  gaps: DiscoveryGap[];
  parse_errors: ParseError[];
}

export interface NormalizedRoute {
  id: string;
  method: string;
  path: string;
  handler?: string;
}

export interface NormalizedProcess {
  id: string;
  name: string;
  entry_point?: string;
}

export interface NormalizedTool {
  id: string;
  name: string;
  file?: string;
}

export interface NormalizedCommunity {
  id: string;
  name: string;
  members?: string[];
}

export interface NormalizedTable {
  id: string;
  name: string;
  schema?: string;
}

export interface DiscoveryGap {
  kind: 'route' | 'process' | 'tool' | 'community' | 'table';
  reason: string;
  raw_line?: string;
}

export interface ParseError {
  line: string;
  error: string;
}

export interface GitNexusAdapter {
  ensureIndex: (repoPath: string) => Promise<void>;
  query: (command: string, args: string[], cwd?: string) => Promise<string>;
  discoverSlices: (repoPath: string) => Promise<NormalizedSliceDiscovery>;
}

export function createGitNexusAdapter(): GitNexusAdapter {
  const exec = createGitNexusExecutor();
  return {
    ensureIndex: async (repoPath: string) => {
      await ensureGitNexusIndex({
        repoPath,
        execGitNexus: exec,
        hasIndex: async (path: string) => checkGitNexusIndex(path, exec),
      });
    },
    query: async (command: string, args: string[], cwd?: string) => {
      const result = await runGitNexus([command, ...args], cwd);
      return result.stdout;
    },
    discoverSlices: async (repoPath: string) => {
      const result = await runGitNexus(['list', repoPath], repoPath);
      return normalizeGitNexusOutput(result);
    },
  };
}

/**
 * Parse GitNexus CLI output into normalized slice discovery data.
 * This isolates text parsing from higher-level slice planning logic.
 */
export function normalizeGitNexusOutput(result: GitNexusResult): NormalizedSliceDiscovery {
  const routes: NormalizedRoute[] = [];
  const processes: NormalizedProcess[] = [];
  const tools: NormalizedTool[] = [];
  const communities: NormalizedCommunity[] = [];
  const tables: NormalizedTable[] = [];
  const gaps: DiscoveryGap[] = [];
  const parse_errors: ParseError[] = [];

  const lines = result.stdout.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const parsed = parseSliceLine(trimmed);

    if (parsed.kind === 'route') {
      routes.push(parsed.data as NormalizedRoute);
    } else if (parsed.kind === 'process') {
      processes.push(parsed.data as NormalizedProcess);
    } else if (parsed.kind === 'tool') {
      tools.push(parsed.data as NormalizedTool);
    } else if (parsed.kind === 'community') {
      communities.push(parsed.data as NormalizedCommunity);
    } else if (parsed.kind === 'table') {
      tables.push(parsed.data as NormalizedTable);
    } else if (parsed.kind === 'gap') {
      gaps.push(parsed.data as DiscoveryGap);
    } else if (parsed.kind === 'parse_error') {
      parse_errors.push(parsed.data as ParseError);
    }
  }

  return { routes, processes, tools, communities, tables, gaps, parse_errors };
}

interface ParseResult {
  kind: string;
  data: unknown;
}

function parseSliceLine(line: string): ParseResult {
  if (line.startsWith('Route:')) {
    const raw = line.replace('Route:', '').trim();
    const parsed = parseRoute(raw);
    if (parsed) {
      return { kind: 'route', data: parsed };
    } else {
      return { kind: 'gap', data: { kind: 'route', reason: 'Malformed route line', raw_line: line } };
    }
  }

  if (line.startsWith('Process:')) {
    const raw = line.replace('Process:', '').trim();
    const parsed = parseProcess(raw);
    if (parsed) {
      return { kind: 'process', data: parsed };
    } else {
      return { kind: 'gap', data: { kind: 'process', reason: 'Malformed process line', raw_line: line } };
    }
  }

  if (line.startsWith('Tool:')) {
    const raw = line.replace('Tool:', '').trim();
    const parsed = parseTool(raw);
    if (parsed) {
      return { kind: 'tool', data: parsed };
    } else {
      return { kind: 'gap', data: { kind: 'tool', reason: 'Malformed tool line', raw_line: line } };
    }
  }

  if (line.startsWith('Community:')) {
    const raw = line.replace('Community:', '').trim();
    const parsed = parseCommunity(raw);
    if (parsed) {
      return { kind: 'community', data: parsed };
    } else {
      return { kind: 'gap', data: { kind: 'community', reason: 'Malformed community line', raw_line: line } };
    }
  }

  if (line.startsWith('Table:')) {
    const raw = line.replace('Table:', '').trim();
    const parsed = parseTable(raw);
    if (parsed) {
      return { kind: 'table', data: parsed };
    } else {
      return { kind: 'gap', data: { kind: 'table', reason: 'Malformed table line', raw_line: line } };
    }
  }

  return { kind: 'unknown', data: null };
}

function parseRoute(raw: string): NormalizedRoute | null {
  const methodMatch = raw.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s(]*)/);
  if (!methodMatch) {
    return null;
  }

  const method = methodMatch[1];
  const path = methodMatch[2];
  const handlerMatch = raw.match(/\(([^)]+)\)/);

  return {
    id: `route:${method}:${path}`,
    method,
    path,
    handler: handlerMatch ? handlerMatch[1] : undefined,
  };
}

function parseProcess(raw: string): NormalizedProcess | null {
  const name = raw.split('(')[0].trim();
  if (name.length === 0) {
    return null;
  }

  const entryMatch = raw.match(/\(([^)]+)\)/);

  return {
    id: `process:${name}`,
    name,
    entry_point: entryMatch ? entryMatch[1] : undefined,
  };
}

function parseTool(raw: string): NormalizedTool | null {
  const name = raw.split('(')[0].trim();
  if (name.length === 0) {
    return null;
  }

  const fileMatch = raw.match(/\(([^)]+)\)/);

  return {
    id: `tool:${name}`,
    name,
    file: fileMatch ? fileMatch[1] : undefined,
  };
}

function parseCommunity(raw: string): NormalizedCommunity | null {
  const name = raw.split('(')[0].trim();
  if (name.length === 0) {
    return null;
  }

  const membersMatch = raw.match(/\(([^)]+)\)/);

  return {
    id: `community:${name}`,
    name,
    members: membersMatch ? membersMatch[1].split(',').map(s => s.trim()) : undefined,
  };
}

function parseTable(raw: string): NormalizedTable | null {
  const name = raw.split('(')[0].trim();
  if (name.length === 0) {
    return null;
  }

  const schemaMatch = raw.match(/\(([^)]+)\)/);

  return {
    id: `table:${name}`,
    name,
    schema: schemaMatch ? schemaMatch[1] : undefined,
  };
}