/**
 * 模块拓扑定义
 *
 * 多模块项目的模块结构、依赖关系和角色信息。
 * 用于分析单元划分和 modules.json 生成。
 */

import { z } from 'zod';

/**
 * 模块角色类型
 *
 * - deployable: 可独立部署的服务/应用
 * - shared: 被其他模块依赖的共享模块（库、公共组件）
 */
export const ModuleRoleSchema = z.enum(['deployable', 'shared']);

export type ModuleRole = z.infer<typeof ModuleRoleSchema>;

/**
 * 模块类型
 *
 * 按构建系统分类
 */
export const ModuleTypeSchema = z.enum([
  'java-maven-module',
  'java-gradle-module',
  'npm-package',
  'go-module',
  'rust-crate',
  'python-package',
  'other',
]);

export type ModuleType = z.infer<typeof ModuleTypeSchema>;

/**
 * 模块信息
 *
 * 单个模块的完整描述
 */
export const ModuleInfoSchema = z.object({
  /** 模块名（如 mall-admin） */
  name: z.string().min(1),

  /** 模块相对路径（如 mall-admin/） */
  path: z.string().min(1),

  /** 模块类型 */
  type: ModuleTypeSchema,

  /** 模块角色 */
  role: ModuleRoleSchema,

  /** 模块用途简述 */
  description: z.string().optional(),

  /** 该模块依赖的其他模块名列表 */
  dependencies: z.array(z.string()).default([]),

  /** 使用该模块的其他模块名列表（shared 模块才有） */
  usedBy: z.array(z.string()).default([]),

  /** 入口文件路径（deployable 模块才有） */
  entryPoint: z.string().optional(),

  /** 包根路径（如 com.macro.mall.admin） */
  packageRoot: z.string().optional(),
});

export type ModuleInfo = z.infer<typeof ModuleInfoSchema>;

/**
 * 耦合模式
 *
 * - tightly-coupled: 紧耦合，一个仓库生成一份知识库
 * - loosely-coupled: 松耦合，每个可部署服务生成独立知识库
 */
export const CouplingModeSchema = z.enum(['tightly-coupled', 'loosely-coupled']);

export type CouplingMode = z.infer<typeof CouplingModeSchema>;

/**
 * 模块拓扑结构
 *
 * modules.json 的完整内容
 */
export const ModuleTopologySchema = z.object({
  /** Schema 版本 */
  schemaVersion: z.literal(1),

  /** 耦合模式 */
  couplingMode: CouplingModeSchema,

  /** 模块总数 */
  moduleCount: z.number().int().min(1),

  /** 模块列表 */
  modules: z.array(ModuleInfoSchema).min(1),

  /** 分析单元划分时间 */
  analyzedAt: z.string(),

  /** 耦合度评估信号（用于追溯划分依据） */
  couplingSignals: z.array(z.object({
    signal: z.string(),
    detected: z.boolean(),
    evidence: z.string().optional(),
  })).optional(),
});

export type ModuleTopology = z.infer<typeof ModuleTopologySchema>;

/**
 * 分析单元
 *
 * 一个 ai-knowledge/ 覆盖的代码范围
 */
export const AnalysisUnitSchema = z.object({
  /** 分析单元名称 */
  name: z.string().min(1),

  /** 覆盖的模块名列表 */
  modules: z.array(z.string()).min(1),

  /** ai-knowledge/ 的位置 */
  knowledgeDir: z.string().min(1),

  /** 是否为完整仓库 */
  isWholeRepo: z.boolean(),
});

export type AnalysisUnit = z.infer<typeof AnalysisUnitSchema>;

/**
 * 分析单元划分结果
 *
 * 包含耦合模式、模块拓扑和分析单元列表
 */
export const AnalysisUnitResultSchema = z.object({
  /** 耦合模式 */
  couplingMode: CouplingModeSchema,

  /** 模块拓扑 */
  moduleTopology: ModuleTopologySchema,

  /** 分析单元列表（紧耦合时只有一个，松耦合时多个） */
  analysisUnits: z.array(AnalysisUnitSchema).min(1),
});

export type AnalysisUnitResult = z.infer<typeof AnalysisUnitResultSchema>;

// ============================================================================
// 耦合度评估信号定义
// ============================================================================

/**
 * 耦合度评估信号
 *
 * 设计文档 04 定义的 6 个信号
 */
export const COUPLING_SIGNALS = [
  {
    id: 'shared-entities',
    name: '共享实体类',
    description: '多个模块使用同一实体类定义（如 mall-mbg 生成的实体被多个服务使用）',
  },
  {
    id: 'cross-module-calls',
    name: '跨模块调用',
    description: '模块间存在直接的代码调用（非 HTTP/API 调用）',
  },
  {
    id: 'shared-db-config',
    name: '共享数据库配置',
    description: '多个模块使用相同的数据库连接配置或共享数据源',
  },
  {
    id: 'transaction-boundary',
    name: '跨模块事务边界',
    description: '事务边界跨越多个模块（如分布式事务或同一数据库事务）',
  },
  {
    id: 'same-tech-stack',
    name: '相同技术栈',
    description: '所有模块使用相同的技术栈（如全部是 Spring Boot）',
  },
  {
    id: 'module-count',
    name: '模块数量',
    description: '模块数量 ≤ 10（超过 10 个倾向于松耦合）',
  },
] as const;

export type CouplingSignalId = typeof COUPLING_SIGNALS[number]['id'];

/**
 * 单个信号的检测结果
 */
export interface SignalDetectionResult {
  signal: CouplingSignalId;
  detected: boolean;
  evidence?: string;
}