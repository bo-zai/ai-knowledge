import type { CapabilityDocModel } from '../knowledge/capability-doc-model.js';

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function listOrFallback(items: string[], fallback: string): string[] {
  return items.length > 0 ? items : [fallback];
}

function evidenceRefs(refs: string[]): string {
  return refs.length > 0 ? refs.join(', ') : '-';
}

function pushList(lines: string[], items: string[], fallback: string): void {
  for (const item of listOrFallback(items, fallback)) {
    lines.push(`- ${item}`);
  }
}

export function renderCapabilityMarkdown(model: CapabilityDocModel): string {
  const lines: string[] = [];

  lines.push(`# ${model.title}`);
  lines.push('');

  lines.push('## 1. 能力结论');
  lines.push('');
  lines.push(model.summaryZh);
  lines.push('');
  lines.push('包含范围：');
  pushList(lines, model.includes, '当前知识包未提供更细的包含范围，需结合下方行为和代码锚点判断。');
  lines.push('');
  lines.push('不包含范围：');
  pushList(lines, model.excludes, '当前知识包未提供明确非目标；计划时不能把未证实边界当成事实。');
  lines.push('');

  lines.push('## 2. 什么时候会用到这份知识');
  lines.push('');
  pushList(lines, model.triggers, '当需求提到该能力名称、相关入口、相关数据表或相关模块时，应先阅读本文。');
  lines.push('');

  lines.push('## 3. 业务术语');
  lines.push('');
  if (model.terms.length === 0) {
    lines.push('- 当前知识包没有生成足够可靠的业务术语对象；不要从代码类名直接猜业务含义。');
  } else {
    lines.push('| 术语 | 含义 | 不等于 | 证据 |');
    lines.push('| --- | --- | --- | --- |');
    for (const term of model.terms) {
      lines.push(`| ${escapeCell(term.term)} | ${escapeCell(term.meaningZh)} | ${escapeCell(term.notEqualTo.join(', ') || '-')} | ${escapeCell(evidenceRefs(term.evidenceRefs))} |`);
    }
  }
  lines.push('');

  lines.push('## 4. 当前行为');
  lines.push('');
  if (model.behaviors.length === 0) {
    lines.push('- 当前知识包没有稳定 FLOW 对象；实现前需要从代码入口重建当前行为。');
  } else {
    for (const behavior of model.behaviors) {
      lines.push(`### ${behavior.title}`);
      lines.push('');
      lines.push(behavior.summary);
      lines.push('');
      if (behavior.steps.length > 0) {
        behavior.steps.forEach((step, index) => {
          lines.push(`${index + 1}. ${step.step} (${evidenceRefs(step.evidenceRefs)})`);
        });
      } else {
        lines.push(`- 证据：${evidenceRefs(behavior.evidenceRefs)}`);
      }
      lines.push('');
    }
  }

  lines.push('## 5. 入口与代码位置');
  lines.push('');
  if (model.codeAnchors.length === 0) {
    lines.push('- 当前知识包没有稳定 MOD 对象；不能直接给出改动面。');
  } else {
    lines.push('| 场景 | 入口/方法 | 文件 | 作用 | 证据 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const anchor of model.codeAnchors) {
      lines.push(`| ${escapeCell(anchor.role)} | ${escapeCell(anchor.symbolOrRoute)} | ${escapeCell(anchor.path)} | ${escapeCell(anchor.role)} | ${escapeCell(evidenceRefs(anchor.evidenceRefs))} |`);
    }
  }
  lines.push('');

  lines.push('## 6. 改动定位建议');
  lines.push('');
  if (model.codeAnchors.length === 0) {
    lines.push('- 没有可用代码锚点，计划前必须重新检索入口、服务和数据访问层。');
  } else {
    for (const anchor of model.codeAnchors) {
      lines.push(`### ${anchor.path}`);
      lines.push('');
      lines.push('应该修改当：');
      pushList(lines, anchor.touchWhen, '当前知识包没有提供明确 touch_when；修改前需要重新确认模块职责。');
      lines.push('');
      lines.push('不应该修改当：');
      pushList(lines, anchor.doNotTouchWhen, '当前知识包没有提供明确 do_not_touch_when；不要把模块边界当成事实。');
      lines.push('');
    }
  }

  lines.push('## 7. 数据与契约');
  lines.push('');
  if (model.dataContracts.length === 0) {
    lines.push('- 当前知识包没有稳定 CON 对象；涉及接口、SQL、表字段或事件时必须补充契约证据。');
  } else {
    for (const contract of model.dataContracts) {
      lines.push(`### ${contract.subject}`);
      lines.push('');
      lines.push(`- 类型：${contract.kind}`);
      lines.push(`- 证据：${evidenceRefs(contract.evidenceRefs)}`);
      if (contract.fields.length > 0) {
        lines.push('');
        lines.push('| 数据/字段 | 含义 | 来源 | 证据 |');
        lines.push('| --- | --- | --- | --- |');
        for (const field of contract.fields) {
          lines.push(`| ${escapeCell(field.name)} | ${escapeCell(field.meaningZh || '-')} | ${escapeCell(field.source)} | ${escapeCell(evidenceRefs(field.evidenceRefs))} |`);
        }
      }
      if (contract.caveats.length > 0) {
        lines.push('');
        lines.push('注意：');
        pushList(lines, contract.caveats, '');
      }
      lines.push('');
    }
  }

  lines.push('## 8. 不能猜的边界');
  lines.push('');
  if (model.unknowns.length === 0) {
    lines.push('- 当前知识包没有 OPEN 对象；这不代表没有未知，遇到 source of truth、验证或外部系统证据缺口仍需停下确认。');
  } else {
    for (const unknown of model.unknowns) {
      lines.push(`### ${unknown.question}`);
      lines.push('');
      lines.push('阻塞决策：');
      pushList(lines, unknown.blockedDecisions, '当前 OPEN 未声明阻塞决策，使用前需要补充。');
      lines.push('');
      lines.push('最小下一证据：');
      pushList(lines, unknown.minimalNextEvidence, '需要补充代码、测试、契约或负责人确认。');
      lines.push('');
      lines.push(`猜测风险：${unknown.riskIfGuessed}`);
      lines.push('');
    }
  }

  lines.push('## 9. 验证方式');
  lines.push('');
  for (const validation of model.validation) {
    lines.push(`### ${validation.goal}`);
    lines.push('');
    lines.push('检查项：');
    pushList(lines, validation.checks, '当前知识包没有可执行检查项。');
    lines.push('');
    lines.push('验收 oracle：');
    pushList(lines, validation.acceptanceOracle, '当前知识包没有足够证据给出验收 oracle。');
    lines.push('');
    lines.push('无法验证除非：');
    pushList(lines, validation.cannotVerifyWithout, '已有验证证据足够或不需要额外前置条件。');
    lines.push('');
    lines.push(`证据：${evidenceRefs(validation.evidenceRefs)}`);
    lines.push('');
  }

  lines.push('## 10. 证据索引');
  lines.push('');
  if (model.evidenceIndex.length === 0) {
    lines.push('- 本文没有可展开的 evidence index 条目；请查看 `evidence/index.jsonl` 和 debug 材料。');
  } else {
    lines.push('| 证据 | 类型 | 位置 | 支撑结论 |');
    lines.push('| --- | --- | --- | --- |');
    for (const evidence of model.evidenceIndex) {
      lines.push(`| ${escapeCell(evidence.ref)} | ${escapeCell(evidence.kind)} | ${escapeCell(evidence.location ?? '-')} | ${escapeCell(evidence.summary ?? evidence.name ?? '-')} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}