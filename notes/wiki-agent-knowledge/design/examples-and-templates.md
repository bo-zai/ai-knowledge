# 对象模板与样例

## 1. TERM 模板

```md
---
id: TERM-XXX
type: TERM
status: fact
owner:
task_triggers:
decision_points:
evidence_primary:
stale_if:
last_verified:
---

# TERM-XXX

## Core Meaning
### DEF-001 Canonical Definition
- Claim:
- Business definition:
- Applies in:
- Not used for:

## Distinctions
### DIF-001 Not Equal To
- Claim:
- Not equal to:
- Why:
- Counterexample:

## Decision Use
### USE-001 Requirement Interpretation
- Claim:
- Affects decisions:
- Expected failure if missing:
```

## 2. OWN 模板

```md
---
id: OWN-XXX
type: OWN
status: fact
owner:
task_triggers:
decision_points:
evidence_primary:
stale_if:
---

# OWN-XXX

## Ownership Statement
### OWN-001 Source Of Truth
- Claim:
- Subject:
- Source of truth:
- Scope:

## Allowed Writes
### WRT-001 Internal Writable Fields
- Claim:
- Writable fields:
- Preconditions:

## Forbidden Writes
### FRB-001 Forbidden Update
- Claim:
- Forbidden updates:
- Why:
- Expected failure if missing:

## Precedence
### PRC-001 Conflict Resolution
- Claim:
- Precedence rule:
- Example:
```

## 3. CON 模板

```md
---
id: CON-XXX
type: CON
status: fact
owner:
task_triggers:
decision_points:
evidence_primary:
stale_if:
---

# CON-XXX

## Purpose
### PUR-001 Contract Purpose
- Claim:
- Producer:
- Consumer:

## Required Fields
### FLD-001 Required Inputs
- Claim:
- Required fields:
- Field semantics:
- Validation rules:

## Delivery Semantics
### DLV-001 Idempotency And Ordering
- Claim:
- Idempotency key:
- Ordering:
- Retry:
- Timeout:

## Error Semantics
### ERR-001 Error Map
- Claim:
- Upstream status meanings:
- Internal mapping:
- Expected failure if missing:
```

## 4. MOD 模板

```md
---
id: MOD-XXX
type: MOD
status: fact
owner:
task_triggers:
decision_points:
evidence_primary:
stale_if:
---

# MOD-XXX

## Responsibility
### RSP-001 Owned Responsibility
- Claim:
- Owns:
- Does not own:

## Entry Points
### ENT-001 Entry Anchors
- Claim:
- Entry points:
- Callers:

## Change Guidance
### TCH-001 Touch When
- Claim:
- Touch when:
- Why:

### NTC-001 Do Not Touch When
- Claim:
- Do not touch when:
- Use instead:
- Expected failure if missing:

## Test Anchors
### TST-001 Related Tests
- Claim:
- Test anchors:
- Missing coverage risks:
```

## 5. VER 模板

```md
---
id: VER-XXX
type: VER
status: fact
owner:
task_triggers:
decision_points:
evidence_primary:
stale_if:
---

# VER-XXX

## Verification Goal
### GOL-001 Done Definition
- Claim:
- Requirement is considered satisfied when:

## Required Checks
### CHK-001 Unit Checks
- Claim:
- Must cover:
- Negative cases:

### CHK-002 Integration Paths
- Claim:
- Must verify:
- Cross-system paths:

## Acceptance Oracle
### ORC-001 Oracle
- Claim:
- Observable outcomes:
- Not enough signals:

## Observability
### OBS-001 Runtime Signals
- Claim:
- Metrics/logs/traces:
- Alert thresholds:
```

## 6. OPEN 模板

```md
---
id: OPEN-XXX
type: OPEN
status: open-question
owner:
task_triggers:
decision_points:
stale_if:
---

# OPEN-XXX

## Unknown
### UNK-001 Unknown Statement
- Claim:
- Unknown statement:
- Why unresolved:

## Impact
### IMP-001 Blocked Decisions
- Claim:
- Blocks:
- Risk if guessed:

## Next Evidence
### NXT-001 Minimal Next Evidence
- Claim:
- Need one of:
- Owner to ask:
- Deadline:
```

## 7. Capability Page 模板

```md
# CAP-XXX

## Requirement Intent
## Actors
## Boundary
## Current Behavior
## Constraints
## Code Anchors
## Validation
## Unknowns and Escalation
```

说明：

- 每个小节只引用对象，不新增权威事实
- 组合页的作用是帮助 Agent 按场景读取

## 8. catalog.yaml 样例

```yaml
version: 1

retrieval_order:
  - TERM
  - CAP
  - SYS
  - OWN
  - CON
  - MOD
  - VER
  - OPEN

capabilities:
  CAP-ORDER-REFUND:
    page: wiki/pages/capabilities/CAP-ORDER-REFUND.md
    seed_objects:
      - TERM-REFUND
      - OWN-REFUND-FINALITY
      - CON-PAY-REFUND-CALLBACK
      - MOD-ORDER-REFUND-SVC
      - VER-ORDER-REFUND
      - OPEN-REFUND-MANUAL-SUCCESS

unknown_escalation_rules:
  - if_no_term_match_for_core_noun: true
  - if_external_system_has_no_contract: true
  - if_no_verification_object_for_capability: true
  - if_ownership_conflict_detected: true
```

## 9. gold case 样例

```yaml
case_id: CASE-001-refund-partial
capability: CAP-ORDER-REFUND
risk_level: high

gold:
  canonical_terms:
    - TERM-REFUND
    - TERM-PARTIAL-REFUND
  systems_involved:
    - SYS-ORDER
    - SYS-PAY-GATEWAY
  source_of_truth:
    - OWN-REFUND-FINALITY
  affected_contracts:
    - CON-PAY-REFUND-CALLBACK
  candidate_modules:
    - MOD-ORDER-REFUND-SVC
  required_validations:
    - VER-ORDER-REFUND
  must_ask_questions:
    - OPEN-REFUND-MANUAL-SUCCESS
```

## 10. Agent 标准输出样例

```yaml
business_summary:
term_mapping:
boundary_decision:
systems_involved:
source_of_truth:
affected_flows:
affected_contracts:
constraints:
change_surface:
validation_plan:
unknowns:
```
