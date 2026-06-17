/**
 * PartitionCandidate 构建器
 *
 * 将 TraceResult 转换为 PartitionCandidate，计算候选之间的关系
 */

import type {
  TraceResult,
  PartitionCandidate,
  CandidateRelation,
  CandidateGroup,
  DomainClusterInput,
  ProjectContext,
  MapperInfo,
  ServiceInfo,
  TableInfo,
  EntryPoint,
  CandidateSnapshotEntry,
  CandidateSnapshot,
} from './types.js';
import { logger } from '../shared/logger.js';
import { createHash } from 'crypto';
import { getCurrentCommit } from '../engine/storage/git.js';

/**
 * CandidateBuilder - 候选构建器
 */
export class CandidateBuilder {
  /**
   * 从 TraceResult 构建候选列表
   */
  buildCandidates(traceResults: TraceResult[]): PartitionCandidate[] {
    const candidates: PartitionCandidate[] = [];

    // 按 anchorTable 分组
    const tableGroups = this.groupByAnchorTable(traceResults);

    for (const [anchorTable, results] of tableGroups.entries()) {
      const candidate = this.buildCandidate(anchorTable, results);
      candidates.push(candidate);
    }

    logger.info(`Built ${candidates.length} candidates from ${traceResults.length} trace results`);

    return candidates;
  }

  /**
   * 按 anchorTable 分组（稳定排序）
   */
  private groupByAnchorTable(traceResults: TraceResult[]): Map<string, TraceResult[]> {
    const tableGroups = new Map<string, TraceResult[]>();

    // 先对 traceResults 进行稳定排序（按入口点文件路径）
    const sortedResults = [...traceResults].sort((a, b) =>
      a.entryPoint.filePath.localeCompare(b.entryPoint.filePath)
    );

    for (const result of sortedResults) {
      // 使用第一个表作为 anchorTable（表列表已排序）
      const sortedTables = [...result.tables].sort((a, b) =>
        a.tableName.localeCompare(b.tableName)
      );
      const anchorTable = sortedTables[0]?.tableName ?? 'unknown';

      if (!tableGroups.has(anchorTable)) {
        tableGroups.set(anchorTable, []);
      }
      tableGroups.get(anchorTable)!.push(result);
    }

    return tableGroups;
  }

  /**
   * 构建单个候选
   */
  private buildCandidate(anchorTable: string, results: TraceResult[]): PartitionCandidate {
    // 合并入口点（先合并，因为 candidateId 依赖入口点）
    const entryPoints = this.mergeEntryPoints(results);

    // 生成稳定的 candidateId：基于 anchorTable + 入口点 ID 集合排序后的 hash
    const entryPointIds = entryPoints.map(ep => this.generateEntryPointId(ep));
    const sortedEntryPointIds = [...entryPointIds].sort(); // 确保稳定排序
    const candidateId = this.generateStableCandidateId(anchorTable, sortedEntryPointIds);

    // 合并表（稳定排序）
    const tables = this.mergeTables(results);

    // 合并 Mapper（稳定排序）
    const mappers = this.mergeMappers(results);

    // 合并 Service（稳定排序）
    const services = this.mergeServices(results);

    // 计算调用链摘要
    const callChainSummary = this.computeCallChainSummary(results);

    return {
      candidateId,
      anchorTable,
      entryPoints,
      tables,
      mappers,
      services,
      callChainSummary,
    };
  }

  /**
   * 生成入口点 ID（稳定）
   * 格式：${filePath}:${kind}:${className}
   */
  generateEntryPointId(ep: PartitionCandidate['entryPoints'][0]): string {
    // 使用与去重 key 相同的顺序，确保稳定性
    return `${ep.filePath}:${ep.kind}:${ep.className}`;
  }

  /**
   * 生成稳定的候选 ID
   * 基于 anchorTable + 入口点 ID 集合排序后的 hash
   */
  private generateStableCandidateId(anchorTable: string, sortedEntryPointIds: string[]): string {
    const hashInput = `${anchorTable}:${sortedEntryPointIds.join(',')}`;
    const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 12);
    return `candidate_${anchorTable}_${hash}`;
  }

  /**
   * 合并入口点（稳定排序）
   */
  private mergeEntryPoints(results: TraceResult[]): PartitionCandidate['entryPoints'] {
    const entryPoints: PartitionCandidate['entryPoints'] = [];
    const addedKeys = new Set<string>();

    // 按 filePath 稳定排序
    const sortedResults = [...results].sort((a, b) =>
      a.entryPoint.filePath.localeCompare(b.entryPoint.filePath)
    );

    for (const result of sortedResults) {
      const ep = result.entryPoint;
      // 与 generateEntryPointId 保持一致的 key 格式
      const key = `${ep.filePath}:${ep.kind}:${ep.className}`;

      if (!addedKeys.has(key)) {
        addedKeys.add(key);

        const entryPointData: PartitionCandidate['entryPoints'][0] = {
          kind: ep.kind,
          className: ep.className,
          filePath: ep.filePath,
        };

        // Controller API 信息（从 callChain 推断）
        if (ep.kind === 'controller') {
          entryPointData.apiInfo = {
            // 简化：从类名推断 API 基路径
            basePath: this.inferApiBasePath(ep.className),
          };
        }

        // MQ Consumer 信息
        if (ep.kind === 'mq_consumer' && ep.mqType) {
          entryPointData.mqInfo = {
            mqType: ep.mqType,
            topic: ep.mqTopic,
          };
        }

        entryPoints.push(entryPointData);
      }
    }

    return entryPoints;
  }

  /**
   * 推断 API 基路径
   */
  private inferApiBasePath(className: string): string {
    // 从类名推断：XxxController → /api/xxx
    const baseName = className.replace(/Controller$/i, '').toLowerCase();
    return `/api/${baseName}`;
  }

  /**
   * 合并表
   */
  private mergeTables(results: TraceResult[]): PartitionCandidate['tables'] {
    const tables: PartitionCandidate['tables'] = [];
    const addedNames = new Set<string>();

    for (const result of results) {
      for (const table of result.tables) {
        if (!addedNames.has(table.tableName)) {
          addedNames.add(table.tableName);

          tables.push({
            tableName: table.tableName,
            role: table.role,
            tableType: table.tableType,
            foreignKeys: this.extractForeignKeysFromRelation(table),
          });
        }
      }
    }

    return tables;
  }

  /**
   * 从表的关系信息提取外键
   */
  private extractForeignKeysFromRelation(table: TableInfo): { columnName: string; referencesTable: string }[] | undefined {
    if (!table.foreignKey) return undefined;

    // 解析外键字符串（格式可能为 "column → target_table.target_column"）
    const fkMatch = table.foreignKey.match(/(\w+)\s*→\s*(\w+)\.(\w+)/);
    if (fkMatch) {
      return [{
        columnName: fkMatch[1],
        referencesTable: fkMatch[2],
      }];
    }

    return undefined;
  }

  /**
   * 合并 Mapper
   */
  private mergeMappers(results: TraceResult[]): PartitionCandidate['mappers'] {
    const mappers: PartitionCandidate['mappers'] = [];
    const addedNames = new Set<string>();

    for (const result of results) {
      for (const mapper of result.mappers) {
        if (!addedNames.has(mapper.className)) {
          addedNames.add(mapper.className);

          mappers.push({
            className: mapper.className,
            filePath: mapper.filePath,
            xmlPath: mapper.xmlPath,
            tablesOperated: mapper.tablesOperated ?? [],
          });
        }
      }
    }

    return mappers;
  }

  /**
   * 合并 Service
   */
  private mergeServices(results: TraceResult[]): PartitionCandidate['services'] {
    const services: PartitionCandidate['services'] = [];
    const addedNames = new Set<string>();

    for (const result of results) {
      for (const service of result.services) {
        if (!addedNames.has(service.className)) {
          addedNames.add(service.className);

          services.push({
            className: service.className,
            filePath: service.filePath,
          });
        }
      }
    }

    return services;
  }

  /**
   * 计算调用链摘要
   */
  private computeCallChainSummary(results: TraceResult[]): PartitionCandidate['callChainSummary'] {
    let maxDepth = 0;
    let totalPaths = 0;

    for (const result of results) {
      const depth = result.entryPoint.callChain.length;
      maxDepth = Math.max(maxDepth, depth);
      totalPaths++;
    }

    return {
      depth: maxDepth,
      pathCount: totalPaths,
    };
  }

  /**
   * 计算候选之间的关系
   */
  buildCandidateRelations(candidates: PartitionCandidate[]): CandidateRelation[] {
    const relations: CandidateRelation[] = [];

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const relation = this.computeRelation(candidates[i], candidates[j]);
        if (relation) {
          relations.push(relation);
        }
      }
    }

    logger.info(`Built ${relations.length} candidate relations`);

    return relations;
  }

  /**
   * 计算两个候选之间的关系
   */
  private computeRelation(a: PartitionCandidate, b: PartitionCandidate): CandidateRelation | null {
    // 计算共享表
    const sharedTables = this.findSharedTables(a, b);

    // 计算共享 Service
    const sharedServices = this.findSharedServices(a, b);

    // 计算共享 Mapper
    const sharedMappers = this.findSharedMappers(a, b);

    // 计算外键关系
    const tableForeignKeyRelations = this.findForeignKeyRelations(a, b);

    // 如果没有任何关联，不返回
    if (
      sharedTables.length === 0 &&
      sharedServices.length === 0 &&
      sharedMappers.length === 0 &&
      tableForeignKeyRelations.length === 0
    ) {
      return null;
    }

    return {
      candidateIdA: a.candidateId,
      candidateIdB: b.candidateId,
      sharedTables,
      sharedServices,
      sharedMappers,
      tableForeignKeyRelations,
    };
  }

  /**
   * 找到共享的表
   */
  private findSharedTables(a: PartitionCandidate, b: PartitionCandidate): string[] {
    const tablesA = a.tables.map(t => t.tableName);
    const tablesB = b.tables.map(t => t.tableName);
    return tablesA.filter(t => tablesB.includes(t));
  }

  /**
   * 找到共享的 Service
   */
  private findSharedServices(a: PartitionCandidate, b: PartitionCandidate): string[] {
    const servicesA = a.services.map(s => s.className);
    const servicesB = b.services.map(s => s.className);
    return servicesA.filter(s => servicesB.includes(s));
  }

  /**
   * 找到共享的 Mapper
   */
  private findSharedMappers(a: PartitionCandidate, b: PartitionCandidate): string[] {
    const mappersA = a.mappers.map(m => m.className);
    const mappersB = b.mappers.map(m => m.className);
    return mappersA.filter(m => mappersB.includes(m));
  }

  /**
   * 找到外键关系
   */
  private findForeignKeyRelations(a: PartitionCandidate, b: PartitionCandidate): CandidateRelation['tableForeignKeyRelations'] {
    const relations: CandidateRelation['tableForeignKeyRelations'] = [];

    // 检查 a 的表是否有外键指向 b 的表
    for (const table of a.tables) {
      if (table.foreignKeys) {
        for (const fk of table.foreignKeys) {
          if (b.tables.some(t => t.tableName === fk.referencesTable)) {
            relations.push({
              fromTable: table.tableName,
              toTable: fk.referencesTable,
              foreignKey: fk.columnName,
            });
          }
        }
      }
    }

    // 检查 b 的表是否有外键指向 a 的表
    for (const table of b.tables) {
      if (table.foreignKeys) {
        for (const fk of table.foreignKeys) {
          if (a.tables.some(t => t.tableName === fk.referencesTable)) {
            relations.push({
              fromTable: table.tableName,
              toTable: fk.referencesTable,
              foreignKey: fk.columnName,
            });
          }
        }
      }
    }

    return relations;
  }

  /**
   * 构建候选预分组
   */
  buildCandidateGroups(candidates: PartitionCandidate[], relations: CandidateRelation[]): CandidateGroup[] {
    const groups: CandidateGroup[] = [];
    const assignedCandidates = new Set<string>();

    // 基于共享表构建分组
    for (const relation of relations) {
      if (relation.sharedTables.length > 0) {
        // 如果两个候选都未分配，创建新分组
        if (!assignedCandidates.has(relation.candidateIdA) && !assignedCandidates.has(relation.candidateIdB)) {
          const groupId = `group_shared_table_${groups.length}`;
          groups.push({
            groupId,
            candidates: [relation.candidateIdA, relation.candidateIdB],
            groupReason: `共享表: ${relation.sharedTables.join(', ')}`,
          });
          assignedCandidates.add(relation.candidateIdA);
          assignedCandidates.add(relation.candidateIdB);
        }
      }
    }

    // 为未分配的候选创建单独分组
    for (const candidate of candidates) {
      if (!assignedCandidates.has(candidate.candidateId)) {
        groups.push({
          groupId: `group_single_${groups.length}`,
          candidates: [candidate.candidateId],
          groupReason: `独立候选: ${candidate.anchorTable}`,
        });
        assignedCandidates.add(candidate.candidateId);
      }
    }

    logger.info(`Built ${groups.length} candidate groups`);

    return groups;
  }

  /**
   * 构建完整的 DomainClusterInput
   */
  buildDomainClusterInput(
    traceResults: TraceResult[],
    repoPath: string,
    moduleNames?: string[]
  ): DomainClusterInput {
    const candidates = this.buildCandidates(traceResults);
    const relations = this.buildCandidateRelations(candidates);
    const groups = this.buildCandidateGroups(candidates, relations);

    const projectContext: ProjectContext = {
      repoPath,
      moduleNames,
    };

    return {
      candidates,
      candidateRelations: relations,
      candidateGroups: groups,
      projectContext,
    };
  }

  /**
   * 计算候选内容 hash
   * 用于检测候选内容是否变化
   */
  computeCandidateContentHash(candidate: PartitionCandidate): string {
    // 使用候选的关键内容计算 hash
    const content = {
      anchorTable: candidate.anchorTable,
      tables: candidate.tables.map(t => t.tableName).sort(),
      mappers: candidate.mappers.map(m => m.className).sort(),
      services: candidate.services.map(s => s.className).sort(),
      callChainSummary: candidate.callChainSummary,
    };
    const hashInput = JSON.stringify(content);
    return `sha256:${createHash('sha256').update(hashInput).digest('hex').slice(0, 16)}`;
  }

  /**
   * 构建候选快照
   * 用于增量更新判断
   */
  buildCandidateSnapshot(candidates: PartitionCandidate[], repoPath: string): CandidateSnapshot {
    const commitHash = getCurrentCommit(repoPath);

    const entries: CandidateSnapshotEntry[] = candidates.map(c => ({
      candidateId: c.candidateId,
      anchorTable: c.anchorTable,
      entryPointIds: c.entryPoints.map(ep => this.generateEntryPointId(ep)).sort(),
      contentHash: this.computeCandidateContentHash(c),
    }));

    return {
      candidates: entries,
      createdAt: new Date().toISOString(),
      commitHash,
    };
  }
}

/**
 * 创建 CandidateBuilder 实例
 */
export function createCandidateBuilder(): CandidateBuilder {
  return new CandidateBuilder();
}