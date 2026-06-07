# 项目类型识别

根据以下证据判断项目类型。

## 类型定义

- **backend-service**：后端服务，有 HTTP/RPC 端点、数据库连接、业务逻辑分层
- **frontend-app**：前端应用，有组件、路由、UI 框架、打包配置
- **cli-tool**：CLI 工具，有命令行入口或 bin 目录
- **library**：库/SDK，有 API 导出，无业务端点
- **mobile-app**：移动应用，有 android/ios 目录或 React Native/Flutter 配置
- **fullstack**：全栈，前后端特征同时存在
- **monorepo**：多包仓库，有 packages/ 或 apps/ 目录
- **microservices**：微服务集群，有多个服务入口
- **config-only**：纯配置项目，无源代码
- **api-definition**：API 定义项目，只有 schema 无实现
- **static-site**：静态文档站点
- **test-only**：测试项目

## 识别优先级

1. 如果存在 packages/ 或 apps/ + workspaces 配置 → monorepo
2. 如果存在多个 docker-compose.yml + 多服务入口 → microservices
3. 如果前后端特征同时存在 → fullstack
4. 如果存在 android/ 或 ios/ 目录 + 移动框架依赖 → mobile-app

以上特征均不匹配时，综合判断：

- 有 Controller/router + 数据库配置 → backend-service
- 有 components/ + vite/webpack + UI 框架 → frontend-app
- 有 bin/ 或 cli 入口 + 无业务端点 → cli-tool
- 有 package.json 导出配置 + 无入口 → library
- 其他情况根据证据综合判断

## 输出要求

只输出一个 JSON 对象，不要任何解释文字：

```json
{
  "project_type": "backend-service",
  "primary_language": "java",
  "framework": "spring-boot",
  "tech_stack": ["Spring Boot", "MyBatis"],
  "confidence": 0.95,
  "identification_evidence": [
    "pom.xml 显示 Spring Boot 依赖",
    "目录结构包含 controller/service/repository 分层",
    "README 描述为订单管理系统"
  ]
}
```

confidence 范围 0.0~1.0，表示识别置信度。