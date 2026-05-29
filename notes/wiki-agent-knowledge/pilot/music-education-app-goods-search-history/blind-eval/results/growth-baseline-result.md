基于以上代码分析，我现在可以输出完整的 change plan：

---

```yaml
business_summary: "运营发现商城商品搜索后的点击和成交分析数据不稳定，怀疑当前搜索词记录中混入了非用户主动搜索的词（如翻页加载、分类切换、列表页进入等场景），导致热门搜索词和搜索转化分析结果失真。需求目标是让搜索词记录更贴近'用户真实发起的一次搜索动作'，仅记录用户明确发起搜索时的关键词，不包括翻页、分类切换、进入列表页、刷新等场景。"

boundary_decision:
  in_scope_backend:
    - "music-education-app 仓库中的 GoodsService.queryPageGoods() 方法（搜索历史记录逻辑）"
    - "music-education-app 仓库中的 SearchHistoryService.save() 方法"
    - "music-education-app 仓库中的 SearchHistoryMapper 及相关数据库操作"
    - "music-education-app 仓库中的 GoodsQuery 请求参数结构（可能需新增标识字段）"
    - "music-education-app 仓库中的 GoodsController.list() 接口"
  likely_out_of_scope_or_external:
    - "小程序前端代码（不在后端仓库范围内，但需前端配合传递搜索行为标识）"
    - "增长分析平台的搜索词统计逻辑（依赖搜索历史数据，不在本次改动范围内）"
    - "首页推荐位、搜索推荐词、热词展示样式（需求明确不包含）"
    - "商品详情页、推荐商品逻辑（需求明确不影响）"
    - "搜索历史列表页面（非本次目标）"

current_behavior_hypothesis:
  - "当前入口：POST /goods/list 接口"
  - "当前逻辑：GoodsService.queryPageGoods() 方法中，只要 userId != null 且 keyword 不为空，就会调用 searchHistoryService.save() 记录搜索历史"
  - "问题：所有带 keyword 参数的请求都会被记录，无法区分主动搜索、翻页加载、分类切换、进入列表页等场景"
  - "分页方式：使用 lastId 进行游标分页，lastId != null 且 lastId != 0 时表示翻页请求"
  - "分类筛选：通过 categoryId 或 categoryIds 参数实现，与关键词搜索可同时存在"
  - "keyType 参数：当 keyType == 1 时才启用关键词匹配商品名称的逻辑"

change_surface:
  backend_modules:
    - module: "GoodsService"
      file: "com.education.music.app.service.mall.GoodsService"
      method: "queryPageGoods()"
      change: "修改搜索历史记录判断逻辑，增加区分主动搜索行为的条件判断"
    - module: "GoodsQuery"
      file: "com.education.music.app.entity.req.query.GoodsQuery"
      change: "可能需要新增字段标识搜索行为来源（需与前端协定）"
    - module: "SearchHistoryDO"
      file: "com.education.music.core.DO.mall.SearchHistoryDO"
      change: "可能需要新增字段记录搜索行为来源（如 searchType）"
    - module: "SearchHistoryMapper"
      file: "com.education.music.app.mapper.SearchHistoryMapper"
      change: "如 SearchHistoryDO 新增字段，需同步修改 Mapper XML"
  contracts_or_inputs:
    - contract: "POST /goods/list 请求参数"
      current: "keyword, lastId, pageSize, categoryId, keyType 等"
      proposed_change: "可能新增 isSearchTrigger 或 searchAction 字段，用于区分主动搜索行为；或约定 lastId == null/0 时才记录"
    - contract: "mall_search_history 表结构"
      current: "id, user_id, keyword, from, add_time, update_time, deleted"
      proposed_change: "可能新增 search_type 或 source 字段，记录搜索触发来源"
  non_backend_dependencies:
    - dependency: "小程序前端需配合传递搜索行为标识"
      description: "前端需要在用户主动点击搜索按钮时传递特定标识，翻页、分类切换等场景不传递或传递不同标识"
    - dependency: "增长分析平台需确认搜索历史数据的使用方式"
      description: "确认当前数据消费方是否依赖现有的记录逻辑，改动后是否影响历史数据统计"

unknowns:
  - question: "如何定义'主动搜索'和'普通浏览'的边界？"
    why_blocking: "需求场景描述了翻页、分类切换、进入列表页、刷新不应记录，但未明确定义技术层面的判断标准。例如：用户输入关键词后点击搜索按钮、用户从搜索历史点击词、用户从热门搜索词点击，是否都算主动搜索？"
  - question: "前端是否能够区分并传递搜索行为标识？"
    why_blocking: "后端无法仅凭当前参数区分用户是主动搜索还是翻页加载。如果前端传递 lastId 参数来翻页，后端可以通过 lastId 判断是否翻页；但如果用户切换分类后重新搜索（lastId=0），后端无法判断这是主动搜索还是分类切换后的浏览。需要确认前端调用约定。"
  - question: "keyType 字段的当前用途和约定是什么？"
    why_blocking: "GoodsMapper.xml 中 keyType == 1 时才按关键词搜索，但 GoodsService 中记录搜索历史未使用此条件。需要确认 keyType 的业务含义。"
  - question: "从搜索历史列表点击词进入是否属于主动搜索？"
    why_blocking: "需求场景未涉及此场景，但实际业务中可能存在。需与产品确认。"
  - question: "从热门搜索词点击进入是否属于主动搜索？"
    why_blocking: "需求场景未涉及此场景，但实际业务中可能存在。需与产品确认。"
  - question: "搜索历史数据是否被其他系统/报表直接消费？"
    why_blocking: "改动搜索历史记录逻辑可能影响历史数据的一致性，需要确认数据消费方的期望。"

verification_plan:
  must_check:
    - "验证用户主动输入关键词并点击搜索后，search_history 表新增一条记录"
    - "验证用户在同一关键词下翻页加载更多，search_history 表不新增记录"
    - "验证用户仅切换分类（不修改关键词），search_history 表不新增记录"
    - "验证用户直接进入商品列表页（无关键词），search_history 表不新增记录"
    - "验证用户刷新当前搜索结果页，search_history 表不新增记录"
    - "验证搜索结果列表正常返回，商品详情、推荐商品等功能不受影响"
  regression_risks:
    - "如果采用 lastId 判断方案，需确认所有首次请求 lastId 都为 null/0，否则可能漏记有效搜索"
    - "如果新增请求参数字段，需确认前端所有调用方都已更新，否则可能漏记或错记"
    - "历史数据统计报表可能需要调整时间窗口或过滤逻辑"

evidence_refs:
  - file: "music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java"
    line: "112-151"
    description: "当前搜索历史记录逻辑所在位置，queryPageGoods() 方法中无条件记录所有带 keyword 的请求"
  - file: "music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java"
    line: "39-43"
    description: "商品列表接口入口，POST /goods/list"
  - file: "music-education-app/src/main/java/com/education/music/app/entity/req/query/GoodsQuery.java"
    line: "1-55"
    description: "请求参数定义，继承 CommonPage，包含 categoryId、keyword、lastId、pageSize 等"
  - file: "music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java"
    line: "1-57"
    description: "通用分页参数，包含 keyword、lastId、pageSize、keyType 等"
  - file: "music-education-core/src/main/java/com/education/music/core/DO/mall/SearchHistoryDO.java"
    line: "1-46"
    description: "搜索历史数据对象，当前字段：id, userId, keyword, from, addTime, updateTime, deleted"
  - file: "music-education-app/src/main/resources/mappers/GoodsMapper.xml"
    line: "89-91"
    description: "keyType == 1 时才按关键词搜索商品名称的逻辑"

knowledge_refs: []
```
