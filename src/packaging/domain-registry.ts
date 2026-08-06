import fs from "node:fs/promises";
import path from "node:path";
import type { RoleKnowledgeRef } from "../role-knowledge/types.js";

export interface DomainCapabilityRef {
  capabilityId: string;
  capabilityName: string;
  capabilityPath: string;
  summaryZh?: string;
}

export interface DomainConceptRef {
  conceptId: string;
  conceptName: string;
  conceptPath: string;
  summaryZh?: string;
}

export interface DomainRoleKnowledgeRefs {
  pm?: RoleKnowledgeRef;
  techLead?: RoleKnowledgeRef;
  qa?: RoleKnowledgeRef;
}

export interface DomainRegistryEntry {
  domainKey: string;
  domainName: string;
  concept?: DomainConceptRef;
  capabilityRefs: DomainCapabilityRef[];
  roleKnowledgeRefs?: DomainRoleKnowledgeRefs;
}

export interface DomainRegistry {
  updatedAt: string;
  domains: DomainRegistryEntry[];
}

const DOMAIN_REGISTRY_RELATIVE_PATH = ".internal/domain-registry.json";

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCapabilityIdentity(input: {
  capabilityId?: string;
  capabilityPath?: string;
  capabilityName?: string;
}): string {
  const normalizedPath = input.capabilityPath
    ?.replace(/\\/g, "/")
    .toLowerCase()
    .replace(/^capabilities\//, "")
    .replace(/\.md$/, "");
  if (normalizedPath) return normalizedPath;

  const normalizedId = input.capabilityId
    ?.toLowerCase()
    .replace(/^cap-/, "")
    .replace(/^capability-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalizedId) return normalizedId;

  return normalizeKey(input.capabilityName ?? "unknown-capability");
}

function uniqueCapabilities(
  items: DomainCapabilityRef[],
): DomainCapabilityRef[] {
  const grouped = new Map<string, DomainCapabilityRef>();
  for (const item of items) {
    const key = normalizeCapabilityIdentity(item);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, item);
      continue;
    }

    const preferCurrent =
      item.capabilityPath.toLowerCase() === item.capabilityPath ||
      (!existing.summaryZh && !!item.summaryZh);
    if (preferCurrent) {
      grouped.set(key, {
        capabilityId: item.capabilityId || existing.capabilityId,
        capabilityName: item.capabilityName || existing.capabilityName,
        capabilityPath: item.capabilityPath || existing.capabilityPath,
        summaryZh: item.summaryZh ?? existing.summaryZh,
      });
    }
  }
  return [...grouped.values()];
}

function normalizeRoleKey(role: keyof DomainRoleKnowledgeRefs): string {
  return role === "techLead" ? "tech-lead" : role;
}

function splitDomainTerms(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1);
}

export function deriveDomainKey(input: {
  domainKey?: string;
  domainName?: string;
  conceptId?: string;
  capabilityId?: string;
}): string {
  const candidates = [
    input.domainKey,
    input.domainName,
    input.conceptId,
    input.capabilityId,
    "unknown-domain",
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeKey(candidate);
    if (normalized) return normalized;
  }

  return "unknown-domain";
}

export async function loadDomainRegistry(
  packageRoot: string,
): Promise<DomainRegistry> {
  const registryPath = path.join(packageRoot, DOMAIN_REGISTRY_RELATIVE_PATH);
  try {
    const raw = await fs.readFile(registryPath, "utf-8");
    const parsed = JSON.parse(raw) as DomainRegistry;
    return {
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      domains: Array.isArray(parsed.domains) ? parsed.domains : [],
    };
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      domains: [],
    };
  }
}

export async function saveDomainRegistry(
  packageRoot: string,
  registry: DomainRegistry,
): Promise<void> {
  const registryPath = path.join(packageRoot, DOMAIN_REGISTRY_RELATIVE_PATH);
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(
    registryPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        domains: registry.domains,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
}

export function upsertConceptDomain(
  registry: DomainRegistry,
  concept: {
    domainKey?: string;
    domainName: string;
    conceptId: string;
    conceptPath: string;
    summaryZh?: string;
  },
): DomainRegistryEntry {
  const domainKey = deriveDomainKey({
    domainKey: concept.domainKey,
    domainName: concept.domainName,
    conceptId: concept.conceptId,
  });
  let entry = registry.domains.find((item) => item.domainKey === domainKey);
  if (!entry) {
    entry = {
      domainKey,
      domainName: concept.domainName,
      capabilityRefs: [],
    };
    registry.domains.push(entry);
  }

  entry.domainName = concept.domainName || entry.domainName;
  entry.concept = {
    conceptId: concept.conceptId,
    conceptName: concept.domainName,
    conceptPath: concept.conceptPath,
    summaryZh: concept.summaryZh,
  };
  return entry;
}

export function upsertCapabilityDomain(
  registry: DomainRegistry,
  capability: {
    domainKey?: string;
    domainName: string;
    capabilityId: string;
    capabilityName: string;
    capabilityPath: string;
    summaryZh?: string;
  },
): DomainRegistryEntry {
  const domainKey = deriveDomainKey({
    domainKey: capability.domainKey,
    domainName: capability.domainName,
    capabilityId: capability.capabilityId,
  });
  let entry = registry.domains.find((item) => item.domainKey === domainKey);
  if (!entry) {
    entry = {
      domainKey,
      domainName: capability.domainName,
      capabilityRefs: [],
    };
    registry.domains.push(entry);
  }

  if (!entry.concept && capability.domainName) {
    entry.domainName = capability.domainName;
  }
  entry.capabilityRefs = uniqueCapabilities([
    ...entry.capabilityRefs.filter(
      (item) =>
        normalizeCapabilityIdentity(item) !==
        normalizeCapabilityIdentity(capability),
    ),
    {
      capabilityId: capability.capabilityId,
      capabilityName: capability.capabilityName,
      capabilityPath: capability.capabilityPath,
      summaryZh: capability.summaryZh,
    },
  ]);
  return entry;
}

export function upsertRoleKnowledgeRef(
  registry: DomainRegistry,
  input: {
    domainKey?: string;
    domainName: string;
    role: keyof DomainRoleKnowledgeRefs;
    indexPath: string;
    generatedAt: string;
    status: RoleKnowledgeRef["status"];
    confidence?: RoleKnowledgeRef["confidence"];
    summary?: string;
  },
): DomainRegistryEntry {
  const domainKey = deriveDomainKey({
    domainKey: input.domainKey,
    domainName: input.domainName,
  });
  let entry = registry.domains.find((item) => item.domainKey === domainKey);
  if (!entry) {
    entry = {
      domainKey,
      domainName: input.domainName ?? domainKey,
      capabilityRefs: [],
    };
    registry.domains.push(entry);
  }

  entry.roleKnowledgeRefs ??= {};
  const roleKey = input.role;
  entry.roleKnowledgeRefs[roleKey] = {
    indexPath: input.indexPath,
    generatedAt: input.generatedAt,
    status: input.status,
    confidence: input.confidence,
    summary: input.summary,
  };
  return entry;
}

export function sortDomainRegistry(registry: DomainRegistry): DomainRegistry {
  registry.domains.sort((left, right) =>
    left.domainName.localeCompare(right.domainName, "zh-CN"),
  );
  for (const domain of registry.domains) {
    domain.capabilityRefs.sort((left, right) =>
      left.capabilityName.localeCompare(right.capabilityName, "zh-CN"),
    );
  }
  return registry;
}

export function findBestMatchingDomain(
  registry: DomainRegistry,
  input: {
    domainKey?: string;
    domainName?: string;
    targetTerms?: string[];
    primaryObjects?: string[];
    relatedEntities?: string[];
  },
): DomainRegistryEntry | undefined {
  const requestedKey = deriveDomainKey({
    domainKey: input.domainKey,
    domainName: input.domainName,
  });

  const exact = registry.domains.find(
    (domain) => domain.domainKey === requestedKey,
  );
  if (exact) return exact;

  const signalTerms = new Set<string>([
    ...splitDomainTerms(input.domainName ?? ""),
    ...(input.targetTerms ?? []).flatMap(splitDomainTerms),
    ...(input.primaryObjects ?? []).flatMap(splitDomainTerms),
    ...(input.relatedEntities ?? []).flatMap(splitDomainTerms),
  ]);

  let best: { domain: DomainRegistryEntry; score: number } | undefined;
  for (const domain of registry.domains) {
    const domainTerms = new Set<string>([
      ...splitDomainTerms(domain.domainKey),
      ...splitDomainTerms(domain.domainName),
      ...domain.capabilityRefs.flatMap((item) =>
        splitDomainTerms(item.capabilityName),
      ),
      ...(domain.concept ? splitDomainTerms(domain.concept.conceptName) : []),
    ]);

    let score = 0;
    for (const term of signalTerms) {
      if (domainTerms.has(term)) score += 1;
    }
    if (
      domain.domainName &&
      input.domainName &&
      domain.domainName.includes(input.domainName)
    )
      score += 2;

    if (score >= 2 && (!best || score > best.score)) {
      best = { domain, score };
    }
  }

  return best?.domain;
}
