基于以上分析，我已理解当前代码结构。现在输出结构化的改动计划：

```yaml
business_summary: "商城商品列表页需要区分'主动搜索'和'普通浏览'两种场景，确保用户切换分类或清空搜索框后，结果不受之前搜索条件残留影响。当前问题是用户在搜索后切换分类或返回列表继续浏览，结果'不对劲'，因为可能存在搜索条件残留。"

boundary_decision:
  in_scope_backend:
    - "GoodsController.list() 接口 - 处理商品列表查询请求"
    - "GoodsService.queryPageGoods() - 商品列表查询业务逻辑"
    - "GoodsMapper.xml 中的 selectByQuery SQL - 商品查询 SQL"
    - "GoodsQuery/CommonPage - 查询参数对象 (keyword, keyType, categoryId 等)"
  likely_out_of_scope_or_external:
    - "前端商城页面 - 负责用户输入状态管理和参数传递"
    - "前端搜索框组件 - 触发搜索和清空操作的交互逻辑"
    - "前端分类切换组件 - 触发分类浏览的交互逻辑"

current_behavior_hypothesis:
  - "接口: POST /goods/list，接收 GoodsQuery 参数 (keyword, keyType, categoryId, categoryIds, lastId, pageSize)"
  - "搜索逻辑: 当 keyword 非空且 keyType == 1 时，SQL 条件为 `p.name like CONCAT('%',#{keyword},'%')`"
  - "分类过滤: 当 categoryId 或 categoryIds 非空时，按分类 ID 过滤"
  - "关键问题: keyword 过滤和 categoryId 过滤是 AND 关系，若前端同时传递两者，结果会被两个条件同时限制"
  - "当前后端是无状态的，不记忆上次请求参数。问题可能出在前端状态管理：切换分类时未清除 keyword，或清空搜索框时未清除 keyType"

change_surface:
  backend_modules:
    - "GoodsMapper.xml - 可能需要调整 SQL 条件逻辑，或增加新的模式区分参数"
    - "GoodsQuery - 可能需要增加 searchMode 或类似的显式模式字段"
    - "GoodsService.queryPageGoods() - 可能需要在业务层增加模式判断逻辑"
  contracts_or_inputs:
    - "请求参数变更: 需要明确 keyType 的完整语义，或新增参数区分搜索/浏览模式"
    - "前端契约: 需要与前端约定参数传递规范，切换分类时如何处理 keyword"
  non_backend_dependencies:
    - "前端需要确保：切换分类浏览时，不传递 keyword 或传递 keyword 为空"
    - "前端需要确保：清空搜索框时，不传递 keyword 或传递 keyword 为空，同时清除搜索状态"
    - "前端可能需要新增 searchMode 参数来显式标识当前是搜索还是浏览"

unknowns:
  - question: "keyType 字段的完整语义是什么？当前只看到 keyType == 1 的判断，是否有其他值（如 0、2 等）？每个值代表什么含义？"
    why_blocking: "如果不清楚 keyType 的完整定义，无法确定是否需要新增参数或复用现有字段"
  - question: "前端在切换分类浏览时的实际行为是什么？是否会传递 keyword 参数？是否会清除 keyType？"
    why_blocking: "这决定了问题是出在前端还是后端。如果前端已经正确清除参数，那问题可能在其他地方"
  - question: "前端在清空搜索框时的实际行为是什么？是传递空字符串 keyword，还是完全不传 keyword 参数？"
    why_blocking: "后端需要知道如何判断'清空搜索'这个动作"
  - question: "'主动搜索'的触发方式是什么？是用户点击搜索按钮触发，还是输入后自动触发？"
    why_blocking: "不同触发方式对应不同的后端实现策略"
  - question: "需求中提到'输入框里还有字就自动得到过滤结果'，这是前端行为还是后端行为？"
    why_blocking: "如果是前端在输入时就自动调用接口，那可能需要后端支持实时搜索过滤"

verification_plan:
  must_check:
    - "验证当前 /goods/list 接口在同时传递 keyword 和 categoryId 时的返回结果"
    - "验证当前 /goods/list 接口在 keyword 为空字符串时的返回结果"
    - "验证当前 /goods/list 接口在 keyType 不传或为 null 时的 SQL 行为"
    - "确认 keyType 的所有可能值及其含义（通过代码全量搜索或询问前端/产品）"
  regression_risks:
    - "如果修改 SQL 条件逻辑，可能影响现有搜索功能"
    - "如果修改参数处理逻辑，可能影响现有分类浏览功能"
    - "如果新增参数，需要确保向后兼容，旧版本前端仍能正常工作"

evidence_refs:
  - "GoodsController.java:39-43 - 商品列表接口入口"
  - "GoodsService.java:112-151 - 商品列表查询业务逻辑，包含搜索历史记录和查询条件组装"
  - "GoodsMapper.xml:62-104 - selectByQuery SQL，第89-91行为 keyword 过滤逻辑"
  - "CommonPage.java:37-38 - keyword 和 keyType 字段定义"
  - "GoodsQuery.java - 继承 CommonPage，增加 categoryId、categoryIds、onSell、deleted、isHot 等字段"

knowledge_refs: []
```
