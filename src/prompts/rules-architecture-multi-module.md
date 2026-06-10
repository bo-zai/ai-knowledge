# 多模块项目架构概览生成规则

## 任务说明

你需要为一个多模块项目生成架构概览知识。多模块项目包含多个子模块，这些模块可能是可部署的服务或共享的公共模块。架构概览帮助 AI Agent 快速建立对项目的全局认知，理解模块间关系，并指导编码时的代码定位。

架构概览回答的问题：
- 这个项目有哪些模块？各模块的角色是什么？
- 哪些模块可以独立部署？哪些是共享公共代码？
- 模块之间的依赖关系是什么？
- 每个可部署服务的架构是什么？
- 共享模块提供了什么能力？
- 核心业务域是什么？支撑域和辅助域是什么？

**核心原则**：架构概览必须提供模块维度的定位信息，帮助 Agent 理解"某个能力属于哪个模块"。

## 输出格式

输出一个 JSON 对象，包含以下字段：

```json
{
  "architecture_overview_name": "项目名称 + 架构概览",
  "summary_zh": "一句话定位",
  "project_type": "monorepo | microservices",
  "tech_stack": ["技术栈列表"],
  "coupling_mode": "紧耦合 | 松耦合",
  "module_topology": [
    {
      "name": "模块名",
      "path": "模块路径",
      "type": "模块类型",
      "role": "deployable | shared",
      "description": "模块用途简述",
      "dependencies": ["依赖的模块名"],
      "used_by": ["被哪些模块使用"],
      "entry_point": "入口文件（仅 deployable）"
    }
  ],
  "module_dependencies_description": "模块依赖关系描述",
  "service_architectures": [
    {
      "module_name": "服务模块名",
      "package_mode": "按层分包 | 按领域分包",
      "layer_package_paths": [
        {
          "layer": "分层名称",
          "package_path": "包路径",
          "coding_guide": "编码时指导"
        }
      ]
    }
  ],
  "shared_modules_description": "共享模块说明",
  "business_domain_panorama": {
    "core_domains": ["核心业务域列表"],
    "supporting_domains": ["支撑域列表"],
    "auxiliary_domains": ["辅助域列表"],
    "domain_interactions": "域间主要交互方向"
  },
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

格式：`技术栈 + 多模块项目 + 主要功能`

示例：
- 正确："Spring Boot 多模块电商项目，包含后台管理、前台商城、搜索服务三个可部署服务，共享实体和公共组件"
- 错误："Maven 多模块项目，采用紧耦合模式"（过于技术化）

### project_type

根据耦合模式判断：
- 紧耦合：`monorepo`
- 松耦合：`microservices`

### tech_stack

列出主要技术栈，不超过 5 个。按重要性排序。

示例：`["Spring Boot", "MyBatis", "MySQL", "Redis", "Elasticsearch"]`

### coupling_mode

从 module_topology 中获取，固定为：
- 紧耦合：`"紧耦合"`
- 松耦合：`"松耦合"`

### module_topology（模块拓扑）—— **核心字段**

直接使用提供的模块拓扑信息，列出所有模块。

每个模块条目包含：

| 字段 | 说明 |
|------|------|
| name | 模块名（如 mall-admin） |
| path | 模块相对路径（如 mall-admin/） |
| type | 模块类型（java-maven-module、npm-package 等） |
| role | deployable（可部署）或 shared（共享模块） |
| description | 模块用途简述 |
| dependencies | 该模块依赖的其他模块名列表 |
| used_by | 使用该模块的其他模块名列表（仅 shared 模块有） |
| entry_point | 入口文件路径（仅 deployable 模块） |

**必须包含所有模块**。

### module_dependencies_description（模块依赖关系描述）

用自然语言描述模块间的依赖关系，说明：
1. 哪些模块被哪些服务依赖
2. 共享模块提供了什么能力
3. 可部署服务之间的关系（如果有）

示例：
```
项目包含 7 个模块：3 个可部署服务（mall-admin、mall-portal、mall-search）和 4 个共享模块（mall-mbg、mall-common、mall-security、mall-demo）。

依赖关系：
- mall-mbg（实体生成模块）被所有服务依赖，提供 MyBatis Generator 生成的实体类和 Mapper
- mall-common（公共模块）被所有服务依赖，提供通用工具类、异常处理、统一返回结果等
- mall-security（安全模块）被 mall-admin 和 mall-portal 依赖，提供 Spring Security 配置和 JWT 认证

可部署服务之间无直接依赖，各自独立运行。
```

### service_architectures（各服务架构）

为每个 **可部署模块** 描述其内部架构。

包含以下信息：

| 字段 | 说明 |
|------|------|
| module_name | 服务模块名 |
| package_mode | 分包模式：按层分包、按领域分包、混合分包 |
| layer_package_paths | 该服务的分层包路径 |

**分包模式判断方法**：
查看该模块的 src_dir_tree 证据，参照单模块模板的判断方法。

**layer_package_paths 要求**：
- **必须完整列出所有分层包**，不能只列出核心三层
- 包含但不限于：Controller、Service、Dao/Mapper、DTO/VO/Domain、Config、Component、Repository、Util/Constant、Exception/Handler
- 根据实际目录结构填写，不存在则不写
- coding_guide 必须说明该包存放什么类型的类

**layer_package_paths 完整示例**：
```json
[
  { "layer": "Controller", "package_path": "com.macro.mall.admin.controller", "coding_guide": "RESTful API 控制器，处理 HTTP 请求" },
  { "layer": "Service", "package_path": "com.macro.mall.admin.service", "coding_guide": "业务逻辑接口和实现类" },
  { "layer": "Dao", "package_path": "com.macro.mall.admin.dao", "coding_guide": "自定义数据访问接口，扩展 MBG 生成的 Mapper" },
  { "layer": "DTO", "package_path": "com.macro.mall.admin.dto", "coding_guide": "数据传输对象，用于 API 参数和响应" },
  { "layer": "BO", "package_path": "com.macro.mall.admin.bo", "coding_guide": "业务对象，用于业务逻辑内部传递" },
  { "layer": "Config", "package_path": "com.macro.mall.admin.config", "coding_guide": "Spring 配置类，如 Security、MyBatis、Swagger 配置" },
  { "layer": "Component", "package_path": "com.macro.mall.admin.component", "coding_guide": "Spring 组件，如消息队列监听器、定时任务" },
  { "layer": "Util", "package_path": "com.macro.mall.admin.util", "coding_guide": "工具类，静态辅助方法" }
]
```

**注意**：
- DTO 包可能命名为 dto、vo、domain、request、response 等，根据实际目录填写
- Dao 包可能命名为 dao、mapper、repository，根据实际目录填写
- 如果模块没有某个分层包，则不列出（不要虚构）

### shared_modules_description（共享模块说明）

用自然语言描述共享模块的能力和职责。

示例：
```
- mall-mbg：MyBatis Generator 模块，生成所有实体类（PmsProduct、OmsOrder 等）和 Mapper 接口。修改数据库表后需重新运行 generatorConfig.xml
- mall-common：公共工具模块，包含统一返回结果 CommonResult、分页工具 PageVo、异常处理 GlobalExceptionHandler 等
- mall-security：安全模块，提供 JWT 认证、Spring Security 配置、用户权限校验
- mall-demo：演示模块，包含示例代码（非生产使用）
```

### business_domain_panorama（业务领域全景）—— **核心字段**

将业务域分为三类：

| 类别 | 说明 |
|------|------|
| core_domains | 核心域：直接承载主营业务，是项目存在的核心价值 |
| supporting_domains | 支撑域：为核心域提供基础能力，如用户管理、权限管理 |
| auxiliary_domains | 辅助域：增值功能，如搜索增强、推荐算法 |

**判断方法**：
1. 从模块名和目录结构推断业务域
2. 从 Controller/Service 的命名推断业务域
3. 核心域判断：项目名称和主要功能直接相关的域
4. 支撑域判断：跨服务共享的通用能力

示例：
```json
{
  "core_domains": ["商品管理", "订单管理", "购物流程"],
  "supporting_domains": ["用户管理", "权限管理", "库存管理"],
  "auxiliary_domains": ["搜索服务", "推荐功能"],
  "domain_interactions": "商品管理 → 订单管理 → 购物流程 为核心业务链，用户管理和权限管理为所有核心域提供基础支撑"
}
```

### directory_structure（目录结构）

**采用表格形式**，列出顶层模块目录。

必须包含：
- 各模块目录（如 mall-admin/、mall-common/）
- 根配置文件目录（如果有）

**最多列出 10 个目录**（因为有多个模块）。

### ignore_directories（忽略目录）

包含所有模块的构建产物目录：

示例：
```json
[
  { "path": "mall-admin/target/", "reason": "mall-admin Maven 构建产物" },
  { "path": "mall-portal/target/", "reason": "mall-portal Maven 构建产物" },
  { "path": "mall-search/target/", "reason": "mall-search Maven 构建产物" },
  { "path": "ai-knowledge/", "reason": "知识库生成产物" },
  { "path": ".codegraph/", "reason": "代码索引文件" }
]
```

### coding_conventions（编码约定）

描述多模块项目的编码约定：

示例：
```json
[
  { "convention": "模块归属", "description": "新代码先确定属于哪个模块：业务功能放入对应服务模块，公共能力放入 mall-common" },
  { "convention": "实体修改", "description": "修改实体类需在 mall-mbg 模块的 generatorConfig.xml 中更新后重新生成" },
  { "convention": "服务命名", "description": "每个服务的 Controller/Service/Mapper 命名遵循各模块的包路径" }
]
```

### debug_entrypoints（调试入口）

列出每个可部署服务的启动入口：

示例：
```json
[
  { "type": "mall-admin 启动类", "location": "mall-admin/src/main/java/com/macro/mall/admin/MallAdminApplication.java", "description": "后台管理服务启动入口" },
  { "type": "mall-portal 启动类", "location": "mall-portal/src/main/java/com/macro/mall/portal/MallPortalApplication.java", "description": "前台商城服务启动入口" },
  { "type": "mall-search 启动类", "location": "mall-search/src/main/java/com/macro/mall/search/MallSearchApplication.java", "description": "搜索服务启动入口" }
]
```

### evidence

列出支撑架构判断的证据文件：

- 根 pom.xml（证明多模块结构）
- 各模块的 pom.xml
- 各模块的目录结构

## 产物示例

```json
{
  "architecture_overview_name": "mall 电商系统架构概览",
  "summary_zh": "Spring Boot 多模块电商项目，包含后台管理、前台商城、搜索服务三个可部署服务，共享实体和公共组件",
  "project_type": "monorepo",
  "tech_stack": ["Spring Boot", "MyBatis", "MySQL", "Redis", "Elasticsearch"],
  "coupling_mode": "紧耦合",
  "module_topology": [
    { "name": "mall-admin", "path": "mall-admin/", "type": "java-maven-module", "role": "deployable", "description": "后台管理服务", "dependencies": ["mall-mbg", "mall-common", "mall-security"], "used_by": [], "entry_point": "mall-admin/src/main/java/com/macro/mall/admin/MallAdminApplication.java" },
    { "name": "mall-portal", "path": "mall-portal/", "type": "java-maven-module", "role": "deployable", "description": "前台商城服务", "dependencies": ["mall-mbg", "mall-common", "mall-security"], "used_by": [], "entry_point": "mall-portal/src/main/java/com/macro/mall/portal/MallPortalApplication.java" },
    { "name": "mall-search", "path": "mall-search/", "type": "java-maven-module", "role": "deployable", "description": "搜索服务", "dependencies": ["mall-mbg", "mall-common"], "used_by": [], "entry_point": "mall-search/src/main/java/com/macro/mall/search/MallSearchApplication.java" },
    { "name": "mall-mbg", "path": "mall-mbg/", "type": "java-maven-module", "role": "shared", "description": "MyBatis Generator 模块", "dependencies": [], "used_by": ["mall-admin", "mall-portal", "mall-search"], "entry_point": null },
    { "name": "mall-common", "path": "mall-common/", "type": "java-maven-module", "role": "shared", "description": "公共工具模块", "dependencies": [], "used_by": ["mall-admin", "mall-portal", "mall-search"], "entry_point": null },
    { "name": "mall-security", "path": "mall-security/", "type": "java-maven-module", "role": "shared", "description": "安全模块", "dependencies": ["mall-common"], "used_by": ["mall-admin", "mall-portal"], "entry_point": null },
    { "name": "mall-demo", "path": "mall-demo/", "type": "java-maven-module", "role": "shared", "description": "演示模块", "dependencies": ["mall-mbg", "mall-common"], "used_by": [], "entry_point": null }
  ],
  "module_dependencies_description": "项目包含 7 个模块：3 个可部署服务（mall-admin、mall-portal、mall-search）和 4 个共享模块。\n\n依赖关系：\n- mall-mbg 被所有服务依赖，提供 MyBatis Generator 生成的实体类和 Mapper\n- mall-common 被所有服务依赖，提供通用工具类\n- mall-security 被 mall-admin 和 mall-portal 依赖，提供 JWT 认证\n\n可部署服务之间无直接依赖。",
  "service_architectures": [
    {
      "module_name": "mall-admin",
      "package_mode": "按层分包",
      "layer_package_paths": [
        { "layer": "Controller", "package_path": "com.macro.mall.controller", "coding_guide": "RESTful API 控制器，处理 HTTP 请求入口" },
        { "layer": "Service", "package_path": "com.macro.mall.service", "coding_guide": "业务逻辑接口和实现类，处理核心业务" },
        { "layer": "Dao", "package_path": "com.macro.mall.dao", "coding_guide": "自定义数据访问接口，扩展 MBG 生成的 Mapper" },
        { "layer": "DTO", "package_path": "com.macro.mall.dto", "coding_guide": "数据传输对象，用于 API 请求参数和响应结果" },
        { "layer": "BO", "package_path": "com.macro.mall.bo", "coding_guide": "业务对象，用于 Service 层内部业务数据传递" },
        { "layer": "Config", "package_path": "com.macro.mall.config", "coding_guide": "Spring 配置类，如 Security、MyBatis、Swagger、OSS 配置" }
      ]
    },
    {
      "module_name": "mall-portal",
      "package_mode": "按层分包",
      "layer_package_paths": [
        { "layer": "Controller", "package_path": "com.macro.mall.portal.controller", "coding_guide": "前台商城 RESTful API 控制器" },
        { "layer": "Service", "package_path": "com.macro.mall.portal.service", "coding_guide": "前台业务逻辑接口和实现类" },
        { "layer": "Dao", "package_path": "com.macro.mall.portal.dao", "coding_guide": "自定义数据访问接口" },
        { "layer": "Domain", "package_path": "com.macro.mall.portal.domain", "coding_guide": "领域对象，购物车、订单详情等业务模型" },
        { "layer": "Config", "package_path": "com.macro.mall.portal.config", "coding_guide": "Spring 配置类，支付、消息队列、安全配置" },
        { "layer": "Component", "package_path": "com.macro.mall.portal.component", "coding_guide": "Spring 组件，消息队列监听器、定时任务" },
        { "layer": "Repository", "package_path": "com.macro.mall.portal.repository", "coding_guide": "MongoDB Repository，会员收藏、浏览历史" },
        { "layer": "Util", "package_path": "com.macro.mall.portal.util", "coding_guide": "工具类，静态辅助方法" }
      ]
    },
    {
      "module_name": "mall-search",
      "package_mode": "按层分包",
      "layer_package_paths": [
        { "layer": "Controller", "package_path": "com.macro.mall.search.controller", "coding_guide": "搜索 RESTful API 控制器" },
        { "layer": "Service", "package_path": "com.macro.mall.search.service", "coding_guide": "搜索业务逻辑，ES 索引同步和查询" },
        { "layer": "Dao", "package_path": "com.macro.mall.search.dao", "coding_guide": "Elasticsearch 数据访问接口" },
        { "layer": "Domain", "package_path": "com.macro.mall.search.domain", "coding_guide": "ES 文档对象，EsProduct、EsProductAttributeValue" },
        { "layer": "Repository", "package_path": "com.macro.mall.search.repository", "coding_guide": "Elasticsearch Repository 接口" },
        { "layer": "Config", "package_path": "com.macro.mall.search.config", "coding_guide": "Spring 配置类，MyBatis、Swagger 配置" }
      ]
    }
  ],
  "shared_modules_description": "- mall-mbg：MyBatis Generator 模块，生成实体类和 Mapper 接口\n- mall-common：公共工具模块，包含 CommonResult、PageVo、GlobalExceptionHandler\n- mall-security：安全模块，提供 JWT 认证和 Spring Security 配置\n- mall-demo：演示模块，包含示例代码",
  "business_domain_panorama": {
    "core_domains": ["商品管理", "订单管理", "购物流程"],
    "supporting_domains": ["用户管理", "权限管理", "库存管理"],
    "auxiliary_domains": ["搜索服务"],
    "domain_interactions": "商品管理 → 订单管理 → 购物流程 为核心业务链，用户管理和权限管理为核心域提供支撑"
  },
  "directory_structure": [
    { "path": "mall-admin/", "purpose": "后台管理服务", "coding_guide": "商品、订单、用户等后台管理功能" },
    { "path": "mall-portal/", "purpose": "前台商城服务", "coding_guide": "购物车、订单、会员等前台功能" },
    { "path": "mall-search/", "purpose": "搜索服务", "coding_guide": "商品搜索、ES 同步" },
    { "path": "mall-mbg/", "purpose": "实体生成模块", "coding_guide": "修改数据库表后重新运行 generator" },
    { "path": "mall-common/", "purpose": "公共模块", "coding_guide": "通用工具类放这里" },
    { "path": "mall-security/", "purpose": "安全模块", "coding_guide": "认证授权相关配置" },
    { "path": "pom.xml", "purpose": "根构建配置", "coding_guide": "模块依赖管理" }
  ],
  "ignore_directories": [
    { "path": "mall-admin/target/", "reason": "Maven 构建产物" },
    { "path": "mall-portal/target/", "reason": "Maven 构建产物" },
    { "path": "mall-search/target/", "reason": "Maven 构建产物" },
    { "path": "mall-mbg/target/", "reason": "Maven 构建产物" },
    { "path": "mall-common/target/", "reason": "Maven 构建产物" },
    { "path": "ai-knowledge/", "reason": "知识库生成产物" },
    { "path": ".codegraph/", "reason": "代码索引文件" }
  ],
  "coding_conventions": [
    { "convention": "模块归属", "description": "业务功能放入对应服务模块，公共能力放入 mall-common" },
    { "convention": "实体修改", "description": "修改实体类需在 mall-mbg 重新生成" },
    { "convention": "服务命名", "description": "各服务的类命名遵循其包路径前缀" }
  ],
  "debug_entrypoints": [
    { "type": "mall-admin 启动类", "location": "mall-admin/src/main/java/com/macro/mall/admin/MallAdminApplication.java", "description": "后台管理服务启动入口" },
    { "type": "mall-portal 启动类", "location": "mall-portal/src/main/java/com/macro/mall/portal/MallPortalApplication.java", "description": "前台商城服务启动入口" },
    { "type": "mall-search 启动类", "location": "mall-search/src/main/java/com/macro/mall/search/MallSearchApplication.java", "description": "搜索服务启动入口" }
  ],
  "evidence": ["pom.xml", "mall-admin/pom.xml", "mall-portal/pom.xml", "mall-search/pom.xml", "mall-mbg/pom.xml", "mall-common/pom.xml", "mall-security/pom.xml"]
}
```

## 禁止事项

1. **禁止遗漏模块**：module_topology 必须包含所有模块
2. **禁止虚构模块依赖**：依赖关系必须从 pom.xml 证据中提取
3. **禁止遗漏业务领域全景**：business_domain_panorama 是核心字段，必须填写
4. **禁止遗漏服务架构**：每个 deployable 模块必须有 service_architectures 条目
5. **禁止遗漏共享模块说明**：shared_modules_description 必须填写
6. **禁止占位符包路径**：layer_package_paths 必须使用实际包名
7. **禁止只列出三层核心包**：layer_package_paths 必须完整列出所有存在的分层包（Controller、Service、Dao 只是基础三层，还需列出 DTO/Domain、Config、Component、Repository、Util 等所有实际存在的包）

## 输入证据说明

你将收到以下证据：

- project_name：项目名称
- identified_type：已识别的项目类型
- identified_tech_stack：已识别的技术栈
- coupling_mode：耦合模式
- module_topology：模块拓扑信息（JSON 格式）
- module_dir_trees：**各模块的目录结构（核心证据）**—— 从中提取每个模块的所有分层包路径，包括 config、dto、domain、component、repository、util 等
- root_pom_modules：根 pom.xml 的 modules 部分
- ignore_dirs：已识别的忽略目录

**提取完整分层包的方法**：
1. 查看 module_dir_trees 中每个模块的 `src/main/java/` 目录结构
2. 找出所有包目录（如 controller、service、dao、dto、config、component、repository、domain、util、bo）
3. 将每个包目录转换为 layer_package_paths 条目
4. 不存在的包不要虚构，存在的包必须全部列出

根据这些证据生成架构概览，不虚构不存在的信息。