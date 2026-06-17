import type { KnowledgeObject } from "./capability-object-assembler.js";
import type { EvidenceIndexItem } from "../packaging/capability-knowledge-writer.js";

export interface CapabilityDocTerm {
  term: string;
  meaningZh: string;
  notEqualTo: string[];
  evidenceRefs: string[];
}

export interface CapabilityDocBehaviorStep {
  step: string;
  evidenceRefs: string[];
}

export interface CapabilityDocBehavior {
  title: string;
  summary: string;
  steps: CapabilityDocBehaviorStep[];
  evidenceRefs: string[];
  functionDocName?: string;
}

export interface CapabilityDocCodeAnchor {
  role: string;
  symbolOrRoute: string;
  path: string;
  touchWhen: string[];
  doNotTouchWhen: string[];
  evidenceRefs: string[];
}

export interface CapabilityDocModuleSurface {
  path: string;
  evidenceRefs: string[];
}

export interface CapabilityDocDataContract {
  subject: string;
  kind: string;
  fields: Array<{
    name: string;
    meaningZh: string;
    source: string;
    evidenceRefs: string[];
  }>;
  caveats: string[];
  evidenceRefs: string[];
}

export interface CapabilityDocUnknown {
  question: string;
  blockedDecisions: string[];
  minimalNextEvidence: string[];
  riskIfGuessed: string;
}

export interface CapabilityDocValidation {
  goal: string;
  checks: string[];
  acceptanceOracle: string[];
  cannotVerifyWithout: string[];
  evidenceRefs: string[];
}

export interface CapabilityDocEvidence {
  ref: string;
  kind: string;
  location?: string;
  name?: string;
  summary?: string;
}

export interface CapabilityDocModel {
  capabilityId: string;
  domainKey?: string;
  domainName?: string;
  title: string;
  summaryZh: string;
  includes: string[];
  excludes: string[];
  triggers: string[];
  terms: CapabilityDocTerm[];
  behaviors: CapabilityDocBehavior[];
  codeAnchors: CapabilityDocCodeAnchor[];
  moduleSurfaces: CapabilityDocModuleSurface[];
  dataContracts: CapabilityDocDataContract[];
  unknowns: CapabilityDocUnknown[];
  validation: CapabilityDocValidation[];
  evidenceIndex: CapabilityDocEvidence[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function objectSource(object: KnowledgeObject): string {
  return asString(object.metadata.source) ?? "llm";
}

function isWeakSkeletonTerm(object: KnowledgeObject): boolean {
  if (object.type !== "TERM") return false;
  if (objectSource(object) !== "skeleton") return false;
  const canonicalTerm = asString(object.metadata.canonicalTerm) ?? "";
  const definition = asString(object.metadata.businessDefinition) ?? "";
  return (
    definition.length === 0 ||
    definition.toLowerCase() === canonicalTerm.toLowerCase()
  );
}

function collectUsedRefs(objects: KnowledgeObject[]): Set<string> {
  const refs = new Set<string>();
  for (const object of objects) {
    for (const ref of object.evidencePrimary) refs.add(ref);
    for (const ref of object.evidenceSupporting) refs.add(ref);
  }
  return refs;
}

export function buildCapabilityDocModel(input: {
  objects: KnowledgeObject[];
  capabilityId: string;
  evidenceIndex?: EvidenceIndexItem[];
}): CapabilityDocModel {
  const { objects, capabilityId } = input;
  const cap =
    objects.find((o) => o.id === capabilityId) ??
    objects.find((o) => o.type === "CAP");
  const title =
    asString(cap?.metadata.canonicalTerm) ?? cap?.id ?? capabilityId;
  const summaryZh = cap?.description ?? `Capability ${capabilityId}`;

  const terms = objects
    .filter((o) => o.type === "TERM")
    .filter((o) => !isWeakSkeletonTerm(o))
    .map((o) => ({
      term: asString(o.metadata.canonicalTerm) ?? o.id.replace(/^TERM-/, ""),
      meaningZh: asString(o.metadata.businessDefinition) ?? o.description,
      notEqualTo: asStringArray(o.metadata.notEqualTo),
      evidenceRefs: o.evidencePrimary,
    }));

  const behaviors = objects
    .filter((o) => o.type === "FLOW")
    .map((o) => {
      const orderedSteps = Array.isArray(o.metadata.orderedSteps)
        ? o.metadata.orderedSteps
        : [];
      const evidenceSteps = Array.isArray(o.metadata.evidenceSteps)
        ? o.metadata.evidenceSteps
        : [];
      const steps: CapabilityDocBehaviorStep[] = orderedSteps
        .map((step) => {
          if (!step || typeof step !== "object") return undefined;
          const record = step as Record<string, unknown>;
          const action = asString(record.action);
          if (!action) return undefined;
          const evidenceRef = asString(record.evidenceRef);
          return {
            step: action,
            evidenceRefs: evidenceRef ? [evidenceRef] : o.evidencePrimary,
          };
        })
        .filter((step): step is CapabilityDocBehaviorStep => Boolean(step));

      if (steps.length === 0) {
        for (const item of evidenceSteps) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const action = asString(record.action);
          if (action)
            steps.push({ step: action, evidenceRefs: o.evidencePrimary });
        }
      }

      return {
        title: o.id,
        summary: o.description,
        steps,
        evidenceRefs: o.evidencePrimary,
        functionDocName: `${o.id}.md`,
      };
    });

  const codeAnchors = objects
    .filter((o) => o.type === "MOD")
    .map((o) => ({
      role: asString(o.metadata.ownedResponsibility) ?? o.description,
      symbolOrRoute: asStringArray(o.metadata.entryPoints).join(", ") || o.id,
      path: asString(o.metadata.rootPath) ?? "unknown",
      touchWhen: asStringArray(o.metadata.touchWhen),
      doNotTouchWhen: asStringArray(o.metadata.doNotTouchWhen),
      evidenceRefs: o.evidencePrimary,
    }));

  const moduleSurfaces = objects
    .filter((o) => o.type === "MOD")
    .map((o) => ({
      path: asString(o.metadata.rootPath) ?? "unknown",
      evidenceRefs: o.evidencePrimary,
    }));

  const dataContracts = objects
    .filter((o) => o.type === "CON")
    .map((o) => {
      const fields: CapabilityDocDataContract["fields"] = [];
      const fieldSemantics = o.metadata.fieldSemantics;
      if (
        fieldSemantics &&
        typeof fieldSemantics === "object" &&
        !Array.isArray(fieldSemantics)
      ) {
        for (const [name, value] of Object.entries(
          fieldSemantics as Record<string, unknown>,
        )) {
          const meaningZh =
            typeof value === "string"
              ? value
              : value && typeof value === "object"
                ? (asString((value as Record<string, unknown>).meaning) ??
                  asString(
                    (value as Record<string, unknown>).businessMeaning,
                  ) ??
                  "")
                : "";
          fields.push({
            name,
            meaningZh,
            source: asString(o.metadata.subject) ?? o.id,
            evidenceRefs: o.evidencePrimary,
          });
        }
      }

      return {
        subject: asString(o.metadata.subject) ?? o.description,
        kind: asString(o.metadata.kind) ?? "contract",
        fields,
        caveats: asStringArray(o.metadata.validationRules),
        evidenceRefs: o.evidencePrimary,
      };
    });

  const unknowns = objects
    .filter((o) => o.type === "OPEN")
    .map((o) => ({
      question: o.description,
      blockedDecisions: o.blockedDecisions,
      minimalNextEvidence: asStringArray(o.metadata.minimalNextEvidence),
      riskIfGuessed:
        o.unsupportedParts.join("; ") ||
        "If guessed, the implementation plan may rely on unsupported assumptions.",
    }));

  const validation: CapabilityDocValidation[] = objects
    .filter((o) => o.type === "VER")
    .map((o) => ({
      goal: asString(o.metadata.verificationGoal) ?? o.description,
      checks: asStringArray(o.metadata.testAnchors),
      acceptanceOracle: asStringArray(o.metadata.acceptanceOracle),
      cannotVerifyWithout: [] as string[],
      evidenceRefs: o.evidencePrimary,
    }));

  if (validation.length === 0) {
    const validationUnknown = unknowns.find(
      (u) =>
        u.question.toLowerCase().includes("validation") ||
        u.blockedDecisions.some((decision) =>
          decision.toLowerCase().includes("validation"),
        ),
    );
    validation.push({
      goal: "当前知识包没有足够证据证明验证路径。",
      checks: [],
      acceptanceOracle: [],
      cannotVerifyWithout: validationUnknown?.minimalNextEvidence.length
        ? validationUnknown.minimalNextEvidence
        : ["补充测试、手工验收步骤或运行证据后，才能把验证结论作为事实。"],
      evidenceRefs: [],
    });
  }

  const usedRefs = collectUsedRefs(objects);
  const evidenceIndex = (input.evidenceIndex ?? [])
    .filter((item) => usedRefs.has(item.ref))
    .map((item) => ({
      ref: item.ref,
      kind: item.kind,
      location: item.location,
      name: item.name,
      summary: item.summary,
    }));

  return {
    capabilityId,
    domainKey: asString(cap?.metadata.domainKey),
    domainName: asString(cap?.metadata.domainName),
    title,
    summaryZh,
    includes: asStringArray(cap?.metadata.successCriteria),
    excludes: asStringArray(cap?.metadata.nonGoals),
    triggers: [title, ...terms.map((term) => term.term)].filter(
      (item, index, array) => array.indexOf(item) === index,
    ),
    terms,
    behaviors,
    codeAnchors,
    moduleSurfaces,
    dataContracts,
    unknowns,
    validation,
    evidenceIndex,
  };
}
