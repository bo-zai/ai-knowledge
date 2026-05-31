export type GenerateKnowledge = 'db' | 'capability' | 'all';

export interface GenerateTarget {
  kind: 'db' | 'capability';
  value: string;
}

export interface ResolveGenerateScopeInput {
  knowledge?: string;
  target?: string;
  terms?: string[];
  paths?: string[];
  slice?: string;
}

export interface ResolvedGenerateScope {
  knowledge: GenerateKnowledge;
  inferred: boolean;
  inferredFrom: 'default' | 'explicit' | 'legacy';
  target?: GenerateTarget;
  legacyArgsUsed: string[];
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

function inferKnowledgeFromLegacy(input: ResolveGenerateScopeInput): GenerateKnowledge | null {
  const hasTerms = input.terms && input.terms.length > 0;
  const hasPaths = input.paths && input.paths.length > 0;
  const hasSlice = !!input.slice;

  if (input.knowledge) return null; // explicit takes priority

  if (hasTerms || hasPaths) return 'capability';
  if (hasSlice) return 'db';
  return null;
}

function inferTargetFromLegacy(input: ResolveGenerateScopeInput): GenerateTarget | undefined {
  if (input.target) return undefined; // explicit takes priority

  // --terms order → capability:order
  if (input.terms && input.terms.length > 0) {
    return { kind: 'capability', value: input.terms[0] };
  }

  // --slice database:users → db:users
  if (input.slice) {
    const parts = input.slice.split(':');
    if (parts.length >= 2) {
      const kind = parts[0] === 'database' ? 'db' : (parts[0] as 'db' | 'capability');
      return { kind, value: parts.slice(1).join(':') };
    }
    return { kind: 'db', value: input.slice };
  }

  return undefined;
}

export function resolveGenerateScope(input: ResolveGenerateScopeInput): ResolvedGenerateScope {
  const warnings: string[] = [];
  const legacyArgsUsed: string[] = [];

  if (input.terms && input.terms.length > 0) legacyArgsUsed.push('terms');
  if (input.paths && input.paths.length > 0) legacyArgsUsed.push('paths');
  if (input.slice) legacyArgsUsed.push('slice');

  const legacyKnowledge = inferKnowledgeFromLegacy(input);
  let inferred = false;
  let inferredFrom: 'default' | 'explicit' | 'legacy' = 'explicit';

  let rawKnowledge: string;
  if (input.knowledge) {
    rawKnowledge = input.knowledge;
  } else if (legacyKnowledge) {
    rawKnowledge = legacyKnowledge;
    inferred = true;
    inferredFrom = 'legacy';
  } else {
    rawKnowledge = 'all';
    inferred = true;
    inferredFrom = 'default';
  }

  assertKnowledge(rawKnowledge);

  if (legacyArgsUsed.length > 0) {
    warnings.push('legacy generate filters were used; prefer --knowledge and --target');
  }

  // Target: explicit --target takes priority, then legacy inference
  const target = input.target
    ? resolveTarget(rawKnowledge as GenerateKnowledge, input.target)
    : inferTargetFromLegacy(input);

  return {
    knowledge: rawKnowledge as GenerateKnowledge,
    inferred,
    inferredFrom,
    target,
    legacyArgsUsed,
    warnings,
  };
}
