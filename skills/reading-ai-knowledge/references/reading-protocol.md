# Reading Protocol

## Objective

Read only the minimum set of `ai-knowledge/wiki/` documents needed to produce a grounded requirement judgment.

The required outcomes are:

1. Normalize requirement terms.
2. Identify source of truth and ownership.
3. Separate referenced systems from systems that must change.
4. Decide implementation mode before discussing local code changes.
5. Add dependencies and validation before finalizing the answer.

## Entry Documents

Read these first for every new requirement:

1. `../../ai-knowledge/wiki/index.md`
2. `../../ai-knowledge/wiki/doc-map.md`

Read `../../ai-knowledge/wiki/getting-started.md` when the requirement looks like a known high-frequency pattern and you need a scenario-first shortcut.

## Phase 1: Extract Requirement Entities

From the requirement, extract:

1. System names, aliases, abbreviations, and old names
2. Business objects
3. Fields, statuses, and rules
4. Actions or change types
5. User-visible targets
6. Delivery goal

If any system or object name looks non-standard, read:

1. `../../ai-knowledge/wiki/术语与别名/系统别名索引.md`
2. `../../ai-knowledge/wiki/术语与别名/业务术语索引.md`

Stop this phase only after the main entities are normalized into the knowledge-tree vocabulary.

## Phase 2: Confirm Source of Truth and Boundaries

Read the smallest set of atomic documents that match the extracted entities. Prioritize:

1. `业务对象与口径/<对象或字段>.md`
2. `外部系统/<系统名>.md`
3. `业务能力/<能力名>.md`

Use this phase to answer:

1. Which system defines the object, field, or status
2. Which systems are external
3. Which systems are only context and should not be changed
4. Which capability owner is responsible for the change

Do not enter local implementation scope before these answers are stable.

## Phase 3: Decide Implementation Mode

Read:

1. `需求路由/<需求类型>.md`
2. `实现方式判断/<需求类型>.md`

Expand into these only when needed:

1. `流程与交接/<流程名>.md`
2. `集成触点/<事件或接口名>.md`

Use this phase to answer:

1. Does the local system need to change
2. Is the change code, config, data handling, coordination, or waiting for upstream
3. Is the local role sync, mapping, query, display, or compatibility handling

If the answer is "do not change local code", stop discussing code landing points and move directly to output with supporting reasons.

## Phase 4: Locate Local Scope

Only if Phase 3 proves local implementation is required, read:

1. `本地代码落点/<服务名或模块名>.md`
2. `本地代码落点/实现层次规则.md`
3. `api/<接口名>.md` when the requirement affects local API shape

Use this phase to answer:

1. Which local service or module is in scope
2. Which implementation layer is in scope
3. Which similarly named modules are out of scope

Never infer local scope from naming similarity alone.

## Phase 5: Close the Plan

Before final output, read:

1. `前置依赖与协作/<主题>.md`
2. `验证与验收/<场景>.md`
3. `规则与反例/*.md` when the requirement touches disputed ownership, source-of-truth, or common misjudgment paths

Use this phase to add:

1. Upstream prerequisites
2. Coordination items
3. Validation path
4. High-risk wrong paths to exclude

## Minimum Read Sets by Demand Pattern

### External system adds a field

Read:

1. `术语与别名/*` if names are non-standard
2. `外部系统/<系统名>.md`
3. `业务对象与口径/<对象或字段>.md`
4. `需求路由/外部系统新增字段.md`
5. `实现方式判断/外部字段接入.md`
6. `本地代码落点/*` only if local adaptation is required
7. `验证与验收/客户字段接入验收.md` or the nearest matching acceptance card

### Upstream rule changes

Read:

1. `业务对象与口径/<规则相关对象>.md`
2. `外部系统/<系统名>.md`
3. `需求路由/外部系统规则变更.md`
4. `实现方式判断/上游规则变化.md`
5. `规则与反例/事实来源规则.md`
6. `规则与反例/常见误判案例.md`

### Local query or display extension

Read:

1. `业务能力/<能力名>.md`
2. `业务对象与口径/<对象或字段>.md`
3. `本地代码落点/<服务或模块>.md`
4. `本地代码落点/实现层次规则.md`
5. `api/<接口名>.md` if response or filters change
6. `验证与验收/<场景>.md`

## Expansion Rules

1. Prefer atomic cards over `_index.md` after the correct category is known.
2. Use `_index.md` to navigate, not to settle detailed responsibility.
3. Read the fewest documents that can close the current uncertainty.
4. Expand to another category only when the current category cannot answer the next decision.

## Stop Conditions

Stop reading when all of these are true:

1. Source of truth is clear.
2. External-system boundary is clear.
3. Capability ownership is clear.
4. Implementation mode is clear.
5. Local scope is either confirmed or explicitly excluded.
6. Prerequisites and validation are identified.

If any of the above remains unclear, stop expansion and report the uncertainty instead of continuing to guess.
