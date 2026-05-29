# Pilot Domain Selection Scorecard

这个评分表用于决定首个试点能力域，不让选择过程变成主观偏好。

## 使用方式

对每个候选能力域打分，建议选择总分最高、且不存在硬性排除项的域作为第一批试点。

评分范围：

- `1` 分：很弱 / 几乎不满足
- `3` 分：一般 / 可接受
- `5` 分：很强 / 明显满足

## 评分维度

### 1. 需求频度

- 问题：近 `90` 天内，这个域是否有足够多真实需求？
- 目的：保证后续评测有样本

### 2. 边界复杂度

- 问题：是否涉及跨模块、跨服务或外部系统？
- 目的：放大知识系统对边界判断的价值

### 3. 返工历史

- 问题：历史上是否出现过需求理解错误、边界误判、漏验证导致的返工？
- 目的：优先选择真实痛点域

### 4. 证据可得性

- 问题：是否能拿到需求、代码、测试、契约、PR、incident 等证据？
- 目的：保证对象能落到事实，而不是脑补

### 5. 验证可操作性

- 问题：是否能定义清晰的 `gold cases` 和验证指标？
- 目的：避免选一个很重要但根本不好评测的域

### 6. 风险等级

- 问题：这个域足够重要吗？
- 目的：太低风险看不出效果，太高风险不适合首轮试点

### 7. 变化稳定性

- 问题：这个域最近是否相对稳定，而不是每周重构？
- 目的：避免对象刚写完就过期

### 8. 代码可定位性

- 问题：这个域在代码里是否能较清晰地定位到模块与入口？
- 目的：方便落 `MOD` 对象和 change surface 评测

## 硬性排除项

以下任一命中，建议不作为第一批试点：

- 几乎拿不到一手证据
- 需求样本过少
- 当前正在大规模重构
- 验证路径完全依赖人工，无法形成基本评测

## 评分模板

```yaml
candidate_domain: ""

scores:
  requirement_frequency: 1
  boundary_complexity: 1
  rework_history: 1
  evidence_availability: 1
  evaluation_feasibility: 1
  risk_level_fit: 1
  stability: 1
  code_localizability: 1

hard_exclusions:
  no_primary_evidence: false
  too_few_cases: false
  active_massive_refactor: false
  impossible_to_evaluate: false

notes:
  strengths: []
  risks: []
  recommended_as_pilot: false
```

## 推荐阈值

- 总分 `>= 28`
- 且 `boundary_complexity >= 3`
- 且 `evidence_availability >= 4`
- 且无硬性排除项

