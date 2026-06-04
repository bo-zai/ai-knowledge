import {
  withReadOnlyLbug,
  type ReadOnlyQueryExecutor,
} from '../engine/lbug/read-only-session.js';
import { getStoragePaths } from '../engine/storage/repo-manager.js';

export interface CapabilityMvpInventoryItem {
  id: string;
  name: string;
  targetTerms: string[];
  targetPaths: string[];
}

/**
 * Query all HTTP entry points (controller methods)
 * Each entry point is a business operation anchor
 */
async function queryHttpEntryPoints(query: ReadOnlyQueryExecutor): Promise<Array<{
  className: string;
  methodName: string;
  filePath: string;
}>> {
  const cypher = `
    MATCH (c:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
    WHERE c.name =~ '.*Controller$'
    RETURN c.name as className, m.name as methodName, c.filePath as filePath
    ORDER BY c.name, m.name
  `;

  const rows = await query(cypher);
  return rows.map((row) => ({
    className: String(row.className ?? ''),
    methodName: String(row.methodName ?? ''),
    filePath: String(row.filePath ?? ''),
  }));
}

/**
 * Query all scheduled job entry points
 */
async function queryJobEntryPoints(query: ReadOnlyQueryExecutor): Promise<Array<{
  className: string;
  methodName: string;
  filePath: string;
}>> {
  const cypher = `
    MATCH (c:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
    WHERE c.name =~ '.*(Job|Task|Scheduler)$'
    RETURN c.name as className, m.name as methodName, c.filePath as filePath
    ORDER BY c.name
  `;

  const rows = await query(cypher);
  return rows.map((row) => ({
    className: String(row.className ?? ''),
    methodName: String(row.methodName ?? ''),
    filePath: String(row.filePath ?? ''),
  }));
}

/**
 * Group entry points by class (same class = same capability)
 * Most reliable grouping heuristic: methods in same controller belong to same capability
 */
function groupEntryPointsByClass(
  entryPoints: Array<{ className: string; methodName: string; filePath: string }>,
): Map<string, Array<{ methodName: string; filePath: string }>> {
  const groups = new Map<string, Array<{ methodName: string; filePath: string }>>();

  for (const entry of entryPoints) {
    const key = entry.className;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push({
      methodName: entry.methodName,
      filePath: entry.filePath,
    });
  }

  return groups;
}

/**
 * Derive capability name from entry class name
 * Remove technical suffixes, keep business term
 */
function deriveCapabilityName(className: string): string {
  const baseName = className
    .replace(/Controller$/, '')
    .replace(/Handler$/, '')
    .replace(/Resource$/, '')
    .replace(/Endpoint$/, '')
    .replace(/Service$/, '')
    .replace(/Job$/, '')
    .replace(/Task$/, '')
    .replace(/Scheduler$/, '')
    .replace(/^Abstract/, '')
    .replace(/^Base/, '')
    .replace(/^Default/, '')
    .replace(/^Common/, '')
    .replace(/^Generic/, '');

  return baseName.length < 2 ? className : baseName;
}

/**
 * Derive search terms from capability name
 */
function deriveTermsFromName(name: string): string[] {
  const terms: string[] = [];
  const lower = name.toLowerCase();

  terms.push(lower);

  // Split compound names (OrderGoods → order, goods)
  const words = lower.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/);
  for (const word of words) {
    if (word.length > 2 && word !== lower) {
      terms.push(word);
    }
  }

  return [...new Set(terms)];
}

/**
 * Query services and data types called by entry class
 * Uses CALLS edges to find related code
 */
async function queryCapabilityRelatedPaths(query: ReadOnlyQueryExecutor, className: string): Promise<string[]> {
  const paths: string[] = [];

  // Query services called by this class
  const serviceCypher = `
    MATCH (c:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
    WHERE c.name = '${escapeCypherString(className)}'
    MATCH (m)-[r:CodeRelation {type: 'CALLS'}]->(target:Method)
    MATCH (targetClass:Class)-[hm2:CodeRelation {type: 'HAS_METHOD'}]->(target)
    WHERE targetClass.name =~ '.*Service$'
    RETURN DISTINCT targetClass.filePath as filePath
    LIMIT 8
  `;

  try {
    const rows = await query(serviceCypher);
    for (const row of rows) {
      paths.push(String(row.filePath ?? ''));
    }
  } catch {
    // Ignore errors
  }

  // Query data types used
  const dataCypher = `
    MATCH (c:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
    WHERE c.name = '${escapeCypherString(className)}'
    MATCH (m)-[r:CodeRelation {type: 'CALLS'}]->(target:Method)
    MATCH (targetClass:Class)-[hm2:CodeRelation {type: 'HAS_METHOD'}]->(target)
    WHERE targetClass.name =~ '.*(Entity|VO|DTO|Request|Response)$'
    RETURN DISTINCT targetClass.filePath as filePath
    LIMIT 5
  `;

  try {
    const rows = await query(dataCypher);
    for (const row of rows) {
      paths.push(String(row.filePath ?? ''));
    }
  } catch {
    // Ignore errors
  }

  return [...new Set(paths.filter(p => p.length > 0))];
}

function escapeCypherString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

function normalizePath(filePath: string, repoRoot: string): string {
  if (filePath.startsWith(repoRoot)) {
    return filePath.slice(repoRoot.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
  }
  return filePath.replace(/\\/g, '/');
}

/**
 * Check if capability name matches technical patterns
 */
function isTechnicalCapability(name: string): boolean {
  const lower = name.toLowerCase();

  if (lower.length < 3) return true;

  const technicalPatterns = [
    /^(api|web|rest|grpc)$/i,
    /^(config|setting|option)$/i,
    /^(util|helper|tool)$/i,
    /^(log|trace|metric|monitor)$/i,
    /^(error|exception|fault)$/i,
    /^(test|spec|mock)$/i,
    /^(common|base|abstract|generic)$/i,
    /^(health|status|ping)$/i,
    /^(upload|download|file)$/i,
    /^(callback|notify|hook)$/i,
    /^(auth|token|session)$/i,
    /^(cache|queue|lock)$/i,
    /^(wx|ali|alipay|wxpay)$/i,
  ];

  for (const pattern of technicalPatterns) {
    if (pattern.test(lower)) return true;
  }

  return false;
}

/**
 * Discover capabilities from entry points
 * Strategy: Query entry classes → group methods by class → derive capability name
 */
export async function discoverProjectCapabilities(repoRoot: string): Promise<CapabilityMvpInventoryItem[]> {
  const inventory: CapabilityMvpInventoryItem[] = [];

  const { lbugPath } = getStoragePaths(repoRoot);

  return withReadOnlyLbug(lbugPath, async query => {
    const countRows = await query(`MATCH (c:Class) RETURN count(c) AS cnt`);
    const classCount = Number(countRows[0]?.cnt ?? 0);

    if (classCount === 0) {
      console.log(`[DEBUG] Graph DB empty`);
      return [];
    }

    console.log(`[DEBUG] Graph has ${classCount} classes`);

    const httpEntries = await queryHttpEntryPoints(query);
    const jobEntries = await queryJobEntryPoints(query);

    console.log(`[DEBUG] ${httpEntries.length} HTTP entries, ${jobEntries.length} job entries`);

    if (httpEntries.length === 0 && jobEntries.length === 0) {
      return [];
    }

    const httpGroups = groupEntryPointsByClass(httpEntries);
    const jobGroups = groupEntryPointsByClass(jobEntries);

    console.log(`[DEBUG] ${httpGroups.size} HTTP groups, ${jobGroups.size} job groups`);

    // Process HTTP groups
    for (const [className, methods] of httpGroups) {
      const capabilityName = deriveCapabilityName(className);

      if (isTechnicalCapability(capabilityName)) {
        console.log(`[DEBUG] Skip technical: ${className}`);
        continue;
      }

      const primaryPath = methods[0]?.filePath;
      if (!primaryPath) continue;

      const normalizedPrimary = normalizePath(primaryPath, repoRoot);
      const relatedPaths = await queryCapabilityRelatedPaths(query, className);
      const normalizedRelated = relatedPaths.map(p => normalizePath(p, repoRoot));

      const allPaths = [normalizedPrimary, ...normalizedRelated.slice(0, 7)];
      const uniquePaths = [...new Set(allPaths)];
      const targetTerms = deriveTermsFromName(capabilityName);

      console.log(`[DEBUG] ${capabilityName}: ${methods.length} methods, ${uniquePaths.length} paths`);

      inventory.push({
        id: capabilityName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: capabilityName,
        targetTerms,
        targetPaths: uniquePaths,
      });
    }

    // Process job groups
    for (const [className, methods] of jobGroups) {
      const capabilityName = deriveCapabilityName(className);

      if (isTechnicalCapability(capabilityName)) continue;

      const primaryPath = methods[0]?.filePath;
      if (!primaryPath) continue;

      inventory.push({
        id: capabilityName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: capabilityName,
        targetTerms: deriveTermsFromName(capabilityName),
        targetPaths: [normalizePath(primaryPath, repoRoot)],
      });
    }

    inventory.sort((a, b) => b.targetPaths.length - a.targetPaths.length);
    return inventory.slice(0, 15);
  });
}

export async function buildCapabilityMvpInventory(repoRoot: string): Promise<CapabilityMvpInventoryItem[]> {
  return discoverProjectCapabilities(repoRoot);
}
