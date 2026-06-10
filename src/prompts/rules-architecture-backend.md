# 后端服务架构概览生成规则

## 任务说明

你需要为一个后端服务项目生成架构概览知识。架构概览帮助 AI Agent 快速建立对项目的全局认知，并指导编码时的代码定位。

架构概览回答的问题：
- 这个项目是什么类型？使用什么技术栈？
- 分包模式是什么？（按层分包还是按领域分包）
- Controller/Service/Mapper/Entity 放在哪个包？
- 新代码应该放哪？
- 哪些目录不需要浏览？
- 通用的编码约定是什么？

**核心原则**：架构概览必须提供可操作的编码定位信息，不能只给出宽泛的描述。

## 输出格式

输出一个 JSON 对象，包含以下字段：

```json
{
  "architecture_overview_name": "项目名称 + 架构概览",
  "summary_zh": "一句话定位",
  "project_type": "backend-service",
  "tech_stack": ["技术栈列表"],
  "package_mode": "按层分包 | 按领域分包 | 混合分包",
  "layer_package_paths": [
    {
      "layer": "分层名称",
      "package_path": "包路径",
      "coding_guide": "编码时指导"
    }
  ],
  "directory_structure": [
    {
      "path": "目录路径",
      "purpose": "目录用途",
      "coding_guide": "编码时指导"
    }
  ],
  "ignore_directories": [
    {
      "path": "目录路径",
      "reason": "忽略原因"
    }
  ],
  "coding_conventions": [
    {
      "convention": "约定名称",
      "description": "约定描述"
    }
  ],
  "business_domains_navigation": "业务领域导航说明",
  "debug_entrypoints": [
    {
      "type": "入口类型",
      "location": "位置",
      "description": "说明"
    }
  ],
  "evidence": ["证据文件列表"]
}
```

## 字段填写要求

### architecture_overview_name

项目名称 + "架构概览"。

### summary_zh（一句话定位）

格式：`技术栈 + 后端服务 + 主要功能`

示例：
- 正确："Spring Boot 后端服务，提供课程管理、用户管理、学习记录等功能"
- 错误："Spring Boot 后端服务，采用 Controller-Service-Repository 分层"（过于技术化）

要求：用业务语言描述，不用架构术语。

### project_type

固定为 `backend-service`。

### tech_stack

列出主要技术栈，不超过 5 个。按重要性排序。

示例：`["Spring Boot", "MyBatis", "MySQL", "Redis"]`

### package_mode（分包模式）—— **必填且必须准确**

从 src_dir_tree 证据中推断分包模式，有以下三种：

**按层分包（layer-based）**：
- 特征：src/ 下直接有 controller、service、mapper/repository、entity 等目录
- 所有 Controller 在同一个包，所有 Service 在同一个包
- 示例结构：
  ```
  com.xxx.app/
  ├── controller/
  ├── service/
  ├── mapper/
  ├── entity/
  ```

**按领域分包（domain-based）**：
- 特征：src/ 下有多个领域包（user、order、product 等），每个领域包内有 controller、service 等
- 每个领域的 Controller 在各自的 controller 子包
- 示例结构：
  ```
  com.xxx/
  ├── user/
  │   ├── controller/
  │   ├── service/
  │   ├── mapper/
  ├── order/
  │   ├── controller/
  │   ├── service/
  ```

**混合分包（mixed）**：
- 特征：部分领域独立分包，部分公共代码按层组织
- 示例结构：
  ```
  com.xxx/
  ├── app/           ← 公共代码（按层）
  │   ├── controller/
  │   ├── common/
  ├── user/          ← 用户领域（按领域）
  ├── order/         ← 订单领域（按领域）
  ```

**判断方法**：
1. 查看 src_dir_tree 中是否存在顶层 controller/service/mapper 目录
2. 如果存在顶层分层目录 → 按层分包
3. 如果只存在多个领域包（如 user/、order/），每个包内有分层 → 按领域分包
4. 如果两者同时存在 → 混合分包

**必须从实际目录结构推断，不能猜测或使用示例模板**。

### layer_package_paths（分层包路径）—— **核心字段，必填**

提供每个分层的具体包路径，这是 Agent 定位代码的关键信息。

采用表格形式，每个条目包含三个字段：

| 字段 | 要求 |
|------|------|
| layer | 分层名称：Controller、Service、Mapper/Repository、Entity 等 |
| package_path | 完整包路径，从证据中提取 |
| coding_guide | 编码时指导——新代码放哪 |

**按层分包示例**：
```json
[
  { "layer": "Controller", "package_path": "com.education.music.app.controller", "coding_guide": "新 Controller 放在此包，如 CourseController.java" },
  { "layer": "Service", "package_path": "com.education.music.app.service", "coding_guide": "新 Service 放在此包，如 CourseService.java" },
  { "layer": "Mapper", "package_path": "com.education.music.app.mapper", "coding_guide": "新 Mapper 放在此包，如 CourseMapper.java" },
  { "layer": "Entity", "package_path": "com.education.music.app.entity", "coding_guide": "新实体类放在此包，DTO/VO/req 子目录分类存放" }
]
```

**按领域分包示例**：
```json
[
  { "layer": "Controller", "package_path": "com.ordermgr.<domain>.controller", "coding_guide": "如 user/controller/UserController.java" },
  { "layer": "Service", "package_path": "com.ordermgr.<domain>.service", "coding_guide": "如 user/service/UserService.java" },
  { "layer": "Repository", "package_path": "com.ordermgr.<domain>.repository", "coding_guide": "如 user/repository/UserRepository.java" },
  { "layer": "Entity", "package_path": "com.ordermgr.<domain>.entity", "coding_guide": "如 user/entity/User.java" }
]
```

**必须从 src_dir_tree 证据中提取实际路径，不能使用 com.xxx.<domain> 这样的占位符**。

### directory_structure（目录结构）

**必须采用表格形式**，每个条目包含三个字段。

**coding_guide 填写示例**：
- `"分层包已在上方列出"`（如果分层已在 layer_package_paths 中详细说明）
- `"application.yml 配置数据库、Redis 等"`
- `"单元测试、集成测试"`

**必须包含的目录**（按实际存在选择）：
- src/main/java/ 或 src/（源代码根目录）
- src/main/resources/ 或 config/（配置目录）
- src/test/java/ 或 test/（测试目录）

**最多列出 5 个目录**。

### ignore_directories（忽略目录）

**只写两类目录**：

1. **项目特定的构建产物目录**（根据 evidence 判断）
   - Java 项目通常是 `target/`
   - 其他项目可能是 `dist/`、`build/`、`out/`、`bin/`

2. **工具生成目录**（必须包含）
   ```json
   [
     { "path": "ai-knowledge/", "reason": "知识库生成产物" },
     { "path": ".codegraph/", "reason": "代码索引文件" }
   ]
   ```

**不要写通用目录**（Agent 已知这些）：
- `.git/`、`.svn/` — 版本控制目录（Agent 已知）
- `.idea/`、`.vscode/` — IDE 配置（Agent 已知）
- `node_modules/` — npm 依赖（Agent 已知）

**示例**（Java 后端项目）：
```json
[
  { "path": "target/", "reason": "Maven 构建产物" },
  { "path": "ai-knowledge/", "reason": "知识库生成产物" },
  { "path": ".codegraph/", "reason": "代码索引文件" }
]
```

**示例**（Node.js 后端项目）：
```json
[
  { "path": "dist/", "reason": "构建产物" },
  { "path": "ai-knowledge/", "reason": "知识库生成产物" },
  { "path": ".codegraph/", "reason": "代码索引文件" }
]
```

### coding_conventions（编码约定）

描述通用的代码组织约定，从包结构和类命名推断。

**必填约定**：
- 命名约定（Controller/Service/Mapper 后缀规则）
- 分层职责（每层的职责边界）

**示例**：
```json
[
  { "convention": "命名约定", "description": "Controller 以 *Controller 结尾，Service 以 *Service 结尾，Mapper 以 *Mapper 结尾" },
  { "convention": "分层职责", "description": "Controller 处理 HTTP 请求和参数校验，Service 处理业务逻辑，Mapper 处理数据访问" },
  { "convention": "实体分类", "description": "DTO 用于数据传输，VO 用于视图输出，req 用于请求参数" }
]
```

**禁止**：
- 不描述业务特定约定（如"订单创建必须校验库存"），业务约定属于约束知识。
- 不虚构不存在的设计意图。

### business_domains_navigation（业务领域导航）

固定格式：

```
参见能力目录 capabilities/_index.md 获取具体业务模块信息。
```

或如果已知主要业务领域：

```
参见能力目录 capabilities/_index.md 获取课程管理、用户管理、学习记录等业务领域的详细信息。
```

### debug_entrypoints（调试入口）

列出主要入口：

| 类型 | 必填 |
|------|------|
| 启动类 | 是（具体类名，如 MusicEducationApplication.java） |
| HTTP | 说明"主要 API 入口参见各领域的 Controller" |

**示例**：
```json
[
  { "type": "启动类", "location": "MusicEducationApplication.java", "description": "Spring Boot 启动入口" },
  { "type": "HTTP", "location": "各领域 Controller", "description": "主要 API 入口参见能力目录" }
]
```

### evidence

列出支撑架构判断的配置文件和目录：

- pom.xml 或 build.gradle（构建配置）
- application.yml 或 application.properties（应用配置）
- src/main/java/ 目录结构（关键：必须包含完整目录树证据）

## 产物示例

**按层分包示例**：

```json
{
  "architecture_overview_name": "音乐教育应用架构概览",
  "summary_zh": "Spring Boot 后端服务，提供课程管理、用户管理、学习记录等功能",
  "project_type": "backend-service",
  "tech_stack": ["Spring Boot", "MyBatis", "MySQL", "Lombok"],
  "package_mode": "按层分包",
  "layer_package_paths": [
    { "layer": "Controller", "package_path": "com.education.music.app.controller", "coding_guide": "新 Controller 放在此包，如 CourseController.java" },
    { "layer": "Service", "package_path": "com.education.music.app.service", "coding_guide": "新 Service 放在此包，如 CourseService.java" },
    { "layer": "Mapper", "package_path": "com.education.music.app.mapper", "coding_guide": "新 Mapper 放在此包，如 CourseMapper.java" },
    { "layer": "Entity", "package_path": "com.education.music.app.entity", "coding_guide": "新实体类放在此包，DTO/VO/req 子目录分类存放" }
  ],
  "directory_structure": [
    { "path": "src/main/java/", "purpose": "Java 源代码", "coding_guide": "分层包已在上方列出" },
    { "path": "src/main/resources/", "purpose": "配置文件", "coding_guide": "application.yml 配置数据库、OSS；mappers/ 放 MyBatis XML" },
    { "path": "src/test/java/", "purpose": "测试代码", "coding_guide": "单元测试、集成测试" }
  ],
  "ignore_directories": [
    { "path": "target/", "reason": "Maven 构建产物" },
    { "path": "ai-knowledge/", "reason": "知识库生成产物" },
    { "path": ".codegraph/", "reason": "代码索引文件" },
    { "path": "node_modules/", "reason": "npm 依赖" }
  ],
  "coding_conventions": [
    { "convention": "命名约定", "description": "Controller 以 *Controller 结尾，Service 以 *Service 结尾，Mapper 以 *Mapper 结尾" },
    { "convention": "分层职责", "description": "Controller 处理 HTTP 请求和参数校验，Service 处理业务逻辑，Mapper 处理数据访问" },
    { "convention": "实体分类", "description": "DTO 用于数据传输，VO 用于视图输出，req 用于请求参数" }
  ],
  "business_domains_navigation": "参见能力目录 capabilities/_index.md 获取课程管理、用户管理、学习记录等业务领域的详细信息。",
  "debug_entrypoints": [
    { "type": "启动类", "location": "MusicEducationApplication.java", "description": "Spring Boot 启动入口" },
    { "type": "HTTP", "location": "com.education.music.app.controller", "description": "主要 API 入口参见能力目录" }
  ],
  "evidence": ["pom.xml", "application.yml", "src/main/java/com/education/music/app/ 目录结构"]
}
```

**按领域分包示例**：

```json
{
  "architecture_overview_name": "订单管理系统架构概览",
  "summary_zh": "Spring Boot 后端服务，提供订单管理、商品管理、用户管理等功能",
  "project_type": "backend-service",
  "tech_stack": ["Spring Boot", "JPA", "PostgreSQL"],
  "package_mode": "按领域分包",
  "layer_package_paths": [
    { "layer": "Controller", "package_path": "com.ordermgr.<domain>.controller", "coding_guide": "如 user/controller/UserController.java" },
    { "layer": "Service", "package_path": "com.ordermgr.<domain>.service", "coding_guide": "如 user/service/UserService.java" },
    { "layer": "Repository", "package_path": "com.ordermgr.<domain>.repository", "coding_guide": "如 user/repository/UserRepository.java" },
    { "layer": "Entity", "package_path": "com.ordermgr.<domain>.entity", "coding_guide": "如 user/entity/User.java" }
  ],
  "directory_structure": [
    { "path": "src/main/java/com/ordermgr/", "purpose": "业务代码根目录", "coding_guide": "新领域创建 com.ordermgr.<domain> 包" },
    { "path": "src/main/java/com/ordermgr/common/", "purpose": "公共代码", "coding_guide": "跨领域共享的工具类、异常类" },
    { "path": "src/main/resources/", "purpose": "配置文件", "coding_guide": "application.yml 配置数据库等" }
  ],
  "ignore_directories": [
    { "path": "target/", "reason": "Maven 构建产物" },
    { "path": "ai-knowledge/", "reason": "知识库生成产物" },
    { "path": ".codegraph/", "reason": "代码索引文件" }
  ],
  "coding_conventions": [
    { "convention": "命名约定", "description": "Controller 以 *Controller 结尾，Service 以 *Service 结尾，Repository 以 *Repository 结尾" },
    { "convention": "领域边界", "description": "每个领域包内聚，领域间通过 Service 接口调用，不直接访问其他领域的 Repository" }
  ],
  "business_domains_navigation": "参见能力目录 capabilities/_index.md 获取订单管理、商品管理、用户管理等业务领域的详细信息。",
  "debug_entrypoints": [
    { "type": "启动类", "location": "OrderApplication.java", "description": "Spring Boot 启动入口" },
    { "type": "HTTP", "location": "各领域 controller 子包", "description": "主要 API 入口参见能力目录" }
  ],
  "evidence": ["pom.xml", "src/main/java/com/ordermgr/ 目录结构"]
}
```

## 禁止事项

1. **禁止模糊分包模式**：package_mode 必须明确"按层分包"、"按领域分包"或"混合分包"，不能省略
2. **禁止占位符包路径**：layer_package_paths 必须使用实际包名（如 com.education.music.app），不能用 com.xxx.<domain> 占位
3. **禁止遗漏分层包路径**：layer_package_paths 是核心字段，必须填写
4. **禁止虚构分包模式**：必须从 src_dir_tree 证据中推断，不能猜测
5. **禁止泛化描述**：不使用"Java 源代码目录，包含业务代码"这类废话
6. **禁止遗漏忽略目录**：`ai-knowledge/`、`.codegraph/`、`target/` 必须在忽略目录列表中
7. **禁止遗漏编码指导**：所有表格必须有 coding_guide 字段

## 输入证据说明

你将收到以下证据：

- project_name：项目名称
- identified_type：已识别的项目类型
- identified_tech_stack：已识别的技术栈
- top_dir_tree：顶层目录结构（3层深度）
- src_dir_tree：src 目录完整结构（4层深度，包含所有子包）—— **关键证据，用于推断分包模式和分层包路径**
- java_dir_tree：Java 源码目录结构（用于提取根包名）
- ignore_dirs：已识别的忽略目录

**重点**：从 src_dir_tree 中：
1. 推断分包模式（按层 vs 按领域）
2. 提取分层包的实际路径
3. 提取根包名

根据这些证据生成架构概览，不虚构不存在的信息。