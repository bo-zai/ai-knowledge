# REQ-001 搜索链路一手证据笔记

## 目标

这份笔记只记录来自真实代码的一手证据，用于后续为 `REQ-001 前台商品搜索增强` 建立首批知识对象。

约束：

- 不使用 `mall-swarm/ai-knowledge/wiki` 作为事实来源
- 不使用 AI 生成计划作为事实来源

## 1. 已确认的系统与职责

### 1.1 mall-app-web

- 前台商城前端
- 当前已有：
  - 搜索输入页
  - 商品列表页
  - 分类筛选
  - 排序切换
- 当前未见：
  - 商品列表页品牌筛选
  - 搜索输入联想词调用

证据：

- `D:\workspace\mall-app-web\src\pages\product\search.vue`
- `D:\workspace\mall-app-web\src\pages\product\list.vue`
- `D:\workspace\mall-app-web\src\apis\product.ts`

### 1.2 mall-portal

- 前台商品接口服务
- 当前 `/product/search` 由 `mall-portal` 自己直接实现
- 并非转发到 `mall-search`

证据：

- `D:\workspace\mall-swarm\mall-portal\src\main\java\com\macro\mall\portal\controller\PmsPortalProductController.java`
- `D:\workspace\mall-swarm\mall-portal\src\main\java\com\macro\mall\portal\service\impl\PmsPortalProductServiceImpl.java`

### 1.3 mall-search

- 独立的 ES 搜索服务
- 当前已有：
  - `/esProduct/search`
  - `/esProduct/search/relate`
  - 品牌 / 分类 / 属性聚合

证据：

- `D:\workspace\mall-swarm\mall-search\src\main\java\com\macro\mall\search\controller\EsProductController.java`
- `D:\workspace\mall-swarm\mall-search\src\main\java\com\macro\mall\search\service\impl\EsProductServiceImpl.java`
- `D:\workspace\mall-swarm\mall-search\src\main\java\com\macro\mall\search\domain\EsProduct.java`

## 2. 已确认的事实

### FACT-001 前台商品列表接口已支持 brandId

`mall-portal` 的 `/product/search` 接口参数中已经包含：

- `keyword`
- `brandId`
- `productCategoryId`
- `sort`

而且服务实现里已有：

- `criteria.andBrandIdEqualTo(brandId)`

含义：

- “品牌筛选能力后端不存在” 这个说法是错误的
- 当前更可能是前端未接入已有能力

证据：

- `PmsPortalProductController.search(...)`
- `PmsPortalProductServiceImpl.search(...)`

### FACT-002 mall-search 也独立支持 brandId + category + sort

`mall-search` 的 `/esProduct/search` 已支持：

- `keyword`
- `brandId`
- `productCategoryId`
- `sort`

且 ES DSL 中已有：

- `term(field="brandId")`
- `term(field="productCategoryId")`

含义：

- 品牌筛选能力不仅存在，而且在 ES 搜索服务里也已存在
- 但是否被前台实际调用，需要和 `mall-portal` 链路区分

证据：

- `EsProductController.search(...)`
- `EsProductServiceImpl.search(...)`

### FACT-003 mall-search 已有“相关信息”聚合接口

`mall-search` 已提供：

- `/esProduct/search/relate`

并返回：

- `brandNames`
- `productCategoryNames`
- `productAttrs`

含义：

- “联想词/搜索相关信息完全不存在” 这个判断不成立
- 但该接口更像“筛选相关信息聚合”，不等于搜索框联想词
- 后续必须明确区分：
  - 搜索结果页的筛选辅助信息
  - 搜索输入框联想词

证据：

- `EsProductController.searchRelatedInfo(...)`
- `EsProductServiceImpl.searchRelatedInfo(...)`

### FACT-004 mall-app-web 当前未接入品牌筛选

当前前台商品列表页代码显示：

- 有分类筛选面板
- 有排序逻辑
- 请求参数中有 `productCategoryId`
- 未见 `brandId` 相关 UI 和交互

含义：

- 前端确实还没有把已有后端能力接上

证据：

- `D:\workspace\mall-app-web\src\pages\product\list.vue`

### FACT-005 mall-app-web 当前未接入搜索相关信息 / 联想词

当前搜索输入页只做：

- 输入关键字
- 保存搜索历史
- 跳转商品列表页

未见：

- 请求联想词接口
- 请求 related info 接口
- 展示候选词/建议词

含义：

- 搜索输入增强目前确实缺前端接入
- 但要明确接什么能力，不能直接把 `relatedInfo` 当作“联想词”

证据：

- `D:\workspace\mall-app-web\src\pages\product\search.vue`

### FACT-006 mall-portal 当前没有直接调用 mall-search 的证据

搜索 `mall-portal/src/main/java`：

- 没有找到对 `mall-search` 或 `/esProduct` 的直接调用
- 没有找到显式的搜索相关 `FeignClient`

含义：

- “mall-portal 转发到 mall-search” 目前没有代码证据支持
- 当前前台商品列表主链路更可能完全落在 `mall-portal`

证据：

- 对 `mall-portal/src/main/java` 的 `@FeignClient|mall-search|esProduct` 检索结果

### FACT-007 网关同时暴露 mall-portal 和 mall-search 两条路由

`mall-gateway` 配置中同时存在：

- `Path=/mall-portal/**`
- `Path=/mall-search/**`

并且匿名放行列表中包含：

- `/mall-search/**`
- `/mall-portal/product/**`
- `/mall-portal/brand/**`

含义：

- 两条搜索相关链路都可以被前端直接访问
- 后续需要明确：
  - 前台当前到底只走 `/product/search`
  - 还是未来要引入 `/mall-search/**` 直连能力

证据：

- `D:\workspace\mall-swarm\mall-gateway\src\main\resources\application.yml`

## 3. 已被代码证伪的旧假设

以下说法不能再作为知识对象：

1. `mall-portal 的商品搜索是否支持 brandId 仍待确认`
   - 已证伪，代码已支持

2. `ES 索引是否包含品牌字段仍待确认`
   - 已证伪，`EsProduct` 已有 `brandId` / `brandName`

3. `mall-portal 是否直接调用 mall-search 仍待确认`
   - 当前没有代码证据支持，不能当事实写成“是”

4. `联想词能力不存在`
   - 不能这么写
   - 更准确的说法应是：`当前未发现搜索框联想词实现；已存在 related info 聚合能力，但语义未必等同于联想词`

## 4. 对对象建模的直接影响

建议优先抽这些对象：

- `TERM-BRAND-FILTER`
- `TERM-RELATED-INFO`
- `TERM-SEARCH-SUGGESTION`
- `SYS-MALL-APP-WEB`
- `SYS-MALL-PORTAL`
- `SYS-MALL-SEARCH`
- `OWN-PORTAL-PRODUCT-SEARCH`
- `OWN-SEARCH-RELATED-INFO`
- `CON-PORTAL-PRODUCT-SEARCH`
- `CON-SEARCH-RELATED-INFO`
- `MOD-APP-PRODUCT-LIST`
- `MOD-APP-PRODUCT-SEARCH`
- `MOD-PORTAL-PRODUCT-SEARCH`
- `MOD-SEARCH-RELATED-INFO`
- `VER-SEARCH-ENHANCEMENT`
- `OPEN-SUGGESTION-SEMANTICS`

## 5. 当前最重要的 open questions

### OPEN-001 搜索框“联想词”到底指什么

当前代码能证明：

- 有搜索历史
- 有 related info 聚合能力

但不能证明：

- 是否已有真正的 suggestions / autocomplete 语义

需要进一步确认：

- 联想词是实时补全？
- 还是热搜 / 搜索历史 / 品牌聚合？

### OPEN-002 首轮试点要围绕哪条搜索链路

当前至少存在两条相关能力线：

1. `mall-portal /product/search`
   - 当前前台实际使用
2. `mall-search /esProduct/search + /search/relate`
   - ES 搜索服务能力

后续必须决定：

- 首轮对象化是只围绕“当前前台实际链路”
- 还是把“未来可能切向 ES 的链路”也纳入
