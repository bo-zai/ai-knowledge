import type { KnowledgeObject } from '../knowledge/capability-object-assembler.js';
import { buildCapabilityDocModel } from '../knowledge/capability-doc-model.js';
import { renderCapabilityMarkdown } from './capability-markdown-renderer.js';
import { TYPE_TO_DIR } from '../knowledge/type-directory-map.js';
import { DEFAULT_KNOWLEDGE_DIR } from '../config/defaults.js';

export interface EvidenceIndexItem {
  ref: string;
  kind: string;
  location?: string;
  name?: string;
  summary?: string;
  targetRelevance?: number;
  matchedTerms?: string[];
  startLine?: number;
}

export interface CapabilityGenerationReport {
  mode: 'skeleton' | 'llm';
  capabilityGenerationMode?: 'single';
  selectedCandidateId?: string;
  candidateCount?: number;
  llmRequested: boolean;
  llmRequired: boolean;
  llmCalled: boolean;
  llmSucceeded: boolean;
  llmRuntime?: 'direct' | 'langgraph';
  model?: string;
  graph?: {
    attempts: number;
    repaired: boolean;
    validationErrors: string[];
  };
  claimCounts: {
    llmRaw: number;
    llmAccepted: number;
    skeletonAdded: number;
    final: number;
  };
  objectSourceCounts?: {
    llm: number;
    skeleton: number;
    evidence_seed: number;
  };
  requiredBusinessObjects?: {
    capFromLlm: boolean;
    flowOrConFromLlm: boolean;
    modPresent: boolean;
    modHasTouchGuidance: boolean;
    verOrValidationOpenPresent: boolean;
    verHasOracle: boolean;
    openHasMinimalNextEvidence: boolean;
    noTechnicalTermLeakage: boolean;
  };
  technicalTermLeakage?: string[];
  qualityWarnings?: string[];
  warnings: string[];
}

export interface CapabilityLlmDebug {
  request?: {
    model?: string;
    systemPrompt: string;
    userPrompt: string;
  };
  response?: {
    rawText?: string;
    error?: string;
  };
  graphTrace?: {
    attempts: number;
    repaired: boolean;
    validationErrors: string[];
  };
}

function buildFunctionMarkdown(input: {
  capabilityId: string;
  capabilityTitle: string;
  flowObject: KnowledgeObject;
  evidenceIndex: EvidenceIndexItem[];
  capabilityModel: ReturnType<typeof buildCapabilityDocModel>;
}): string {
  const { capabilityId, capabilityTitle, flowObject, evidenceIndex, capabilityModel } = input;
  const orderedSteps = Array.isArray(flowObject.metadata.orderedSteps) ? flowObject.metadata.orderedSteps : [];
  const evidenceSteps = Array.isArray(flowObject.metadata.evidenceSteps) ? flowObject.metadata.evidenceSteps : [];
  const flowEvidenceRefs = new Set([
    ...flowObject.evidencePrimary,
    ...flowObject.evidenceSupporting,
  ]);

  const lines: string[] = [];
  lines.push(`# ${flowObject.id}`);
  lines.push('');
  lines.push(`> 所属 capability：${capabilityTitle} (${capabilityId})`);
  lines.push(`> 生成时间：${new Date().toISOString()}`);
  lines.push('');

  lines.push('## 1. 功能定位');
  lines.push('');
  lines.push(flowObject.description);
  lines.push('');

  lines.push('## 2. 关联入口');
  lines.push('');
  if (capabilityModel.codeAnchors.length === 0) {
    lines.push('- 当前知识包没有稳定入口锚点。');
  } else {
    for (const anchor of capabilityModel.codeAnchors) {
      lines.push(`- ${anchor.symbolOrRoute} @ ${anchor.path}`);
    }
  }
  lines.push('');

  lines.push('## 3. 关键步骤');
  lines.push('');
  if (orderedSteps.length > 0) {
    orderedSteps.forEach((step, index) => {
      if (!step || typeof step !== 'object') return;
      const action = typeof step.action === 'string' ? step.action : '';
      const evidenceRef = typeof step.evidenceRef === 'string' ? step.evidenceRef : '';
      if (action) {
        lines.push(`${index + 1}. ${action}${evidenceRef ? ` (${evidenceRef})` : ''}`);
      }
    });
  } else if (evidenceSteps.length > 0) {
    evidenceSteps.forEach((step, index) => {
      if (!step || typeof step !== 'object') return;
      const action = typeof step.action === 'string' ? step.action : '';
      if (action) {
        lines.push(`${index + 1}. ${action}`);
      }
    });
  } else {
    lines.push('- 当前 FLOW 对象没有稳定步骤，只能把它视为功能占位。');
  }
  lines.push('');

  lines.push('## 4. 入口与证据');
  lines.push('');
  const relatedEvidence = evidenceIndex.filter(item => flowEvidenceRefs.has(item.ref));
  if (relatedEvidence.length === 0) {
    lines.push('- 当前功能没有单独绑定证据索引条目。');
  } else {
    lines.push('| 证据 | 类型 | 位置 | 说明 |');
    lines.push('| --- | --- | --- | --- |');
    for (const item of relatedEvidence) {
      lines.push(`| ${item.ref} | ${item.kind} | ${item.location ?? '-'} | ${item.summary ?? item.name ?? '-'} |`);
    }
  }
  lines.push('');

  lines.push('## 5. 相关数据与约束');
  lines.push('');
  if (capabilityModel.dataContracts.length === 0) {
    lines.push('- 当前知识包没有稳定契约对象。');
  } else {
    for (const contract of capabilityModel.dataContracts) {
      lines.push(`- ${contract.subject} (${contract.kind})`);
    }
  }
  if (capabilityModel.unknowns.length > 0) {
    lines.push('');
    lines.push('待确认：');
    for (const unknown of capabilityModel.unknowns) {
      lines.push(`- ${unknown.question}`);
    }
  }
  if (capabilityModel.validation.length > 0) {
    lines.push('');
    lines.push('验证关注点：');
    for (const validation of capabilityModel.validation) {
      lines.push(`- ${validation.goal}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

function buildObjectYaml(object: KnowledgeObject): string {
  const domain = inferDomainFromObject(object);
  const owner = (object.metadata.owner as string | undefined) ?? '';
  const taskTriggers = inferTaskTriggers(object.type, object.metadata);
  const staleIf = inferStaleIf(object.type);

  const lines = [
    `id: ${object.id}`,
    `type: ${object.type}`,
    `domain: ${domain}`,
    `owner: ${owner}`,
    `task_triggers:`,
  ];
  for (const trigger of taskTriggers) {
    lines.push(`  - ${trigger}`);
  }
  lines.push(`description: |`);
  lines.push(`  ${object.description}`);
  lines.push(`evidencePrimary:`);

  for (const ref of object.evidencePrimary) {
    lines.push(`  - ${ref}`);
  }

  lines.push(`evidenceSupporting: []`);
  lines.push(`decisionPoints:`);
  for (const dp of object.decisionPoints) {
    lines.push(`  - ${dp}`);
  }

  lines.push(`sddStageUses:`);
  for (const stage of object.sddStageUses) {
    lines.push(`  - ${stage}`);
  }

  lines.push(`unsupportedParts:`);
  for (const part of object.unsupportedParts) {
    lines.push(`  - ${part}`);
  }

  lines.push(`blockedDecisions:`);
  for (const bd of object.blockedDecisions) {
    lines.push(`  - ${bd}`);
  }

  lines.push(`stale_if:`);
  for (const condition of staleIf) {
    lines.push(`  - ${condition}`);
  }

  lines.push(`metadata:`);
  for (const [key, value] of Object.entries(object.metadata)) {
    if (typeof value === 'string') {
      lines.push(`  ${key}: ${value}`);
    } else if (Array.isArray(value)) {
      lines.push(`  ${key}:`);
      for (const item of value) {
        lines.push(`    - ${typeof item === 'object' ? JSON.stringify(item) : item}`);
      }
    } else {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  return lines.join('\n');
}

function inferDomainFromObject(object: KnowledgeObject): string {
  // Try metadata domain first
  const metaDomain = object.metadata.domain as string | undefined;
  if (metaDomain) return String(metaDomain);

  // Infer from rootPath or subject
  const rootPath = object.metadata.rootPath as string | undefined;
  if (rootPath) {
    const parts = rootPath.split('/').filter(Boolean);
    if (parts.length > 0) return parts[0];
  }

  const subject = object.metadata.subject as string | undefined;
  if (subject) return subject.toLowerCase().split(' ')[0];

  // Default from ID
  const idParts = object.id.split('-');
  return idParts.length > 1 ? idParts.slice(1, -1).join('-').toLowerCase() : 'unknown';
}

function inferTaskTriggers(objType: string, metadata: Record<string, unknown>): string[] {
  const triggers: string[] = [];
  switch (objType) {
    case 'CAP':
      triggers.push('Adding new business feature');
      triggers.push('Changing capability scope or non-goals');
      break;
    case 'TERM':
      triggers.push('Business vocabulary changes');
      triggers.push('Introducing new domain concept');
      break;
    case 'FLOW':
      triggers.push('Changing business process order');
      triggers.push('Adding failure branch or compensation');
      break;
    case 'MOD':
      triggers.push('Adding new API endpoint or method');
      triggers.push('Changing module boundary or responsibility');
      break;
    case 'CON':
      triggers.push('Changing API request/response contract');
      triggers.push('Modifying data schema or field semantics');
      break;
    case 'VER':
      triggers.push('Changing acceptance criteria');
      triggers.push('Adding new validation scenario');
      break;
    case 'OPEN':
      triggers.push('New evidence resolves the unknown');
      triggers.push('Decision becomes unblocked');
      break;
  }
  return triggers;
}

function inferStaleIf(objType: string): string[] {
  switch (objType) {
    case 'CAP':
      return ['Business goal changes', 'Capability scope changes'];
    case 'TERM':
      return ['Business vocabulary evolves', 'New aliases discovered'];
    case 'FLOW':
      return ['Business process changes', 'New failure scenarios identified'];
    case 'MOD':
      return ['File structure changes', 'Module responsibility changes'];
    case 'CON':
      return ['API contract changes', 'Schema evolution'];
    case 'VER':
      return ['Test suite changes', 'Acceptance criteria updated'];
    case 'OPEN':
      return ['New evidence becomes available', 'Decision is resolved'];
    default:
      return ['Related code changes'];
  }
}

function buildCatalogYaml(objects: KnowledgeObject[], capabilityId: string): string {
  const lines = [
    `version: 1`,
    ``,
    `retrieval_order:`,
    `  capability_context:`,
    `    - CAP`,
    `    - TERM`,
    `    - FLOW`,
    `    - MOD`,
    `    - CON`,
    `    - VER`,
    `    - OPEN`,
    ``,
    `sdd_stage_mapping:`,
    `  requirement_clarification:`,
    `    include_types: [TERM, CAP, OPEN]`,
    `  requirement_specification:`,
    `    include_types: [CAP, FLOW, CON, VER, OPEN]`,
    `  design_planning:`,
    `    include_types: [FLOW, CON, MOD, OPEN]`,
    `  implementation_planning:`,
    `    include_types: [MOD, CON, VER, FLOW]`,
    `  coding:`,
    `    include_types: [MOD, CON, VER]`,
    `  review:`,
    `    include_types: [CON, MOD, VER, OPEN]`,
    `  validation:`,
    `    include_types: [VER, CON, FLOW]`,
    ``,
    `capabilities:`,
    `  ${capabilityId}:`,
    `    view: views/capabilities/${capabilityId}.md`,
    `    objects:`,
  ];

  for (const obj of objects) {
    lines.push(`      - ${obj.id}`);
  }

  lines.push(``);
  lines.push(`objects:`);

  for (const obj of objects) {
    lines.push(`  ${obj.id}:`);
    lines.push(`    type: ${obj.type}`);
    lines.push(`    path: objects/${TYPE_TO_DIR[obj.type] || 'unknown'}/${obj.id}.yaml`);
  }

  return lines.join('\n');
}

function objectLine(obj: KnowledgeObject): string {
  return `- ${obj.id}: ${obj.description}`;
}

export function buildCapabilityView(
  objects: KnowledgeObject[],
  capabilityId: string,
  evidenceIndex?: EvidenceIndexItem[],
): string {
  const model = buildCapabilityDocModel({ objects, capabilityId, evidenceIndex });
  return renderCapabilityMarkdown(model);
}

function buildEvidenceIndexJsonl(evidenceIndex: EvidenceIndexItem[]): string {
  return evidenceIndex.map(item => JSON.stringify(item)).join('\n') + '\n';
}

export function buildCapabilityKnowledgeFiles(input: {
  objects: KnowledgeObject[];
  capabilityId: string;
  evidenceIndex?: EvidenceIndexItem[];
  report?: CapabilityGenerationReport;
  debug?: CapabilityLlmDebug;
}): Array<{ path: string; content: string }> {
  const { objects, capabilityId, evidenceIndex, report, debug } = input;
  const files: Array<{ path: string; content: string }> = [];

  // 生成 catalog.yaml
  files.push({
    path: 'catalog.yaml',
    content: buildCatalogYaml(objects, capabilityId),
  });

  // 生成每个对象的 YAML 文件
  for (const obj of objects) {
    const dir = TYPE_TO_DIR[obj.type] || 'unknown';
    files.push({
      path: `objects/${dir}/${obj.id}.yaml`,
      content: buildObjectYaml(obj),
    });
  }

  // 生成 capability markdown（主入口）
  const capabilityModel = buildCapabilityDocModel({ objects, capabilityId, evidenceIndex });
  const capabilityMarkdown = renderCapabilityMarkdown(capabilityModel, {
    functionLinkPrefix: '../functions',
  });
  const compatibilityViewMarkdown = renderCapabilityMarkdown(capabilityModel, {
    functionLinkPrefix: '../../functions',
  });

  // 生成主 capability Markdown
  files.push({
    path: `capabilities/${capabilityId}.md`,
    content: capabilityMarkdown,
  });

  // 生成兼容性 view
  files.push({
    path: `views/capabilities/${capabilityId}.md`,
    content: compatibilityViewMarkdown,
  });

  for (const flowObject of objects.filter(obj => obj.type === 'FLOW')) {
    files.push({
      path: `functions/${flowObject.id}.md`,
      content: buildFunctionMarkdown({
        capabilityId,
        capabilityTitle: capabilityModel.title,
        flowObject,
        evidenceIndex: evidenceIndex ?? [],
        capabilityModel,
      }),
    });
  }

  // 生成 evidence index
  if (evidenceIndex && evidenceIndex.length > 0) {
    files.push({
      path: 'evidence/index.jsonl',
      content: buildEvidenceIndexJsonl(evidenceIndex),
    });
  }

  // 生成 report
  if (report) {
    files.push({
      path: 'reports/capability-generation.json',
      content: JSON.stringify(report, null, 2) + '\n',
    });
  }

  // 生成 debug files
  if (debug?.request) {
    files.push({
      path: 'debug/capability-llm-request.json',
      content: JSON.stringify(debug.request, null, 2) + '\n',
    });
  }

  if (debug?.response) {
    files.push({
      path: 'debug/capability-llm-response.json',
      content: JSON.stringify(debug.response, null, 2) + '\n',
    });
  }

  return files;
}

export async function writeCapabilityKnowledgePackage(input: {
  outputRoot: string;
  objects: KnowledgeObject[];
  capabilityId: string;
  evidenceIndex?: EvidenceIndexItem[];
  report?: CapabilityGenerationReport;
  debug?: CapabilityLlmDebug;
}): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const { outputRoot, objects, capabilityId, evidenceIndex, report, debug } = input;

  // 安全清理 ai-knowledge 目录
  const packageRoot = path.resolve(outputRoot, DEFAULT_KNOWLEDGE_DIR);

  if (path.basename(packageRoot) !== DEFAULT_KNOWLEDGE_DIR) {
    throw new Error(`Refusing to clean invalid package root: ${packageRoot}`);
  }

  await fs.rm(packageRoot, { recursive: true, force: true });
  await fs.mkdir(packageRoot, { recursive: true });

  const files = buildCapabilityKnowledgeFiles({ objects, capabilityId, evidenceIndex, report, debug });

  for (const file of files) {
    const fullPath = path.join(packageRoot, file.path);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content, 'utf-8');
  }
}
