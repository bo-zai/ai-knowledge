/**
 * Java 语言适配器（概念提取专用）
 *
 * 实现 LanguageAdapter 接口，用于从 Java/Spring 项目中提取概念证据。
 * 支持：
 * - 注解检测：@RestController, @Controller, @Scheduled, @RocketMQMessageListener 等
 * - 调用链追溯：Controller -> Service -> Mapper -> Table -> Entity
 * - MyBatis Mapper XML 表提取
 * - Entity 定位（根据表名推断 Entity 类名）
 */

import path from 'path';
import fs from 'fs/promises';
import type { LanguageAdapter, EntryPointInfo, ServiceChainNode, MapperInfo, TableInfo, EntityInfo } from '../types.js';
import { withReadOnlyLbug, type ReadOnlyQueryExecutor } from '../../../../engine/lbug/read-only-session.js';
import { getStoragePaths } from '../../../../engine/storage/repo-manager.js';
import { parseMapperFile, extractTablesFromSql } from '../../../../mybatis/mapper-parser.js';

/**
 * Java 入口点注解模式
 */
const ENTRY_POINT_ANNOTATIONS = {
  controller: ['@RestController', '@Controller'],
  scheduled: ['@Scheduled'],
  mq_consumer: ['@RocketMQMessageListener', '@KafkaListener', '@RabbitListener'],
};

/**
 * Cypher 字符串转义
 */
function escapeCypherString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * 从代码内容提取注解签名
 */
function extractAnnotationSignature(content: string, annotation: string): string | undefined {
  // 匹配注解行，如 @GetMapping("/product/list")
  const regex = new RegExp(`^\\s*${annotation.replace('@', '@')}\\s*\\([^)]*\\)`, 'm');
  const match = content.match(regex);
  return match ? match[0].trim() : undefined;
}

/**
 * 从模块路径提取模块名
 */
function extractModuleName(modulePath: string): string {
  const parts = modulePath.split(path.sep);
  // 寻找 src/main/java 之后的第一个包名作为模块名
  const srcIdx = parts.findIndex(p => p === 'src');
  if (srcIdx >= 0 && srcIdx + 3 < parts.length && parts[srcIdx + 1] === 'main' && parts[srcIdx + 2] === 'java') {
    // 取包名的最后一段作为模块名
    const packageName = parts.slice(srcIdx + 3).join('.');
    return packageName.split('.').pop() || 'unknown';
  }
  // 回退到 basename
  return path.basename(modulePath);
}

/**
 * JavaAdapter 实现
 */
export class JavaAdapter implements LanguageAdapter {
  readonly language = 'java';

  /**
   * 检测入口点（Controller、Scheduled、MQ Consumer）
   *
   * 使用图数据库查询带有特定注解的类
   */
  async detectEntryPoints(modulePath: string): Promise<EntryPointInfo[]> {
    const { lbugPath } = getStoragePaths(modulePath);

    try {
      await fs.access(lbugPath);
    } catch {
      // 图数据库不存在，使用文件扫描回退
      return this.detectEntryPointsFallback(modulePath);
    }

    return withReadOnlyLbug(lbugPath, async (query) => {
      const entryPoints: EntryPointInfo[] = [];

      // 检测 Controller 入口
      const controllerClasses = await this.queryAnnotatedClasses(query, modulePath, ENTRY_POINT_ANNOTATIONS.controller);
      for (const cls of controllerClasses) {
        entryPoints.push({
          kind: 'controller',
          className: cls.name,
          filePath: cls.filePath,
          moduleName: extractModuleName(cls.filePath),
          modulePath,
          startLine: cls.startLine,
          signature: cls.signature,
        });
      }

      // 检测 Scheduled 入口
      const scheduledClasses = await this.queryScheduledMethods(query, modulePath);
      for (const item of scheduledClasses) {
        entryPoints.push({
          kind: 'scheduled',
          className: item.className,
          filePath: item.filePath,
          moduleName: extractModuleName(item.filePath),
          modulePath,
          methodName: item.methodName,
          startLine: item.startLine,
        });
      }

      // 检测 MQ Consumer 入口
      const mqConsumers = await this.queryAnnotatedClasses(query, modulePath, ENTRY_POINT_ANNOTATIONS.mq_consumer);
      for (const cls of mqConsumers) {
        entryPoints.push({
          kind: 'mq_consumer',
          className: cls.name,
          filePath: cls.filePath,
          moduleName: extractModuleName(cls.filePath),
          modulePath,
          startLine: cls.startLine,
          signature: cls.signature,
        });
      }

      return entryPoints;
    });
  }

  /**
   * 从入口点追溯到 Service 层
   *
   * 通过 CALLS 边追溯调用链，直到找到 Service 类
   */
  async traceToService(entryPoint: EntryPointInfo): Promise<ServiceChainNode[]> {
    const { lbugPath } = getStoragePaths(entryPoint.modulePath);

    try {
      await fs.access(lbugPath);
    } catch {
      // 图数据库不存在，返回空
      return [];
    }

    return withReadOnlyLbug(lbugPath, async (query) => {
      const serviceChain: ServiceChainNode[] = [];

      // 从入口类的方法追溯调用链
      const escapedClass = escapeCypherString(entryPoint.className);
      const escapedPath = escapeCypherString(entryPoint.filePath);

      // 查找入口类的方法调用的 Service 类
      const cypher = `
        MATCH (entryClass:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(entryMethod:Method)
        WHERE entryClass.name = '${escapedClass}' AND entryClass.filePath = '${escapedPath}'
        MATCH (entryMethod)-[call:CodeRelation {type: 'CALLS'}]->(targetMethod:Method)
        MATCH (targetClass:Class)-[hm2:CodeRelation {type: 'HAS_METHOD'}]->(targetMethod)
        WHERE targetClass.name =~ '(?i).*Service$'
        AND NOT targetClass.filePath =~ '(?i).*(test|spec).*'
        RETURN DISTINCT
          targetClass.name AS className,
          targetClass.filePath AS filePath,
          entryMethod.name AS callingMethod,
          targetMethod.name AS calledMethod,
          targetMethod.startLine AS startLine
        LIMIT 20
      `;

      const rows = await query(cypher);

      for (const row of rows) {
        const className = row.className as string;
        const filePath = row.filePath as string;
        const startLine = row.startLine as number | undefined;

        if (!filePath || !className) continue;

        // 避免重复
        if (serviceChain.some(s => s.className === className && s.filePath === filePath)) continue;

        serviceChain.push({
          className,
          filePath,
          moduleName: extractModuleName(filePath),
          modulePath: entryPoint.modulePath,
          startLine: startLine ?? 0,
        });
      }

      return serviceChain;
    });
  }

  /**
   * 从 Service 追溯到 Mapper
   *
   * 通过 CALLS 边找到被 Service 调用的 Mapper 接口
   */
  async traceToMapper(serviceNode: ServiceChainNode): Promise<MapperInfo[]> {
    const { lbugPath } = getStoragePaths(serviceNode.modulePath);

    try {
      await fs.access(lbugPath);
    } catch {
      return [];
    }

    return withReadOnlyLbug(lbugPath, async (query) => {
      const mappers: MapperInfo[] = [];

      const escapedClass = escapeCypherString(serviceNode.className);
      const escapedPath = escapeCypherString(serviceNode.filePath);

      // 查找 Service 调用的 Mapper 类（Mapper 或 Dao 后缀）
      const cypher = `
        MATCH (serviceClass:Class)-[hm:CodeRelation {type: 'HAS_METHOD'}]->(serviceMethod:Method)
        WHERE serviceClass.name = '${escapedClass}' AND serviceClass.filePath = '${escapedPath}'
        MATCH (serviceMethod)-[call:CodeRelation {type: 'CALLS'}]->(mapperMethod:Method)
        MATCH (mapperClass:Class)-[hm2:CodeRelation {type: 'HAS_METHOD'}]->(mapperMethod)
        WHERE mapperClass.name =~ '(?i).*(Mapper|Dao|Repository)$'
        AND NOT mapperClass.filePath =~ '(?i).*(test|spec).*'
        RETURN DISTINCT
          mapperClass.name AS className,
          mapperClass.filePath AS filePath,
          mapperMethod.name AS methodName
        LIMIT 30
      `;

      const rows = await query(cypher);

      // 收集 Mapper 类和对应的方法
      const mapperClassMap = new Map<string, { filePath: string; sqlIds: string[] }>();

      for (const row of rows) {
        const className = row.className as string;
        const filePath = row.filePath as string;
        const methodName = row.methodName as string;

        if (!filePath || !className) continue;

        const key = `${className}:${filePath}`;
        if (!mapperClassMap.has(key)) {
          mapperClassMap.set(key, { filePath, sqlIds: [] });
        }
        if (methodName) {
          mapperClassMap.get(key)!.sqlIds.push(methodName);
        }
      }

      // 查找对应的 Mapper XML 文件
      for (const [className, info] of mapperClassMap.entries()) {
        const xmlPath = await this.findMapperXml(info.filePath, className);

        mappers.push({
          className: className.split(':')[0],
          filePath: info.filePath,
          moduleName: extractModuleName(info.filePath),
          modulePath: serviceNode.modulePath,
          xmlPath,
          sqlIds: info.sqlIds,
        });
      }

      return mappers;
    });
  }

  /**
   * 从 Mapper 提取表信息
   *
   * 解析 Mapper XML 文件，提取 SQL 中的表名
   */
  async extractTableFromMapper(mapper: MapperInfo): Promise<TableInfo[]> {
    // 如果没有 XML 文件，返回空
    if (!mapper.xmlPath) {
      return [];
    }

    try {
      const mapperDoc = await parseMapperFile(mapper.xmlPath);
      if (!mapperDoc) {
        return [];
      }

      const tables: TableInfo[] = [];

      // 从每个 SQL 语句提取表名
      for (const stmt of mapperDoc.statements) {
        // 合并 SQL 片段（暂时忽略 include 引用）
        const sqlParts = stmt.rawSqlParts
          .filter((p: { kind: string; value: string }) => p.kind === 'text')
          .map((p: { kind: string; value: string }) => p.value)
          .join(' ');

        const extractedTables = extractTablesFromSql(sqlParts);

        for (const tableName of extractedTables) {
          // 避免重复
          if (tables.some(t => t.tableName === tableName)) continue;

          tables.push({
            tableName,
            columns: [], // TODO: 从 resultMap 提取列名
          });
        }
      }

      return tables;
    } catch {
      return [];
    }
  }

  /**
   * 根据表名查找对应的 Entity 类
   *
   * 策略：根据表名推断 Entity 类名（如 user_order -> UserOrder 或 UserOrderEntity）
   */
  async findEntityForTable(table: TableInfo, modulePath: string): Promise<EntityInfo | undefined> {
    const { lbugPath } = getStoragePaths(modulePath);

    try {
      await fs.access(lbugPath);
    } catch {
      return undefined;
    }

    // 推断 Entity 类名
    const entityNameCandidates = this.inferEntityNames(table.tableName);

    return withReadOnlyLbug(lbugPath, async (query) => {
      for (const entityName of entityNameCandidates) {
        const escapedName = escapeCypherString(entityName);

        // 查找 Entity 类
        const cypher = `
          MATCH (entity:Class)
          WHERE entity.name = '${escapedName}'
          AND NOT entity.filePath =~ '(?i).*(test|spec).*'
          RETURN entity.name AS name, entity.filePath AS filePath, entity.startLine AS startLine
          LIMIT 1
        `;

        const rows = await query(cypher);

        if (rows.length > 0) {
          const row = rows[0];
          const filePath = row.filePath as string;
          const startLine = row.startLine as number | undefined;

          if (filePath) {
            // 获取类的字段列表
            const fields = await this.queryClassFields(query, filePath, entityName);

            return {
              className: entityName,
              filePath,
              moduleName: extractModuleName(filePath),
              modulePath,
              fields,
              startLine: startLine ?? 0,
            };
          }
        }
      }

      return undefined;
    });
  }

  // ---- 私有辅助方法 ----

  /**
   * 查询带有特定注解的类
   */
  private async queryAnnotatedClasses(
    query: ReadOnlyQueryExecutor,
    modulePath: string,
    annotations: string[],
  ): Promise<Array<{ name: string; filePath: string; startLine: number; signature?: string }>> {
    // 图数据库中没有 annotations 属性，从 content 中搜索注解
    // 同时支持从 name 搜索（如 Controller 结尾的类）
    const annotationPattern = annotations.map(a => a.replace('@', '').replace(/'/g, "''")).join('|');
    // filePath 是相对路径，不使用 STARTS WITH 绝对路径限制

    // 方案: 从 name 搜索包含注解名或结尾的类
    const cypher = `
      MATCH (c:Class)
      WHERE c.name =~ '(?i).*(${annotationPattern}).*'
      OR c.content =~ '(?i).*(${annotationPattern}).*'
      AND NOT c.filePath =~ '(?i).*(test|spec).*'
      RETURN c.name AS name, c.filePath AS filePath, c.startLine AS startLine, c.content AS content
      LIMIT 50
    `;

    const rows = await query(cypher);
    const results: Array<{ name: string; filePath: string; startLine: number; signature?: string }> = [];

    for (const row of rows) {
      const name = row.name as string;
      const filePath = row.filePath as string;
      const startLine = row.startLine as number | undefined;
      const content = row.content as string | undefined;

      if (!filePath || !name) continue;

      // 提取路由签名（对于 Controller）
      let signature: string | undefined;
      if (content && annotations.some(a => a.includes('Controller'))) {
        // 尝试提取 HTTP 方法注解
        for (const httpMethod of ['@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@RequestMapping']) {
          const sig = extractAnnotationSignature(content, httpMethod);
          if (sig) {
            signature = sig;
            break;
          }
        }
      }

      results.push({
        name,
        filePath,
        startLine: startLine ?? 0,
        signature,
      });
    }

    return results;
  }

  /**
   * 查询带有 @Scheduled 注解的方法
   */
  private async queryScheduledMethods(
    query: ReadOnlyQueryExecutor,
    modulePath: string,
  ): Promise<Array<{ className: string; filePath: string; methodName: string; startLine: number }>> {
    // 从 Class 的 content 搜索 @Scheduled 注解，不限制路径
    const cypher = `
      MATCH (c:Class)
      WHERE c.content =~ '(?i).*Scheduled.*'
      AND NOT c.filePath =~ '(?i).*(test|spec).*'
      RETURN c.name AS className, c.filePath AS filePath, c.startLine AS startLine
      LIMIT 30
    `;

    const rows = await query(cypher);
    const results: Array<{ className: string; filePath: string; methodName: string; startLine: number }> = [];

    for (const row of rows) {
      const className = row.className as string;
      const filePath = row.filePath as string;
      const methodName = row.methodName as string;
      const startLine = row.startLine as number | undefined;

      if (!filePath || !className || !methodName) continue;

      results.push({
        className,
        filePath,
        methodName,
        startLine: startLine ?? 0,
      });
    }

    return results;
  }

  /**
   * 查询类的字段列表
   */
  private async queryClassFields(
    query: ReadOnlyQueryExecutor,
    filePath: string,
    className: string,
  ): Promise<string[]> {
    const escapedPath = escapeCypherString(filePath);
    const escapedClass = escapeCypherString(className);

    const cypher = `
      MATCH (c:Class)-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:Property)
      WHERE c.name = '${escapedClass}' AND c.filePath = '${escapedPath}'
      RETURN p.name AS name
      ORDER BY p.startLine
    `;

    const rows = await query(cypher);
    return rows.map(r => r.name as string).filter(Boolean);
  }

  /**
   * 查找 Mapper XML 文件
   */
  private async findMapperXml(javaFilePath: string, mapperClassName: string): Promise<string | undefined> {
    // 从 Java 文件路径推断 XML 文件位置
    // 通常在 resources/mapper 或 resources/mybatis 目录下
    const baseName = mapperClassName.replace(/Mapper$|Dao$|Repository$/i, '');
    const possibleXmlPaths: string[] = [];

    // 标准路径推断
    const srcIdx = javaFilePath.split(path.sep).findIndex(p => p === 'src');
    if (srcIdx >= 0) {
      const projectRoot = javaFilePath.split(path.sep).slice(0, srcIdx).join(path.sep);

      // 常见的 Mapper XML 位置
      possibleXmlPaths.push(
        path.join(projectRoot, 'src', 'main', 'resources', 'mapper', `${mapperClassName}.xml`),
        path.join(projectRoot, 'src', 'main', 'resources', 'mapper', `${baseName}Mapper.xml`),
        path.join(projectRoot, 'src', 'main', 'resources', 'mybatis', `${mapperClassName}.xml`),
        path.join(projectRoot, 'src', 'main', 'resources', 'mybatis', `${baseName}Mapper.xml`),
        path.join(projectRoot, 'src', 'main', 'resources', `${mapperClassName}.xml`),
      );
    }

    // 尝试每个可能的路径
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
   * 根据表名推断 Entity 类名
   */
  private inferEntityNames(tableName: string): string[] {
    // snake_case -> PascalCase
    const pascalName = tableName
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('');

    // 常见的 Entity 命名模式
    return [
      pascalName,
      `${pascalName}Entity`,
      `${pascalName}DO`,
      `${pascalName}PO`,
    ];
  }

  /**
   * 文件扫描回退（当图数据库不存在时）
   */
  private async detectEntryPointsFallback(modulePath: string): Promise<EntryPointInfo[]> {
    const entryPoints: EntryPointInfo[] = [];

    try {
      const { glob } = await import('glob');
      const javaFiles = await glob('**/*.java', {
        cwd: modulePath,
        absolute: true,
        ignore: ['**/test/**', '**/spec/**', '**/target/**'],
      });

      for (const filePath of javaFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');

          // 检查 Controller
          if (ENTRY_POINT_ANNOTATIONS.controller.some(ann => content.includes(ann))) {
            const classMatch = content.match(/public\s+class\s+(\w+)/);
            if (classMatch) {
              const lineMatch = content.substring(0, content.indexOf(classMatch[0])).split('\n');
              entryPoints.push({
                kind: 'controller',
                className: classMatch[1],
                filePath,
                moduleName: extractModuleName(filePath),
                modulePath,
                startLine: lineMatch.length,
              });
            }
          }

          // 检查 MQ Consumer
          if (ENTRY_POINT_ANNOTATIONS.mq_consumer.some(ann => content.includes(ann))) {
            const classMatch = content.match(/public\s+class\s+(\w+)/);
            if (classMatch) {
              const lineMatch = content.substring(0, content.indexOf(classMatch[0])).split('\n');
              entryPoints.push({
                kind: 'mq_consumer',
                className: classMatch[1],
                filePath,
                moduleName: extractModuleName(filePath),
                modulePath,
                startLine: lineMatch.length,
              });
            }
          }

          // 检查 @Scheduled 方法
          if (content.includes('@Scheduled')) {
            const classMatch = content.match(/public\s+class\s+(\w+)/);
            const methodMatches = content.matchAll(/(?:public|private)\s+\w+\s+(\w+)\s*\([^)]*\)\s*\{[^}]*@Scheduled/g);
            if (classMatch) {
              for (const methodMatch of methodMatches) {
                const lineMatch = content.substring(0, content.indexOf(methodMatch[0])).split('\n');
                entryPoints.push({
                  kind: 'scheduled',
                  className: classMatch[1],
                  filePath,
                  moduleName: extractModuleName(filePath),
                  modulePath,
                  methodName: methodMatch[1],
                  startLine: lineMatch.length,
                });
              }
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      // glob 失败
    }

    return entryPoints;
  }
}

/**
 * 创建 Java 语言适配器实例
 */
export function createJavaAdapter(): JavaAdapter {
  return new JavaAdapter();
}