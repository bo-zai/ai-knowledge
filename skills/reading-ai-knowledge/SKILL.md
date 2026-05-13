---
name: reading-ai-knowledge
description: Use when a task asks for requirement clarification, plan generation, boundary judgment, or implementation-scope analysis based on the local `ai-knowledge/wiki` business knowledge tree.
---

# Reading AI Knowledge

## Overview

Use this skill to turn `ai-knowledge/wiki/` from static documentation into an execution protocol for reading a new requirement.

The goal is not to summarize the whole knowledge tree. The goal is to:

1. Standardize terms from the requirement.
2. Confirm facts, ownership, and external-system boundaries.
3. Decide whether the change is code, config, data, coordination, or waiting for upstream.
4. Enter local implementation scope only after the boundary is clear.

## Quick Start

Always read these entry documents first:

1. `../../ai-knowledge/wiki/index.md`
2. `../../ai-knowledge/wiki/doc-map.md`

Then load the detailed protocol in [references/reading-protocol.md](./references/reading-protocol.md).

## Required References

- Use [references/reading-protocol.md](./references/reading-protocol.md) for the required reading order, expansion rules, and stop conditions.
- Use [references/plan-output-contract.md](./references/plan-output-contract.md) when the task asks for a plan, scope judgment, or structured conclusion.
- Use [references/insufficient-knowledge-rules.md](./references/insufficient-knowledge-rules.md) whenever knowledge is missing, conflicting, or only partially matched.

## Hard Rules

1. Do not read the whole tree by default. Follow the protocol and expand only where the requirement points.
2. Do not jump into local implementation scope before finishing source-of-truth and ownership judgment.
3. Do not treat a mentioned system as a modifiable system unless the knowledge tree supports that conclusion.
4. Do not treat a local copy, cache, or view as the source of truth unless the knowledge tree says so.
5. When knowledge is insufficient, output explicit open questions instead of inventing certainty.

## When Not to Use

Do not use this skill when the task is only:

1. Editing the knowledge tree itself.
2. Reading one specific business document without plan or scope judgment.
3. Performing pure code refactoring unrelated to `ai-knowledge/wiki/`.
