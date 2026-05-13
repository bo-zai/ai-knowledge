# Reading AI Knowledge Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-local skill that teaches AI how to read `ai-knowledge/wiki/` and turn a new requirement into a grounded plan.

**Architecture:** Create one concise `SKILL.md` plus three focused reference files. Keep the main skill short and move the reading protocol, output contract, and insufficient-knowledge rules into `references/`.

**Tech Stack:** Markdown, repository-local skill structure

---

### Task 1: Create the skill scaffold

**Files:**
- Create: `skills/reading-ai-knowledge/SKILL.md`
- Create: `skills/reading-ai-knowledge/references/reading-protocol.md`
- Create: `skills/reading-ai-knowledge/references/plan-output-contract.md`
- Create: `skills/reading-ai-knowledge/references/insufficient-knowledge-rules.md`

- [ ] Write the skill frontmatter and concise trigger description.
- [ ] Write the main skill workflow and point to the reference files.
- [ ] Write the detailed reading protocol for `ai-knowledge/wiki/`.
- [ ] Write the plan output contract with required sections.
- [ ] Write the insufficient-knowledge rules and conflict priority.

### Task 2: Validate the skill

**Files:**
- Validate: `skills/reading-ai-knowledge/**/*`

- [ ] Run the skill validator against `skills/reading-ai-knowledge/`.
- [ ] Read the generated files back and check for duplicated guidance, missing paths, or contradictory rules.
- [ ] Confirm the skill can support at least three current demand patterns:
  - external system adds a field
  - upstream rule changes
  - local query/display needs extension

### Task 3: Persist the implementation

**Files:**
- Modify: `docs/superpowers/plans/2026-05-13-reading-ai-knowledge-skill.md`
- Commit: repository git history

- [ ] Stage the new skill files.
- [ ] Commit the skill with a message that reflects the repository-local `ai-knowledge` reading guidance.
