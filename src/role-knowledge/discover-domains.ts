import type { DomainRegistry } from "../packaging/domain-registry.js";
import type { DomainProfile } from "./types.js";

export type DomainSignal = {
  domainKey: string;
  domainName?: string;
  reason: string;
};

export async function discoverDomains(input: {
  registry: DomainRegistry;
  knowledgeObjects: Array<{
    type: string;
    id: string;
    name: string;
    path: string;
  }>;
  codeSignals: DomainSignal[];
  docSignals: DomainSignal[];
  gitSignals: DomainSignal[];
}): Promise<{
  confirmed: DomainProfile[];
  enriched: DomainProfile[];
  candidates: DomainProfile[];
  ignored: DomainSignal[];
}> {
  const confirmed = input.registry.domains.map((domain) =>
    ({
      domainKey: domain.domainKey,
      domainName: domain.domainName,
      summary: domain.concept?.summaryZh,
      tags: ["registry"],
    }) satisfies DomainProfile,
  );

  const candidateSignals = [
    ...input.codeSignals,
    ...input.docSignals,
    ...input.gitSignals,
  ];
  const candidates = candidateSignals
    .filter((signal) => !input.registry.domains.some((domain) => domain.domainKey === signal.domainKey))
    .map((signal) =>
      ({
        domainKey: signal.domainKey,
        domainName: signal.domainName ?? signal.domainKey,
        summary: signal.reason,
        tags: ["candidate"],
      }) satisfies DomainProfile,
    );

  const knowledgeRefDomains = input.knowledgeObjects
    .map((item) => item.path.split("/")[1] ?? "unknown")
    .filter((domain) => domain && domain !== "unknown");
  const enriched = [...new Set(knowledgeRefDomains)]
    .filter((domainKey) => !input.registry.domains.some((domain) => domain.domainKey === domainKey))
    .map((domainKey) =>
      ({
        domainKey,
        domainName: domainKey,
        tags: ["knowledge-object"],
      }) satisfies DomainProfile,
    );

  return {
    confirmed,
    enriched,
    candidates,
    ignored: [],
  };
}
