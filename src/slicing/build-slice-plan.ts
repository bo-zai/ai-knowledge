import type { SlicePlan, SliceSeed } from './types.js';
import { discoverSlices, countByKind } from './discover-slices.js';

export function buildSlicePlan(input: {
  routes: string[];
  processes: string[];
  tools: string[];
  communities: string[];
  tables: string[];
}): SlicePlan {
  const slices = discoverSlices(input);
  const by_kind = countByKind(slices);
  return {
    slices,
    total_count: slices.length,
    by_kind,
  };
}

// 从 GitNexus 查询结果提取切片种子
export function extractSliceSeedsFromGitNexus(gitnexusOutput: string): {
  routes: string[];
  processes: string[];
  tools: string[];
  communities: string[];
  tables: string[];
} {
  // 解析 GitNexus 输出（简化实现，后续可根据实际输出格式调整）
  const lines = gitnexusOutput.split('\n');
  const routes: string[] = [];
  const processes: string[] = [];
  const tools: string[] = [];
  const communities: string[] = [];
  const tables: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Route:')) {
      routes.push(trimmed.replace('Route:', '').trim());
    } else if (trimmed.startsWith('Process:')) {
      processes.push(trimmed.replace('Process:', '').trim());
    } else if (trimmed.startsWith('Tool:')) {
      tools.push(trimmed.replace('Tool:', '').trim());
    } else if (trimmed.startsWith('Community:')) {
      communities.push(trimmed.replace('Community:', '').trim());
    } else if (trimmed.startsWith('Table:')) {
      tables.push(trimmed.replace('Table:', '').trim());
    }
  }

  return { routes, processes, tools, communities, tables };
}