# 场景 4：重构 —— 订单模块分包模式变更

## 需求文档

> "将订单模块从当前的按层分包（controller/service/mapper/entity）重构为按领域分包（order/controller、order/service、order/mapper、order/entity），使订单相关代码内聚在同一个包下。重构不改变任何业务逻辑和 API 接口。"

## 我的工作过程

### 第一步：确认当前结构和目标

```
CodeGraph search "Order" kind=class
```

→ 返回所有 Order 相关类及其包路径：

- com.app.controller.OrderController
- com.app.service.OrderService
- com.app.service.impl.OrderServiceImpl
- com.app.mapper.OrderMapper
- com.app.entity.OrderDO、OrderGoodsDO、OrderRecordDO
- com.app.entity.dto.OrderDTO、OrderVO

确认是按层分包。目标包路径：com.app.order.\*

### 第二步：找所有需要移动的类

```
Grep "import com\.app\.entity\.Order" glob="*.java"
Grep "import com\.app\.service\.Order" glob="*.java"
Grep "import com\.app\.controller\.Order" glob="*.java"
Grep "import com\.app\.mapper\.Order" glob="*.java"
```

→ 找到所有引用了订单类的文件，包括跨域引用：

- CartService 引用了 OrderService
- PaymentService 引用了 OrderService
- CouponService 引用了 OrderDO

### 第三步：检查非 Java 引用

```
Grep "OrderMapper" glob="*.xml"
```

→ MyBatis mapper XML 中的 namespace，移动后必须更新

```
Grep "com.app.service.Order\|com.app.controller.Order" glob="*.yml"
```

→ 检查 Spring 配置中是否有显式包路径引用

### 第四步：执行重构

1. 创建 com.app.order.\* 包结构
2. 移动所有 Order 相关类
3. 更新 package 声明
4. 更新所有 Java 文件中的 import
5. 更新 MyBatis XML 的 namespace
6. 编译验证

### 第五步：编译验证

编译 → 修复遗漏的 import → 再编译 → 直到通过。

## 知识库在这个场景中的作用

**没有作用。** 整个重构过程是纯结构操作：

- 当前分包模式 → CodeGraph search 看到包路径就知道了
- 需要移动的类 → Grep import 就能找到完整清单
- 跨域引用 → Grep import 就能找到
- XML namespace → Grep 就能找到

这个场景不需要任何业务知识。CodeGraph + Grep 完全覆盖。

## 本场景结论

| 信息需求         | 实际获取方式              | 知识库的增量价值 |
| ---------------- | ------------------------- | :--------------: |
| 当前分包模式     | CodeGraph search 看包路径 |        无        |
| 需要移动的类清单 | Grep import               |        无        |
| 跨域引用         | Grep import               |        无        |
| XML namespace    | Grep                      |        无        |
| Spring 配置引用  | Grep                      |        无        |

重构场景下知识库 ROI 为零。
