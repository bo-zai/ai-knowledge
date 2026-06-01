import fs from 'fs/promises';
import path from 'path';
import lbug from '@ladybugdb/core';
import type { Connection } from '@ladybugdb/core';
import type { CapabilityCandidate, EntrySignal, BehaviorSignal, DataSignal, TestSignal, DocSignal, ModuleCluster } from './capability-candidate-schema.js';
import { openLbugConnection, closeLbugConnection } from '../engine/lbug/lbug-config.js';
import { getStoragePaths } from '../engine/storage/repo-manager.js';

/**
 * Execute a Cypher query on a single connection and return rows.
 * Uses read-only mode to avoid lock conflicts and FTS extension loading.
 */
async function executeQuery(conn: Connection, cypher: string): Promise<Record<string, unknown>[]> {
  const queryResult = await conn.query(cypher);
  const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
  const rows = await result.getAll();
  return rows as Record<string, unknown>[];
}

const DOMAIN_PHRASES = [
  'db object',
  'knowledge object',
  'description source',
  'mybatis mapper',
  'sql evidence',
  'field description',
  'bootstrap knowledge',
  'evidence bundle',
  'capability candidate',
  'knowledge generation',
];

const DISCOVERY_FILE_EXTENSIONS = new Set([
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
  '.java',
  '.xml',
  '.yml',
  '.yaml',
  '.properties',
  '.md',
  '.txt',
]);

const IGNORED_DISCOVERY_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  'build',
  'dist',
  '.idea',
  '.mvn',
  'logs',
]);

const CROSS_CUTTING_TERMS = [
  'aop',
  'aspect',
  'config',
  'interceptor',
  'filter',
  'util',
  'utils',
  'common',
  'job',
  'listener',
  'event',
  'bootstrap',
  'security',
  'auth',
  'logging',
  'log',
  'ratelimit',
  'rate-limit',
];

const BUSINESS_ROLE_TERMS = [
  'controller',
  'service',
  'mapper',
  'repository',
  'dao',
  'xml',
  'request',
  'response',
  'vo',
  'dto',
  'entity',
];

const TECHNICAL_CONTEXT_TERMS = new Set([
  'mybatis',
  'mapper',
  'xml',
  'sql',
  'db',
  'database',
  'table',
  'schema',
  'knowledge',
  'evidence',
  'capability',
  'bootstrap',
]);

function classifyTargetTerms(targetTerms: string[]): {
  businessTerms: string[];
  technicalTerms: string[];
  normalizedTerms: string[];
} {
  const normalizedTerms = normalizeTargetTerms(targetTerms);
  const businessTerms = normalizedTerms.filter(term => !TECHNICAL_CONTEXT_TERMS.has(term));
  const technicalTerms = normalizedTerms.filter(term => TECHNICAL_CONTEXT_TERMS.has(term));
  return { businessTerms, technicalTerms, normalizedTerms };
}

function titleCaseTerm(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

type RankedSignal = {
  targetRelevance?: number;
  matchedTerms?: string[];
  name?: string;
  location?: string;
};

function collectBusinessTermScores(signals: RankedSignal[], businessTerms: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  const businessSet = new Set(businessTerms);

  for (const signal of signals) {
    const relevance = signal.targetRelevance ?? 0;
    for (const term of signal.matchedTerms ?? []) {
      if (!businessSet.has(term)) continue;
      scores.set(term, (scores.get(term) ?? 0) + Math.max(0.1, relevance));
    }
  }

  return scores;
}

function deriveBusinessCapabilityName(input: {
  businessTerms: string[];
  entrySignals: RankedSignal[];
  behaviorSignals: RankedSignal[];
  dataSignals: RankedSignal[];
  moduleSignals: RankedSignal[];
}): string {
  const scores = collectBusinessTermScores(
    [
      ...input.entrySignals,
      ...input.behaviorSignals,
      ...input.dataSignals,
      ...input.moduleSignals,
    ],
    input.businessTerms,
  );

  const rankedTerms = [...input.businessTerms].sort((left, right) => {
    const diff = (scores.get(right) ?? 0) - (scores.get(left) ?? 0);
    if (diff !== 0) return diff;
    return left.localeCompare(right);
  });

  const selectedTerms = rankedTerms
    .filter(term => (scores.get(term) ?? 0) > 0)
    .slice(0, 3);

  const termsForName = selectedTerms.length > 0 ? selectedTerms : input.businessTerms.slice(0, 3);
  if (termsForName.length === 0) {
    return 'Repository capability';
  }

  return `${termsForName.map(titleCaseTerm).join(' ')} capability`;
}

function normalizePathForMatch(input: string): string {
  return input.replace(/\\/g, '/').toLowerCase();
}

export type DiscoverCapabilitiesInput = {
  repoRoot: string;
  targetTerms?: string[];
  targetPaths?: string[];
};

export function normalizeCapabilityTerms(input: string): string[] {
  let normalized = input;
  // 先处理 domain phrases
  const foundPhrases: string[] = [];
  for (const phrase of DOMAIN_PHRASES) {
    const regex = new RegExp(phrase, 'gi');
    if (regex.test(normalized)) {
      foundPhrases.push(phrase);
      normalized = normalized.replace(regex, ' ');
    }
  }

  // 拆分 camelCase 和 PascalCase
  normalized = normalized.replace(/([a-z])([A-Z])/g, '$1 $2');
  normalized = normalized.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // 拆分 kebab-case 和 snake_case
  normalized = normalized.replace(/[-_]/g, ' ');

  // 分词并转小写
  const words = normalized
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 0);

  // 合并去重
  const allTerms = [...new Set([...foundPhrases, ...words])];
  return allTerms;
}

function normalizeTargetTerms(targetTerms: string[]): string[] {
  return [...new Set(targetTerms.flatMap(normalizeCapabilityTerms).map(term => term.toLowerCase()))];
}

function textForRelevance(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ').replace(/\\/g, '/').toLowerCase();
}

function computeTargetRelevance(parts: Array<string | undefined>, targetTerms: string[]): {
  score: number;
  matchedTerms: string[];
} {
  const text = textForRelevance(parts);
  const normalizedTargets = normalizeTargetTerms(targetTerms);
  const matchedTerms = normalizedTargets.filter(term => text.includes(term));
  const base = normalizedTargets.length === 0 ? 0 : matchedTerms.length / normalizedTargets.length;
  const roleBoost = BUSINESS_ROLE_TERMS.some(term => text.includes(term)) ? 0.25 : 0;
  const crossCutPenalty = CROSS_CUTTING_TERMS.some(term => text.includes(term)) ? 0.45 : 0;
  const score = Math.max(0, Math.min(1, base + roleBoost - crossCutPenalty));
  return { score, matchedTerms };
}

function byRelevanceDesc<T extends { targetRelevance?: number; location?: string }>(left: T, right: T): number {
  const scoreDiff = (right.targetRelevance ?? 0) - (left.targetRelevance ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  return (left.location ?? '').localeCompare(right.location ?? '');
}

function extractJavaFieldNames(content: string): string[] {
  const fields: string[] = [];
  const fieldRegex = /\b(private|protected|public)\s+[\w<>\[\], ?]+\s+(\w+)\s*;/g;
  let fieldMatch: RegExpExecArray | null;
  while ((fieldMatch = fieldRegex.exec(content)) !== null) {
    const fieldName = fieldMatch[2];
    if (fieldName) fields.push(fieldName);
  }
  return [...new Set(fields)];
}

async function scanDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DISCOVERY_DIRS.has(entry.name)) {
          files.push(...await scanDirectory(fullPath));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (DISCOVERY_FILE_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // 目录不存在或无法访问
  }
  return files;
}

function extractJavaEntrySignals(content: string, location: string, targetTerms: string[]): EntrySignal[] {
  const signals: EntrySignal[] = [];
  const classNameMatch = content.match(/\bclass\s+(\w+)/);
  const interfaceNameMatch = content.match(/\binterface\s+(\w+)/);
  const className = classNameMatch?.[1] ?? interfaceNameMatch?.[1] ?? path.basename(location, '.java');

  const hasController = /@(RestController|Controller)\b/.test(content);
  const hasService = /@Service\b/.test(content);
  const hasComponent = /@Component\b/.test(content);
  const hasScheduled = /@Scheduled\b/.test(content);

  const routeMatches = [...content.matchAll(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(([^)]*)\))?/g)];

  const routeSignature = routeMatches.map(match => match[0]).join(' ');

  const relevance = computeTargetRelevance([location, className, routeSignature], targetTerms);

  // Find the line number of the class definition for startLine
  const classLineMatch = content.match(/^.*\b(?:public\s+)?(?:abstract\s+)?(?:class|interface)\s+/m);
  const startLine = classLineMatch ? content.slice(0, classLineMatch.index ?? 0).split('\n').length + 1 : undefined;

  if (hasController || routeMatches.length > 0) {
    signals.push({
      kind: 'http',
      location,
      name: className,
      signature: routeSignature,
      description: 'Spring controller or route entry',
      targetRelevance: relevance.score,
      matchedTerms: relevance.matchedTerms,
      role: 'controller',
      startLine,
    });
  } else if (hasScheduled) {
    signals.push({
      kind: 'job',
      location,
      name: className,
      description: 'Scheduled job entry',
      targetRelevance: relevance.score,
      matchedTerms: relevance.matchedTerms,
      role: 'job',
    });
  } else if (hasService) {
    signals.push({
      kind: 'service',
      location,
      name: className,
      description: 'Spring service entry',
      targetRelevance: relevance.score,
      matchedTerms: relevance.matchedTerms,
      role: 'service',
    });
  } else if (hasComponent) {
    signals.push({
      kind: 'handler',
      location,
      name: className,
      description: 'Spring component entry',
      targetRelevance: relevance.score,
      matchedTerms: relevance.matchedTerms,
      role: 'handler',
    });
  }

  return signals;
}

/**
 * Use graph (Cypher) to find callers of discovered services.
 * Queries CALLS edges from controller/service methods to the target service.
 */
async function collectCallerSignals(
  conn: Connection,
  serviceSignals: EntrySignal[],
  _targetPaths: string[],
  repoRoot: string,
  targetTerms: string[],
): Promise<EntrySignal[]> {
  if (serviceSignals.length === 0) return [];

  const serviceNames = [...new Set(serviceSignals.map(s => s.name).filter(Boolean))];
  if (serviceNames.length === 0) return [];

  const callerSignals: EntrySignal[] = [];
  const seen = new Set<string>();

  // Use graph to find callers via CALLS edges
  for (const serviceName of serviceNames) {
    // Cypher: find all methods that CALL methods of the target service class
    // LadybugDB uses CodeRelation table with type property for ALL edges
    const escapedName = escapeCypherString(serviceName);
    const cypher = `
      MATCH (serviceClass:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(target:Method)
      WHERE serviceClass.name = '${escapedName}'
      MATCH (caller:Method)-[r:CodeRelation {type: 'CALLS'}]->(target)
      MATCH (callerClass:Class)-[hm2:CodeRelation {type: 'HAS_METHOD'}]->(caller)
      RETURN DISTINCT callerClass.name AS className, callerClass.filePath AS filePath, caller.name AS methodName, caller.startLine AS startLine
      LIMIT 50
    `;

    try {
      const rows = await executeQuery(conn, cypher);
      for (const row of (rows || [])) {
        const className = row.className as string;
        const filePath = row.filePath as string;
        const methodName = row.methodName as string;
        const startLine = Number((row as Record<string, unknown>).startLine ?? undefined);

        if (!filePath || !className) continue;

        const relative = path.relative(repoRoot, filePath).replace(/\\/g, '/');
        if (!relative.endsWith('.java')) continue;

        const key = `${relative}:${className}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const normalizedPath = relative.toLowerCase();
        const hasController = normalizedPath.includes('/controller');
        const hasService = normalizedPath.includes('/service');

        let kind: EntrySignal['kind'] = 'handler';
        let role: string | undefined;
        if (hasController) { kind = 'http'; role = 'controller'; }
        else if (hasService) { kind = 'service'; role = 'service'; }

        const relevance = computeTargetRelevance([relative, className, serviceName, methodName], targetTerms);
        const boostedRelevance = Math.min(1, relevance.score + 0.3);

        callerSignals.push({
          kind,
          location: relative,
          name: className,
          signature: methodName,
          description: `Caller of ${serviceName} (caller tracing via graph)`,
          targetRelevance: boostedRelevance,
          matchedTerms: [...new Set([...relevance.matchedTerms, serviceName])],
          role,
          startLine: isNaN(startLine) ? undefined : startLine,
        });
      }
    } catch {
      // Graph query failed; fall back to no caller signals for this service
    }
  }

  return callerSignals;
}

async function collectEntrySignals(targetPaths: string[], repoRoot: string, targetTerms: string[]): Promise<EntrySignal[]> {
  const signals: EntrySignal[] = [];
  for (const targetPath of targetPaths) {
    const fullPath = path.resolve(repoRoot, targetPath);
    const files = await scanDirectory(fullPath);
    for (const file of files) {
      const relative = path.relative(repoRoot, file);
      const content = await fs.readFile(file, 'utf-8').catch(() => '');
      if (file.endsWith('.java')) {
        signals.push(...extractJavaEntrySignals(content, relative, targetTerms));
      }
    }
  }
  return signals;
}

function computeConfidence(
  entrySignal: number,
  behaviorSignal: number,
  dataSignal: number,
  testSignal: number,
  docSignal: number,
  graphCohesion: number,
): number {
  return (
    entrySignal * 0.25 +
    behaviorSignal * 0.20 +
    dataSignal * 0.20 +
    testSignal * 0.15 +
    docSignal * 0.05 +
    graphCohesion * 0.15
  );
}

function deriveModuleRoot(relativeFile: string): string {
  const normalized = relativeFile.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const roleIndex = parts.findIndex(part =>
    ['controller', 'service', 'mapper', 'repository', 'dao', 'resources', 'test', 'entity', 'dto', 'vo', 'request', 'response'].includes(part.toLowerCase())
  );
  if (roleIndex >= 0) {
    return parts.slice(0, roleIndex + 1).join('/');
  }
  return parts.slice(0, Math.min(parts.length - 1, 4)).join('/');
}

async function analyzeModuleClusters(targetPaths: string[], repoRoot: string, targetTerms: string[]): Promise<ModuleCluster[]> {
  const clusterMap: Map<string, { files: string[]; moduleNames: string[] }> = new Map();

  for (const targetPath of targetPaths) {
    const fullPath = path.resolve(repoRoot, targetPath);
    const files = await scanDirectory(fullPath);
    for (const file of files) {
      const relative = path.relative(repoRoot, file);
      const root = deriveModuleRoot(relative);
      if (!clusterMap.has(root)) {
        clusterMap.set(root, { files: [], moduleNames: [] });
      }
      const entry = clusterMap.get(root)!;
      entry.files.push(relative);
      entry.moduleNames.push(path.basename(file, path.extname(file)));
    }
  }

  const clusters: ModuleCluster[] = [];
  for (const [rootPath, data] of clusterMap.entries()) {
    const role = rootPath.split('/').pop()?.toLowerCase() ?? undefined;
    const relevance = computeTargetRelevance([rootPath, ...data.moduleNames], targetTerms);
    clusters.push({
      rootPath,
      moduleNames: [...new Set(data.moduleNames)],
      cohesionScore: 0.75,
      targetRelevance: relevance.score,
      matchedTerms: relevance.matchedTerms,
      role,
    });
  }

  // Limit to top 8 clusters after relevance sort
  clusters.sort(byRelevanceDesc);
  return clusters.slice(0, 8);
}

async function collectBehaviorSignals(targetPaths: string[], repoRoot: string, targetTerms: string[]): Promise<BehaviorSignal[]> {
  const signals: BehaviorSignal[] = [];
  for (const targetPath of targetPaths) {
    const fullPath = path.resolve(repoRoot, targetPath);
    const files = await scanDirectory(fullPath);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8').catch(() => '');
      const relative = path.relative(repoRoot, file);

      if (file.endsWith('.java')) {
        // Determine role from file path (normalize for Windows backslash)
        const normalizedRelative = normalizePathForMatch(relative);
        const role = normalizedRelative.includes('/controller/') ? 'controller' :
                     normalizedRelative.includes('/service/') ? 'service' :
                     normalizedRelative.includes('/mapper/') ? 'mapper' : undefined;

        // Java method regex
        const javaMethodRegex = /\b(public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?[\w<>\[\], ?]+\s+(\w+)\s*\([^)]*\)\s*\{/g;
        let methodMatch: RegExpExecArray | null;
        while ((methodMatch = javaMethodRegex.exec(content)) !== null) {
          const name = methodMatch[2];
          if (name) {
            const terms = normalizeCapabilityTerms(name);
            const relevance = computeTargetRelevance([relative, name], targetTerms);
            const startLine = content.slice(0, methodMatch.index ?? 0).split('\n').length + 1;
            signals.push({
              location: relative,
              verb: terms[0] || name,
              object: terms.slice(1).join(' ') || name,
              targetRelevance: relevance.score,
              matchedTerms: relevance.matchedTerms,
              role,
              startLine,
            });
          }
        }
      } else {
        // TypeScript/JavaScript function regex
        const lines = content.split('\n');
        for (const line of lines) {
          const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
          if (funcMatch) {
            const name = funcMatch[1];
            const terms = normalizeCapabilityTerms(name);
            const relevance = computeTargetRelevance([relative, name], targetTerms);
            signals.push({
              location: relative,
              verb: terms[0] || name,
              object: terms.slice(1).join(' ') || name,
              targetRelevance: relevance.score,
              matchedTerms: relevance.matchedTerms,
            });
          }
        }
      }
    }
  }
  return signals;
}

async function collectDataSignals(targetPaths: string[], repoRoot: string, targetTerms: string[]): Promise<DataSignal[]> {
  const signals: DataSignal[] = [];
  for (const targetPath of targetPaths) {
    const fullPath = path.resolve(repoRoot, targetPath);
    const files = await scanDirectory(fullPath);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8').catch(() => '');
      const relative = path.relative(repoRoot, file);

      if (file.endsWith('.java')) {
        // Determine role from file path (normalize for Windows backslash)
        const normalizedRelative = normalizePathForMatch(relative);
        const role = normalizedRelative.includes('/controller/') ? 'controller' :
                     normalizedRelative.includes('/service/') ? 'service' :
                     normalizedRelative.includes('/mapper/') ? 'mapper' :
                     normalizedRelative.includes('/entity/') ? 'entity' :
                     normalizedRelative.includes('/dto/') ||
                     normalizedRelative.includes('/vo/') ||
                     normalizedRelative.includes('/request/') ||
                     normalizedRelative.includes('/response/') ? 'dto' : undefined;

        // Java class/interface/enum
        const typeMatch = content.match(/\b(class|interface|enum)\s+(\w+)/);
        if (typeMatch) {
          const relevance = computeTargetRelevance([relative, typeMatch[2]], targetTerms);
          const startLine = content.slice(0, typeMatch.index ?? 0).split('\n').length + 1;
          signals.push({
            kind: 'type',
            location: relative,
            name: typeMatch[2],
            fields: extractJavaFieldNames(content),
            targetRelevance: relevance.score,
            matchedTerms: relevance.matchedTerms,
            role,
            startLine,
          });
        }

        // Java field names
        const fieldRegex = /\b(private|protected|public)\s+[\w<>\[\], ?]+\s+(\w+)\s*;/g;
        let fieldMatch: RegExpExecArray | null;
        while ((fieldMatch = fieldRegex.exec(content)) !== null) {
          const fieldName = fieldMatch[2];
          if (fieldName) {
            const relevance = computeTargetRelevance([relative, fieldName], targetTerms);
            signals.push({
              kind: 'field',
              location: relative,
              name: fieldName,
              targetRelevance: relevance.score,
              matchedTerms: relevance.matchedTerms,
              role,
            });
          }
        }
      } else if (file.endsWith('.xml') && content.includes('<mapper')) {
        // MyBatis mapper XML
        const namespaceMatch = content.match(/<mapper\s+[^>]*namespace=["']([^"']+)["']/);
        const namespace = namespaceMatch?.[1];

        const statementRegex = /<(select|insert|update|delete)\s+[^>]*id=["']([^"']+)["'][^>]*>/g;
        let statementMatch: RegExpExecArray | null;
        while ((statementMatch = statementRegex.exec(content)) !== null) {
          const statementId = statementMatch[2];
          if (statementId) {
            const statementName = `${namespace ?? 'mapper'}.${statementId}`;
            const tableNames = extractSimpleSqlTableNames(content);
            const relevance = computeTargetRelevance([relative, statementName, ...tableNames], targetTerms);
            signals.push({
              kind: 'sql',
              location: relative,
              name: statementName,
              fields: tableNames,
              targetRelevance: relevance.score,
              matchedTerms: relevance.matchedTerms,
              role: 'mapper',
            });
          }
        }
      } else {
        // TypeScript/JavaScript type regex
        const lines = content.split('\n');
        for (const line of lines) {
          const typeMatch = line.match(/(?:export\s+)?(?:interface|type)\s+(\w+)/);
          if (typeMatch) {
            const relevance = computeTargetRelevance([relative, typeMatch[1]], targetTerms);
            signals.push({
              kind: 'type',
              location: relative,
              name: typeMatch[1],
              targetRelevance: relevance.score,
              matchedTerms: relevance.matchedTerms,
            });
          }
        }
      }
    }
  }
  return signals;
}

function extractSimpleSqlTableNames(content: string): string[] {
  const tables: string[] = [];
  // Match table names after FROM, JOIN, INSERT INTO, UPDATE
  const fromMatch = content.match(/from\s+(\w+)/i);
  const joinMatch = content.match(/join\s+(\w+)/i);
  const insertMatch = content.match(/insert\s+into\s+(\w+)/i);
  const updateMatch = content.match(/update\s+(\w+)/i);

  if (fromMatch?.[1]) tables.push(fromMatch[1]);
  if (joinMatch?.[1]) tables.push(joinMatch[1]);
  if (insertMatch?.[1]) tables.push(insertMatch[1]);
  if (updateMatch?.[1]) tables.push(updateMatch[1]);

  return [...new Set(tables)];
}

async function collectTestSignals(repoRoot: string, targetPaths: string[], targetTerms: string[]): Promise<TestSignal[]> {
  const signals: TestSignal[] = [];

  // Check for Java test directories
  for (const targetPath of targetPaths) {
    if (targetPath.includes('test')) {
      const fullPath = path.resolve(repoRoot, targetPath);
      const files = await scanDirectory(fullPath);
      for (const file of files) {
        if (file.endsWith('.java')) {
          const content = await fs.readFile(file, 'utf-8').catch(() => '');
          const relative = path.relative(repoRoot, file);

          // Find @Test methods
          const testMethodRegex = /@Test[\s\S]*?\bvoid\s+(\w+)\s*\(/g;
          let methodMatch: RegExpExecArray | null;
          while ((methodMatch = testMethodRegex.exec(content)) !== null) {
            const methodName = methodMatch[1];
            if (methodName) {
              const relevance = computeTargetRelevance([relative, methodName], targetTerms);
              signals.push({
                location: relative,
                testName: methodName,
                targetRelevance: relevance.score,
                matchedTerms: relevance.matchedTerms,
                role: 'test',
              });
            }
          }

          // Also detect test class naming pattern
          const classMatch = content.match(/\bclass\s+(\w*Test\w*)\b/);
          if (classMatch?.[1]) {
            const relevance = computeTargetRelevance([relative, classMatch[1]], targetTerms);
            signals.push({
              location: relative,
              testName: classMatch[1],
              targetRelevance: relevance.score,
              matchedTerms: relevance.matchedTerms,
              role: 'test',
            });
          }
        }
      }
    }
  }

  // Check for TypeScript/JavaScript test directories
  const testDirs = ['tests', 'test'];
  for (const testDir of testDirs) {
    const files = await scanDirectory(path.join(repoRoot, testDir));
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8').catch(() => '');
      const relative = path.relative(repoRoot, file);
      const lines = content.split('\n');
      for (const line of lines) {
        const testMatch = line.match(/(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)/);
        if (testMatch) {
          const relevance = computeTargetRelevance([relative, testMatch[1]], targetTerms);
          signals.push({
            location: relative,
            testName: testMatch[1],
            targetRelevance: relevance.score,
            matchedTerms: relevance.matchedTerms,
            role: 'test',
          });
        }
      }
    }
  }
  return signals;
}

export async function discoverCapabilities(input: DiscoverCapabilitiesInput): Promise<CapabilityCandidate[]> {
  const { repoRoot, targetTerms = [], targetPaths = [] } = input;

  console.log(`[DEBUG] discoverCapabilities: starting, terms=${targetTerms.length}, paths=${targetPaths.length}`);

  if (targetTerms.length === 0 && targetPaths.length === 0) {
    return [];
  }

  // Try graph-based discovery first (uses LadybugDB at .knowledge/lbug)
  // Use single read-only connection to avoid FTS extension loading and lock conflicts
  const { lbugPath } = getStoragePaths(repoRoot);
  console.log(`[DEBUG] discoverCapabilities: lbugPath=${lbugPath}`);
  try {
    console.log(`[DEBUG] discoverCapabilities: opening connection`);
    const handle = await openLbugConnection(lbug, lbugPath, { readOnly: true });
    console.log(`[DEBUG] discoverCapabilities: connection opened`);

    // Check if the graph actually has data (empty DB means no knowledge has been analyzed)
    const classCountRows = await executeQuery(handle.conn, `MATCH (c:Class) RETURN count(c) AS cnt`);
    const classCount = Number(classCountRows[0]?.cnt ?? 0);
    console.log(`[DEBUG] discoverCapabilities: classCount=${classCount}`);
    if (classCount === 0) {
      await closeLbugConnection(handle);
      return discoverCapabilitiesFromFilesystem(input);
    }

    console.log(`[DEBUG] discoverCapabilities: calling discoverCapabilitiesFromGraph`);
    const result = await discoverCapabilitiesFromGraph(handle.conn, input);
    console.log(`[DEBUG] discoverCapabilities: discoverCapabilitiesFromGraph returned ${result.length} candidates`);
    await closeLbugConnection(handle);
    console.log(`[DEBUG] discoverCapabilities: connection closed`);
    return result;
  } catch (err) {
    console.log(`[DEBUG] discoverCapabilities: caught error ${err}`);
    // Fall back to file-system scanning if graph is not available
    return discoverCapabilitiesFromFilesystem(input);
  }
}

// ============================================================================
// Filesystem-based capability discovery (fallback when graph is unavailable)
// ============================================================================

async function discoverCapabilitiesFromFilesystem(input: DiscoverCapabilitiesInput): Promise<CapabilityCandidate[]> {
  const { repoRoot, targetTerms = [], targetPaths = [] } = input;

  if (targetTerms.length === 0 && targetPaths.length === 0) {
    return [];
  }

  const candidates: CapabilityCandidate[] = [];

  const primaryEntryPoints = await collectEntrySignals(targetPaths, repoRoot, targetTerms);
  const behaviorAnchors = await collectBehaviorSignals(targetPaths, repoRoot, targetTerms);
  const dataAnchors = await collectDataSignals(targetPaths, repoRoot, targetTerms);
  const testAnchors = await collectTestSignals(repoRoot, targetPaths, targetTerms);
  const moduleClusters = await analyzeModuleClusters(targetPaths, repoRoot, targetTerms);

  primaryEntryPoints.sort(byRelevanceDesc);
  behaviorAnchors.sort(byRelevanceDesc);
  dataAnchors.sort(byRelevanceDesc);
  testAnchors.sort(byRelevanceDesc);
  moduleClusters.sort(byRelevanceDesc);

  const entrySignal = primaryEntryPoints.length > 0 ? 0.9 : targetPaths.length > 0 ? 0.55 : 0.2;
  const behaviorSignal = behaviorAnchors.length > 5 ? 0.85 : behaviorAnchors.length > 0 ? 0.6 : 0.3;
  const dataSignal = dataAnchors.length > 3 ? 0.9 : dataAnchors.length > 0 ? 0.6 : 0.3;
  const testSignal = testAnchors.length > 5 ? 0.75 : testAnchors.length > 0 ? 0.5 : 0.2;
  const docSignal = 0.4;
  const graphCohesion = moduleClusters.length > 1 ? 0.75 : 0.5;

  const confidence = computeConfidence(entrySignal, behaviorSignal, dataSignal, testSignal, docSignal, graphCohesion);

  const { businessTerms, technicalTerms } = classifyTargetTerms(targetTerms);
  const nameCandidates: string[] = [];
  const relatedTerms: string[] = [...targetTerms];

  for (const term of targetTerms) {
    const normalized = normalizeCapabilityTerms(term);
    relatedTerms.push(...normalized);
  }

  const businessCapabilityName = deriveBusinessCapabilityName({
    businessTerms,
    entrySignals: primaryEntryPoints,
    behaviorSignals: behaviorAnchors,
    dataSignals: dataAnchors,
    moduleSignals: moduleClusters.map(cluster => ({
      targetRelevance: cluster.targetRelevance,
      matchedTerms: cluster.matchedTerms,
      name: cluster.rootPath,
      location: cluster.rootPath,
    })),
  });

  nameCandidates.push(businessCapabilityName);

  if (technicalTerms.includes('mybatis') && !relatedTerms.includes('mybatis mapper')) {
    relatedTerms.push('mybatis mapper');
  }

  const candidate: CapabilityCandidate = {
    candidateId: `CAND-${targetTerms.map(t => t.toUpperCase()).join('-')}`,
    nameCandidates,
    confidence,
    confidenceBreakdown: {
      entrySignal,
      behaviorSignal,
      dataSignal,
      testSignal,
      docSignal,
      graphCohesion,
    },
    primaryEntryPoints,
    behaviorAnchors,
    dataAnchors,
    testAnchors,
    docAnchors: [],
    moduleClusters,
    relatedTerms: [...new Set(relatedTerms)],
    risks: ['no_external_boundary_found'],
    missingSignals: ['No explicit external DB ownership contract found'],
  };

  if (candidate.confidence >= 0.55) {
    candidates.push(candidate);
  }

  return candidates;
}

// ============================================================================
// Graph-DB-based capability discovery (replaces file-system scanning)
// ============================================================================

function escapeCypherString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

function buildPathFilterCypher(varName: string, targetPaths: string[]): string {
  if (targetPaths.length === 0) return 'true';
  const clauses = targetPaths.map(p => {
    const normalized = escapeCypherString(p.replace(/\\/g, '/'));
    return `${varName}.filePath STARTS WITH '${normalized}'`;
  });
  return `(${clauses.join(' OR ')})`;
}

async function queryGraphEntrySignals(
  conn: Connection,
  pathFilter: string,
  repoRoot: string,
  targetTerms: string[],
): Promise<EntrySignal[]> {
  const cypher = `MATCH (c:Class) WHERE ${pathFilter} AND c.name =~ '.*(Controller|Service|Component|Handler)$' RETURN c.name as name, c.filePath as filePath`;
  const rows = await executeQuery(conn, cypher);
  const results: EntrySignal[] = [];

  for (const row of rows) {
    const name = String(row.name ?? '');
    const filePath = String(row.filePath ?? '');
    const relevance = computeTargetRelevance([filePath, name], targetTerms);
    const lower = name.toLowerCase();
    let kind: EntrySignal['kind'] = 'handler';
    let role: string | undefined;
    if (lower.includes('controller')) { kind = 'http'; role = 'controller'; }
    else if (lower.includes('service')) { kind = 'service'; role = 'service'; }

    const signal: EntrySignal = {
      kind,
      location: filePath,
      name,
      description: `Graph-discovered ${kind} entry`,
      targetRelevance: relevance.score,
      matchedTerms: relevance.matchedTerms,
      role,
    };

    // For HTTP controllers, extract route annotations for signature and startLine
    if (kind === 'http') {
      try {
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
        const content = await fs.readFile(resolvedPath, 'utf-8');
        const routeMatches = [...content.matchAll(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\(([^)]*)\))?/g)];
        if (routeMatches.length > 0) {
          signal.signature = routeMatches.map(m => m[0]).join(' ');
          // Extract startLine from class definition
          const classMatch = content.match(/^.*\b(?:public\s+)?(?:abstract\s+)?(?:class|interface)\s+/m);
          if (classMatch) {
            signal.startLine = content.slice(0, classMatch.index).split('\n').length + 1;
          }
        }
      } catch {
        // File may not be readable; skip signature
      }
    }

    results.push(signal);
  }

  return results.sort(byRelevanceDesc);
}

async function queryGraphBehaviorSignals(
  conn: Connection,
  pathFilter: string,
  _repoRoot: string,
  targetTerms: string[],
): Promise<BehaviorSignal[]> {
  const cypher = `MATCH (m:Method) WHERE ${pathFilter} RETURN m.name as name, m.filePath as filePath LIMIT 500`;
  const rows = await executeQuery(conn, cypher);
  return rows.map((row: Record<string, unknown>) => {
    const name = String(row.name ?? '');
    const filePath = String(row.filePath ?? '');
    const relevance = computeTargetRelevance([filePath, name], targetTerms);
    const terms = normalizeCapabilityTerms(name);
    const normalizedPath = normalizePathForMatch(filePath);
    const role = normalizedPath.includes('/controller/') ? 'controller' :
                 normalizedPath.includes('/service/') ? 'service' :
                 normalizedPath.includes('/mapper/') ? 'mapper' : undefined;
    return {
      location: filePath,
      verb: terms[0] || name,
      object: terms.slice(1).join(' ') || name,
      targetRelevance: relevance.score,
      matchedTerms: relevance.matchedTerms,
      role,
    };
  }).sort(byRelevanceDesc);
}

async function queryGraphDataSignals(
  conn: Connection,
  pathFilter: string,
  repoRoot: string,
  targetTerms: string[],
): Promise<DataSignal[]> {
  const classCypher = `MATCH (c:Class) WHERE ${pathFilter} AND c.name =~ '.*(Entity|DTO|VO|Request|Response|DO|PO|BO|Model)$' RETURN c.name as name, c.filePath as filePath`;
  const interfaceCypher = `MATCH (c:Interface) WHERE ${pathFilter} AND c.name =~ '.*(Entity|DTO|VO|Request|Response|DO|PO|BO|Model)$' RETURN c.name as name, c.filePath as filePath`;
  // Run sequentially to avoid shared connection concurrency issues
  const classRows = await executeQuery(conn, classCypher);
  const interfaceRows = await executeQuery(conn, interfaceCypher);
  const allRows = [
    ...classRows.map((r: Record<string, unknown>) => ({ name: String(r.name ?? ''), filePath: String(r.filePath ?? ''), kind: 'type' as const })),
    ...interfaceRows.map((r: Record<string, unknown>) => ({ name: String(r.name ?? ''), filePath: String(r.filePath ?? ''), kind: 'type' as const })),
  ];
  return allRows.map(row => {
    const relevance = computeTargetRelevance([row.filePath, row.name], targetTerms);
    const normalizedPath = normalizePathForMatch(row.filePath);
    const role = normalizedPath.includes('/controller/') ? 'controller' :
                 normalizedPath.includes('/service/') ? 'service' :
                 normalizedPath.includes('/mapper/') ? 'mapper' :
                 normalizedPath.includes('/entity/') ? 'entity' :
                 normalizedPath.includes('/dto/') || normalizedPath.includes('/vo/') ||
                 normalizedPath.includes('/request/') || normalizedPath.includes('/response/') ? 'dto' : undefined;
    return { kind: row.kind, location: row.filePath, name: row.name, targetRelevance: relevance.score, matchedTerms: relevance.matchedTerms, role };
  }).sort(byRelevanceDesc);
}

async function queryGraphTestSignals(
  conn: Connection,
  pathFilter: string,
  repoRoot: string,
  targetTerms: string[],
): Promise<TestSignal[]> {
  const cypher = `MATCH (m:Method) WHERE ${pathFilter} AND m.filePath =~ '.*(test|spec).*' RETURN m.name as name, m.filePath as filePath LIMIT 300`;
  const rows = await executeQuery(conn, cypher);
  const seen = new Set<string>();
  const signals: TestSignal[] = [];
  for (const row of rows) {
    const name = String((row as Record<string, unknown>).name ?? '');
    const filePath = String((row as Record<string, unknown>).filePath ?? '');
    const startLine = Number((row as Record<string, unknown>).startLine ?? undefined);
    const key = `${filePath}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const relevance = computeTargetRelevance([filePath, name], targetTerms);
    signals.push({ location: filePath, testName: name, targetRelevance: relevance.score, matchedTerms: relevance.matchedTerms, role: 'test', startLine: isNaN(startLine) ? undefined : startLine });
  }
  signals.sort(byRelevanceDesc);
  return signals;
}

async function queryGraphModuleClusters(conn: Connection, targetTerms: string[]): Promise<ModuleCluster[]> {
  const cypher = `MATCH (c:Community) RETURN c.heuristicLabel as label, c.symbolCount as symbolCount, c.cohesion as cohesion LIMIT 8`;
  const rows = await executeQuery(conn, cypher);
  return rows.map((row: Record<string, unknown>) => {
    const label = String(row.label ?? '');
    const cohesion = Number(row.cohesion ?? row.symbolCount ?? 0);
    const relevance = computeTargetRelevance([label], targetTerms);
    return {
      rootPath: label,
      moduleNames: [label],
      cohesionScore: Math.min(1, Math.max(0.5, cohesion / 100)),
      targetRelevance: relevance.score,
      matchedTerms: relevance.matchedTerms,
    };
  }).sort(byRelevanceDesc);
}

export async function discoverCapabilitiesFromGraph(
  conn: Connection,
  input: DiscoverCapabilitiesInput,
): Promise<CapabilityCandidate[]> {
  const { repoRoot, targetTerms = [], targetPaths = [] } = input;

  if (targetTerms.length === 0 && targetPaths.length === 0) {
    return [];
  }

  const pathFilter = buildPathFilterCypher('c', targetPaths);
  const methodPathFilter = buildPathFilterCypher('m', targetPaths);
  const interfacePathFilter = buildPathFilterCypher('i', targetPaths);

  const candidates: CapabilityCandidate[] = [];

  const primaryEntryPoints = await queryGraphEntrySignals(conn, pathFilter, repoRoot, targetTerms);
  const behaviorAnchors = await queryGraphBehaviorSignals(conn, methodPathFilter, repoRoot, targetTerms);
  const dataAnchors = await queryGraphDataSignals(conn, pathFilter, repoRoot, targetTerms);
  const testAnchors = await queryGraphTestSignals(conn, methodPathFilter, repoRoot, targetTerms);
  const moduleClusters = await queryGraphModuleClusters(conn, targetTerms);

  // Compute confidence (reuse existing logic)
  const entrySignal = primaryEntryPoints.length > 0 ? 0.9 : targetPaths.length > 0 ? 0.55 : 0.2;
  const behaviorSignal = behaviorAnchors.length > 5 ? 0.85 : behaviorAnchors.length > 0 ? 0.6 : 0.3;
  const dataSignal = dataAnchors.length > 3 ? 0.9 : dataAnchors.length > 0 ? 0.6 : 0.3;
  const testSignal = testAnchors.length > 5 ? 0.75 : testAnchors.length > 0 ? 0.5 : 0.2;
  const docSignal = 0.4;
  const graphCohesion = moduleClusters.length > 1 ? 0.75 : 0.5;

  const confidence = computeConfidence(entrySignal, behaviorSignal, dataSignal, testSignal, docSignal, graphCohesion);

  const { businessTerms, technicalTerms } = classifyTargetTerms(targetTerms);
  const relatedTerms: string[] = [...targetTerms];
  for (const term of targetTerms) {
    relatedTerms.push(...normalizeCapabilityTerms(term));
  }

  const businessCapabilityName = deriveBusinessCapabilityName({
    businessTerms,
    entrySignals: primaryEntryPoints,
    behaviorSignals: behaviorAnchors,
    dataSignals: dataAnchors,
    moduleSignals: moduleClusters.map(cluster => ({
      targetRelevance: cluster.targetRelevance,
      matchedTerms: cluster.matchedTerms,
      name: cluster.rootPath,
      location: cluster.rootPath,
    })),
  });

  const nameCandidates = [businessCapabilityName];

  if (technicalTerms.includes('mybatis') && !relatedTerms.includes('mybatis mapper')) {
    relatedTerms.push('mybatis mapper');
  }

  const candidate: CapabilityCandidate = {
    candidateId: `CAND-${targetTerms.map(t => t.toUpperCase()).join('-')}`,
    nameCandidates,
    confidence,
    confidenceBreakdown: {
      entrySignal,
      behaviorSignal,
      dataSignal,
      testSignal,
      docSignal,
      graphCohesion,
    },
    primaryEntryPoints,
    behaviorAnchors,
    dataAnchors,
    testAnchors,
    docAnchors: [],
    moduleClusters,
    relatedTerms: [...new Set(relatedTerms)],
    risks: ['no_external_boundary_found'],
    missingSignals: ['No explicit external DB ownership contract found'],
  };

  if (candidate.confidence >= 0.55) {
    candidates.push(candidate);
  }

  return candidates;
}
