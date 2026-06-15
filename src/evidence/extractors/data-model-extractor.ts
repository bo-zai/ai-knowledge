import type { EvidenceBundle } from '../evidence-bundle-schema.js';
import type { EvidenceGroup } from '../type-evidence-builder.js';
import type { GenerateTarget } from '../../knowledge/generate-scope.js';
import type { ReadOnlyQueryExecutor } from '../../engine/lbug/read-only-session.js';
import { extractPackagePath, groupByPackagePath } from './shared.js';

/** 实体继承关系信息 */
interface EntityInheritance {
  extendsClass?: string;
  implementsInterfaces?: string[];
}

/**
 * DATA_MODEL: Query entity classes grouped by package.
 * 包含继承关系（EXTENDS）和实现关系（IMPLEMENTS）。
 */
export async function queryDataModelEvidenceByPackage(
  repoPath: string,
  target: GenerateTarget | undefined,
  executeQuery: ReadOnlyQueryExecutor,
): Promise<EvidenceGroup[]> {
  const targetFilter = target ? `AND c.name CONTAINS '${target.value}'` : '';
  const repoName = repoPath.split('/').pop() || 'unknown';

  const entityCypher = `
    MATCH (c:Class)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
    WHERE (
      c.name =~ '(?i).*(DO|Entity|Model|VO|DTO|PO)$'
      OR c.filePath =~ '(?i).*mall-mbg.*model.*'
      OR (c.filePath =~ '(?i).*/model/.*' AND NOT c.filePath =~ '(?i).*(test|spec|example).*')
    )
    AND NOT c.filePath =~ '(?i).*(test|spec|node_modules|example).*'
    ${targetFilter}
    WITH c, collect(p.name) as fields, count(p) as fieldCount
    WHERE fieldCount >= 5
    RETURN c.name as entityName, c.filePath as filePath, fields
    LIMIT 30
  `;
  const entityResults = await executeQuery(entityCypher);

  // 收集所有实体名称用于查询继承关系
  const entityNames = (entityResults as Array<{ entityName: string; filePath: string; fields: string[] }>)
    .map(r => r.entityName);

  // 查询继承关系
  const inheritanceMap = await queryEntityInheritance(entityNames, executeQuery);

  const packageGroups = groupByPackagePath(
    entityResults as Array<{ entityName: string; filePath: string; fields: string[] }>,
    6,
  );

  const groups: EvidenceGroup[] = [];

  for (const [packagePath, rows] of packageGroups.entries()) {
    const groupId = `DATA_MODEL-${packagePath.replace(/[\/]/g, '-')}`;
    const bundleId = `BUNDLE-DATA_MODEL-${packagePath.replace(/[\/]/g, '-')}`.toUpperCase();

    const dataContracts: EvidenceBundle['dataContracts'] = rows.map((row, idx) => {
      const inheritance = inheritanceMap.get(row.entityName);
      return {
        ref: `evidence://contract/CON-${String(idx + 1).padStart(3, '0')}`,
        kind: 'schema',
        location: row.filePath,
        name: row.entityName,
        fields: row.fields || [],
        customData: inheritance ? {
          extendsClass: inheritance.extendsClass,
          implementsInterfaces: inheritance.implementsInterfaces,
        } : undefined,
      };
    });

    groups.push({
      groupId,
      packagePath,
      bundle: {
        bundleId,
        candidateId: `CAND-DATA_MODEL-${packagePath}`,
        repoProfile: { name: repoName },
        confidence: 0.75,
        risks: [],
        capabilityHints: {
          nameCandidates: rows.map(r => r.entityName),
          relatedTerms: [],
        },
        entryPoints: [],
        behaviorSlices: [],
        dataContracts,
        validationAnchors: [],
        moduleSurfaces: [],
        flowTraces: [],
        docs: [],
        negativeEvidence: [],
        openQuestions: [],
      },
    });
  }

  return groups;
}

/**
 * 查询实体的继承关系（EXTENDS）和实现关系（IMPLEMENTS）。
 */
async function queryEntityInheritance(
  entityNames: string[],
  executeQuery: ReadOnlyQueryExecutor,
): Promise<Map<string, EntityInheritance>> {
  const inheritanceMap = new Map<string, EntityInheritance>();

  if (entityNames.length === 0) return inheritanceMap;

  // 初始化所有实体
  for (const name of entityNames) {
    inheritanceMap.set(name, {});
  }

  // 查询 EXTENDS 关系
  const extendsCypher = `
    MATCH (src:Class)-[r:CodeRelation {type: 'EXTENDS'}]->(dst)
    WHERE src.name IN ${JSON.stringify(entityNames)}
    RETURN src.name as entityName, dst.name as parentName
  `;
  try {
    const extendsResults = await executeQuery(extendsCypher);
    for (const row of extendsResults as Array<{ entityName: string; parentName: string }>) {
      const existing = inheritanceMap.get(row.entityName) || {};
      inheritanceMap.set(row.entityName, {
        ...existing,
        extendsClass: row.parentName,
      });
    }
  } catch {
    // EXTENDS 查询失败时忽略
  }

  // 查询 IMPLEMENTS 关系
  const implementsCypher = `
    MATCH (src:Class)-[r:CodeRelation {type: 'IMPLEMENTS'}]->(dst:Interface)
    WHERE src.name IN ${JSON.stringify(entityNames)}
    RETURN src.name as entityName, collect(dst.name) as interfaces
  `;
  try {
    const implResults = await executeQuery(implementsCypher);
    for (const row of implResults as Array<{ entityName: string; interfaces: string[] }>) {
      const existing = inheritanceMap.get(row.entityName) || {};
      if (row.interfaces && row.interfaces.length > 0) {
        inheritanceMap.set(row.entityName, {
          ...existing,
          implementsInterfaces: row.interfaces,
        });
      }
    }
  } catch {
    // IMPLEMENTS 查询失败时忽略
  }

  return inheritanceMap;
}