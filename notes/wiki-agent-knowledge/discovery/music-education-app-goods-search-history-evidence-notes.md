# Music Education App Goods Search History Evidence Notes

## 范围

- 仓库：`music-education-app`
- 辅助仓库：`music-education-core`
- 能力：`商品列表查询 + 搜索历史写入`

## 代码事实

### 1. `/goods/list` 是能力入口

- 事实：`GoodsController.list` 通过 `POST /goods/list` 接收 `GoodsQuery`，并直接调用 `goodsService.queryPageGoods(req)`
- 证据：
  - `music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:39`
  - `music-education-app/src/main/java/com/education/music/app/controller/GoodsController.java:41`

### 2. 商品查询主流程在 `GoodsService.queryPageGoods`

- 事实：该方法负责读取用户上下文、决定是否写搜索历史、设定排序、强制 `onSell=1`、查询商品列表、补充价格并返回分页结果
- 证据：
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:112`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:116`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:122`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:125`

### 3. 搜索历史写入条件是 `userId != null && keyword 非空`

- 事实：`GoodsService.queryPageGoods` 在 `keyword` 非空且线程上下文里有 `userId` 时，构造 `SearchHistoryDO` 并调用 `searchHistoryService.save`
- 证据：
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:114`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:119`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:120`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:121`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:122`

### 4. 搜索历史服务本身只负责补时间并落库

- 事实：`SearchHistoryService.save` 只设置 `addTime`、`updateTime` 并调用 `insertSelective`
- 证据：
  - `music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:18`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:19`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/SearchHistoryService.java:20`

### 5. 运行时关键字过滤并不直接使用商品 `keywords` 字段

- 事实：`/goods/list` 的 SQL 只在 `keyType == 1` 时执行 `p.name like CONCAT('%',#{keyword},'%')`
- 事实：共享商品模型 `GoodsDO` 虽然存在 `keywords` 字段，但当前查询 SQL 没有用它做过滤
- 证据：
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:89`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:90`
  - `music-education-core/src/main/java/com/education/music/core/DO/mall/GoodsDO.java:33`

### 6. 关键字“参与查询”和“写入历史”的条件不一致

- 事实：写历史只判断 `keyword` 非空
- 事实：查列表时只有 `keyType == 1` 才会使用 `keyword` 过滤商品名
- 判断：这造成一个真实分歧，`keyword` 可能被写入历史，但并未影响查询结果
- 证据：
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:116`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:89`
  - `music-education-app/src/main/resources/mappers/GoodsMapper.xml:90`

### 7. `/goods/list` 在运行时需要登录

- 事实：`WebConfig` 的登录拦截器排除名单里没有 `/goods/list`
- 事实：`LoginInterceptor` 对空 token 直接返回 `NO_LOGIN`
- 事实：校验通过后才将 `userId` 写入 `ThreadContextHolder`
- 证据：
  - `music-education-app/src/main/java/com/education/music/app/config/WebConfig.java:25`
  - `music-education-app/src/main/java/com/education/music/app/interceptor/LoginInterceptor.java:38`
  - `music-education-app/src/main/java/com/education/music/app/interceptor/LoginInterceptor.java:69`
  - `music-education-core/src/main/java/com/education/music/core/context/ThreadContextHolder.java`

### 8. 请求模型的关键字段来自 `CommonPage`

- 事实：`GoodsQuery` 继承 `CommonPage`
- 事实：`keyType`、`keyword`、`orderByClause` 定义在 `CommonPage`
- 证据：
  - `music-education-app/src/main/java/com/education/music/app/entity/req/query/GoodsQuery.java:35`
  - `music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:36`
  - `music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:38`
  - `music-education-app/src/main/java/com/education/music/app/entity/page/CommonPage.java:40`

### 9. 搜索历史表模型包含 `from` 和逻辑删除字段

- 事实：`SearchHistoryDO` 具备 `userId`、`keyword`、`from`、`addTime`、`updateTime`、`deleted`
- 事实：当前写入时 `from` 被硬编码为 `"wx"`
- 证据：
  - `music-education-core/src/main/java/com/education/music/core/DO/mall/SearchHistoryDO.java:23`
  - `music-education-core/src/main/java/com/education/music/core/DO/mall/SearchHistoryDO.java:28`
  - `music-education-app/src/main/java/com/education/music/app/service/mall/GoodsService.java:121`

### 10. 当前可见测试只覆盖了 `/goods/list` 的基础调用

- 事实：`GoodsControllerTest.list` 使用 `teacherJwtToken`、`pageSize`、`lastId` 请求 `/goods/list`
- 事实：当前未看到针对 `keyword`、`keyType`、搜索历史写入的自动化断言
- 证据：
  - `music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:37`
  - `music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:39`
  - `music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:40`
  - `music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:42`
  - `music-education-app/src/test/java/com/education/music/app/controller/GoodsControllerTest.java:43`

## 当前最值得沉淀的知识

- `TERM`: `keyword` 的运行时语义
- `OWN`: 搜索历史写入条件和写入归属
- `CON`: `/goods/list` 的输入、登录边界和查询语义
- `MOD`: controller、goods service、search-history service 的职责边界
- `VER`: 当前验证覆盖和未来变更的最低验证要求
- `OPEN`: `keyword` 写历史和查结果的条件分歧是否有意
