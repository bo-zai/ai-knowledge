# Plan Output Contract

## Purpose

When this skill is used for requirement clarification, scope judgment, or plan generation, the output must be structured enough that a reader can see:

1. What the requirement actually means
2. Which systems are involved
3. Which systems are external or out of scope
4. Whether local code should change
5. What is still uncertain

## Required Sections

Always include these sections in the final answer.

### 1. Requirement Summary

State:

1. The normalized requirement intent
2. The target business object or capability
3. The user-visible or system-visible expected result

### 2. Term Normalization

List:

1. Requirement terms that were mapped to standard system names, objects, fields, or capabilities
2. Any unresolved aliases or ambiguous terms

### 3. System Boundary Judgment

State:

1. Which systems are involved
2. Which systems are external
3. Which systems are mentioned but do not need to change
4. The specific knowledge documents that support the judgment

### 4. Source of Truth and Ownership

State:

1. Which system defines the relevant object, field, status, or rule
2. Which capability owner is responsible for the change
3. Whether the local system is owner, consumer, adapter, mapper, or presenter

### 5. Implementation Mode

State one primary mode:

1. Local code change
2. Local configuration change
3. Data handling or initialization
4. Upstream change first, local follow-up
5. Coordination only, no local change yet

Explain why this is the correct mode and why the obvious alternatives are not.

### 6. Local Scope

If local change is required, state:

1. Which local service, module, or API is in scope
2. Which implementation layer is in scope
3. Which related local modules are explicitly out of scope

If local change is not required, state that explicitly and do not invent local implementation tasks.

### 7. Preconditions and Coordination

List:

1. Upstream prerequisites
2. Required coordination with other systems or teams
3. Blocking items that prevent a fully executable plan

### 8. Validation and Acceptance

List:

1. Minimum validation steps
2. Required integration checks
3. Acceptance evidence such as fields, statuses, API results, events, or logs

### 9. Open Questions

List every item that remains uncertain after following the reading protocol.

Do not hide missing knowledge inside tentative wording. State it directly.

## Output Rules

1. Every key conclusion should cite the supporting document path inline.
2. Use direct and deterministic wording when the knowledge tree is explicit.
3. Use `cannot determine from current knowledge` when the knowledge tree does not support a conclusion.
4. Separate `needs no local code change` from `cannot yet determine local code change`.
5. Do not turn the answer into a generic development checklist without boundary reasoning.
