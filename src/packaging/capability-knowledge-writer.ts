import type { KnowledgeObject } from '../knowledge/capability-object-assembler.js';
import { buildCapabilityDocModel } from '../knowledge/capability-doc-model.js';
import { renderCapabilityMarkdown } from './capability-markdown-renderer.js';

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

const TYPE_TO_DIR: Record<string, string> = {
  CAP: 'capabilities',
  TERM: 'terms',
  FLOW: 'flows',
  MOD: 'modules',
  CON: 'contracts',
  VER: 'validation',
  OPEN: 'open',
};

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
  const capabilityMarkdown = buildCapabilityView(objects, capabilityId, evidenceIndex);

  // 生成主 capability Markdown
  files.push({
    path: `capabilities/${capabilityId}.md`,
    content: capabilityMarkdown,
  });

  // 生成兼容性 view
  files.push({
    path: `views/capabilities/${capabilityId}.md`,
    content: capabilityMarkdown,
  });

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

  // 安全清理 bootstrap-knowledge 目录
  const packageRoot = path.resolve(outputRoot, 'bootstrap-knowledge');

  if (path.basename(packageRoot) !== 'bootstrap-knowledge') {
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
