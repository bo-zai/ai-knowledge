# Music Education Repo Assessment

## 目标

为 `music-education-admin`、`music-education-app`、`music-education-core` 三个仓库选择一个适合跑完整个知识系统 MVP 的锚点仓库。

## 结论

- 锚点仓库：`music-education-app`
- 辅助仓库：`music-education-core`
- 旁证仓库：`music-education-admin`

## 选择理由

### `music-education-app`

- `pom.xml` 标识为 `音乐小程序接口`
- 控制器丰富，直接承载用户侧真实业务入口
- 同时存在少量需求笔记，可作为候选线索，但不作为事实来源
- 适合作为 `需求理解 -> 代码定位 -> 验证规划` 的首个 MVP 入口

### `music-education-core`

- `pom.xml` 标识为 `核心实体类`
- 提供共享 DO、枚举、上下文等一手模型证据
- 不适合作为单独锚点，但适合为 app 能力提供数据模型和上下文证据

### `music-education-admin`

- `pom.xml` 标识为 `后台管理`
- 更偏管理端和运营端流程
- 与首轮 MVP 相比，业务链路更长，不利于先收敛最小闭环

## 首个 MVP 能力点

- 能力：`商品列表查询 + 搜索历史写入`
- 入口：`POST /goods/list`
- 原因：
  - 足够小，不会一下子扩散到订单、支付、积分、短信等高复杂度模块
  - 仍然跨越了 controller、service、mapper、shared model、login context
  - 有真实代码路径和基础测试锚点，适合做第一批正式知识对象

## 取证规则

- `需求文档.txt`、`TODO.txt`、`doc/` 下文档只作为线索来源
- 最终事实只来自源码、Mapper SQL、测试、共享模型和框架配置
- 本轮 MVP 不依赖任何 AI 生成 wiki 或推测性说明
