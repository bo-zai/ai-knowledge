export type GenerateKnowledge = 'db' | 'capability' | 'all';

export interface GenerateTarget {
  kind: 'db' | 'capability';
  value: string;
}

export interface ResolveGenerateScopeInput {
  knowledge?: string;
  target?: string;
}

export interface ResolvedGenerateScope {
  knowledge: GenerateKnowledge;
  inferred: boolean;
  inferredFrom: 'default' | 'explicit';
  target?: GenerateTarget;
  warnings: string[];
}

const VALID_KNOWLEDGE = new Set(['db', 'capability', 'all']);

function assertKnowledge(value: string): asserts value is GenerateKnowledge {
  if (!VALID_KNOWLEDGE.has(value)) {
    throw new Error(`Invalid --knowledge value: ${value}. Expected db, capability, or all.`);
  }
}

function parseTypedTarget(raw: string): GenerateTarget | null {
  const separator = raw.indexOf(':');
  if (separator < 0) return null;
  const kind = raw.slice(0, separator);
  const value = raw.slice(separator + 1).trim();
  if ((kind !== 'db' && kind !== 'capability') || value.length === 0) {
    throw new Error('--target must use db:<name> or capability:<name>');
  }
  return { kind, value };
}

function resolveTarget(knowledge: GenerateKnowledge, rawTarget?: string): GenerateTarget | undefined {
  if (!rawTarget) return undefined;

  const typed = parseTypedTarget(rawTarget);
  if (typed) {
    if (knowledge === 'db' && typed.kind !== 'db') {
      throw new Error('--knowledge db cannot use capability target');
    }
    if (knowledge === 'capability' && typed.kind !== 'capability') {
      throw new Error('--knowledge capability cannot use db target');
    }
    return typed;
  }

  if (knowledge === 'all') {
    throw new Error('--target must use db:<name> or capability:<name> when --knowledge all is used');
  }

  return { kind: knowledge, value: rawTarget.trim() };
}

export function resolveGenerateScope(input: ResolveGenerateScopeInput): ResolvedGenerateScope {
  const warnings: string[] = [];

  let inferred = false;
  let inferredFrom: 'default' | 'explicit' = 'explicit';

  let rawKnowledge: string;
  if (input.knowledge) {
    rawKnowledge = input.knowledge;
  } else {
    rawKnowledge = 'all';
    inferred = true;
    inferredFrom = 'default';
  }

  assertKnowledge(rawKnowledge);

  const target = input.target
    ? resolveTarget(rawKnowledge as GenerateKnowledge, input.target)
    : undefined;

  return {
    knowledge: rawKnowledge as GenerateKnowledge,
    inferred,
    inferredFrom,
    target,
    warnings,
  };
}
