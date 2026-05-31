# Capability Real LLM Robustness Spec

## Background

The current `generate-capability` implementation has the right high-level flow:

```text
CLI
-> discover capability candidates
-> choose one capability
-> build one EvidenceBundle
-> call LangGraph LLM provider
-> parse CandidateClaim[]
-> filter by evidence
-> assemble CAP/TERM/FLOW/CON/MOD/VER/OPEN
-> write bootstrap-knowledge/
```

However, real validation against:

```text
D:\workspace\other_project\music-education-app
```

still fails before any package is written:

```text
Invalid capability claim at index 4:
objectHints.fieldSemantics.goodsList expected string, received object
objectHints.fieldSemantics.goodsPrice expected string, received object
```

This means the current code is not yet production-usable for business capability knowledge generation. Unit and mock integration tests pass because they use idealized model output, but the real model produces slightly richer nested structures than the current schema accepts.

## Answer: Is Business Capability Knowledge Generated One LLM Call At A Time?

Yes, the correct architecture is one LLM generation per business capability.

The LLM must not scan the whole repository or generate a whole-repo wiki in one call. The program should first discover and slice the repository into capability candidates, then create a bounded `EvidenceBundle` for each capability. Each `EvidenceBundle` is sent to the LLM independently.

Current state:

- `generate-capability` picks the top candidate and calls the LLM once.
- This is acceptable for the current single-capability CLI mode.
- It is not a complete multi-capability repo generation mode.

Target rule:

```text
1 capability candidate -> 1 EvidenceBundle -> 1 LangGraph LLM claim generation -> 1 capability package/view
```

Future multi-capability mode should loop over candidates and call LLM once per capability, with concurrency limits and per-capability failure reporting. That future mode is not part of this round.

## Goal

Make the current single-capability `generate-capability` command robust enough to succeed on the real `music-education-app` project and enforce the business-quality criteria from:

```text
docs/superpowers/specs/2026-05-31-business-capability-knowledge-quality-spec.md
```

This round focuses on:

1. Real LLM schema tolerance.
2. Deterministic normalization of common LLM shape variations.
3. Stronger final quality gates.
4. Real project validation.
5. Explicit documentation that the current command is single-capability mode.

## Non-Goals

- Do not implement multi-capability whole-repo generation.
- Do not add concurrency or batch orchestration.
- Do not implement `SYS`, `OWN`, `INV`, `STATE`, or `DEC`.
- Do not let the LLM choose object IDs or file paths.
- Do not let the LLM read arbitrary repository files.
- Do not add new CLI flags for `--llm` or `--require-llm`.
- Do not introduce a second model configuration system.

## Required Design

### 1. Single-Capability Mode Must Be Explicit

`generate-capability` currently selects the highest-confidence candidate:

```text
discoverCapabilities() -> candidates.sort(...)[0]
```

This must remain the behavior for this round, but the report must make it explicit:

```json
{
  "capabilityGenerationMode": "single",
  "selectedCandidateId": "CAND-...",
  "candidateCount": 1
}
```

This prevents future confusion that one command is generating all business capabilities in the repository.

### 2. Schema Must Accept Real LLM Field Semantics

Real LLM output may represent `fieldSemantics` values as objects:

```json
{
  "objectHints": {
    "fieldSemantics": {
      "goodsList": {
        "meaning": "Ordered goods line items",
        "validation": ["Must contain submitted goods"],
        "evidenceRef": "evidence://contract/CON-EVID-012"
      }
    }
  }
}
```

The schema must accept this directly instead of failing.

Define:

```ts
const FieldSemanticSchema = z.union([
  z.string(),
  z.object({
    meaning: z.string().optional(),
    validation: z.array(z.string()).optional(),
    evidenceRef: z.string().optional(),
    notes: z.array(z.string()).optional(),
  }).strict(),
]);
```

Then:

```ts
fieldSemantics: z.record(z.string(), FieldSemanticSchema).optional()
```

The writer may serialize nested objects as JSON under YAML metadata. Do not flatten semantic objects unless necessary.

### 3. Parser Normalization Must Handle Common Real LLM Shapes

The parser may normalize these cases before schema validation:

- array fields returned as a string
- `fieldSemantics.<field>` returned as a plain object
- `validationRules.<field>` accidentally returned as a string map
- OPEN `minimalNextEvidence` returned as a string
- `blockedDecisions` returned as a string
- `objectHints.orderedSteps` returned as strings

Required normalization:

```text
string -> [string] for array fields
orderedSteps: string[] -> [{ action: string }]
blockedDecisions: string -> [string]
minimalNextEvidence: string -> [string]
```

Do not normalize invalid evidence refs into valid-looking refs. Evidence refs must still be filtered against the bundle.

### 4. Repair Trace Must Be Honest

If local parser normalization changes model output after JSON parse, it must be visible in diagnostics.

Add parse metadata:

```ts
{
  normalized: boolean;
  normalizationNotes: string[];
}
```

`CapabilityClaimsLangGraphResult.graphTrace` must include:

```ts
normalizationNotes: string[];
```

This distinguishes:

- model repair through a second LLM call
- local deterministic normalization
- strict clean parse

### 5. Final Quality Gates Must Match The Spec

Current gates only verify object presence:

- CAP from LLM
- FLOW or CON from LLM
- MOD exists
- VER exists or validation OPEN exists

This is not enough.

Add these required booleans:

```ts
requiredBusinessObjects: {
  capFromLlm: boolean;
  flowOrConFromLlm: boolean;
  modPresent: boolean;
  modHasTouchGuidance: boolean;
  verOrValidationOpenPresent: boolean;
  verHasOracle: boolean;
  openHasMinimalNextEvidence: boolean;
  noTechnicalTermLeakage: boolean;
}
```

Success requires:

```text
capFromLlm = true
flowOrConFromLlm = true
modPresent = true
modHasTouchGuidance = true
verOrValidationOpenPresent = true
noTechnicalTermLeakage = true
```

For validation:

- If a `VER` exists, at least one `VER` must have `verificationGoal` and `acceptanceOracle`.
- If no adequate `VER` exists, at least one `OPEN` must have `minimalNextEvidence` and block a validation decision.

### 6. MOD Must Not Pass On Skeleton Alone

`MOD` can be created from skeleton only as a supporting object, but a successful run must contain one MOD with:

```text
metadata.source = "llm"
metadata.touchWhen non-empty
metadata.doNotTouchWhen non-empty
```

If the LLM does not provide this, the command must fail with a clear error:

```text
LLM generation failed: LLM MOD touch guidance is required for business capability knowledge
```

### 7. TERM Technical Leakage Must Be Checked On Final Objects

Filtering `TERM` claims is not enough because object assembly may derive terms from `claimText`.

After object assembly, inspect every `TERM` object's:

- `metadata.canonicalTerm`
- `id`
- `description`

Reject generated terms if the canonical term is a technical term:

```text
mybatis
mapper
xml
sql
db
database
table
schema
knowledge
evidence
capability
bootstrap
orm
dao
repository
controller
service
handler
endpoint
api
rest
http
request
response
query
result
session
transaction
connection
pool
driver
jdbc
dto
vo
req
resp
entity
```

The final report must include:

```json
"technicalTermLeakage": []
```

or a non-empty list when failing.

### 8. OPEN Quality Must Be Enforced

Every final `OPEN` object must include:

- `blockedDecisions` non-empty
- `metadata.minimalNextEvidence` non-empty

Evidence-seed OPEN objects already have `minimalNextEvidence`. LLM OPEN claims must provide it too.

If an LLM OPEN lacks `minimalNextEvidence`, reject that OPEN claim or fail if it is needed for validation readiness.

### 9. Real Project Acceptance

The final implementation must pass:

```bash
npm run typecheck
npm run build
npm test
```

And the real command:

```bash
node dist/cli/index.js generate-capability D:\workspace\other_project\music-education-app --terms course,goods,order,mybatis --paths src/main/java,src/main/resources,src/test --out D:\tmp\music-education-app-capability-real-llm-robustness-validation --llm-config D:\workspace\other_project\music-education-app\llm.config.json --verbose
```

Expected:

```text
Generated ... files
LLM runtime: langgraph
Succeeded: true
```

Report must show:

```json
"capabilityGenerationMode": "single"
"llmRuntime": "langgraph"
"llmSucceeded": true
"requiredBusinessObjects": {
  "capFromLlm": true,
  "flowOrConFromLlm": true,
  "modPresent": true,
  "modHasTouchGuidance": true,
  "verOrValidationOpenPresent": true,
  "noTechnicalTermLeakage": true
}
```

Generated package must not contain:

```text
is a discovered business capability supported by repository evidence
has a repository-derived execution flow
is a data or schema contract related
TERM-MYBATIS-MAPPER
service_implementation
data_access_layer
business_logic
persistence_layer
```

All non-OPEN evidence refs must resolve against:

```text
bootstrap-knowledge/evidence/index.jsonl
```

## Final Response Required From Claude Code

Claude Code must report:

```text
Generation mode: single capability per LLM call
Selected candidate:
Candidate count:
Generated capability:
LLM runtime:
LLM accepted claims:
Skeleton added claims:
CAP source:
FLOW/CON source:
MOD has touch guidance:
VER has oracle:
OPEN has minimal next evidence:
Technical term leakage:
Parser normalization notes:
Evidence refs verified:
Real project command:
```

