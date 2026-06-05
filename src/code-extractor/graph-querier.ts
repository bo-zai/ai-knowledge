/**
 * 图数据库查询器
 *
 * 从 LadybugDB 查询 Class 节点及其 Property/Method 成员。
 * 优先路径：利用已有的 Tree-sitter 解析结果，避免重新解析文件。
 */

import type { Connection } from '@ladybugdb/core';
import {
  openLbugConnection,
  closeLbugConnection,
  type LbugConnectionHandle,
} from '../engine/lbug/lbug-config.js';
import type {
  GraphClassNode,
  GraphPropertyNode,
  GraphMethodNode,
} from './types.js';

/**
 * 多语言表名需要反引号转义
 */
const BACKTICK_TABLES = new Set([
  'Struct',
  'Enum',
  'Macro',
  'Typedef',
  'Union',
  'Namespace',
  'Trait',
  'Impl',
  'TypeAlias',
  'Const',
  'Static',
  'Property',
  'Record',
  'Delegate',
  'Annotation',
  'Constructor',
  'Template',
  'Module',
]);

function escapeTableName(table: string): string {
  return BACKTICK_TABLES.has(table) ? `\`${table}\`` : table;
}

/**
 * 查询类节点
 *
 * @param conn - LadybugDB 连接
 * @param filePath - 文件路径
 * @param className - 类名
 * @returns 类节点，或 null 表示未找到
 */
export async function queryClassNode(
  conn: Connection,
  filePath: string,
  className: string,
): Promise<GraphClassNode | null> {
  const escapedPath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const escapedName = className.replace(/'/g, "''");

  try {
    const result = await conn.query(`
      MATCH (c:Class)
      WHERE c.filePath = '${escapedPath}' AND c.name = '${escapedName}'
      RETURN c.id AS id, c.name AS name, c.filePath AS filePath,
             c.startLine AS startLine, c.endLine AS endLine,
             c.content AS content, c.description AS description
      LIMIT 1
    `);
    const queryResult = Array.isArray(result) ? result[0] : result;
    const rows = await queryResult.getAll();
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: String(row.id ?? row[0] ?? ''),
      name: String(row.name ?? row[1] ?? className),
      filePath: String(row.filePath ?? row[2] ?? filePath),
      startLine: Number(row.startLine ?? row[3] ?? 0),
      endLine: Number(row.endLine ?? row[4] ?? 0),
      content: row.content ?? row[5] ? String(row.content ?? row[5]) : undefined,
      description: row.description ?? row[6] ? String(row.description ?? row[6]) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 查询类的 Property 节点
 *
 * @param conn - LadybugDB 连接
 * @param classId - 类节点 ID
 * @returns Property 节点列表
 */
export async function queryClassProperties(
  conn: Connection,
  classId: string,
): Promise<GraphPropertyNode[]> {
  const escapedId = classId.replace(/'/g, "''");
  const propertyTable = escapeTableName('Property');

  try {
    const result = await conn.query(`
      MATCH (c:Class {id: '${escapedId}'})-[r:CodeRelation {type: 'HAS_PROPERTY'}]->(p:${propertyTable})
      RETURN p.id AS id, p.name AS name, p.filePath AS filePath,
             p.startLine AS startLine, p.endLine AS endLine, p.content AS content
      ORDER BY p.startLine
    `);
    const queryResult = Array.isArray(result) ? result[0] : result;
    const rows = await queryResult.getAll();

    return rows.map((row) => ({
      id: String(row.id ?? row[0] ?? ''),
      name: String(row.name ?? row[1] ?? ''),
      filePath: String(row.filePath ?? row[2] ?? ''),
      startLine: Number(row.startLine ?? row[3] ?? 0),
      endLine: Number(row.endLine ?? row[4] ?? 0),
      content: row.content ?? row[5] ? String(row.content ?? row[5]) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * 查询类的 Method 节点
 *
 * @param conn - LadybugDB 连接
 * @param classId - 类节点 ID
 * @returns Method 节点列表
 */
export async function queryClassMethods(
  conn: Connection,
  classId: string,
): Promise<GraphMethodNode[]> {
  const escapedId = classId.replace(/'/g, "''");

  try {
    const result = await conn.query(`
      MATCH (c:Class {id: '${escapedId}'})-[r:CodeRelation {type: 'HAS_METHOD'}]->(m:Method)
      RETURN m.id AS id, m.name AS name, m.filePath AS filePath,
             m.startLine AS startLine, m.endLine AS endLine,
             m.content AS content, m.parameterCount AS parameterCount, m.returnType AS returnType
      ORDER BY m.startLine
    `);
    const queryResult = Array.isArray(result) ? result[0] : result;
    const rows = await queryResult.getAll();

    return rows.map((row) => ({
      id: String(row.id ?? row[0] ?? ''),
      name: String(row.name ?? row[1] ?? ''),
      filePath: String(row.filePath ?? row[2] ?? ''),
      startLine: Number(row.startLine ?? row[3] ?? 0),
      endLine: Number(row.endLine ?? row[4] ?? 0),
      content: row.content ?? row[5] ? String(row.content ?? row[5]) : undefined,
      parameterCount: Number(row.parameterCount ?? row[6] ?? 0),
      returnType: row.returnType ?? row[7] ? String(row.returnType ?? row[7]) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * 批量查询多个类的图数据
 *
 * @param dbPath - 图数据库路径
 * @param candidates - 类候选列表
 * @returns 查询结果映射
 */
export async function batchQueryGraphData(
  dbPath: string,
  candidates: Array<{ filePath: string; className: string }>,
): Promise<Map<string, { classNode: GraphClassNode; properties: GraphPropertyNode[]; methods: GraphMethodNode[] } | null>> {
  const results = new Map<string, { classNode: GraphClassNode; properties: GraphPropertyNode[]; methods: GraphMethodNode[] } | null>();

  if (candidates.length === 0) return results;

  const handle = await openLbugConnectionWithRetry(dbPath);
  if (!handle) {
    // 所有候选都标记为 null
    for (const c of candidates) {
      results.set(`${c.filePath}:${c.className}`, null);
    }
    return results;
  }

  try {
    for (const candidate of candidates) {
      const classNode = await queryClassNode(handle.conn, candidate.filePath, candidate.className);
      if (!classNode) {
        results.set(`${candidate.filePath}:${candidate.className}`, null);
        continue;
      }

      const properties = await queryClassProperties(handle.conn, classNode.id);
      const methods = await queryClassMethods(handle.conn, classNode.id);

      results.set(`${candidate.filePath}:${candidate.className}`, {
        classNode,
        properties,
        methods,
      });
    }
  } finally {
    await closeLbugConnection(handle);
  }

  return results;
}

/**
 * 带重试的连接打开
 */
async function openLbugConnectionWithRetry(dbPath: string): Promise<LbugConnectionHandle | null> {
  try {
    const lbug = await import('@ladybugdb/core');
    return await openLbugConnection(lbug.default, dbPath);
  } catch {
    return null;
  }
}