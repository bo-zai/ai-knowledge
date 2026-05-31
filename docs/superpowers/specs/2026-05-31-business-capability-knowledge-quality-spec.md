# Business Capability Knowledge Quality Spec

## Background

The design baseline is under:

```text
notes/wiki-agent-knowledge/design
```

The current implementation can run `generate-capability`, discover a target capability, build an `EvidenceBundle`, call a LangGraph-backed LLM provider, and write `bootstrap-knowledge/`.

Real validation on:

```text
D:\workspace\other_project\music-education-app
```

shows the command can call the model and write files, but the generated package is still closer to a technical proof of concept than the business capability knowledge described by the design documents.

Current real output issues:

- `CAP` can still come from skeleton text such as `is a discovered business capability supported by repository evidence`.
- `FLOW` can be a method-name chain such as `check prod stock and create order -> add add -> find by id`, not a business flow.
- `TERM` can include field-like or DTO-like facts instead of business vocabulary.
- `CON` can represent mapper/type evidence instead of a business-facing contract.
- `MOD` lacks change guidance such as `touch_when` and `do_not_touch_when`.
- `VER` only names test anchors instead of explaining the validation goal and oracle.
- `OPEN` lacks `minimal_next_evidence`, so it cannot reliably stop an agent from guessing.
- The report counts accepted claims but does not prove key business objects came from the LLM.

This round must return to the design goal: generate AI-facing knowledge that helps an agent understand a new requirement, ground terms, reconstruct current behavior, localize change surface, and plan validation.

## Goal

Improve `generate-capability` so the first landed version of business capability knowledge generation produces useful, evidence-grounded objects for one business capability.

The target object set for this round is:

```text
CAP
TERM
FLOW
CON
MOD
VER
OPEN
```

This is intentionally narrower than the full design model. Do not implement the full `SYS` / `OWN` / `INV` / `STATE` / `DEC` system in this round. The generated `OPEN` objects may identify missing ownership or external system evidence, but those object types are out of scope for this implementation.

## Non-Goals

- Do not implement all 13 object types from `knowledge-object-model.md`.
- Do not build the full evaluation harness with `with / without / stale` experiments.
- Do not introduce a second LLM config system.
- Do not let the LLM decide object IDs, file paths, catalog paths, or package layout.
- Do not let the LLM scan the whole repository.
- Do not move business logic into `src/cli/`.
- Do not make `generation/` write files.

## Design Baseline Requirements

### Capability Knowledge Must Serve Agent Decisions

The generated package must support these design decisions from `document-architecture.md`:

- Term grounding.
- Current behavior reconstruction.
- Change surface localization.
- Validation planning.
- Unknown escalation.
- Evidence check.

The output does not need to solve full boundary lock yet because `SYS` and `OWN` are out of scope. However, if external system or ownership evidence is missing, that gap must become an `OPEN` object.

### Claims Are the Minimum Unit

LLM output remains `CandidateClaim[]`, but the claim schema must be rich enough to assemble business useful objects. A candidate claim must be able to carry object-type-specific fields without allowing the model to choose IDs or paths.

Add or extend object hints so claims can provide:

```ts
objectHints: {
  canonicalTerm?: string;
  subject?: string;
  businessDefinition?: string;
  notEqualTo?: string[];
  orderedSteps?: Array<{ action: string; evidenceRef?: string; note?: string }>;
  contractSubject?: string;
  contractKind?: 'schema' | 'sql' | 'api' | 'event' | 'output';
  fieldSemantics?: Record<string, string>;
  validationRules?: string[];
  modulePath?: string;
  ownedResponsibility?: string;
  touchWhen?: string[];
  doNotTouchWhen?: string[];
  verificationGoal?: string;
  acceptanceOracle?: string[];
  minimalNextEvidence?: string[];
}
```

The program still controls:

- object ID generation
- object path
- catalog path
- object type directory
- evidence ref validation

### Required Object Quality

#### CAP

`CAP` must describe the business capability, not the existence of repository evidence.

Required quality:

- description states the business purpose.
- metadata includes `goal`, `successCriteria`, and `nonGoals` when evidence supports them.
- evidence refs are non-empty.
- must be LLM-generated for command success.

Rejected examples:

- `X is a discovered business capability supported by repository evidence.`
- `X capability exists as a service layer component...`

#### TERM

`TERM` must represent business vocabulary.

Required quality:

- `canonicalTerm` is a business term.
- description explains business meaning.
- metadata may include aliases, business definition, and `notEqualTo`.
- technical terms such as `mybatis`, `mapper`, `service`, `controller`, `xml`, `sql`, `dto`, `vo`, `req`, `resp`, `entity` are rejected as terms unless they are part of a domain phrase proven by evidence.

Rejected examples:

- `OrderCommitReq contains goodsId`
- `OrderGoodsVO has fields id, goodsName, number`
- `MyBatis mapper`

#### FLOW

`FLOW` must describe current business behavior.

Required quality:

- metadata includes `orderedSteps`.
- steps are business actions, not raw method names.
- at least one step must cite an evidence ref.
- happy path is required.
- missing failure branches or compensation must become `OPEN`.

Rejected examples:

- `Flow: add add -> find by id`
- `X has a repository-derived execution flow.`

#### CON

`CON` must describe a business-relevant data/API/SQL contract used by the capability.

Required quality:

- description explains the contract's role in the business capability.
- metadata includes `kind`, `subject`, and at least one of `fieldSemantics`, `validationRules`, or `schemaRef`.
- mapper methods and DTO classes may be evidence, but the object should not be only a mapper/type name.

Rejected examples:

- `OrderGoodsMapper provides SQL contracts...` without business field semantics.
- `X is a data or schema contract related to Y.`

#### MOD

`MOD` must map business change to code change surface.

Required quality:

- metadata includes `rootPath`.
- metadata includes `ownedResponsibility`.
- metadata includes `touchWhen`.
- metadata includes `doNotTouchWhen`.
- should link test anchors when available.

Rejected examples:

- `src/main/java/.../service is part of the change surface...` without guidance.

#### VER

`VER` must explain how to prove the business capability change is correct.

Required quality:

- metadata includes `verificationGoal`.
- metadata includes `acceptanceOracle`.
- should cite tests when available.
- if no tests exist, generate `OPEN` with minimal next evidence for validation.

Rejected examples:

- `OrderControllerTest is a validation anchor...` without what it proves.

#### OPEN

`OPEN` must block guessing.

Required quality:

- description states the unknown.
- `blockedDecisions` is non-empty.
- metadata includes `minimalNextEvidence`.
- optional metadata includes `ownerToAsk` and `escalationGate`.

Rejected examples:

- generic `No explicit external DB ownership contract found` without what decision is blocked.

## LLM Success Semantics

`generate-capability` succeeds only if all conditions are met:

1. LangGraph LLM runtime is called.
2. JSON/schema validation passes.
3. Evidence filtering passes.
4. Accepted LLM claims include at least one `CAP`.
5. Accepted LLM claims include at least one of `FLOW` or `CON`.
6. Generated final objects include:
   - one `CAP`
   - at least one `TERM`
   - at least one `FLOW` or `CON`
   - at least one `MOD`
   - at least one `VER` or one `OPEN` that explains missing validation evidence
7. Key `CAP` and `FLOW`/`CON` descriptions are not skeleton default sentences.

Skeleton claims may only supplement missing supporting objects after the LLM has supplied required business claims. Skeleton claims must never be enough to make the run succeed.

## Source Tracking

Every final `KnowledgeObject` must carry source metadata:

```ts
metadata: {
  source: 'llm' | 'skeleton' | 'evidence_seed';
  ...
}
```

If multiple claims merge into one object, keep the strongest source:

```text
llm > evidence_seed > skeleton
```

The report must include:

```json
{
  "objectSourceCounts": {
    "llm": 0,
    "skeleton": 0,
    "evidence_seed": 0
  },
  "requiredBusinessObjects": {
    "capFromLlm": true,
    "flowOrConFromLlm": true,
    "modPresent": true,
    "verOrValidationOpenPresent": true
  }
}
```

## Prompt Requirements

The capability prompt must explicitly tell the model:

- Generate business capability knowledge for AI agents.
- Do not generate generic code summaries.
- Do not create object IDs or paths.
- Use only evidence refs listed in the prompt.
- Missing failure semantics, ownership, source of truth, or validation evidence must become `OPEN`.
- `TERM` is business vocabulary only.
- `FLOW` steps must be business actions.
- `CON` must describe business-relevant contract semantics, not just class or mapper names.
- `MOD` must include when to touch and when not to touch.
- `VER` must include verification goal and acceptance oracle.
- `OPEN` must include blocked decisions and minimal next evidence.

The prompt must include rejected examples so the model does not reproduce current skeleton sentences.

## Assembly Requirements

Assembly must convert enriched hints into object metadata:

- `CAP`: `goal`, `successCriteria`, `nonGoals`
- `TERM`: `canonicalTerm`, `businessDefinition`, `notEqualTo`
- `FLOW`: `orderedSteps`, `failureBranches`, `compensation`
- `CON`: `kind`, `subject`, `fieldSemantics`, `validationRules`
- `MOD`: `rootPath`, `ownedResponsibility`, `touchWhen`, `doNotTouchWhen`, `testAnchors`
- `VER`: `verificationGoal`, `acceptanceOracle`, `testAnchors`
- `OPEN`: `minimalNextEvidence`, `ownerToAsk`, `escalationGate`

The implementation may leave unsupported metadata fields absent, but must not replace missing evidence with invented facts. Missing critical evidence becomes `OPEN`.

## Capability Page Requirements

Update the capability page to follow the design shape more closely:

```md
# CAP-XXX

## Requirement Intent
## Current Behavior
## Business Terms
## Contracts
## Code Anchors
## Validation
## Unknowns and Escalation
```

`Boundary` and `Constraints` may be omitted in this round or represented through `OPEN` because `SYS` / `OWN` / `INV` are out of scope.

The page must only reference object IDs and brief summaries derived from objects. It must not invent new facts.

## Real Project Validation

The required real validation target is:

```text
D:\workspace\other_project\music-education-app
```

Use this command:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-business-capability-quality-validation --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

If the target project config is unavailable, use an equivalent working local config. A config that returns authentication errors is not valid for acceptance.

Validation must inspect generated files and report:

```text
Generated capability:
LLM runtime:
LLM accepted claims:
Skeleton added claims:
CAP source:
FLOW/CON source:
TERM technical leakage:
MOD has touch guidance:
VER has oracle:
OPEN has minimal next evidence:
Evidence refs verified:
```

## Acceptance Criteria

- `npm run typecheck` passes.
- `npm run build` passes.
- `npm test` passes.
- Real project command succeeds.
- `reports/capability-generation.json` shows `llmRuntime: "langgraph"` and `llmSucceeded: true`.
- Required business object report flags are true.
- `CAP` object source is `llm`.
- At least one `FLOW` or `CON` object source is `llm`.
- No generated `TERM` object has a technical canonical term.
- At least one `MOD` object has non-empty `touchWhen` and `doNotTouchWhen`.
- At least one `VER` object has non-empty `verificationGoal` and `acceptanceOracle`, or an `OPEN` object blocks validation with `minimalNextEvidence`.
- Every non-OPEN evidence ref exists in `evidence/index.jsonl`.
- Generated package does not contain current bad default phrases:
  - `is a discovered business capability supported by repository evidence`
  - `has a repository-derived execution flow`
  - `is a data or schema contract related`
  - `TERM-MYBATIS-MAPPER`
  - `service_implementation`
  - `data_access_layer`
  - `business_logic`
  - `persistence_layer`

