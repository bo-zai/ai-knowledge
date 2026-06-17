import type {
  EntrySignal,
  BehaviorSignal,
  TestSignal,
  DocSignal,
} from "./capability-candidate-schema.js";

export interface FunctionClusterSignal {
  kind: "entry" | "behavior" | "test" | "doc";
  name: string;
  location: string;
  summary?: string;
  role?: string;
  matchedTerms: string[];
  relevance: number;
}

export interface FunctionCluster {
  clusterId: string;
  canonicalName: string;
  normalizedVerb: string;
  normalizedObject: string;
  domainTerms: string[];
  summary: string;
  sourceKinds: Array<"entry" | "behavior" | "test" | "doc">;
  isCore: boolean;
  relevance: number;
  signals: FunctionClusterSignal[];
}

const VERB_NORMALIZATION: Record<string, string> = {
  submit: "create",
  place: "create",
  create: "create",
  add: "create",
  save: "create",
  issue: "create",
  publish: "publish",
  send: "send",
  cancel: "cancel",
  close: "cancel",
  revoke: "cancel",
  delete: "delete",
  remove: "delete",
  update: "update",
  edit: "update",
  modify: "update",
  bind: "bind",
  assign: "bind",
  link: "bind",
  unbind: "unbind",
  unlock: "unlock",
  lock: "lock",
  approve: "approve",
  reject: "reject",
  pay: "pay",
  settle: "settle",
  refund: "refund",
  sync: "sync",
  import: "import",
  export: "export",
  list: "query",
  page: "query",
  query: "query",
  get: "query",
  detail: "query",
  find: "query",
  fetch: "query",
  load: "query",
};

const QUERY_VERBS = new Set(["query"]);
const TECHNICAL_OBJECTS = new Set([
  "abstract",
  "api",
  "callback",
  "cloud",
  "data",
  "info",
  "list",
  "page",
  "detail",
  "dto",
  "vo",
  "request",
  "response",
  "entity",
  "mapper",
  "service",
  "controller",
  "config",
  "job",
  "task",
  "scheduler",
  "test",
  "health",
  "ffmpeg",
  "file",
  "upload",
  "download",
  "internal",
  "execute",
  "call",
  "back",
  "ali",
  "li",
  "wx",
  "sdk",
]);

function splitWords(input: string): string[] {
  return input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[._\/-]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function normalizeVerb(rawVerb?: string): string {
  const first = splitWords(rawVerb ?? "")[0] ?? "handle";
  return VERB_NORMALIZATION[first] ?? first;
}

function normalizeObject(
  rawObject: string | undefined,
  matchedTerms: string[],
): { object: string; domainTerms: string[] } {
  const terms = [...matchedTerms]
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 1 && !TECHNICAL_OBJECTS.has(term));

  const rawWords = splitWords(rawObject ?? "").filter(
    (word) => word.length > 1 && !TECHNICAL_OBJECTS.has(word),
  );

  const merged = [...new Set([...terms, ...rawWords])];
  const domainTerms = merged.slice(0, 3);
  const object = domainTerms[0] ?? rawWords[0] ?? terms[0] ?? "workflow";
  return { object, domainTerms };
}

function titleCaseTerm(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function toCanonicalFunctionName(verb: string, object: string): string {
  const verbLabel = titleCaseTerm(verb);
  const objectLabel = titleCaseTerm(object);
  return `${verbLabel} ${objectLabel}`;
}

function toClusterSignalFromEntry(entry: EntrySignal): FunctionClusterSignal {
  return {
    kind: "entry",
    name: entry.name,
    location: entry.location,
    summary: entry.description,
    role: entry.role,
    matchedTerms: entry.matchedTerms ?? [],
    relevance: entry.targetRelevance ?? 0,
  };
}

function toClusterSignalFromBehavior(
  behavior: BehaviorSignal,
): FunctionClusterSignal {
  return {
    kind: "behavior",
    name: `${behavior.verb} ${behavior.object}`.trim(),
    location: behavior.location,
    summary: behavior.context,
    role: behavior.role,
    matchedTerms: behavior.matchedTerms ?? [],
    relevance: behavior.targetRelevance ?? 0,
  };
}

function toClusterSignalFromTest(test: TestSignal): FunctionClusterSignal {
  return {
    kind: "test",
    name: test.testName,
    location: test.location,
    summary: test.describeBlock,
    role: test.role,
    matchedTerms: test.matchedTerms ?? [],
    relevance: test.targetRelevance ?? 0,
  };
}

function toClusterSignalFromDoc(doc: DocSignal): FunctionClusterSignal {
  return {
    kind: "doc",
    name: (doc.terms ?? []).join(" "),
    location: doc.location,
    summary: (doc.constraints ?? []).join("; "),
    matchedTerms: doc.matchedTerms ?? [],
    relevance: doc.targetRelevance ?? 0,
  };
}

function deriveClusterKey(signal: FunctionClusterSignal): {
  key: string;
  canonicalName: string;
  normalizedVerb: string;
  normalizedObject: string;
  domainTerms: string[];
} {
  const words = splitWords(signal.name);
  const normalizedVerb = normalizeVerb(words[0]);
  const { object, domainTerms } = normalizeObject(
    words.slice(1).join(" "),
    signal.matchedTerms,
  );
  const canonicalName = toCanonicalFunctionName(normalizedVerb, object);
  return {
    key: `${normalizedVerb}:${object}`,
    canonicalName,
    normalizedVerb,
    normalizedObject: object,
    domainTerms,
  };
}

function isCoreCluster(
  verb: string,
  signals: FunctionClusterSignal[],
): boolean {
  if (!QUERY_VERBS.has(verb)) return true;
  return signals.some(
    (signal) => signal.kind === "doc" || signal.kind === "test",
  );
}

function buildSummary(cluster: {
  canonicalName: string;
  signals: FunctionClusterSignal[];
  normalizedVerb: string;
  normalizedObject: string;
}): string {
  const sourceKinds = [
    ...new Set(cluster.signals.map((signal) => signal.kind)),
  ];
  const roleHints = [
    ...new Set(cluster.signals.map((signal) => signal.role).filter(Boolean)),
  ];
  const roleText =
    roleHints.length > 0 ? `，主要落在 ${roleHints.join(" / ")} 层` : "";
  return `${cluster.canonicalName} 候选由 ${sourceKinds.join("、")} 证据共同支持${roleText}。`;
}

export function buildFunctionClusters(input: {
  entrySignals: EntrySignal[];
  behaviorSignals: BehaviorSignal[];
  testSignals: TestSignal[];
  docSignals: DocSignal[];
}): FunctionCluster[] {
  const allSignals: FunctionClusterSignal[] = [
    ...input.entrySignals.map(toClusterSignalFromEntry),
    ...input.behaviorSignals.map(toClusterSignalFromBehavior),
    ...input.testSignals.map(toClusterSignalFromTest),
    ...input.docSignals.map(toClusterSignalFromDoc),
  ].filter((signal) => signal.name.trim().length > 0);

  const clusters = new Map<string, FunctionCluster>();

  for (const signal of allSignals) {
    const derived = deriveClusterKey(signal);
    const current = clusters.get(derived.key);
    if (!current) {
      clusters.set(derived.key, {
        clusterId: `FUNC-${derived.normalizedVerb.toUpperCase()}-${derived.normalizedObject.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
        canonicalName: derived.canonicalName,
        normalizedVerb: derived.normalizedVerb,
        normalizedObject: derived.normalizedObject,
        domainTerms: derived.domainTerms,
        summary: "",
        sourceKinds: [signal.kind],
        isCore: true,
        relevance: signal.relevance,
        signals: [signal],
      });
      continue;
    }

    current.signals.push(signal);
    current.relevance = Math.max(current.relevance, signal.relevance);
    if (!current.sourceKinds.includes(signal.kind)) {
      current.sourceKinds.push(signal.kind);
    }
    current.domainTerms = [
      ...new Set([...current.domainTerms, ...derived.domainTerms]),
    ].slice(0, 3);
  }

  const values = [...clusters.values()]
    .map((cluster) => ({
      ...cluster,
      isCore: isCoreCluster(cluster.normalizedVerb, cluster.signals),
      summary: buildSummary(cluster),
    }))
    .filter((cluster) => cluster.signals.length > 0)
    .sort((left, right) => {
      const coreDiff = Number(right.isCore) - Number(left.isCore);
      if (coreDiff !== 0) return coreDiff;
      return right.relevance - left.relevance;
    });

  return values.slice(0, 12);
}
