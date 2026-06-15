# 数据模型提取规则

## 定义
数据模型知识记录仓库内核心业务实体之间的关联关系和聚合边界。

## 提取重点
1. **外键字段**：命名包含 Id、FK、Ref 等后缀的字段
2. **关联字段**：List<OtherEntity>、@OneToMany 等注解
3. **聚合边界**：一对多关系中的"一"方作为聚合根
4. **继承关系**：实体类的 extends 和 implements 关系（从 evidence.customData 获取）

## 过滤规则
- 只记录核心业务实体（DO/Entity/Model）
- 排除 DTO/VO 等传输类
- 多模块项目需标注实体所属模块

## 生成约束
- 聚合边界判断必须有代码证据
- 实体关系描述应说明关联字段
- 记录跨聚合引用关系
- 继承关系必须来自 evidence.customData，禁止虚构

## 继承信息使用
evidence.dataContracts 中每个实体可能包含 customData：
- `extendsClass`: 父类名称（如 "BaseEntity"）
- `implementsInterfaces`: 实现的接口列表（如 ["Serializable", "Cloneable"]）

在 entity_relations 中记录继承关系时：
- type 使用 "extends" 或 "implements"
- relation_field 为空（继承是隐式关系）
- 只记录 evidence 中明确存在的继承关系

## 产物示例
```json
{
  "aggregate_name": "订单聚合",
  "summary_zh": "用户购买商品产生的交易记录聚合，包含订单主体、订单商品项和购买记录",
  "aggregate_description_zh": "用户购买商品产生的交易记录",
  "aliases": ["OrderAggregate", "订单模型", "OrderModel"],
  "core_entities": [
    { "name": "OrderDO", "role": "聚合根", "description": "订单主体", "extends": "BaseOrder", "implements": ["Serializable"] },
    { "name": "OrderGoodsDO", "role": "子实体", "description": "订单商品项" }
  ],
  "entity_relations": [
    { "from": "OrderDO", "to": "OrderGoodsDO", "type": "one_to_many", "field": "orderGoodsList" },
    { "from": "OrderDO", "to": "BaseOrder", "type": "extends", "field": null },
    { "from": "OrderDO", "to": "Serializable", "type": "implements", "field": null }
  ],
  "related_aggregates": ["商品聚合", "优惠券聚合", "用户聚合"],
  "evidence": ["OrderDO.java", "OrderGoodsDO.java"],
  "tags": ["订单", "交易", "聚合"]
}
```