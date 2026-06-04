import {
  KnowledgeType,
  ALL_KNOWLEDGE_TYPES,
  GenerationPhase,
  PHASE_TO_TYPES,
} from '../schemas/knowledge-type.js';

export type GenerateKnowledge = KnowledgeType | 'all' | 'phase1' | 'phase2';

export interface GenerateTarget {
  kind: KnowledgeType;
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
  phase?: GenerationPhase;
  types: KnowledgeType[];
  target?: GenerateTarget;
  warnings: string[];
}

// Valid knowledge options: 8 types (lowercase) + all + phase1 + phase2
const VALID_KNOWLEDGE = new Set<string>([
  ...ALL_KNOWLEDGE_TYPES.map(t => t.toLowerCase()),
  'all',
  'phase1',
  'phase2',
]);

function assertKnowledge(value: string): asserts value is GenerateKnowledge {
  if (!VALID_KNOWLEDGE.has(value.toLowerCase())) {
    throw new Error(
      `Invalid --knowledge value: ${value}. Expected one of: ${ALL_KNOWLEDGE_TYPES.map(t => t.toLowerCase()).join(', ')}, all, phase1, phase2.`,
    );
  }
}

function normalizeKnowledge(value: string): GenerateKnowledge {
  const lower = value.toLowerCase();
  if (lower === 'all' || lower === 'phase1' || lower === 'phase2') {
    return lower as 'all' | 'phase1' | 'phase2';
  }
  // Convert to uppercase KnowledgeType
  return value.toUpperCase() as KnowledgeType;
}

function parseTypedTarget(raw: string): GenerateTarget | null {
  const separator = raw.indexOf(':');
  if (separator < 0) return null;
  const kind = raw.slice(0, separator).toUpperCase();
  const value = raw.slice(separator + 1).trim();

  if (!ALL_KNOWLEDGE_TYPES.includes(kind as KnowledgeType) || value.length === 0) {
    throw new Error(
      `--target must use <type>:<name> format where type is one of: ${ALL_KNOWLEDGE_TYPES.map(t => t.toLowerCase()).join(', ')}`,
    );
  }
  return { kind: kind as KnowledgeType, value };
}

function resolveTarget(rawTarget?: string): GenerateTarget | undefined {
  if (!rawTarget) return undefined;
  const typed = parseTypedTarget(rawTarget);
  if (!typed) {
    throw new Error('--target must use <type>:<name> format');
  }
  return typed;
}

function getTypesForKnowledge(knowledge: GenerateKnowledge): KnowledgeType[] {
  if (knowledge === 'all') {
    return ALL_KNOWLEDGE_TYPES;
  }
  if (knowledge === 'phase1') {
    return PHASE_TO_TYPES.concept.concat(PHASE_TO_TYPES.data_model).concat(PHASE_TO_TYPES.capability);
  }
  if (knowledge === 'phase2') {
    return PHASE_TO_TYPES.parallel;
  }
  return [knowledge as KnowledgeType];
}

function getPhaseForKnowledge(knowledge: GenerateKnowledge): GenerationPhase | undefined {
  if (knowledge === 'phase1') return undefined; // Multi-phase
  if (knowledge === 'phase2') return 'parallel';
  if (knowledge === 'all') return undefined; // Multi-phase

  const type = knowledge as KnowledgeType;
  if (PHASE_TO_TYPES.concept.includes(type)) return 'concept';
  if (PHASE_TO_TYPES.data_model.includes(type)) return 'data_model';
  if (PHASE_TO_TYPES.capability.includes(type)) return 'capability';
  if (PHASE_TO_TYPES.parallel.includes(type)) return 'parallel';

  return undefined;
}

export function resolveGenerateScope(input: ResolveGenerateScopeInput): ResolvedGenerateScope {
  const warnings: string[] = [];

  let inferred = false;
  let inferredFrom: 'default' | 'explicit' = 'explicit';

  let rawKnowledge: string;
  if (input.knowledge) {
    rawKnowledge = input.knowledge.toLowerCase();
  } else {
    rawKnowledge = 'all';
    inferred = true;
    inferredFrom = 'default';
  }

  assertKnowledge(rawKnowledge);

  const knowledge = normalizeKnowledge(rawKnowledge);
  const types = getTypesForKnowledge(knowledge);
  const phase = getPhaseForKnowledge(knowledge);
  const target = resolveTarget(input.target);

  // Validate target matches knowledge scope
  if (target && knowledge !== 'all') {
    const targetIncluded = types.includes(target.kind);
    if (!targetIncluded) {
      throw new Error(
        `--target ${target.kind}:${target.value} is not valid for --knowledge ${knowledge}`,
      );
    }
  }

  return {
    knowledge,
    inferred,
    inferredFrom,
    phase,
    types,
    target,
    warnings,
  };
}

/**
 * Get the generation order for multiple types
 * Returns types in the correct order for generation
 */
export function getGenerationOrder(types: KnowledgeType[]): KnowledgeType[][] {
  const phases: KnowledgeType[][] = [];

  // Phase 1: Sequential
  if (types.some(t => PHASE_TO_TYPES.concept.includes(t))) {
    phases.push(types.filter(t => PHASE_TO_TYPES.concept.includes(t)));
  }
  if (types.some(t => PHASE_TO_TYPES.data_model.includes(t))) {
    phases.push(types.filter(t => PHASE_TO_TYPES.data_model.includes(t)));
  }
  if (types.some(t => PHASE_TO_TYPES.capability.includes(t))) {
    phases.push(types.filter(t => PHASE_TO_TYPES.capability.includes(t)));
  }

  // Phase 2: Parallel
  const parallelTypes = types.filter(t => PHASE_TO_TYPES.parallel.includes(t));
  if (parallelTypes.length > 0) {
    phases.push(parallelTypes);
  }

  return phases;
}
