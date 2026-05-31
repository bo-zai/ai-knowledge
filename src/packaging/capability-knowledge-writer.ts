import type { KnowledgeObject } from '../knowledge/capability-object-assembler.js';

export interface EvidenceIndexItem {
  ref: string;
  kind: string;
  location?: string;
  name?: string;
  summary?: string;
  targetRelevance?: number;
  matchedTerms?: string[];
}

export interface CapabilityGenerationReport {
  mode: 'skeleton' | 'llm';
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
    verOrValidationOpenPresent: boolean;
  };
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
  const lines = [
    `id: ${object.id}`,
    `type: ${object.type}`,
    `description: |`,
    `  ${object.description}`,
    `evidencePrimary:`,
  ];

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

export function buildCapabilityView(objects: KnowledgeObject[], capabilityId: string): string {
  const cap = objects.find(o => o.id === capabilityId) ?? objects.find(o => o.type === 'CAP');
  const terms = objects.filter(o => o.type === 'TERM');
  const flows = objects.filter(o => o.type === 'FLOW');
  const mods = objects.filter(o => o.type === 'MOD');
  const cons = objects.filter(o => o.type === 'CON');
  const vers = objects.filter(o => o.type === 'VER');
  const opens = objects.filter(o => o.type === 'OPEN');

  const sections: Array<{ heading: string; items: KnowledgeObject[] }> = [
    { heading: 'Requirement Intent', items: cap ? [cap] : [] },
    { heading: 'Current Behavior', items: flows },
    { heading: 'Business Terms', items: terms },
    { heading: 'Contracts', items: cons },
    { heading: 'Code Anchors', items: mods },
    { heading: 'Validation', items: vers },
    { heading: 'Unknowns and Escalation', items: opens },
  ];

  const lines = [`# ${capabilityId}`, ''];

  for (const section of sections) {
    lines.push(`## ${section.heading}`);
    if (section.items.length === 0) {
      lines.push('- (none)');
    } else {
      for (const item of section.items) {
        lines.push(objectLine(item));
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
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

  // 生成 capability view
  files.push({
    path: `views/capabilities/${capabilityId}.md`,
    content: buildCapabilityView(objects, capabilityId),
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
