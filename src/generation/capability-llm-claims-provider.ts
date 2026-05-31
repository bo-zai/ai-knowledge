import { AIMessage } from '@langchain/core/messages';
import type { EvidenceBundle } from '../evidence/evidence-bundle-schema.js';
import {
  CandidateClaimSchema,
  buildCapabilityClaimPrompt,
  type CandidateClaim,
} from './capability-claim-generator.js';
import { runCapabilityClaimsLangGraph } from './capability-langgraph-claims-runtime.js';

export interface CapabilityLlmClaimsProviderResult {
  claims: CandidateClaim[];
  rawText: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  graphTrace: {
    attempts: number;
    repaired: boolean;
    validationErrors: string[];
  };
}

export interface CreateCapabilityLlmClaimsProviderInput {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  modelInstance?: {
    invoke(messages: unknown): Promise<AIMessage>;
  };
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch?.[1]?.trim() ?? trimmed;
}

function sanitizeJsonControlChars(text: string): string {
  let sanitized = text;
  sanitized = sanitized.replace(/\x00/g, '');
  sanitized = sanitized.replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
  return sanitized;
}

function repairCommonJsonIssues(text: string): string {
  let repaired = text;

  repaired = repaired.replace(/"(\w+)":\s*([a-zA-Z][\w-]*)"?/g, (match, key, value) => {
    const knownEnums = ['high', 'medium', 'low', 'CAP', 'TERM', 'FLOW', 'MOD', 'CON', 'VER', 'OPEN',
      'requirement_clarification', 'requirement_specification', 'design_planning',
      'implementation_planning', 'coding', 'review', 'validation',
      'schema', 'sql', 'api', 'event', 'output',
      'target_term', 'evidence_match', 'data_contract'];
    if (knownEnums.includes(value)) {
      return `"${key}": "${value}"`;
    }
    return match;
  });

  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  if (!repaired.includes('"') && repaired.includes("'")) {
    repaired = repaired.replace(/'/g, '"');
  }

  return repaired;
}

function repairTruncatedJson(text: string): string {
  let repaired = text.trim();

  // Count open brackets/braces to close them
  let openBrackets = 0;
  let openBraces = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') openBrackets++;
    if (ch === ']') openBrackets--;
    if (ch === '{') openBraces++;
    if (ch === '}') openBraces--;
  }

  // Close any unclosed string
  if (inString) {
    repaired += '"';
  }

  // Remove trailing comma if present
  repaired = repaired.replace(/,\s*$/, '');

  // Close open objects and arrays
  for (let i = 0; i < openBraces; i++) {
    repaired += '}';
  }
  for (let i = 0; i < openBrackets; i++) {
    repaired += ']';
  }

  return repaired;
}

function extractValidClaimObjects(text: string): unknown[] {
  // Extract complete JSON objects (handling nested braces) from corrupted array
  const claims: unknown[] = [];

  // Find all candidate object start positions (opening brace after whitespace/comma)
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      // Check if this looks like a claim object start (preceded by comma, bracket, or whitespace)
      const before = text.slice(Math.max(0, i - 10), i).trim();
      if (before === '' || before.endsWith(',') || before.endsWith('[')) {
        starts.push(i);
      }
    }
  }

  for (const start of starts) {
    // Find matching closing brace
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let end = -1;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end > start) {
      const candidate = text.slice(start, end + 1);
      try {
        const obj = JSON.parse(candidate);
        if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.suggestedType && obj.claimText) {
          claims.push(obj);
        }
      } catch {
        // Try repairing common issues within this single object
        try {
          const repaired = repairCommonJsonIssues(sanitizeJsonControlChars(candidate));
          const obj = JSON.parse(repaired);
          if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.suggestedType && obj.claimText) {
            claims.push(obj);
          }
        } catch {
          // Skip invalid objects
        }
      }
    }
  }

  return claims;
}

function repairArrayFields(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(repairArrayFields);
  }

  const record = obj as Record<string, unknown>;
  const arrayFields = [
    'notEqualTo', 'aliases', 'successCriteria', 'nonGoals',
    'failureBranches', 'compensation', 'touchWhen', 'doNotTouchWhen',
    'testAnchors', 'validationRules', 'acceptanceOracle', 'minimalNextEvidence',
  ];

  for (const key of Object.keys(record)) {
    if (key === 'objectHints' && record[key] && typeof record[key] === 'object' && !Array.isArray(record[key])) {
      const hints = record[key] as Record<string, unknown>;
      for (const arrayField of arrayFields) {
        if (typeof hints[arrayField] === 'string') {
          hints[arrayField] = [hints[arrayField]];
        }
      }
    }
    // Recurse into nested objects/arrays
    if (record[key] && typeof record[key] === 'object') {
      record[key] = repairArrayFields(record[key]);
    }
  }

  return record;
}

export function parseCapabilityClaimJson(text: string): CandidateClaim[] {
  const jsonText = stripJsonFences(text);
  const sanitized = sanitizeJsonControlChars(jsonText);
  const repaired = repairCommonJsonIssues(sanitized);

  let parsed: unknown;

  // Try parsing as-is first
  try {
    parsed = JSON.parse(repaired);
  } catch {
    // Try repairing truncated JSON
    try {
      const truncatedRepaired = repairTruncatedJson(repaired);
      parsed = JSON.parse(truncatedRepaired);
    } catch {
      // Last resort: try to extract valid claim objects from corrupted JSON
      const extracted = extractValidClaimObjects(repaired);
      if (extracted.length > 0) {
        parsed = extracted;
      } else {
        throw new Error(`Invalid capability claim JSON: failed to parse or extract valid claims`);
      }
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Invalid capability claim JSON: expected array');
  }

  return (parsed as unknown[]).map((item, index) => {
    const repairedItem = repairArrayFields(item);
    const result = CandidateClaimSchema.safeParse(repairedItem);
    if (!result.success) {
      throw new Error(`Invalid capability claim at index ${index}: ${result.error.message}`);
    }
    return result.data;
  });
}

export function createCapabilityLlmClaimsProvider(input: CreateCapabilityLlmClaimsProviderInput) {
  return async function provideCapabilityClaims(bundle: EvidenceBundle): Promise<CapabilityLlmClaimsProviderResult> {
    const result = await runCapabilityClaimsLangGraph({
      bundle,
      modelName: input.model,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.modelInstance,
    });

    return {
      claims: result.claims,
      rawText: result.repairedText ?? result.rawText,
      model: result.model,
      systemPrompt: result.systemPrompt,
      userPrompt: result.userPrompt,
      graphTrace: result.graphTrace,
    };
  };
}
