import type { KnowledgeObject } from '../knowledge/capability-object-assembler.js';

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

function buildCatalogYaml(objects: KnowledgeObject[]): string {
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
    `capabilities: {}`,
    ``,
    `objects:`,
  ];

  for (const obj of objects) {
    lines.push(`  ${obj.id}:`);
    lines.push(`    type: ${obj.type}`);
    lines.push(`    path: objects/${TYPE_TO_DIR[obj.type] || 'unknown'}/${obj.id}.yaml`);
  }

  return lines.join('\n');
}

export function buildCapabilityView(objects: KnowledgeObject[], capabilityId: string): string {
  const cap = objects.find(o => o.id === capabilityId);
  const terms = objects.filter(o => o.type === 'TERM');
  const flows = objects.filter(o => o.type === 'FLOW');
  const mods = objects.filter(o => o.type === 'MOD');
  const cons = objects.filter(o => o.type === 'CON');
  const vers = objects.filter(o => o.type === 'VER');
  const opens = objects.filter(o => o.type === 'OPEN');

  const lines = [
    `# ${capabilityId}`,
    ``,
    `## Purpose`,
    cap ? `- ${cap.id}` : '- (no CAP object)',
    ``,
    `## Terms`,
    ...terms.map(t => `- ${t.id}`),
    terms.length === 0 ? '- (none)' : '',
    ``,
    `## Current Flow`,
    ...flows.map(f => `- ${f.id}`),
    flows.length === 0 ? '- (none)' : '',
    ``,
    `## Code Surface`,
    ...mods.map(m => `- ${m.id}`),
    mods.length === 0 ? '- (none)' : '',
    ``,
    `## Contracts`,
    ...cons.map(c => `- ${c.id}`),
    cons.length === 0 ? '- (none)' : '',
    ``,
    `## Validation`,
    ...vers.map(v => `- ${v.id}`),
    vers.length === 0 ? '- (none)' : '',
    ``,
    `## Unknowns`,
    ...opens.map(o => `- ${o.id}`),
    opens.length === 0 ? '- (none)' : '',
  ].filter(line => line !== '');

  return lines.join('\n');
}

export function buildCapabilityKnowledgeFiles(input: {
  objects: KnowledgeObject[];
  capabilityId: string;
}): Array<{ path: string; content: string }> {
  const { objects, capabilityId } = input;
  const files: Array<{ path: string; content: string }> = [];

  // 生成 catalog.yaml
  files.push({
    path: 'catalog.yaml',
    content: buildCatalogYaml(objects),
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

  return files;
}

export async function writeCapabilityKnowledgePackage(input: {
  outputRoot: string;
  objects: KnowledgeObject[];
  capabilityId: string;
}): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const { outputRoot, objects, capabilityId } = input;
  const files = buildCapabilityKnowledgeFiles({ objects, capabilityId });

  for (const file of files) {
    const fullPath = path.join(outputRoot, 'bootstrap-knowledge', file.path);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content, 'utf-8');
  }
}
