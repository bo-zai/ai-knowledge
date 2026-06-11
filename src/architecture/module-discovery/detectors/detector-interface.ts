/**
 * 模块探测器接口
 *
 * 定义所有探测器必须实现的接口，支持策略模式扩展
 */

import type { ModuleInfo } from '../../../schemas/module.js';

/**
 * 探测结果
 */
export interface DetectionResult {
  /** 探测器名称 */
  detectorName: string;

  /** 发现的模块列表 */
  modules: ModuleInfo[];

  /** 探测层级 */
  layer: 'root-build-system' | 'sub-project' | 'nested';

  /** 探测是否成功 */
  success: boolean;

  /** 错误信息（可选） */
  error?: string;
}

/**
 * 探测选项
 */
export interface DetectionOptions {
  /** 已发现的模块路径（用于去重） */
  discoveredPaths?: Set<string>;

  /** 最大递归深度 */
  maxDepth?: number;
}

/**
 * 模块探测器接口
 *
 * 所有探测器必须实现此接口
 */
export interface ModuleDetector {
  /** 探测器名称 */
  readonly name: string;

  /** 探测器优先级（数字越小优先级越高） */
  readonly priority: number;

  /** 探测层级 */
  readonly layer: 'root-build-system' | 'sub-project' | 'nested';

  /**
   * 检查该探测器是否适用于当前路径
   *
   * 用于短路优化：如果 canDetect 返回 false，跳过 detect
   */
  canDetect(repoPath: string): Promise<boolean>;

  /**
   * 执行探测，返回发现的模块
   *
   * @param repoPath 仓库路径
   * @param options 探测选项
   */
  detect(repoPath: string, options?: DetectionOptions): Promise<DetectionResult>;
}

/**
 * 探测器基类
 *
 * 提供通用功能，减少重复代码
 */
export abstract class BaseDetector implements ModuleDetector {
  abstract readonly name: string;
  abstract readonly priority: number;
  abstract readonly layer: 'root-build-system' | 'sub-project' | 'nested';

  abstract canDetect(repoPath: string): Promise<boolean>;
  abstract detect(repoPath: string, options?: DetectionOptions): Promise<DetectionResult>;

  /**
   * 创建成功的探测结果
   */
  protected createSuccessResult(modules: ModuleInfo[]): DetectionResult {
    return {
      detectorName: this.name,
      modules,
      layer: this.layer,
      success: true,
    };
  }

  /**
   * 创建失败的探测结果
   */
  protected createEmptyResult(): DetectionResult {
    return {
      detectorName: this.name,
      modules: [],
      layer: this.layer,
      success: false,
    };
  }

  /**
   * 创建错误的探测结果
   */
  protected createErrorResult(error: string): DetectionResult {
    return {
      detectorName: this.name,
      modules: [],
      layer: this.layer,
      success: false,
      error,
    };
  }
}