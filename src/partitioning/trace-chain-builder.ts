/**
 * 追溯链构建器
 *
 * 使用图数据库 CALLS 边追溯调用链：
 * Controller → Service → Mapper → Table
 *
 * 核心改动：
 * 1. 不使用正则匹配，而是通过图数据库边关系追溯
 * 2. 复用 ModuleTopology 查找模块名（而非从路径推断）
 */

import path from "path";
import fs from "fs/promises";
import type { ReadOnlyQueryExecutor } from "../engine/lbug/read-only-session.js";
import { getStoragePaths } from "../engine/storage/repo-manager.js";
import {
  parseMapperFile,
  extractTablesFromSql,
} from "../mybatis/mapper-parser.js";
import { resolveStatementSql } from "../mybatis/include-resolver.js";
import { logger } from "../shared/logger.js";
import type { ModuleTopology, ModuleInfo } from "../module/index.js";
import type {
  EntryPoint,
  CallChainNode,
  TableInfo,
  MapperInfo,
  ServiceInfo,
  EntityInfo,
  CrossDomainCall,
  TraceResult,
  EntryPointKind,
} from "./types.js";

/**
 * Cypher 字符串转义
 */
function escapeCypherString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/**
 * 从文件路径提取模块名
 *
 * 对于 Maven 多模块项目，提取真正的模块名（如 admin、app）
 * 而非包名的最后一段
 */
function extractModuleName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");

  // 查找 src 目录
  const srcIdx = parts.findIndex((p) => p === "src");

  if (srcIdx > 0) {
    // src 前面的目录就是模块名
    // 例如：music-education-admin/src/... → 模块名是 music-education-admin
    // 可以进一步简化：取最后一段作为模块名
    const modulePath = parts.slice(0, srcIdx);
    return modulePath[modulePath.length - 1] || "unknown";
  }

  // 回退到目录名
  return parts[parts.length - 2] || "unknown";
}

/**
 * 使用 ModuleTopology 查找模块名
 *
 * 根据文件路径在模块拓扑中查找所属模块
 */
function findModuleName(filePath: string, topology: ModuleTopology): string {
  const normalized = filePath.replace(/\\/g, "/");

  // 遍历 modules，检查 filePath 是否在模块路径下
  for (const module of topology.modules) {
    const modulePath = module.path.replace(/\\/g, "/").replace(/\/$/, "");

    // 检查文件路径是否以模块路径开头
    if (
      normalized.startsWith(modulePath + "/") ||
      normalized.includes(module.name + "/src/")
    ) {
      return module.name;
    }
  }

  // 回退到路径推断
  return extractModuleName(filePath);
}

/**
 * TraceChainBuilder - 追溯链构建器
 */
export class TraceChainBuilder {
  private readonly query: ReadOnlyQueryExecutor;
  private readonly repoPath: string;
  private readonly moduleTopology?: ModuleTopology;

  constructor(
    query: ReadOnlyQueryExecutor,
    repoPath: string,
    moduleTopology?: ModuleTopology,
  ) {
    this.query = query;
    this.repoPath = repoPath;
    this.moduleTopology = moduleTopology;
  }

  /**
   * 查找模块名（优先使用 ModuleTopology）
   */
  private getModuleName(filePath: string): string {
    if (this.moduleTopology) {
      return findModuleName(filePath, this.moduleTopology);
    }
    return extractModuleName(filePath);
  }

  /**
   * 判断是否跨模块调用
   *
   * 使用 ModuleTopology 的依赖关系判断
   */
  private isCrossModuleCall(
    sourceModule: string,
    targetModule: string,
  ): boolean {
    if (!this.moduleTopology) {
      // 无拓扑信息，回退到简单判断
      return sourceModule !== targetModule;
    }

    // source 和 target 相同 → 不是跨模块
    if (sourceModule === targetModule) return false;

    // 检查是否是正常依赖关系
    const sourceInfo = this.moduleTopology.modules.find(
      (m) => m.name === sourceModule,
    );
    if (sourceInfo && sourceInfo.dependencies.includes(targetModule))
      return false;

    // 否则是跨模块调用
    return true;
  }

  /**
   * 发现所有入口点
   */
  async discoverEntryPoints(): Promise<EntryPoint[]> {
    const entryPoints: EntryPoint[] = [];

    // 1. 发现 Controller 入口点
    const controllers = await this.discoverControllers();
    entryPoints.push(...controllers);

    // 2. 发现 Scheduled 入口点
    const scheduleds = await this.discoverScheduledTasks();
    entryPoints.push(...scheduleds);

    // 3. 发现 MQ Consumer 入口点
    const mqConsumers = await this.discoverMqConsumers();
    entryPoints.push(...mqConsumers);

    return entryPoints;
  }

  /**
   * 发现 Controller 入口点
   */
  private async discoverControllers(): Promise<EntryPoint[]> {
    // 查询按名称模式匹配的节点
    const cypher = `
      MATCH (c:Class)
      WHERE c.name CONTAINS 'Controller'
      AND NOT c.filePath CONTAINS 'test'
      AND NOT c.filePath CONTAINS 'spec'
      RETURN c.name AS className, c.filePath AS filePath, c.startLine AS startLine
      LIMIT 100
    `;

    const rows = await this.query(cypher);
    const entryPoints: EntryPoint[] = [];

    for (const row of rows) {
      const className = row.className as string;
      const filePath = row.filePath as string;
      const startLine = row.startLine as number | undefined;

      if (!filePath || !className) continue;

      // 确定客户端类型
      const clientType = this.determineClientType(className, filePath);

      entryPoints.push({
        kind: "controller",
        clientType,
        className,
        methodName: "", // Controller 级别，方法名后续追溯时补充
        filePath,
        startLine: startLine ?? 0,
        module: this.getModuleName(filePath),
        callChain: [],
      });
    }

    return entryPoints;
  }

  /**
   * 发现 Scheduled 任务入口点
   */
  private async discoverScheduledTasks(): Promise<EntryPoint[]> {
    // 查询所有 Method 节点，在代码中过滤 annotations
    // LadybugDB 不支持 exists() 或 IS NOT NULL 语法
    const cypher = `
      MATCH (m:Method)
      WHERE NOT m.filePath CONTAINS 'test'
      AND NOT m.filePath CONTAINS 'spec'
      RETURN m.name AS methodName, m.filePath AS filePath, m.startLine AS startLine, m.annotations AS annotations
      LIMIT 100
    `;

    const rows = await this.query(cypher);
    const entryPoints: EntryPoint[] = [];

    for (const row of rows) {
      const methodName = row.methodName as string;
      const filePath = row.filePath as string;
      const annotations = row.annotations as string[] | undefined;

      if (!filePath || !methodName) continue;

      // 检查是否是 Scheduled（通过 annotations）
      // annotations 可能不存在（undefined），需要安全检查
      const isScheduled =
        annotations?.some((ann) => ann.includes("Scheduled")) ?? false;

      if (!isScheduled) continue;

      // 从 filePath 推断类名
      const className = path.basename(filePath, ".java");

      entryPoints.push({
        kind: "scheduled",
        className,
        methodName,
        filePath,
        startLine: (row.startLine as number) ?? 0,
        module: this.getModuleName(filePath),
        callChain: [],
      });
    }

    return entryPoints;
  }

  /**
   * 发现 MQ Consumer 入口点
   */
  private async discoverMqConsumers(): Promise<EntryPoint[]> {
    // 查询所有 Class 节点，在代码中过滤 annotations
    const cypher = `
      MATCH (c:Class)
      WHERE NOT c.filePath CONTAINS 'test'
      AND NOT c.filePath CONTAINS 'spec'
      RETURN c.name AS className, c.filePath AS filePath, c.startLine AS startLine, c.annotations AS annotations
      LIMIT 100
    `;

    const rows = await this.query(cypher);
    const entryPoints: EntryPoint[] = [];

    for (const row of rows) {
      const className = row.className as string;
      const filePath = row.filePath as string;
      const annotations = row.annotations as string[] | undefined;

      if (!filePath || !className) continue;

      // 检查是否是 MQ Consumer
      // annotations 可能不存在，需要安全检查
      if (!annotations || annotations.length === 0) continue;

      let mqType: string | undefined;
      let mqTopic: string | undefined;

      for (const ann of annotations) {
        if (ann.includes("RocketMQMessageListener")) {
          mqType = "rocketmq";
          // 尝试提取 topic
          const topicMatch = ann.match(/topic\s*=\s*"([^"]+)"/);
          if (topicMatch) mqTopic = topicMatch[1];
          break;
        }
        if (ann.includes("KafkaListener")) {
          mqType = "kafka";
          const topicMatch = ann.match(/topics\s*=\s*"([^"]+)"/);
          if (topicMatch) mqTopic = topicMatch[1];
          break;
        }
        if (ann.includes("RabbitListener")) {
          mqType = "rabbitmq";
          const queueMatch = ann.match(/queues\s*=\s*"([^"]+)"/);
          if (queueMatch) mqTopic = queueMatch[1];
          break;
        }
      }

      if (!mqType) continue;

      entryPoints.push({
        kind: "mq_consumer",
        className,
        methodName: "", // Consumer 级别，方法名后续追溯时补充
        filePath,
        startLine: (row.startLine as number) ?? 0,
        module: this.getModuleName(filePath),
        callChain: [],
        mqType,
        mqTopic,
      });
    }

    return entryPoints;
  }

  /**
   * 确定客户端类型
   */
  private determineClientType(
    className: string,
    filePath: string,
  ): "web" | "app" | "admin" | "api" {
    const lowerClass = className.toLowerCase();
    const lowerPath = filePath.toLowerCase();

    if (lowerClass.includes("app") || lowerPath.includes("/app/")) return "app";
    if (lowerClass.includes("admin") || lowerPath.includes("/admin/"))
      return "admin";
    if (lowerClass.includes("api") || lowerPath.includes("/api/")) return "api";
    return "web";
  }

  /**
   * 追溯入口点的调用链
   */
  async traceEntryPoint(entryPoint: EntryPoint): Promise<TraceResult> {
    const result: TraceResult = {
      entryPoint,
      tables: [],
      mappers: [],
      services: [],
      entities: [],
      crossDomainCalls: [],
    };

    // 1. 追溯到 Service
    const services = await this.traceToService(entryPoint);
    result.services = services;

    // 2. 追溯到 Mapper
    for (const service of services) {
      const mappers = await this.traceServiceToMapper(service);
      for (const mapper of mappers) {
        // 检查是否已添加
        if (!result.mappers.some((m) => m.className === mapper.className)) {
          result.mappers.push(mapper);
        }

        // 3. 从 Mapper 提取表信息
        const tables = await this.extractTablesFromMapper(mapper);
        for (const table of tables) {
          if (!result.tables.some((t) => t.tableName === table.tableName)) {
            result.tables.push(table);
          }
        }
      }

      // 构建 callChain
      for (const mapper of mappers) {
        entryPoint.callChain.push({
          className: mapper.className,
          filePath: mapper.filePath,
          role: "data_layer",
        });
      }
    }

    // 4. 查找 Entity
    for (const table of result.tables) {
      const entity = await this.findEntityForTable(table.tableName);
      if (
        entity &&
        !result.entities.some((e) => e.className === entity.className)
      ) {
        result.entities.push(entity);
      }
    }

    // 5. 如果没有 Service，标记为纯 Mapper 场景
    if (services.length === 0 && result.mappers.length > 0) {
      entryPoint.noServiceLayer = true;
    }

    return result;
  }

  /**
   * 追溯到 Service（使用 CALLS 边）
   */
  private async traceToService(entryPoint: EntryPoint): Promise<ServiceInfo[]> {
    const services: ServiceInfo[] = [];

    // 如果是 Controller，追溯 Controller 的方法调用的 Service
    if (entryPoint.kind === "controller") {
      const escapedClass = escapeCypherString(entryPoint.className);
      const escapedPath = escapeCypherString(entryPoint.filePath);

      const cypher = `
        MATCH (controller:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(ctrlMethod:Method)
        WHERE controller.name = '${escapedClass}' AND controller.filePath = '${escapedPath}'
        MATCH (ctrlMethod)-[call:CodeRelation {type: 'CALLS'}]->(serviceMethod:Method)
        MATCH (serviceClass:Class)-[hm2:CodeRelation {type: 'HAS_METHOD'}]->(serviceMethod)
        WHERE serviceClass.name =~ '.*Service.*'
        AND NOT serviceClass.filePath CONTAINS 'test'
        RETURN DISTINCT serviceClass.name AS className, serviceClass.filePath AS filePath
        LIMIT 10
      `;

      const rows = await this.query(cypher);

      for (const row of rows) {
        const className = row.className as string;
        const filePath = row.filePath as string;

        if (!filePath || !className) continue;

        // 添加到 callChain
        entryPoint.callChain.push({
          className,
          filePath,
          role: "core_logic",
        });

        // 检查是否跨域
        const crossDomainHint = this.detectCrossDomain(
          className,
          entryPoint.className,
        );
        if (crossDomainHint) {
          entryPoint.callChain[
            entryPoint.callChain.length - 1
          ].crossDomainHint = crossDomainHint;
          entryPoint.crossDomainCalls?.push({
            targetDomain: crossDomainHint,
            className,
            methodName: "",
            callPurpose: "跨域调用",
          });
        }

        services.push({
          className,
          filePath,
          module: this.getModuleName(filePath),
        });
      }
    }

    // 如果是 Scheduled 或 MQ Consumer，类似逻辑
    if (entryPoint.kind === "scheduled" || entryPoint.kind === "mq_consumer") {
      const escapedClass = escapeCypherString(entryPoint.className);

      const cypher = `
        MATCH (entryClass:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(entryMethod:Method)
        WHERE entryClass.name = '${escapedClass}'
        MATCH (entryMethod)-[call:CodeRelation {type: 'CALLS'}]->(serviceMethod:Method)
        MATCH (serviceClass:Class)-[hm2:CodeRelation {type: 'HAS_METHOD'}]->(serviceMethod)
        WHERE serviceClass.name =~ '.*Service.*'
        AND NOT serviceClass.filePath CONTAINS 'test'
        RETURN DISTINCT serviceClass.name AS className, serviceClass.filePath AS filePath
        LIMIT 5
      `;

      const rows = await this.query(cypher);

      for (const row of rows) {
        const className = row.className as string;
        const filePath = row.filePath as string;

        if (!filePath || !className) continue;

        entryPoint.callChain.push({
          className,
          filePath,
          role: "core_logic",
        });

        services.push({
          className,
          filePath,
          module: this.getModuleName(filePath),
        });
      }
    }

    return services;
  }

  /**
   * 追溯 Service 到 Mapper（使用 CALLS 边）
   */
  private async traceServiceToMapper(
    service: ServiceInfo,
  ): Promise<MapperInfo[]> {
    const mappers: MapperInfo[] = [];

    const escapedClass = escapeCypherString(service.className);
    const escapedPath = escapeCypherString(service.filePath);

    const cypher = `
      MATCH (serviceClass:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(serviceMethod:Method)
      WHERE serviceClass.name = '${escapedClass}' AND serviceClass.filePath = '${escapedPath}'
      MATCH (serviceMethod)-[call:CodeRelation {type: 'CALLS'}]->(mapperMethod:Method)
      MATCH (mapperNode)-[hm2:CodeRelation {type: 'HAS_METHOD'}]->(mapperMethod)
      WHERE mapperNode.name =~ '.*(Mapper|Dao|Repository).*'
      AND NOT mapperNode.filePath CONTAINS 'test'
      RETURN DISTINCT mapperNode.name AS className, mapperNode.filePath AS filePath, labels(mapperNode) AS nodeLabels
      LIMIT 10
    `;

    const rows = await this.query(cypher);

    for (const row of rows) {
      const className = row.className as string;
      const filePath = row.filePath as string;

      if (!filePath || !className) continue;

      // JavaScript 正则检查：名称以 Mapper/Dao/Repository 结尾
      if (!/(Mapper|Dao|Repository)$/.test(className)) continue;

      // 查找 Mapper XML
      const xmlPath = await this.findMapperXml(filePath, className);

      mappers.push({
        className,
        filePath,
        xmlPath,
        module: this.getModuleName(filePath),
      });
    }

    return mappers;
  }

  /**
   * 从 Mapper 提取表信息
   */
  private async extractTablesFromMapper(
    mapper: MapperInfo,
  ): Promise<TableInfo[]> {
    if (!mapper.xmlPath) {
      return [];
    }

    try {
      const mapperDoc = await parseMapperFile(mapper.xmlPath);
      if (!mapperDoc) {
        return [];
      }

      const tables: TableInfo[] = [];

      for (const stmt of mapperDoc.statements) {
        // 使用 resolveStatementSql 正确处理动态 SQL 和 include
        const resolved = resolveStatementSql(stmt, mapperDoc);
        const sqlText = resolved.sql;

        const extractedTables = extractTablesFromSql(sqlText);

        for (const tableName of extractedTables) {
          if (!tables.some((t) => t.tableName === tableName)) {
            tables.push({
              tableName,
              role: "primary",
              tableType: "table",
            });
          }
        }
      }

      // 更新 mapper.tablesOperated
      mapper.tablesOperated = tables.map((t) => t.tableName);

      return tables;
    } catch {
      return [];
    }
  }

  /**
   * 查找 Mapper XML 文件
   */
  private async findMapperXml(
    javaFilePath: string,
    mapperClassName: string,
  ): Promise<string | undefined> {
    const baseName = mapperClassName.replace(/Mapper$|Dao$|Repository$/i, "");
    const possibleXmlPaths: string[] = [];

    const parts = javaFilePath.replace(/\\/g, "/").split("/");
    const srcIdx = parts.findIndex((p) => p === "src");

    if (srcIdx >= 0) {
      const projectRoot = path.join(
        this.repoPath,
        parts.slice(0, srcIdx).join("/"),
      );
      const javaIdx = parts.findIndex((p) => p === "java");

      if (javaIdx >= 0 && javaIdx + 1 < parts.length - 1) {
        const packagePath = parts
          .slice(javaIdx + 1, parts.length - 1)
          .join("/");
        possibleXmlPaths.push(
          path.join(
            projectRoot,
            "src",
            "main",
            "resources",
            packagePath,
            `${mapperClassName}.xml`,
          ),
        );
      }

      possibleXmlPaths.push(
        path.join(
          projectRoot,
          "src",
          "main",
          "resources",
          "mapper",
          `${mapperClassName}.xml`,
        ),
        path.join(
          projectRoot,
          "src",
          "main",
          "resources",
          "mapper",
          `${baseName}Mapper.xml`,
        ),
        path.join(
          projectRoot,
          "src",
          "main",
          "resources",
          "mappers",
          `${mapperClassName}.xml`,
        ),
        path.join(
          projectRoot,
          "src",
          "main",
          "resources",
          "mappers",
          `${baseName}Mapper.xml`,
        ),
        path.join(
          projectRoot,
          "src",
          "main",
          "resources",
          "mybatis",
          `${mapperClassName}.xml`,
        ),
      );
    }

    for (const xmlPath of possibleXmlPaths) {
      try {
        await fs.access(xmlPath);
        return xmlPath;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  /**
   * 根据表名查找 Entity
   */
  private async findEntityForTable(
    tableName: string,
  ): Promise<EntityInfo | undefined> {
    // 推断 Entity 类名
    const entityNameCandidates = this.inferEntityNames(tableName);

    for (const entityName of entityNameCandidates) {
      const escapedName = escapeCypherString(entityName);

      const cypher = `
        MATCH (entity:Class)
        WHERE entity.name = '${escapedName}'
        AND NOT entity.filePath CONTAINS 'test'
        RETURN entity.name AS className, entity.filePath AS filePath
        LIMIT 1
      `;

      const rows = await this.query(cypher);

      if (rows.length > 0) {
        const row = rows[0];
        const filePath = row.filePath as string;

        if (filePath) {
          return {
            className: entityName,
            filePath,
            module: this.getModuleName(filePath),
            entityRole: "canonical",
            tablesMapped: [tableName],
          };
        }
      }
    }

    return undefined;
  }

  /**
   * 推断 Entity 类名
   */
  private inferEntityNames(tableName: string): string[] {
    const pascalName = tableName
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("");

    return [
      pascalName,
      `${pascalName}Entity`,
      `${pascalName}DO`,
      `${pascalName}PO`,
    ];
  }

  /**
   * 检测跨域调用
   */
  private detectCrossDomain(
    serviceClassName: string,
    entryClassName: string,
  ): string | undefined {
    // 从 Service 类名提取域关键词（去除 Service 后缀）
    const domainHint = serviceClassName
      .replace(/Service$|ServiceImpl$/i, "")
      .toLowerCase();

    // 如果域关键词与入口类名不同，认为是跨域
    const entryDomain = entryClassName
      .replace(/Controller$|AppController$/i, "")
      .toLowerCase();

    if (domainHint !== entryDomain && domainHint.length > 2) {
      return domainHint;
    }

    return undefined;
  }
}

/**
 * 创建 TraceChainBuilder 实例
 */
export function createTraceChainBuilder(
  query: ReadOnlyQueryExecutor,
  repoPath: string,
  moduleTopology?: ModuleTopology,
): TraceChainBuilder {
  return new TraceChainBuilder(query, repoPath, moduleTopology);
}
