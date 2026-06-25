import { AIMessage } from "@langchain/core/messages";
import type { EvidenceBundle } from "../evidence/evidence-bundle-schema.js";
import {
  CandidateClaimSchema,
  buildCapabilityClaimPrompt,
  type CandidateClaim,
} from "./capability-claim-generator.js";
import { runCapabilityClaimsLangGraph } from "./capability-langgraph-claims-runtime.js";

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
  sanitized = sanitized.replace(/\x00/g, "");
  sanitized = sanitized.replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, " ");
  return sanitized;
}

function repairCommonJsonIssues(text: string): string {
  let repaired = text;

  repaired = repaired.replace(
    /"(\w+)":\s*([a-zA-Z][\w-]*)"?/g,
    (match, key, value) => {
      const knownEnums = [
        "high",
        "medium",
        "low",
        "CAP",
        "TERM",
        "FLOW",
        "MOD",
        "CON",
        "VER",
        "OPEN",
        "requirement_clarification",
        "requirement_specification",
        "design_planning",
        "implementation_planning",
        "coding",
        "review",
        "validation",
        "schema",
        "sql",
        "api",
        "event",
        "output",
        "target_term",
        "evidence_match",
        "data_contract",
      ];
      if (knownEnums.includes(value)) {
        return `"${key}": "${value}"`;
      }
      return match;
    },
  );

  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");

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
    if (ch === "\\" && inString) {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
  }

  // Close any unclosed string
  if (inString) {
    repaired += '"';
  }

  // Remove trailing comma if present
  repaired = repaired.replace(/,\s*$/, "");

  // Close open objects and arrays
  for (let i = 0; i < openBraces; i++) {
    repaired += "}";
  }
  for (let i = 0; i < openBrackets; i++) {
    repaired += "]";
  }

  return repaired;
}

function extractValidClaimObjects(text: string): unknown[] {
  // Extract complete JSON objects (handling nested braces) from corrupted array
  const claims: unknown[] = [];

  // Find all candidate object start positions (opening brace after whitespace/comma)
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      // Check if this looks like a claim object start (preceded by comma, bracket, or whitespace)
      const before = text.slice(Math.max(0, i - 10), i).trim();
      if (before === "" || before.endsWith(",") || before.endsWith("[")) {
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
      if (ch === "\\" && inString) {
        escapeNext = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
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
        if (
          obj &&
          typeof obj === "object" &&
          !Array.isArray(obj) &&
          obj.suggestedType &&
          obj.claimText
        ) {
          claims.push(obj);
        }
      } catch {
        // Try repairing common issues within this single object
        try {
          const repaired = repairCommonJsonIssues(
            sanitizeJsonControlChars(candidate),
          );
          const obj = JSON.parse(repaired);
          if (
            obj &&
            typeof obj === "object" &&
            !Array.isArray(obj) &&
            obj.suggestedType &&
            obj.claimText
          ) {
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

interface NormalizeResult {
  value: unknown;
  notes: string[];
}

const ROOT_ARRAY_FIELDS = new Set([
  "evidenceRefs",
  "decisionPoints",
  "sddStageUses",
  "unsupportedParts",
  "blockedDecisions",
]);

const HINT_ARRAY_FIELDS = new Set([
  "notEqualTo",
  "aliases",
  "successCriteria",
  "nonGoals",
  "failureBranches",
  "compensation",
  "touchWhen",
  "doNotTouchWhen",
  "testAnchors",
  "validationRules",
  "acceptanceOracle",
  "minimalNextEvidence",
]);

const ALLOWED_OBJECT_HINT_FIELDS = new Set([
  "canonicalTerm",
  "subject",
  "businessDefinition",
  "notEqualTo",
  "aliases",
  "goal",
  "successCriteria",
  "nonGoals",
  "orderedSteps",
  "failureBranches",
  "compensation",
  "modulePath",
  "ownedResponsibility",
  "touchWhen",
  "doNotTouchWhen",
  "testAnchors",
  "contractSubject",
  "contractKind",
  "fieldSemantics",
  "validationRules",
  "schemaRef",
  "verificationGoal",
  "acceptanceOracle",
  "minimalNextEvidence",
  "ownerToAsk",
  "escalationGate",
  "termSource",
  "matchedEvidenceCount",
]);

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function normalizeStringArrayItems(items: unknown[]): string[] {
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if (item === undefined || item === null) return "";
      if (typeof item === "number" || typeof item === "boolean")
        return String(item);
      if (typeof item === "object") {
        const record = item as Record<string, unknown>;
        for (const key of [
          "text",
          "message",
          "description",
          "reason",
          "condition",
          "action",
          "note",
        ]) {
          if (typeof record[key] === "string") return record[key];
        }
        return JSON.stringify(record);
      }
      return "";
    })
    .map((item) => item.trim())
    .filter(Boolean);
}

const VALID_SDD_STAGES = new Set([
  "requirement_clarification",
  "requirement_specification",
  "design_planning",
  "implementation_planning",
  "coding",
  "review",
  "validation",
]);

function normalizeClaimShape(item: unknown, index: number): NormalizeResult {
  const notes: string[] = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { value: item, notes };
  }

  const record = { ...(item as Record<string, unknown>) };

  for (const field of ROOT_ARRAY_FIELDS) {
    if (typeof record[field] === "string") {
      record[field] = toArray(record[field]);
      notes.push(`claim[${index}].${field}: string normalized to array`);
    }
  }

  // Filter invalid sddStageUses values
  if (Array.isArray(record.sddStageUses)) {
    const original = record.sddStageUses as unknown[];
    const filtered = original.filter(
      (v) => typeof v === "string" && VALID_SDD_STAGES.has(v),
    );
    if (filtered.length < original.length) {
      notes.push(
        `claim[${index}].sddStageUses: ${original.length - filtered.length} invalid values removed`,
      );
      record.sddStageUses = filtered;
    }
  }

  if (
    record.objectHints &&
    typeof record.objectHints === "object" &&
    !Array.isArray(record.objectHints)
  ) {
    const hints = { ...(record.objectHints as Record<string, unknown>) };

    // Remove root-level fields mistakenly placed in objectHints
    const rootFieldNames = new Set([
      "suggestedType",
      "claimText",
      "confidence",
      "evidenceRefs",
      "decisionPoints",
      "sddStageUses",
      "unsupportedParts",
      "blockedDecisions",
      "source",
    ]);
    for (const field of rootFieldNames) {
      if (field in hints) {
        delete hints[field];
        notes.push(
          `claim[${index}].objectHints.${field}: removed (root-level field misplaced in objectHints)`,
        );
      }
    }

    for (const field of Object.keys(hints)) {
      if (!ALLOWED_OBJECT_HINT_FIELDS.has(field)) {
        delete hints[field];
        notes.push(
          `claim[${index}].objectHints.${field}: removed (unsupported hint field)`,
        );
      }
    }

    for (const field of HINT_ARRAY_FIELDS) {
      if (hints[field] === null) {
        hints[field] = [];
        notes.push(
          `claim[${index}].objectHints.${field}: null normalized to empty array`,
        );
      }
      if (typeof hints[field] === "string") {
        hints[field] = toArray(hints[field]);
        notes.push(
          `claim[${index}].objectHints.${field}: string normalized to array`,
        );
      }
      if (Array.isArray(hints[field])) {
        const normalizedItems = normalizeStringArrayItems(
          hints[field] as unknown[],
        );
        if (normalizedItems.length !== (hints[field] as unknown[]).length) {
          notes.push(
            `claim[${index}].objectHints.${field}: non-string items normalized or removed`,
          );
        }
        hints[field] = normalizedItems;
      }
    }

    if (
      Array.isArray(hints.orderedSteps) &&
      hints.orderedSteps.every((step) => typeof step === "string")
    ) {
      hints.orderedSteps = hints.orderedSteps.map((action) => ({ action }));
      notes.push(
        `claim[${index}].objectHints.orderedSteps: string[] normalized to step objects`,
      );
    }
    if (Array.isArray(hints.orderedSteps)) {
      hints.orderedSteps = hints.orderedSteps.map((step, stepIndex) => {
        if (!step || typeof step !== "object" || Array.isArray(step)) {
          return step;
        }
        const normalizedStep = { ...(step as Record<string, unknown>) };
        if (normalizedStep.evidenceRef === null) {
          delete normalizedStep.evidenceRef;
          notes.push(
            `claim[${index}].objectHints.orderedSteps[${stepIndex}].evidenceRef: null removed`,
          );
        }
        return normalizedStep;
      });
    }

    // Normalize contractKind: map common non-standard values to valid enum
    const VALID_CONTRACT_KINDS = new Set([
      "schema",
      "sql",
      "api",
      "event",
      "output",
    ]);
    if (
      typeof hints.contractKind === "string" &&
      !VALID_CONTRACT_KINDS.has(hints.contractKind)
    ) {
      const rawKind = hints.contractKind.toLowerCase();
      if (
        rawKind.includes("api") ||
        rawKind.includes("request") ||
        rawKind.includes("response")
      ) {
        hints.contractKind = "api";
        notes.push(
          `claim[${index}].objectHints.contractKind: "${hints.contractKind}" normalized to "api"`,
        );
      } else if (
        rawKind.includes("sql") ||
        rawKind.includes("mapper") ||
        rawKind.includes("query")
      ) {
        hints.contractKind = "sql";
        notes.push(
          `claim[${index}].objectHints.contractKind: "${hints.contractKind}" normalized to "sql"`,
        );
      } else if (
        rawKind.includes("event") ||
        rawKind.includes("message") ||
        rawKind.includes("queue")
      ) {
        hints.contractKind = "event";
        notes.push(
          `claim[${index}].objectHints.contractKind: "${hints.contractKind}" normalized to "event"`,
        );
      } else {
        hints.contractKind = "schema";
        notes.push(
          `claim[${index}].objectHints.contractKind: "${hints.contractKind}" normalized to "schema" (default fallback)`,
        );
      }
    }

    // Normalize fieldSemantics: convert string to empty object
    if (typeof hints.fieldSemantics === "string") {
      hints.fieldSemantics = {};
      notes.push(
        `claim[${index}].objectHints.fieldSemantics: string converted to empty object`,
      );
    }
    if (Array.isArray(hints.fieldSemantics)) {
      const entries = hints.fieldSemantics
        .map((item, itemIndex) => {
          if (typeof item === "string") {
            return [`field_${itemIndex + 1}`, item] as const;
          }
          if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            const key =
              typeof record.field === "string"
                ? record.field
                : typeof record.name === "string"
                  ? record.name
                  : `field_${itemIndex + 1}`;
            return [key, record] as const;
          }
          return undefined;
        })
        .filter((entry): entry is readonly [string, unknown] => Boolean(entry));
      hints.fieldSemantics = Object.fromEntries(entries);
      notes.push(
        `claim[${index}].objectHints.fieldSemantics: array normalized to record`,
      );
    }
    if (hints.schemaRef === null) {
      delete hints.schemaRef;
      notes.push(`claim[${index}].objectHints.schemaRef: null removed`);
    }
    if (Array.isArray(hints.schemaRef)) {
      const firstSchemaRef = hints.schemaRef.find(
        (item): item is string => typeof item === "string" && item.length > 0,
      );
      if (firstSchemaRef) {
        hints.schemaRef = firstSchemaRef;
        notes.push(
          `claim[${index}].objectHints.schemaRef: string[] normalized to first string`,
        );
      } else {
        delete hints.schemaRef;
        notes.push(
          `claim[${index}].objectHints.schemaRef: invalid array removed`,
        );
      }
    }

    record.objectHints = hints;
  }

  return { value: record, notes };
}

export interface CapabilityClaimParseResult {
  claims: CandidateClaim[];
  normalizationNotes: string[];
}

export function parseCapabilityClaimJsonWithMetadata(
  text: string,
): CapabilityClaimParseResult {
  const jsonText = stripJsonFences(text);
  const sanitized = sanitizeJsonControlChars(jsonText);
  const repaired = repairCommonJsonIssues(sanitized);

  let parsed: unknown;

  try {
    parsed = JSON.parse(repaired);
  } catch {
    try {
      const truncatedRepaired = repairTruncatedJson(repaired);
      parsed = JSON.parse(truncatedRepaired);
    } catch {
      const extracted = extractValidClaimObjects(repaired);
      if (extracted.length > 0) {
        parsed = extracted;
      } else {
        throw new Error(
          `Invalid capability claim JSON: failed to parse or extract valid claims`,
        );
      }
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid capability claim JSON: expected array");
  }

  const allNotes: string[] = [];
  const claims = (parsed as unknown[]).map((item, index) => {
    const normalized = normalizeClaimShape(item, index);
    allNotes.push(...normalized.notes);
    const result = CandidateClaimSchema.safeParse(normalized.value);
    if (!result.success) {
      throw new Error(
        `Invalid capability claim at index ${index}: ${result.error.message}`,
      );
    }
    return result.data;
  });

  return { claims, normalizationNotes: allNotes };
}

export function parseCapabilityClaimJson(text: string): CandidateClaim[] {
  return parseCapabilityClaimJsonWithMetadata(text).claims;
}

export function createCapabilityLlmClaimsProvider(
  input: CreateCapabilityLlmClaimsProviderInput,
) {
  return async function provideCapabilityClaims(
    bundle: EvidenceBundle,
    repairPrompt?: string,
  ): Promise<CapabilityLlmClaimsProviderResult> {
    const result = await runCapabilityClaimsLangGraph({
      bundle,
      modelName: input.model,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.modelInstance,
      repairPrompt,
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
