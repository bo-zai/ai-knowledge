import YAML from 'yaml';
import type { ConObject } from '../schemas/contract.js';

export function renderObjectMarkdown(input: {
  frontmatter: Record<string, unknown>;
  body: string;
}): string {
  return `---\n${YAML.stringify(input.frontmatter)}---\n\n${input.body}\n`;
}

// Contract-oriented CON markdown renderer
export function renderConMarkdown(object: ConObject): string {
  const frontmatter = {
    id: object.id,
    type: object.type,
    title: object.title,
    status: object.status,
    maturity: object.maturity,
    scope: object.scope,
    repo: object.repo,
    slice_ids: object.slice_ids,
    evidence_primary: object.evidence_primary,
    evidence_secondary: object.evidence_secondary,
  };

  const sections = [
    '# Interface Summary',
    '',
    `**类型:** ${object.interface_kind}`,
    `**名称:** ${object.interface_name}`,
    `**中文名称:** ${object.interface_name_zh}`,
    '',
    '# Producer and Consumer',
    '',
    `**生产者:** ${object.producer} (${object.producer_zh})`,
    '**消费者:**',
    ...object.consumers.map((c) => `- ${c}`),
    '',
    '# Inputs',
    '',
    object.input_description_zh,
    '',
    '| 字段 | 类型 | 必填 | 描述 |',
    '|------|------|------|------|',
    ...object.input_shape.map(
      (f) => `| ${f.name} | ${f.type} | ${f.required ? '是' : '否'} | ${f.description_zh} |`,
    ),
    '',
    '# Outputs',
    '',
    object.output_description_zh,
    '',
    '| 字段 | 类型 | 必填 | 描述 |',
    '|------|------|------|------|',
    ...object.output_shape.map(
      (f) => `| ${f.name} | ${f.type} | ${f.required ? '是' : '否'} | ${f.description_zh} |`,
    ),
    '',
    '# Runtime Semantics',
    '',
    ...(object.middleware && object.middleware.length > 0
      ? ['**中间件:**', ...object.middleware.map((m) => `- ${m}`), '']
      : ['']),
    ...(object.timeout_ms ? [`**超时:** ${object.timeout_ms}ms`, ''] : []),
    ...(object.retry_policy ? [`**重试策略:** ${object.retry_policy}`, ''] : []),
    '',
    ...(object.error_shape && object.error_shape.length > 0
      ? [
          '# Error Handling',
          '',
          ...(object.error_description_zh ? [object.error_description_zh, ''] : []),
          '| 错误码 | HTTP状态 | 描述 |',
          '|--------|----------|------|',
          ...object.error_shape.map(
            (e) => `| ${e.code} | ${e.http_status ?? '-'} | ${e.message_zh} |`,
          ),
          '',
        ]
      : []),
    '# Code Anchors',
    '',
    `**入口文件:** ${object.entry_file}`,
    ...(object.entry_symbol ? [`**入口符号:** ${object.entry_symbol}`, ''] : []),
    '',
    '**相关路由:**',
    ...object.related_routes.map((r) => `- ${r}`),
    '',
    '**相关工具:**',
    ...object.related_tools.map((t) => `- ${t}`),
  ];

  const body = sections.filter((s) => s !== undefined).join('\n');

  return renderObjectMarkdown({ frontmatter, body });
}