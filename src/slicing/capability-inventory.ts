import {
  withReadOnlyLbug,
  type ReadOnlyQueryExecutor,
} from '../engine/lbug/read-only-session.js';
import { getStoragePaths } from '../engine/storage/repo-manager.js';
import type {
  EntrySignal,
  BehaviorSignal,
  TestSignal,
  DocSignal,
} from './capability-candidate-schema.js';
import { buildFunctionClusters, type FunctionCluster } from './function-clusterer.js';
import {
  buildCapabilityDomainCandidates,
  type CapabilityDomainCandidate,
} from './capability-domain-clusterer.js';
import {
  buildCapabilityDomainRefinePrompt,
  parseCapabilityDomainRefineResponse,
} from './capability-domain-refiner.js';
import {
  findBestMatchingDomain,
  loadDomainRegistry,
  type DomainRegistryEntry,
} from '../packaging/domain-registry.js';

export interface CapabilityInventoryItem {
  id: string;
  name: string;
  summary?: string;
  targetTerms: string[];
  targetPaths: string[];
  primaryObjects: string[];
  relatedEntities: string[];
  functionClusters: FunctionCluster[];
  coreFunctionIds: string[];
  supportingFunctionIds: string[];
}

type PromptProvider = (systemPrompt: string, userPrompt: string) => Promise<{
  rawText: string;
  model: string;
}>;

async function queryHttpEntryPoints(query: ReadOnlyQueryExecutor): Promise<EntrySignal[]> {
  const cypher = `
    MATCH (c:Class)-[:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
    WHERE c.name =~ '.*Controller$'
    RETURN c.name as className, m.name as methodName, c.filePath as filePath, m.startLine as startLine
    ORDER BY c.name, m.name
  `;

  const rows = await query(cypher);
  return rows.map((row) => ({
    kind: 'http' as const,
    location: String(row.filePath ?? ''),
    name: `${String(row.className ?? '')}.${String(row.methodName ?? '')}`,
    description: 'HTTP entry point',
    matchedTerms: normalizeTerms(`${String(row.className ?? '')} ${String(row.methodName ?? '')}`),
    targetRelevance: 0.8,
    role: 'controller',
    startLine: Number(row.startLine ?? undefined),
  }));
}

async function queryJobEntryPoints(query: ReadOnlyQueryExecutor): Promise<EntrySignal[]> {
  const cypher = `
    MATCH (c:Class)-[:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
    WHERE c.name =~ '.*(Job|Task|Scheduler)$'
    RETURN c.name as className, m.name as methodName, c.filePath as filePath, m.startLine as startLine
    ORDER BY c.name, m.name
  `;

  const rows = await query(cypher);
  return rows.map((row) => ({
    kind: 'job' as const,
    location: String(row.filePath ?? ''),
    name: `${String(row.className ?? '')}.${String(row.methodName ?? '')}`,
    description: 'Scheduled job entry point',
    matchedTerms: normalizeTerms(`${String(row.className ?? '')} ${String(row.methodName ?? '')}`),
    targetRelevance: 0.65,
    role: 'job',
    startLine: Number(row.startLine ?? undefined),
  }));
}

async function queryServiceBehaviors(query: ReadOnlyQueryExecutor): Promise<BehaviorSignal[]> {
  const cypher = `
    MATCH (c:Class)-[:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
    WHERE c.name =~ '.*Service$'
    RETURN c.name as className, m.name as methodName, c.filePath as filePath, m.startLine as startLine
    LIMIT 400
  `;

  const rows = await query(cypher);
  return rows.map((row) => {
    const className = String(row.className ?? '');
    const methodName = String(row.methodName ?? '');
    const words = normalizeTerms(methodName);
    return {
      location: String(row.filePath ?? ''),
      verb: words[0] ?? methodName,
      object: words.slice(1).join(' ') || className.replace(/Service$/, ''),
      context: `${className}.${methodName}`,
      targetRelevance: 0.7,
      matchedTerms: normalizeTerms(`${className} ${methodName}`),
      role: 'service',
      startLine: Number(row.startLine ?? undefined),
    };
  });
}

async function queryTestSignals(query: ReadOnlyQueryExecutor): Promise<TestSignal[]> {
  const cypher = `
    MATCH (m:Method)
    WHERE m.filePath =~ '.*(test|spec).*'
    RETURN m.name as methodName, m.filePath as filePath, m.startLine as startLine
    LIMIT 300
  `;

  const rows = await query(cypher);
  return rows.map((row) => ({
    location: String(row.filePath ?? ''),
    testName: String(row.methodName ?? ''),
    targetRelevance: 0.55,
    matchedTerms: normalizeTerms(String(row.methodName ?? '')),
    role: 'test',
    startLine: Number(row.startLine ?? undefined),
  }));
}

async function queryDocSignals(query: ReadOnlyQueryExecutor): Promise<DocSignal[]> {
  const cypher = `
    MATCH (f:File)
    WHERE f.filePath =~ '.*(README|readme|docs|design).*'
    RETURN f.filePath as filePath
    LIMIT 120
  `;

  const rows = await query(cypher);
  return rows.map((row) => {
    const location = String(row.filePath ?? '');
    return {
      location,
      kind: 'docs' as const,
      terms: normalizeTerms(location),
      constraints: [],
      targetRelevance: 0.35,
      matchedTerms: normalizeTerms(location),
    };
  });
}

function normalizeTerms(input: string): string[] {
  return input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_/().]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .map(term => term.trim())
    .filter(term => term.length > 1)
    .filter(term => ![
      'abstract',
      'api',
      'callback',
      'cloud',
      'config',
      'controller',
      'execute',
      'ffmpeg',
      'file',
      'health',
      'internal',
      'job',
      'li',
      'scheduler',
      'service',
      'spec',
      'task',
      'test',
      'upload',
      'wx',
    ].includes(term));
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function deriveRelatedEntities(functionClusters: FunctionCluster[]): string[] {
  return dedupe(functionClusters.flatMap(cluster => cluster.domainTerms)).slice(0, 8);
}

function normalizeInventoryItem(candidate: CapabilityDomainCandidate): CapabilityInventoryItem {
  return {
    id: candidate.id,
    name: candidate.nameHint,
    summary: candidate.summary,
    targetTerms: candidate.targetTerms,
    targetPaths: candidate.targetPaths,
    primaryObjects: candidate.primaryObjects,
    relatedEntities: candidate.relatedEntities,
    functionClusters: candidate.functionClusters,
    coreFunctionIds: candidate.coreFunctionIds,
    supportingFunctionIds: candidate.supportingFunctionIds,
  };
}

function applyMatchedDomain(
  item: CapabilityInventoryItem,
  matched?: DomainRegistryEntry,
): CapabilityInventoryItem {
  if (!matched) return item;
  return {
    ...item,
    id: matched.domainKey,
    name: matched.domainName,
  };
}

function applyRefinedDomains(
  candidates: CapabilityDomainCandidate[],
  refined: ReturnType<typeof parseCapabilityDomainRefineResponse>,
): CapabilityInventoryItem[] {
  const clusterById = new Map<string, FunctionCluster>();
  for (const candidate of candidates) {
    for (const cluster of candidate.functionClusters) {
      clusterById.set(cluster.clusterId, cluster);
    }
  }

  return refined
    .map(domain => {
      const functionClusters = domain.includedFunctionIds
        .map(id => clusterById.get(id))
        .filter((cluster): cluster is FunctionCluster => Boolean(cluster));

      if (functionClusters.length === 0) return undefined;

      const targetPaths = dedupe(functionClusters.flatMap(cluster => cluster.signals.map(signal => signal.location))).slice(0, 12);
      const targetTerms = dedupe([
        ...domain.targetTerms,
        ...functionClusters.flatMap(cluster => [cluster.normalizedObject, ...cluster.domainTerms]),
      ]).slice(0, 12);

      return {
        id: domain.id,
        name: domain.name,
        summary: domain.summary,
        targetTerms,
        targetPaths,
        primaryObjects: dedupe(functionClusters.map(cluster => cluster.normalizedObject)).slice(0, 6),
        relatedEntities: deriveRelatedEntities(functionClusters),
        functionClusters,
        coreFunctionIds: domain.coreFunctionIds.filter(id => clusterById.has(id)),
        supportingFunctionIds: domain.supportingFunctionIds.filter(id => clusterById.has(id)),
      } satisfies CapabilityInventoryItem;
    })
    .filter((item): item is CapabilityInventoryItem => Boolean(item));
}

export async function discoverProjectCapabilities(
  repoRoot: string,
  promptProvider?: PromptProvider,
): Promise<CapabilityInventoryItem[]> {
  const { lbugPath } = getStoragePaths(repoRoot);

  return withReadOnlyLbug(lbugPath, async query => {
    const countRows = await query(`MATCH (c:Class) RETURN count(c) AS cnt`);
    const classCount = Number(countRows[0]?.cnt ?? 0);
    if (classCount === 0) {
      return [];
    }

    const [httpEntries, jobEntries, behaviorSignals, testSignals, docSignals] = await Promise.all([
      queryHttpEntryPoints(query),
      queryJobEntryPoints(query),
      queryServiceBehaviors(query),
      queryTestSignals(query),
      queryDocSignals(query),
    ]);

    const functionClusters = buildFunctionClusters({
      entrySignals: [...httpEntries, ...jobEntries],
      behaviorSignals,
      testSignals,
      docSignals,
    });

    if (functionClusters.length === 0) {
      return [];
    }

    const candidates = buildCapabilityDomainCandidates(functionClusters);
    if (candidates.length === 0) {
      return [];
    }

    let registryDomains: DomainRegistryEntry[] = [];
    try {
      const registry = await loadDomainRegistry(repoRoot);
      registryDomains = registry.domains;
    } catch {
      // ignore registry lookup failures and fall back to fresh grouping
    }

    if (!promptProvider) {
      return candidates.map(candidate =>
        applyMatchedDomain(
          normalizeInventoryItem(candidate),
          findBestMatchingDomain({ updatedAt: '', domains: registryDomains }, candidate),
        ),
      );
    }

    try {
      const { systemPrompt, userPrompt } = buildCapabilityDomainRefinePrompt(candidates);
      const result = await promptProvider(systemPrompt, userPrompt);
      const refined = parseCapabilityDomainRefineResponse(result.rawText);
      const applied = applyRefinedDomains(candidates, refined);
      const normalized = applied.length > 0 ? applied : candidates.map(normalizeInventoryItem);
      return normalized.map(item =>
        applyMatchedDomain(
          item,
          findBestMatchingDomain(
            { updatedAt: '', domains: registryDomains },
            {
              domainKey: item.id,
              domainName: item.name,
              targetTerms: item.targetTerms,
              primaryObjects: item.primaryObjects,
              relatedEntities: item.relatedEntities,
            },
          ),
        ),
      );
    } catch {
      return candidates.map(candidate =>
        applyMatchedDomain(
          normalizeInventoryItem(candidate),
          findBestMatchingDomain({ updatedAt: '', domains: registryDomains }, candidate),
        ),
      );
    }
  });
}

export async function buildCapabilityInventory(
  repoRoot: string,
  promptProvider?: PromptProvider,
): Promise<CapabilityInventoryItem[]> {
  return discoverProjectCapabilities(repoRoot, promptProvider);
}
