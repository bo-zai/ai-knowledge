/**
 * Controller 路径发现
 *
 * 实现 Controller 入口点的完整追溯链路：
 * Controller -> Service -> Mapper -> Table -> Entity
 */

import type { LanguageAdapter, EntryPointInfo } from "../types.js";
import {
  BasePathDiscovery,
  type BasePathDiscoveryConfig,
} from "./base-path-discovery.js";

/**
 * Controller 路径发现配置
 */
export type ControllerPathDiscoveryConfig = BasePathDiscoveryConfig;

/**
 * Controller 路径发现
 *
 * 从 Controller 入口点追溯完整的调用链路，最终到达数据表和实体类。
 */
export class ControllerPathDiscovery extends BasePathDiscovery {
  protected readonly pathway = "controller" as const;
  protected readonly entryPointKind = "controller" as const;

  /**
   * 格式化入口点名称用于错误信息
   */
  protected formatEntryPointName(ep: EntryPointInfo): string {
    return ep.className;
  }
}

/**
 * 创建 ControllerPathDiscovery 实例的便捷函数
 *
 * @param adapter - 语言适配器
 * @param modulePath - 模块路径
 * @param config - 配置选项
 * @returns ControllerPathDiscovery 实例
 */
export function createControllerPathDiscovery(
  adapter: LanguageAdapter,
  modulePath: string,
  config?: ControllerPathDiscoveryConfig,
): ControllerPathDiscovery {
  return new ControllerPathDiscovery(adapter, modulePath, config);
}
