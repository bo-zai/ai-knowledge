/**
 * MQ Consumer 路径发现
 *
 * 实现 MQ Consumer 入口点的完整追溯链路：
 * @RocketMQMessageListener -> Service -> Mapper -> Table -> Entity
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
 * MQ Consumer 路径发现配置
 */
export type MqConsumerPathDiscoveryConfig = BasePathDiscoveryConfig;

/**
 * MQ Consumer 路径发现
 *
 * 从 @RocketMQMessageListener/@KafkaListener/@RabbitListener 入口点追溯完整的调用链路，
 * 最终到达数据表和实体类。
 */
export class MqConsumerPathDiscovery extends BasePathDiscovery {
  protected readonly pathway = 'mq_consumer' as const;
  protected readonly entryPointKind = 'mq_consumer' as const;

  /**
   * 格式化入口点名称用于错误信息
   */
  protected formatEntryPointName(ep: EntryPointInfo): string {
    return ep.className;
  }
}

/**
 * 创建 MqConsumerPathDiscovery 实例的便捷函数
 *
 * @param adapter - 语言适配器
 * @param modulePath - 模块路径
 * @param config - 配置选项
 * @returns MqConsumerPathDiscovery 实例
 */
export function createMqConsumerPathDiscovery(
  adapter: LanguageAdapter,
  modulePath: string,
  config?: MqConsumerPathDiscoveryConfig,
): MqConsumerPathDiscovery {
  return new MqConsumerPathDiscovery(adapter, modulePath, config);
}