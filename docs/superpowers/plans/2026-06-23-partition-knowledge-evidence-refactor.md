# Partition Knowledge Evidence Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make partition output the primary evidence boundary for existing `CONCEPT` and `CAPABILITY` generation without introducing a parallel knowledge-input framework.

**Architecture:** Add `src/knowledge-evidence/` as the unified evidence planning layer. It reads partition artifacts, converts them to existing `EvidenceGroup` and `CapabilityInventoryItem` contracts, writes review artifacts, and falls back to existing graph extractors when partition evidence is unavailable.

**Tech Stack:** TypeScript, Node.js fs/path, existing LadybugDB query executor, existing `EvidenceBundle`, `EvidenceGroup`, and capability inventory contracts.

---

### Task 1: Add Knowledge Evidence Module

**Files:**

- Create: `src/knowledge-evidence/types.ts`
- Create: `src/knowledge-evidence/partition-provider.ts`
- Create: `src/knowledge-evidence/artifact-writer.ts`
- Create: `src/knowledge-evidence/index.ts`

- [ ] Define normalized partition scope types.
- [ ] Read `.knowledge/partitions/_index.json` and partition files through `getStoragePaths(repoPath)`.
- [ ] Write `.knowledge/knowledge-generation/*.json` review artifacts.

### Task 2: Add Planners

**Files:**

- Create: `src/knowledge-evidence/graph-provider.ts`
- Create: `src/knowledge-evidence/merge-policy.ts`
- Create: `src/knowledge-evidence/concept/concept-evidence-planner.ts`
- Create: `src/knowledge-evidence/capability/capability-evidence-planner.ts`
- Create: `src/knowledge-evidence/capability/capability-inventory-planner.ts`
- Create: `src/knowledge-evidence/evidence-planner.ts`

- [ ] Wrap existing extractors as `GraphEvidenceProvider`.
- [ ] Convert partition scopes to partition-scoped concept and capability `EvidenceGroup[]`.
- [ ] Convert partition scopes with entry points to `CapabilityInventoryItem[]`.
- [ ] Use partition evidence first and graph evidence as fallback or supplement.

### Task 3: Replace Evidence Preparation Entrypoints

**Files:**

- Modify: `src/evidence/type-evidence-builder.ts`
- Modify: `src/slicing/capability-inventory.ts`

- [ ] Route `buildEvidenceBundlesByPackage()` through `buildPlannedEvidenceGroups()`.
- [ ] Route `buildCapabilityInventory()` through `buildPlannedCapabilityInventory()`.
- [ ] Keep existing graph logic available through provider fallback.

### Task 4: Verify

**Files:**

- No test files by user request.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] If build passes, run generation/partition inspection commands against the three validation repositories as needed.
