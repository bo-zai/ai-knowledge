基于需求文件、代码仓库和知识对象的详细分析，现在输出结构化的 change plan：

---

```yaml
business_summary: "提升商城商品搜索词记录的数据质量，确保只记录用户主动发起的搜索行为，避免将翻页、分类切换、列表进入等非主动搜索行为误记为搜索记录，为后续热门词统计和搜索转化分析提供可靠数据基础。"

boundary_decision:
  in_scope_backend:
    - "GoodsService.queryPageGoods 的搜索历史写入条件逻辑"
    - "GoodsQuery 请求模型的字段定义（可能需要新增字段）"
    - "搜索历史记录的触发条件判断"
  likely_out_of_scope_or_external:
    - "前端小程序的请求参数调整（需要前端配合新增字段）"
    - "搜索历史列表展示页面（需求明确为非目标）"
    - "热门词排序策略实现（需求明确为非目标）"
    - "商品详情页、推荐商品逻辑（需求明确不包含）"
    - "数据库表结构变更（当前 mall_search_history 表结构已满足需求）"

current_behavior_hypothesis:
  - statement: "当前代码在 GoodsService.queryPageGoods 中，只要 keyword 非空且 userId 非空，就会无条件写入搜索历史记录"
    evidence: "GoodsService.java:117-122"
  - statement: "当前 SQL 过滤逻辑只在 keyType == 1 时才按 keyword 进行商品名模糊匹配"
    evidence: "GoodsMapper.xml:89-90，TERM-GOODS-SEARCH-KEYWORD 知识对象 DEF-001"
  - statement: "当前写入条件和查询过滤条件不一致：keyword 非空即写历史，但只有 keyType==1 时才真正过滤商品"
    evidence: "OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE 知识对象 UNK-001"
  - statement: "当前请求模型中没有字段可以区分'主动搜索'、'翻页加载'、'分类切换'等不同场景"
    evidence: "CommonPage.java 和 GoodsQuery.java 的字段定义"
  - statement: "当前 lastId 字段用于向前翻页，但无法区分'搜索结果翻页'和'独立浏览翻页'"
    evidence: "GoodsMapper.xml:92-93，CON-GOODS-LIST 知识对象 FLD-001"

change_surface:
  backend_modules:
    - module: "GoodsService.queryPageGoods"
      path: "music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java"
      change_type: "modify"
      rationale: "需要修改搜索历史写入的触发条件，从'keyword非空即写'改为'识别主动搜索行为才写'"
      knowledge_ref: "OWN-GOODS-SEARCH-HISTORY-WRITE, MOD-GOODS-SERVICE-QUERY-PAGE"
    - module: "GoodsQuery 或 CommonPage"
      path: "music-education-app/src/main/java/com/education/music/app/entity/req/query/GoodsQuery.java 或 CommonPage.java"
      change_type: "modify"
      rationale: "可能需要新增字段（如 searchAction 或 searchSessionId）来标识搜索动作类型或会话"
      knowledge_ref: "CON-GOODS-LIST"
    - module: "SearchHistoryService"
      path: "music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java"
      change_type: "likely_no_change"
      rationale: "根据 OWN-GOODS-SEARCH-HISTORY-WRITE，该服务只负责持久化，写入条件由 GoodsService 持有，不应在此处修改触发逻辑"
      knowledge_ref: "OWN-GOODS-SEARCH-HISTORY-WRITE, MOD-SEARCH-HISTORY-SERVICE-SAVE"
    - module: "GoodsController.list"
      path: "music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java"
      change_type: "likely_no_change"
      rationale: "根据 MOD-GOODS-CONTROLLER-LIST，controller 只负责路由和包装，业务语义应在 service 层处理"
      knowledge_ref: "MOD-GOODS-CONTROLLER-LIST"
    - module: "GoodsMapper.xml"
      path: "music-education-app/src/main/resources/mappers/GoodsMapper.xml"
      change_type: "no_change"
      rationale: "需求不涉及查询逻辑变更，保持现有的 keyType 过滤逻辑"
      knowledge_ref: "CON-GOODS-LIST"

  contracts_or_inputs:
    - contract: "POST /goods/list 请求参数"
      current_fields: "lastId, pageSize, keyword, keyType, categoryId, categoryIds, isHot"
      proposed_change: "需要讨论是否新增字段（如 searchAction 或 searchSessionId）来区分主动搜索和其他操作"
      knowledge_ref: "CON-GOODS-LIST"
    - contract: "mall_search_history 表结构"
      current_fields: "id, user_id, keyword, from, add_time, update_time, deleted"
      proposed_change: "无需变更，当前结构已满足需求"

  non_backend_dependencies:
    - dependency: "前端小程序"
      description: "需要前端在发起主动搜索时传入标识字段（如 searchAction 或 searchSessionId）"
      impact: "后端无法独立完成需求，需要前后端协同定义契约"
    - dependency: "客户端已有行为"
      description: "需要确认客户端当前如何区分'主动搜索'、'翻页加载'、'分类切换'等场景"
      impact: "如果客户端已经通过某种方式区分，后端只需适配；如果没有，需要共同设计"

unknowns:
  - question: "如何区分'用户主动发起搜索'和'翻页加载'？"
    why_blocking: "当前请求模型中没有任何字段可以区分这两种场景，无法判断何时记录搜索历史。需求场景 2 明确要求'同一轮搜索结果下的继续翻页，不应重复新增搜索记录'，但无法判断两次相同 keyword 的请求是'新搜索'还是'翻页'。"
    knowledge_refs: "CON-GOODS-LIST, MOD-GOODS-SERVICE-QUERY-PAGE"
    possible_solutions:
      - "方案 A: 新增 searchAction 字段，前端在主动搜索时传入 'NEW_SEARCH'，翻页时传入 'PAGE_LOAD' 或不传"
      - "方案 B: 新增 searchSessionId 字段，每次主动搜索生成新 sessionId，相同 sessionId 的后续请求视为同一轮搜索"
      - "方案 C: 基于 keyword + 时间间隔判断（不可靠，不推荐）"
    decision_owner: "产品负责人 + 前端负责人"
    
  - question: "keyType 的完整业务语义是什么？当前已知 keyType=1 是商品名搜索，其他类型是什么？"
    why_blocking: "需求场景 3 提到'仅进入列表页不应被统计'，如果客户端通过传入特定 keyType 来标识'分类浏览'或'热门推荐浏览'，需要明确这些 keyType 值以避免误记录。此外，OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE 明确指出当前'写入条件与查询条件不一致'是未知点。"
    knowledge_refs: "TERM-GOODS-SEARCH-KEYWORD, OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE"
    decision_owner: "产品负责人或原需求设计者"
    
  - question: "搜索历史是否应该只记录'真正参与查询过滤'的搜索词？"
    why_blocking: "当前代码在 keyword 非空时写入历史，但 SQL 只有在 keyType==1 时才真正按 keyword 过滤。如果用户传入 keyword 但 keyType!=1，这个 keyword 是否应该被记录？这涉及数据一致性问题。OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE 已标记为未知。"
    knowledge_refs: "OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE"
    decision_owner: "产品负责人"
    
  - question: "分类切换时的搜索历史记录规则是什么？"
    why_blocking: "需求场景 2 提到'仅切换分类不应新增搜索记录'，但如果用户在已有搜索结果中切换分类（例如搜索'钢琴'后切换到'弦乐'分类），这是否算新的搜索？需要产品定义规则。"
    knowledge_refs: "CON-GOODS-LIST"
    decision_owner: "产品负责人"
    
  - question: "客户端当前如何区分'主动搜索'、'翻页加载'、'分类切换'等场景？"
    why_blocking: "需要了解客户端当前的实现逻辑，判断是否已经有某种区分机制（如不同的接口、不同的字段组合等），以决定后端改动范围。"
    knowledge_refs: "CON-GOODS-LIST"
    decision_owner: "前端负责人"

verification_plan:
  must_check:
    - check: "验证登录边界不被破坏"
      method: "无 authorization 时调用 /goods/list 应返回 NO_LOGIN"
      evidence_ref: "CON-GOODS-LIST ERR-001, LoginInterceptor.java:38"
      knowledge_ref: "CON-GOODS-LIST, VER-GOODS-SEARCH-HISTORY"
    - check: "验证关键字过滤逻辑不变"
      method: "keyType==1 时 keyword 应参与 SQL 过滤，keyType!=1 时不应过滤"
      evidence_ref: "GoodsMapper.xml:89-90"
      knowledge_ref: "TERM-GOODS-SEARCH-KEYWORD, CON-GOODS-LIST DLV-002"
    - check: "验证搜索历史写入行为符合新规则"
      method: "需要补充测试用例验证：1) 主动搜索时写入历史；2) 翻页时不重复写入；3) 仅进入列表页不写入；4) 分类切换不写入"
      evidence_ref: "GoodsService.java:117-122"
      knowledge_ref: "VER-GOODS-SEARCH-HISTORY"
    - check: "验证商品列表查询不受影响"
      method: "确保搜索结果列表正常返回，分页、排序、商品详情、推荐商品等能力不受影响"
      evidence_ref: "GoodsService.java:125-151"
      knowledge_ref: "需求文件验收标准第 4 点"
    
  regression_risks:
    - risk: "修改 GoodsService.queryPageGoods 的写入条件可能影响现有搜索历史数据流"
      mitigation: "需要与运营/数据分析团队确认是否依赖当前行为，评估是否需要数据迁移或双写期"
      knowledge_ref: "OWN-GOODS-SEARCH-HISTORY-WRITE"
    - risk: "新增请求字段可能导致旧版本客户端兼容性问题"
      mitigation: "新增字段应设为可选，旧客户端不传字段时保持原有行为或按默认规则处理"
      knowledge_ref: "CON-GOODS-LIST"
    - risk: "当前测试覆盖不足，GoodsControllerTest 只验证基础调用，未覆盖关键字和历史写入分支"
      mitigation: "补充自动化测试覆盖：1) keyword 与 keyType 联动；2) 搜索历史写入条件；3) 登录边界"
      evidence_ref: "GoodsControllerTest.java:37-50"
      knowledge_ref: "MOD-GOODS-SERVICE-QUERY-PAGE TST-001, VER-GOODS-SEARCH-HISTORY CHK-002"

evidence_refs:
  - "music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:112-123（搜索历史写入逻辑）"
  - "music-education-app/src/main/resources/mappers/GoodsMapper.xml:89-90（关键字过滤条件）"
  - "music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:36-38（keyType、keyword 字段定义）"
  - "music-education-app/src/main/java/com/education/music/app/entity/req/query/GoodsQuery.java（请求参数定义）"
  - "music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:17-21（搜索历史保存逻辑）"
  - "music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:39-42（列表接口入口）"
  - "music-education-app/src/main/java/com/education/music/app/interceptor/LoginInterceptor.java:36-40（登录拦截）"
  - "music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:37-50（现有测试）"

knowledge_refs:
  - "TERM-GOODS-SEARCH-KEYWORD（关键字语义定义）"
  - "OWN-GOODS-SEARCH-HISTORY-WRITE（搜索历史写入归属）"
  - "CON-GOODS-LIST（商品列表接口契约）"
  - "MOD-GOODS-CONTROLLER-LIST（控制器职责）"
  - "MOD-GOODS-SERVICE-QUERY-PAGE（服务层职责）"
  - "MOD-SEARCH-HISTORY-SERVICE-SAVE（搜索历史保存职责）"
  - "VER-GOODS-SEARCH-HISTORY（验证计划）"
  - "OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE（关键字写入与查询条件分歧的未知点）"
```

---

## 知识覆盖边界说明

### 知识已知内容：

1. **当前搜索历史写入条件**：由 `GoodsService.queryPageGoods` 控制，只要 `userId != null && keyword 非空` 就写入 [OWN-GOODS-SEARCH-HISTORY-WRITE]

2. **当前关键字过滤逻辑**：SQL 只有在 `keyType == 1` 时才按 `keyword` 过滤商品名 [TERM-GOODS-SEARCH-KEYWORD, CON-GOODS-LIST]

3. **接口契约和登录边界**：`/goods/list` 需要登录，支持 `keyword`、`keyType`、`lastId`、`pageSize`、`categoryId` 等字段 [CON-GOODS-LIST]

4. **模块职责划分**：写入条件由 `GoodsService` 控制，`SearchHistoryService` 只负责持久化，不应在其内部修改触发逻辑 [OWN-GOODS-SEARCH-HISTORY-WRITE, MOD-SEARCH-HISTORY-SERVICE-SAVE]

### 知识尚未覆盖的内容（需要产品/前端确认）：

1. **如何区分"主动搜索"与"翻页"**：当前请求模型没有此标识字段 [OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE 提到这是阻塞点]

2. **keyType 的完整业务语义**：只知 `keyType=1` 是商品名搜索，其他类型未知 [TERM-GOODS-SEARCH-KEYWORD 提到需要确认]

3. **写入条件是否应与查询条件一致**：当前写入不检查 `keyType`，查询时检查，这是有意设计还是缺陷？ [OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE]

4. **客户端现有实现**：是否已经有区分不同场景的机制 [需要与前端确认]
