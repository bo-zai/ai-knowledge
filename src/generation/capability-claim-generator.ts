import { z } from "zod";
import type { EvidenceBundle } from "../evidence/evidence-bundle-schema.js";

const TECHNICAL_TERM_HINTS = new Set([
  "mybatis",
  "mapper",
  "xml",
  "sql",
  "db",
  "database",
  "table",
  "schema",
  "knowledge",
  "evidence",
  "capability",
  "bootstrap",
  "orm",
  "dao",
  "repository",
  "controller",
  "service",
  "handler",
  "endpoint",
  "api",
  "rest",
  "http",
  "request",
  "response",
  "query",
  "result",
  "session",
  "transaction",
  "connection",
  "pool",
  "driver",
  "jdbc",
  "dto",
  "vo",
  "req",
  "resp",
  "entity",
]);

/**
 * Check if a term is technical (should not be a business TERM object).
 * Matches both exact terms and compound terms containing technical words.
 */
export function isTechnicalTerm(term: string): boolean {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return true;
  if (TECHNICAL_TERM_HINTS.has(normalized)) return true;

  // Check if any word in a compound term is technical
  const words = normalized.split(/[\s_-]+/);
  for (const word of words) {
    if (TECHNICAL_TERM_HINTS.has(word)) return true;
  }

  return false;
}

type TermEvidence = {
  term: string;
  refs: string[];
  count: number;
  source: "target_term" | "evidence_match" | "data_contract";
};

function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

function addTermEvidence(
  map: Map<string, TermEvidence>,
  term: string,
  ref: string,
  source: TermEvidence["source"],
): void {
  const normalized = normalizeTerm(term);
  if (!normalized || isTechnicalTerm(normalized)) return;

  const current = map.get(normalized) ?? {
    term: normalized,
    refs: [],
    count: 0,
    source,
  };
  if (!current.refs.includes(ref)) {
    current.refs.push(ref);
  }
  current.count += 1;
  map.set(normalized, current);
}

function collectTermEvidence(bundle: EvidenceBundle): TermEvidence[] {
  const terms = new Map<string, TermEvidence>();

  for (const item of [
    ...bundle.entryPoints,
    ...bundle.behaviorSlices,
    ...bundle.dataContracts,
    ...bundle.validationAnchors,
  ]) {
    for (const term of item.matchedTerms ?? []) {
      addTermEvidence(terms, term, item.ref, "evidence_match");
    }
  }

  for (const related of bundle.capabilityHints.relatedTerms) {
    const normalized = normalizeTerm(related);
    if (TECHNICAL_TERM_HINTS.has(normalized)) continue;
    const existingRef = [...terms.values()].find((item) => item.refs.length > 0)
      ?.refs[0];
    if (existingRef) {
      addTermEvidence(terms, normalized, existingRef, "target_term");
    }
  }

  return [...terms.values()]
    .filter((item) => item.refs.length > 0)
    .sort((left, right) => {
      const diff = right.count - left.count;
      if (diff !== 0) return diff;
      return left.term.localeCompare(right.term);
    })
    .slice(0, 8);
}

const FieldSemanticSchema = z.union([
  z.string(),
  z
    .object({
      meaning: z.string().optional(),
      businessMeaning: z.string().optional(),
      dataType: z.string().optional(),
      constraints: z.array(z.string()).optional(),
      validation: z.array(z.string()).optional(),
      evidenceRef: z.string().optional(),
      notes: z.array(z.string()).optional(),
    })
    .passthrough(),
]);

const ObjectHintSchema = z
  .object({
    canonicalTerm: z.string().optional(),
    subject: z.string().optional(),
    businessDefinition: z.string().optional(),
    notEqualTo: z.array(z.string()).optional(),
    aliases: z.array(z.string()).optional(),
    goal: z.string().optional(),
    successCriteria: z.array(z.string()).optional(),
    nonGoals: z.array(z.string()).optional(),
    orderedSteps: z
      .array(
        z.object({
          action: z.string(),
          evidenceRef: z.string().optional(),
          note: z.string().optional(),
        }),
      )
      .optional(),
    failureBranches: z.array(z.string()).optional(),
    compensation: z.array(z.string()).optional(),
    modulePath: z.string().optional(),
    ownedResponsibility: z.string().optional(),
    touchWhen: z.array(z.string()).optional(),
    doNotTouchWhen: z.array(z.string()).optional(),
    testAnchors: z.array(z.string()).optional(),
    contractSubject: z.string().optional(),
    contractKind: z
      .enum(["schema", "sql", "api", "event", "output"])
      .optional(),
    fieldSemantics: z.record(z.string(), FieldSemanticSchema).optional(),
    validationRules: z.array(z.string()).optional(),
    schemaRef: z.string().optional(),
    verificationGoal: z.string().optional(),
    acceptanceOracle: z.array(z.string()).optional(),
    minimalNextEvidence: z.array(z.string()).optional(),
    ownerToAsk: z.string().optional(),
    escalationGate: z.string().optional(),
    termSource: z
      .enum(["target_term", "evidence_match", "data_contract"])
      .optional(),
    matchedEvidenceCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const CandidateClaimSchema = z.object({
  suggestedType: z.enum(["CAP", "TERM", "FLOW", "MOD", "CON", "VER", "OPEN"]),
  claimText: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  evidenceRefs: z.array(z.string()),
  decisionPoints: z.array(z.string()),
  sddStageUses: z.array(
    z.enum([
      "requirement_clarification",
      "requirement_specification",
      "design_planning",
      "implementation_planning",
      "coding",
      "review",
      "validation",
    ]),
  ),
  unsupportedParts: z.array(z.string()),
  blockedDecisions: z.array(z.string()),
  objectHints: ObjectHintSchema.optional(),
  source: z.enum(["llm", "skeleton", "evidence_seed"]).optional(),
});

export type CandidateClaim = z.infer<typeof CandidateClaimSchema>;

function collectBundleRefs(bundle: EvidenceBundle): Set<string> {
  const refs = new Set<string>();
  bundle.entryPoints.forEach((e) => refs.add(e.ref));
  bundle.flowTraces.forEach((e) => refs.add(e.ref));
  bundle.behaviorSlices.forEach((e) => refs.add(e.ref));
  bundle.dataContracts.forEach((e) => refs.add(e.ref));
  bundle.moduleSurfaces.forEach((e) => refs.add(e.ref));
  bundle.validationAnchors.forEach((e) => refs.add(e.ref));
  bundle.docs.forEach((e) => refs.add(e.ref));
  return refs;
}

export function filterCandidateClaims(
  claims: CandidateClaim[],
  bundle: EvidenceBundle,
): CandidateClaim[] {
  const validRefs = collectBundleRefs(bundle);

  return claims.filter((claim) => {
    // OPEN claim 必须有 blockedDecisions 和 minimalNextEvidence
    if (claim.suggestedType === "OPEN") {
      if (claim.blockedDecisions.length === 0) return false;
      const minimalNextEvidence = claim.objectHints?.minimalNextEvidence;
      if (!minimalNextEvidence || minimalNextEvidence.length === 0)
        return false;
      return true;
    }

    // TERM claim 不能是技术术语
    if (claim.suggestedType === "TERM") {
      const term = claim.objectHints?.canonicalTerm || claim.claimText;
      if (isTechnicalTerm(term)) {
        return false;
      }
    }

    // 非 OPEN claim 必须有 evidence refs
    if (claim.evidenceRefs.length === 0) {
      return false;
    }

    // 非 OPEN claim 的 evidence refs 必须存在于 bundle
    for (const ref of claim.evidenceRefs) {
      if (!validRefs.has(ref)) {
        return false;
      }
    }

    // 非 OPEN claim 的 confidence 不能是 low
    if (claim.confidence === "low") {
      return false;
    }

    return true;
  });
}

export function buildCapabilityClaimPrompt(bundle: EvidenceBundle): string {
  const lines: string[] = [
    "Generate candidate claims for a capability knowledge object.",
    "",
    "HARD RULES:",
    "- Return strict JSON array only; no markdown fences, no prose before or after JSON",
    "- use only bundle evidence",
    "- every non-OPEN claim cites evidence refs",
    "- missing evidence becomes OPEN",
    "- do not invent facts",
    "- do not mark inference as fact",
    "- do not create object IDs or file paths",
    "- do not decide directory structure",
    "- low confidence non-OPEN claims are rejected",
    "",
    "BUSINESS OBJECT QUALITY RULES:",
    "- Generate business capability knowledge for AI agents, not generic code summaries.",
    "- Capability name must describe a business action or managed business object.",
    "- Do not use project/module/layer names as capability names.",
    "- Avoid names made mostly from admin, portal, service, controller, mapper, module, capability, all.",
    "- Do not start CAP canonicalTerm with low-value access verbs such as get, list, query, find, search; prefer the managed business object or a user-visible business outcome.",
    "- Prefer BUSINESS FUNCTION CANDIDATES when naming CAP and FLOW objects.",
    "- If a domain name is supplied, use it only as context; do not copy it blindly when a more specific business function exists.",
    "- CAP objectHints.canonicalTerm must be the final user-facing business capability name.",
    "- TERM is business vocabulary only; reject mybatis, mapper, service, controller, xml, sql, dto, vo, req, resp, entity as standalone terms.",
    "- FLOW must represent a stable business function or user-visible business action, not a raw endpoint or method.",
    '- FLOW objectHints.subject must be a stable business function name, never "unknown".',
    "- FLOW must include orderedSteps with concrete business actions and evidenceRef when available.",
    "- Prefer one FLOW per stable function candidate cluster. Merge entry/service/test/doc evidence that points to the same action.",
    "- FLOW steps must be business actions, not raw method names.",
    "- CON must describe business-relevant contract semantics; mapper methods and DTOs are evidence, not the whole contract.",
    "- MOD must include touchWhen and doNotTouchWhen guidance.",
    "- VER must include verificationGoal and acceptanceOracle.",
    "- OPEN must include blockedDecisions and minimalNextEvidence.",
    "- Missing failure semantics, ownership, source of truth, or validation evidence must become OPEN.",
    "",
    "Rejected examples:",
    '- CAP: "X is a discovered business capability supported by repository evidence."',
    '- CAP canonicalTerm: "Admin Module capability"',
    '- CAP canonicalTerm: "All Resource Service"',
    '- CAP canonicalTerm: "Portal Controller capability"',
    '- FLOW: "X has a repository-derived execution flow."',
    '- FLOW: "add add -> find by id"',
    '- FLOW subject: "unknown"',
    '- CON: "X is a data or schema contract related to Y."',
    '- TERM: "OrderGoodsVO has fields id, goodsName, number."',
    "",
    "Accepted naming examples:",
    '- CAP canonicalTerm: "Leave Request Approval"',
    '- CAP canonicalTerm: "Invoice Payment Reconciliation"',
    '- CAP canonicalTerm: "Customer Notification Subscription"',
    '- FLOW subject: "Submit Leave Request"',
    '- FLOW subject: "Approve Invoice Payment"',
    '- FLOW subject: "Update Notification Preference"',
    "",
    "CAPABILITY HINTS:",
    `- name candidates: ${bundle.capabilityHints.nameCandidates.join(", ")}`,
    `- related terms: ${bundle.capabilityHints.relatedTerms.join(", ")}`,
  ];

  if (bundle.capabilityHints.summaryHint) {
    lines.push(`- summary hint: ${bundle.capabilityHints.summaryHint}`);
  }

  lines.push("");
  lines.push("AVAILABLE EVIDENCE REFS:");
  bundle.entryPoints.forEach((e) =>
    lines.push(`- ${e.ref}: ${e.kind} entry "${e.name}" at ${e.location}`),
  );
  bundle.behaviorSlices.forEach((e) =>
    lines.push(`- ${e.ref}: behavior "${e.verb} ${e.object}" at ${e.location}`),
  );
  bundle.dataContracts.forEach((e) =>
    lines.push(`- ${e.ref}: ${e.kind} contract "${e.name}" at ${e.location}`),
  );
  bundle.moduleSurfaces.forEach((e) =>
    lines.push(`- ${e.ref}: module surface at ${e.rootPath}`),
  );
  bundle.validationAnchors.forEach((e) =>
    lines.push(`- ${e.ref}: validation anchor "${e.name}" at ${e.location}`),
  );
  bundle.flowTraces.forEach((e) =>
    lines.push(`- ${e.ref}: flow trace with ${e.steps.length} steps`),
  );

  if (bundle.negativeEvidence.length > 0) {
    lines.push("");
    lines.push("NEGATIVE EVIDENCE:");
    bundle.negativeEvidence.forEach((n) =>
      lines.push(`- ${n.id}: ${n.kind} - ${n.description}`),
    );
  }

  if (bundle.openQuestions.length > 0) {
    lines.push("");
    lines.push("OPEN QUESTION SEEDS:");
    bundle.openQuestions.forEach((q) => lines.push(`- ${q.id}: ${q.question}`));
  }

  if ((bundle.functionCandidates?.length ?? 0) > 0) {
    lines.push("");
    lines.push("BUSINESS FUNCTION CANDIDATES:");
    lines.push(
      "- These are statically clustered action candidates. Use them as the primary basis for FLOW/function judgment.",
    );
    lines.push(
      "- Merge duplicates across entry/service/test/doc evidence when they describe one user-visible business action.",
    );
    lines.push(
      "- Query/list/detail candidates are supporting functions unless the repository evidence clearly shows they are core.",
    );
    bundle.functionCandidates!.forEach((candidate) => {
      lines.push(
        `- ${candidate.id}: ${candidate.canonicalName} | verb=${candidate.normalizedVerb} | object=${candidate.normalizedObject} | core=${candidate.isCore} | relevance=${candidate.relevance.toFixed(2)}`,
      );
      lines.push(`  summary: ${candidate.summary}`);
      candidate.signals.slice(0, 6).forEach((signal) => {
        lines.push(
          `  signal: ${signal.kind} "${signal.name}" at ${signal.location}`,
        );
      });
    });
  }

  lines.push("");
  lines.push("ALLOWED ENUM VALUES:");
  lines.push("suggestedType: CAP, TERM, FLOW, MOD, CON, VER, OPEN");
  lines.push("confidence: high, medium, low");
  lines.push("sddStageUses allowed values:");
  lines.push("- requirement_clarification");
  lines.push("- requirement_specification");
  lines.push("- design_planning");
  lines.push("- implementation_planning");
  lines.push("- coding");
  lines.push("- review");
  lines.push("- validation");
  lines.push("Do not invent other stage names.");
  lines.push("");
  lines.push("OUTPUT FORMAT:");
  lines.push("Return strict JSON array only. Each claim must have:");
  lines.push(
    "suggestedType (CAP|TERM|FLOW|MOD|CON|VER|OPEN), claimText (string), confidence (high|medium|low),",
  );
  lines.push(
    "evidenceRefs (string[]), decisionPoints (string[]), sddStageUses (string[]),",
  );
  lines.push(
    "unsupportedParts (string[]), blockedDecisions (string[]), objectHints (object, optional).",
  );
  lines.push("");
  lines.push("objectHints fields by type:");
  lines.push(
    "- ALL: canonicalTerm, subject, businessDefinition, aliases, notEqualTo",
  );
  lines.push("- CAP: goal, successCriteria, nonGoals");
  lines.push(
    "- FLOW: orderedSteps[{action, evidenceRef?, note}], failureBranches, compensation",
  );
  lines.push(
    "- CON: contractSubject, contractKind, fieldSemantics, validationRules, schemaRef",
  );
  lines.push(
    "- MOD: modulePath, ownedResponsibility, touchWhen[], doNotTouchWhen[], testAnchors",
  );
  lines.push("- VER: verificationGoal, acceptanceOracle, testAnchors");
  lines.push(
    "- OPEN: minimalNextEvidence[], blockedDecisions[], ownerToAsk, escalationGate",
  );
  lines.push("");
  lines.push("Example:");
  lines.push(
    '[{"suggestedType":"CAP","claimText":"Order goods fulfillment lets a customer submit goods as part of an order.","confidence":"high","evidenceRefs":["evidence://entry/EP-001"],"decisionPoints":["requirement_intent"],"sddStageUses":["requirement_clarification"],"unsupportedParts":[],"blockedDecisions":[],"objectHints":{"goal":"Submit goods as part of an order","successCriteria":["Order detail shows submitted goods"],"nonGoals":["Changing payment settlement"]}}]',
  );
  lines.push("");
  lines.push("Generate claims now.");

  return lines.join("\n");
}

export function buildSkeletonClaims(bundle: EvidenceBundle): CandidateClaim[] {
  const claims: CandidateClaim[] = [];
  const capabilityName =
    bundle.capabilityHints.nameCandidates[0] ?? bundle.candidateId;

  const firstEvidence =
    bundle.entryPoints[0]?.ref ??
    bundle.flowTraces[0]?.ref ??
    bundle.behaviorSlices[0]?.ref ??
    bundle.moduleSurfaces[0]?.ref ??
    bundle.dataContracts[0]?.ref ??
    bundle.validationAnchors[0]?.ref;

  if (firstEvidence) {
    claims.push({
      suggestedType: "CAP",
      claimText: `${capabilityName} is a discovered business capability supported by repository evidence.`,
      confidence: "medium",
      evidenceRefs: [firstEvidence],
      decisionPoints: ["matched_capability"],
      sddStageUses: ["requirement_clarification", "requirement_specification"],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { canonicalTerm: capabilityName },
      source: "skeleton",
    });
  }

  for (const termEvidence of collectTermEvidence(bundle)) {
    claims.push({
      suggestedType: "TERM",
      claimText: `${termEvidence.term} is a business term evidenced within ${capabilityName}.`,
      confidence: "medium",
      evidenceRefs: [termEvidence.refs[0]!],
      decisionPoints: ["business_vocabulary"],
      sddStageUses: [
        "requirement_clarification",
        "requirement_specification",
        "coding",
        "review",
      ],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: {
        canonicalTerm: termEvidence.term,
        termSource: termEvidence.source,
        matchedEvidenceCount: termEvidence.count,
      },
      source: "skeleton",
    });
  }

  const flow = bundle.flowTraces[0];
  if (flow) {
    claims.push({
      suggestedType: "FLOW",
      claimText: `${capabilityName} has a repository-derived execution flow.`,
      confidence: "medium",
      evidenceRefs: [flow.ref],
      decisionPoints: ["current_behavior"],
      sddStageUses: ["requirement_specification", "design_planning"],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { subject: capabilityName },
      source: "skeleton",
    });
  }

  const module = bundle.moduleSurfaces[0];
  if (module) {
    claims.push({
      suggestedType: "MOD",
      claimText: `${module.rootPath} is part of the change surface for ${capabilityName}.`,
      confidence: "medium",
      evidenceRefs: [module.ref],
      decisionPoints: ["change_surface"],
      sddStageUses: ["implementation_planning", "coding"],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { modulePath: module.rootPath },
      source: "skeleton",
    });
  }

  const contract = bundle.dataContracts[0];
  if (contract) {
    claims.push({
      suggestedType: "CON",
      claimText: `${contract.name} is a data or schema contract related to ${capabilityName}.`,
      confidence: "medium",
      evidenceRefs: [contract.ref],
      decisionPoints: ["affected_contracts"],
      sddStageUses: ["design_planning", "implementation_planning", "review"],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: {
        subject: contract.name,
        contractKind:
          contract.kind === "sql"
            ? "sql"
            : contract.kind === "api"
              ? "api"
              : contract.kind === "event"
                ? "event"
                : "schema",
      },
      source: "skeleton",
    });
  }

  const validation = bundle.validationAnchors[0];
  if (validation) {
    claims.push({
      suggestedType: "VER",
      claimText: `${validation.name} is a validation anchor for ${capabilityName}.`,
      confidence: "medium",
      evidenceRefs: [validation.ref],
      decisionPoints: ["validation_plan"],
      sddStageUses: ["validation", "review"],
      unsupportedParts: [],
      blockedDecisions: [],
      objectHints: { subject: capabilityName },
      source: "skeleton",
    });
  }

  for (const question of bundle.openQuestions) {
    claims.push({
      suggestedType: "OPEN",
      claimText: question.question,
      confidence: "low",
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: ["requirement_clarification"],
      unsupportedParts: [],
      blockedDecisions: question.blockedDecisions,
      objectHints: { minimalNextEvidence: [question.minimalNextEvidence] },
      source: "skeleton",
    });
  }

  for (const negative of bundle.negativeEvidence) {
    claims.push({
      suggestedType: "OPEN",
      claimText: negative.description,
      confidence: "low",
      evidenceRefs: [],
      decisionPoints: [],
      sddStageUses: ["design_planning"],
      unsupportedParts: [],
      blockedDecisions: [negative.impact],
      objectHints: {
        minimalNextEvidence: [negative.location ?? negative.description],
      },
      source: "skeleton",
    });
  }

  return claims;
}
