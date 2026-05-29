根据需求文档、代码仓库和知识对象的综合分析，我输出以下 change plan：

---

```yaml
business_summary: |
  用户在商城商品列表页输入关键词搜索后，再切换分类或清空搜索框继续浏览时，期望"搜索"和"浏览"两种模式有清晰的行为边界。当前系统存在 keyword 字段残留导致结果范围不明确的问题，需要让商品列表在"主动搜索"与"普通浏览"场景下表现更一致、更易理解。需求不涉及搜索联想、搜索历史入口、排序策略和推荐算法，也不影响商品详情、推荐商品、短信验证码和兑换流程。

boundary_decision:
  in_scope_backend:
    - "GoodsService.queryPageGoods 的 keyword/keyType 处理逻辑（MOD-GOODS-SERVICE-QUERY-PAGE）"
    - "GoodsMapper.xml 中 keyType == 1 的 SQL 过滤分支（CON-GOODS-LIST: DLV-002）"
    - "搜索历史写入的触发条件（OWN-GOODS-SEARCH-HISTORY-WRITE: OWN-001）"
    - "/goods/list 接口的参数语义与行为边界（CON-GOODS-LIST: FLD-001）"
  likely_out_of_scope_or_external:
    - "前端搜索框状态管理与参数传递（不在后端仓库范围）"
    - "首页搜索框改版（需求明确说明不涉及）"
    - "商品详情、推荐商品、短信验证码、兑换流程（需求明确说明不影响）"

current_behavior_hypothesis:
  - claim: "当前 keyword 字段可在多次请求间残留，若前端未主动清空 keyword 或 keyType，用户切换分类后仍可能被误判为搜索模式"
    source: 
      - "CON-GOODS-LIST: FLD-001 - keyword 与 keyType 联动"
      - "TERM-GOODS-SEARCH-KEYWORD: DEF-001 - keyword 是运行时搜索词，只有 keyType == 1 时才过滤商品名"
    evidence:
      - "GoodsMapper.xml:89-91 - keyType == 1 时才执行 keyword 过滤"
      - "GoodsService.java:117-123 - userId != null && keyword 非空白即写搜索历史，未校验 keyType"
  
  - claim: "搜索历史写入条件（keyword 非空白）与 SQL 过滤条件（keyType == 1 且 keyword 非空白）存在分歧"
    source:
      - "OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE: UNK-001"
    evidence:
      - "GoodsService.java:117 - 只判断 keyword 非空白"
      - "GoodsMapper.xml:89 - 同时要求 keyType == 1"
  
  - claim: "keyType 的语义、取值范围和默认行为未在知识对象中明确记录"
    source:
      - "CON-GOODS-LIST: FLD-001 - 只说明 keyword 与 keyType 联动，未定义 keyType 枚举值"
    gap: "无证据说明 keyType 为 null/0/其他值时的语义"

change_surface:
  backend_modules:
    - module: "GoodsService.java"
      path: "music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java"
      anchor: "queryPageGoods 方法（第112-151行）"
      likely_change: "需要明确 keyword/keyType 的组合语义，可能需要调整搜索历史写入条件或 SQL 过滤触发条件"
      knowledge_ref: "MOD-GOODS-SERVICE-QUERY-PAGE"
    
    - module: "GoodsMapper.xml"
      path: "music-education-app/src/main/resources/mappers/GoodsMapper.xml"
      anchor: "selectByQuery 的 keyType 分支（第89-91行）"
      likely_change: "可能需要新增或调整 keyType 条件分支，以区分'主动搜索'与'普通浏览'"
      knowledge_ref: "CON-GOODS-LIST: DLV-002"
    
    - module: "CommonPage.java"
      path: "music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java"
      anchor: "keyword 与 keyType 字段定义（第36-38行）"
      likely_change: "如果需要新增字段或枚举来标识'搜索模式'，可能需要在此扩展"
      knowledge_ref: "TERM-GOODS-SEARCH-KEYWORD: EVD-001"
  
  contracts_or_inputs:
    - contract: "/goods/list 接口请求参数"
      knowledge_ref: "CON-GOODS-LIST: FLD-001"
      impacted_fields:
        - "keyword - 当前语义是运行时搜索词"
        - "keyType - 当前已知 keyType == 1 触发关键字过滤，其他值语义未知"
      change_hypothesis: "需要明确 keyType 的枚举值与语义，或新增字段来区分'主动搜索'与'普通浏览'"
      frontend_coordination: "前端需要在切换分类或清空搜索框时，传递正确的参数组合"
  
  non_backend_dependencies:
    - dependency: "前端搜索框状态管理"
      reason: "后端无法独立判断用户是否'清空了搜索框'，需要前端配合传递明确参数（如 keyword 为空、keyType 为特定值）"
      unknown: "前端当前如何处理搜索框清空事件？传参策略是什么？"

unknowns:
  - question: "keyType 的枚举值与语义定义"
    why_blocking: "需求提到'主动搜索'和'普通浏览'两种场景，但当前只知 keyType == 1 触发关键字过滤。keyType 为 null、0 或其他值时代表什么？哪种值表示'普通浏览'？是否需要新增字段？"
    evidence_gap: "CON-GOODS-LIST: FLD-001 只说明联动，未定义枚举；TERM-GOODS-SEARCH-KEYWORD 未提供取值范围"
    blocking_decisions:
      - "如何判断用户是'主动搜索'还是'普通浏览'"
      - "搜索历史应在什么条件下写入"
      - "SQL 过滤分支如何调整"
  
  - question: "搜索历史写入条件是否应与 SQL 过滤条件一致"
    why_blocking: "当前代码在 keyword 非空白时写入搜索历史，但只在 keyType == 1 时过滤商品名。这是否是有意设计？需求提到'用户不会因为输入框里还有字就自动得到一组看不懂来源的过滤结果'，是否需要调整写入条件？"
    evidence_gap: "OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE: UNK-001 - 明确指出这是开放问题"
    blocking_decisions:
      - "是否修改 GoodsService.java:117 的写入条件"
      - "是否需要同步调整 GoodsMapper.xml 的过滤条件"
  
  - question: "前端如何处理'切换分类'和'清空搜索框'事件"
    why_blocking: "后端无法独立判断用户的交互意图。需求说'切换分类后不应被上一轮搜索残留条件干扰'、'清空搜索内容后恢复正常浏览'，但后端如何知道用户做了这些操作？前端需要传递什么参数组合？"
    evidence_gap: "知识对象只覆盖后端代码，无前端交互证据"
    blocking_decisions:
      - "接口参数设计是否需要新增字段"
      - "是否需要前端在切换分类或清空搜索框时，传递 keyType=null 或 keyword='' 或两者组合"
  
  - question: "'主动搜索'的精确定义"
    why_blocking: "需求场景1说'用户主动发起搜索时，列表应按这次搜索意图返回结果'，但什么算'主动发起'？是点击搜索按钮？还是只要 keyword 有值就算？是否需要 keyType == 1？"
    evidence_gap: "需求文档未定义'主动搜索'的技术实现标准"
    blocking_decisions:
      - "接口如何判断用户是'主动搜索'"
      - "是否需要前端传递额外的标识字段"

verification_plan:
  must_check:
    - check: "确认 keyType 枚举值与语义定义"
      method: "询问产品或查阅需求规格文档、前端代码"
      blocking: true
      reason: "这是区分'主动搜索'与'普通浏览'的基础"
    
    - check: "确认搜索历史写入条件是否应与 SQL 过滤条件一致"
      method: "询问产品或查阅历史 PR/issue"
      blocking: true
      reason: "OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE 指出这是未决问题"
    
    - check: "确认前端如何处理'切换分类'和'清空搜索框'事件"
      method: "查阅前端代码或询问前端开发"
      blocking: true
      reason: "后端改动需要前端配合调整参数传递"
    
    - check: "定义'主动搜索'的技术标准"
      method: "与产品确认交互设计"
      blocking: true
      reason: "验收标准1需要明确的判断依据"
    
    - check: "测试 keyType != 1 且 keyword 非空的当前行为"
      method: "手动测试或补充自动化测试用例"
      blocking: false
      reason: "理解当前系统边界，避免改动后引入回归"
  
  regression_risks:
    - risk: "修改 keyword/keyType 逻辑可能影响现有搜索历史写入"
      impact: "用户搜索历史可能不再写入或错误写入"
      mitigation: "回归测试 GoodsControllerTest.list，并补充 keyword/keyType 组合场景测试"
      knowledge_ref: "VER-GOODS-SEARCH-HISTORY: CHK-002"
    
    - risk: "调整 SQL 过滤条件可能影响商品列表查询结果"
      impact: "商品列表返回的商品集合可能变化"
      mitigation: "对比改动前后的 SQL 执行计划，验证边界场景（keyword 为空、keyType 为 null 等）"
      knowledge_ref: "CON-GOODS-LIST: DLV-002"
    
    - risk: "登录边界被误改"
      impact: "未登录用户可能绕过认证或登录用户被误拦截"
      mitigation: "验证 GoodsControllerTest.list 的登录边界，确保 LoginInterceptor 逻辑不变"
      knowledge_ref: "CON-GOODS-LIST: ERR-001"

evidence_refs:
  - "music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:114-123"
  - "music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:125-129"
  - "music-education-app/src/main/resources/mappers/GoodsMapper.xml:89-91"
  - "music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:36-38"
  - "music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:39-43"
  - "music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:37-50"

knowledge_refs:
  - "TERM-GOODS-SEARCH-KEYWORD"
  - "CON-GOODS-LIST"
  - "OWN-GOODS-SEARCH-HISTORY-WRITE"
  - "MOD-GOODS-SERVICE-QUERY-PAGE"
  - "MOD-GOODS-CONTROLLER-LIST"
  - "MOD-SEARCH-HISTORY-SERVICE-SAVE"
  - "VER-GOODS-SEARCH-HISTORY"
  - "OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE"
```

---

## 关键判断依据

### 已知内容

1. **keyword 与 keyType 联动**（TERM-GOODS-SEARCH-KEYWORD, CON-GOODS-LIST）：
   - keyword 是运行时搜索词
   - 只有 keyType == 1 时，SQL 才执行 `p.name like CONCAT('%',#{keyword},'%')`
   - keyType 为其他值时，keyword 不会参与商品名过滤

2. **搜索历史写入条件**（OWN-GOODS-SEARCH-HISTORY-WRITE, MOD-GOODS-SERVICE-QUERY-PAGE）：
   - 当前条件：userId != null 且 keyword 非空白
   - 不检查 keyType 的值
   - 这与 SQL 过滤条件存在分歧（OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE）

3. **接口契约**（CON-GOODS-LIST）：
   - /goods/list 要求登录
   - 支持字段：lastId, pageSize, keyword, keyType, categoryId, categoryIds, isHot
   - 默认排序：p.create_time desc

### 知识边界

根据 OPEN-GOODS-SEARCH-WRITE-READ-DIVERGENCE，**读写分歧是否有意设计仍是开放问题**，需要产品或历史文档确认。

根据 CON-GOODS-LIST: FLD-001，**keyType 的枚举值与语义未在知识对象中明确定义**，需要补充。

根据需求文档，**前端如何处理"切换分类"和"清空搜索框"事件未明确**，这是后端改动的非后端依赖。

### 改动优先级

1. **必须先明确**：keyType 语义、搜索历史写入条件、前端参数传递策略
2. **再考虑修改**：GoodsService.queryPageGoods、GoodsMapper.xml、CommonPage（如需新增字段）
3. **最后验证**：登录边界、关键字过滤行为、搜索历史写入、商品详情/推荐/兑换流程不受影响
