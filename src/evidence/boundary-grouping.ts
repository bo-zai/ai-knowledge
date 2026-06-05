/**
 * Boundary Evidence Grouping Module
 *
 * 两阶段分组方案：
 * 阶段1：LLM 分析配置文件列表，按业务领域分组
 * 阶段2：每组独立调用 LLM 生成边界知识
 */

import { logger } from '../shared/logger.js';
import type { LlmClaimsProvider } from '../generation/knowledge-generator.js';

/**
 * 配置文件信息
 */
export interface ConfigFileInfo {
  name: string;
  path: string;
}

/**
 * 分组结果
 */
export interface BoundaryGroup {
  group_name: string;
  group_description: string;
  files: ConfigFileInfo[];
}

/**
 * LLM 分组输出
 */
export interface GroupingOutput {
  groups: BoundaryGroup[];
}

/**
 * 分组阶段提示词
 */
const GROUPING_SYSTEM_PROMPT = `你是配置文件分析专家。根据配置文件列表，按业务领域分组。

## 分组规则

1. 同一业务领域的配置放入同一组
2. 业务领域示例：
   - 支付（pay、payment、wxpay、alipay）
   - 短信（sms、message、notify）
   - 缓存（redis、cache、memcache）
   - 数据库（db、mysql、datasource、jdbc）
   - 存储（oss、storage、file、upload）
   - 定时任务（job、schedule、quartz、task）
   - 安全认证（auth、security、login、token）
   - 日志（log、logger）
   - 通用配置（application、config、bootstrap）
   - 其他（无法判断的）

3. 每组建议包含 1-5 个文件
4. 单个文件也可以独立成组

## 输出格式

只输出 JSON，格式如下：

{
  "groups": [
    {
      "group_name": "支付配置",
      "group_description": "支付渠道相关配置",
      "files": [
        {"name": "wxpay.properties", "path": "src/main/resources/property/wxpay.properties"}
      ]
    }
  ]
}

不输出任何解释或注释。`;

/**
 * 构建分组用户提示词
 */
function buildGroupingUserPrompt(configFiles: ConfigFileInfo[]): string {
  const fileList = configFiles.map(f =>
    JSON.stringify({ name: f.name, path: f.path })
  ).join(',\n  ');

  return `请对以下配置文件列表进行分组：

[
  ${fileList}
]

输出分组结果 JSON。`;
}

/**
 * 阶段1：LLM 分组
 */
export async function groupBoundaryConfigs(
  configFiles: ConfigFileInfo[],
  claimsProvider: LlmClaimsProvider,
): Promise<BoundaryGroup[]> {
  if (configFiles.length === 0) {
    return [];
  }

  // 单文件或少量文件：不分组，直接返回
  if (configFiles.length <= 3) {
    return [{
      group_name: '配置文件',
      group_description: '项目配置文件',
      files: configFiles,
    }];
  }

  const userPrompt = buildGroupingUserPrompt(configFiles);

  try {
    const result = await claimsProvider(GROUPING_SYSTEM_PROMPT, userPrompt);
    const parsed = parseGroupingOutput(result.rawText);

    if (parsed.groups.length > 0) {
      logger.debug(`LLM 分组完成：${parsed.groups.length} 组`);
      return parsed.groups;
    }
  } catch (error) {
    logger.warn(`LLM 分组失败，使用默认分组：${error}`);
  }

  // 备用：等量分组
  return fallbackGrouping(configFiles);
}

/**
 * 解析分组输出
 */
function parseGroupingOutput(rawText: string): GroupingOutput {
  let jsonText = rawText.trim();

  // 移除 markdown code blocks
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7);
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();

  try {
    const parsed = JSON.parse(jsonText);
    if (parsed.groups && Array.isArray(parsed.groups)) {
      return { groups: parsed.groups };
    }
    return { groups: [] };
  } catch {
    return { groups: [] };
  }
}

/**
 * 备用分组：等量拆分
 */
function fallbackGrouping(configFiles: ConfigFileInfo[]): BoundaryGroup[] {
  const groupSize = 4;
  const groups: BoundaryGroup[] = [];

  for (let i = 0; i < configFiles.length; i += groupSize) {
    const chunk = configFiles.slice(i, i + groupSize);
    groups.push({
      group_name: `配置组${groups.length + 1}`,
      group_description: `配置文件组 ${groups.length + 1}`,
      files: chunk,
    });
  }

  return groups;
}

/**
 * 生成阶段提示词模板
 */
export function buildBoundaryGenerationPrompt(group: BoundaryGroup): {
  system: string;
  user: string;
} {
  const systemPrompt = `你是边界知识提取专家。从配置文件中提取边界知识（局限性和禁用功能）。

## 输出要求

1. 输出 objects 数组，每个独立边界单独成对象
2. 该组包含 ${group.files.length} 个配置文件，请仔细分析每个文件
3. 每个配置文件至少提取一条边界知识

## 边界知识字段

每个边界知识必须包含：
- boundary_title：边界标题（业务化命名）
- summary_zh：一句话定位（简洁事实）
- boundary_type：limitation（局限性）或 disabled_feature（禁用功能）
- detailed_description_zh：详细说明（直接陈述事实，不包含解释或"这意味着"）
- aliases：别名（必须包含英文标识符）
- related_capability：关联能力
- evidence：证据路径列表
- applicable_scope：适用范围
- tags：标签（1-3个）

## 详细说明示例

反面（包含解释）：
"在项目配置中只发现了微信支付配置文件。这意味着应用仅支持微信支付一种渠道。"

正面（简洁事实）：
"项目只配置了微信支付（wxpay.properties），未发现支付宝配置文件。"

## 输出格式

{
  "objects": [
    {
      "boundary_title": "...",
      "summary_zh": "...",
      ...
    }
  ]
}

只输出 JSON，不输出解释或注释。`;

  const fileList = group.files.map(f =>
    `- ${f.name} (${f.path})`
  ).join('\n');

  const userPrompt = `分析以下 ${group.group_name}：

${fileList}

提取边界知识，输出 objects 数组。`;

  return { system: systemPrompt, user: userPrompt };
}