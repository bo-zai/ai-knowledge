# Insufficient Knowledge Rules

## Purpose

These rules prevent the model from filling business-knowledge gaps with generic engineering intuition.

## Non-Negotiable Rules

1. Do not invent system boundaries that are not stated in `ai-knowledge/wiki/`.
2. Do not assign source-of-truth ownership without a matching object, field, rule, or system card.
3. Do not assume a mentioned system must change.
4. Do not assume a local copy, cache, or query view owns business semantics.
5. Do not use local implementation names as evidence of business responsibility.

## Conflict Priority

When documents appear inconsistent, resolve in this order:

1. `规则与反例/*.md`
2. `业务对象与口径/*.md`
3. `外部系统/*.md`
4. `业务能力/*.md`
5. `流程与交接/*.md`
6. `集成触点/*.md`
7. `业务全景/*.md`
8. `index.md`, `doc-map.md`, `getting-started.md`

If the conflict still cannot be resolved, do not choose a side silently. Output the conflict as an open question.

## Escalate Uncertainty Instead of Guessing

Use explicit uncertainty when any of these happen:

1. A requirement term cannot be mapped through `术语与别名`.
2. No atomic document exists for the key object, field, or capability.
3. The requirement implies a business rule but only technical docs are available.
4. The knowledge tree explains integration behavior but not ownership.
5. Multiple candidate local modules exist and the skill cannot disambiguate them with the current knowledge.

## Required Fallback Wording

When knowledge is missing, use wording equivalent to:

1. `cannot determine the source of truth from current knowledge`
2. `cannot confirm whether local code change is required from current knowledge`
3. `cannot confirm the owning system from current knowledge`
4. `requires clarification before local implementation scope can be fixed`

## Anti-Patterns

Do not do the following:

1. Turn an unresolved ownership question into a local coding task.
2. Treat `_index.md` category summaries as stronger evidence than atomic cards.
3. Treat a demand-routing card as proof of source-of-truth ownership.
4. Fill an acceptance gap with generic `self-test` wording when the knowledge tree has no validation card.
5. Convert an upstream dependency gap into a silent assumption that upstream is already ready.

## Minimum Open Questions to Output

When the conclusion is not fully grounded, surface at least the unresolved items in these dimensions:

1. Unresolved term or alias
2. Unresolved source of truth
3. Unresolved owning system or capability
4. Unresolved implementation mode
5. Unresolved local landing point
6. Unresolved prerequisite or acceptance criterion
