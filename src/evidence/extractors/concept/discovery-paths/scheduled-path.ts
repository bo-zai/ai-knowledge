/**
 * Scheduled 路径发现
 *
 * 实现 Scheduled 入口点的完整追溯链路：
 * @Scheduled -> Service -> Mapper -> Table -> Entity
 */

import type {
  LanguageAdapter,
  EntryPointInfo,
} from '../types.js';
import {
  BasePathDiscovery,
  type BasePathDiscoveryConfig,
} from './base-path-discovery.js';

/**
 * Scheduled 路径发现配置
 */
export type ScheduledPathDiscoveryConfig = BasePathDiscoveryConfig;

/**
 * Scheduled 路径发现
 *
 * 从 @Scheduled 入口点追溯完整的调用链路，最终到达数据表和实体类。
 */
export class ScheduledPathDiscovery extends BasePathDiscovery {
  protected readonly pathway = 'scheduled' as const;
  protected readonly entryPointKind = 'scheduled' as const;

  /**
   * 格式化入口点名称用于错误信息
   */
  protected formatEntryPointName(ep: EntryPointInfo): string {
    const methodInfo = ep.methodName ? `.${ep.methodName}` : '';
    return `${ep.className}${methodInfo}`;
  }
}

/**
 * 创建 ScheduledPathDiscovery 实例的便捷函数
 *
 * @param adapter - 语言适配器
 * @param modulePath - 模块路径
 * @param config - 配置选项
 * @returns ScheduledPathDiscovery 实例
 */
export function createScheduledPathDiscovery(
  adapter: LanguageAdapter,
  modulePath: string,
  config?: ScheduledPathDiscoveryConfig,
): ScheduledPathDiscovery {
  return new ScheduledPathDiscovery(adapter, modulePath, config);
}