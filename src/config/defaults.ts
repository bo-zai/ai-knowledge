/** 设计文档定义的知识库输出目录名 */
export const DEFAULT_KNOWLEDGE_DIR = 'ai-knowledge';

/** 兼容旧命名（已废弃，使用 DEFAULT_KNOWLEDGE_DIR） */
export const DEFAULT_BOOTSTRAP_DIR = DEFAULT_KNOWLEDGE_DIR;

/** 旧实现的默认对象类型（技术视角） */
export const DEFAULT_OBJECT_TYPES = ['TERM', 'CON', 'FLOW', 'MOD', 'OPEN', 'OWN', 'VER', 'DB'] as const;

/** 设计文档定义的知识类型（业务视角） */
export const KNOWLEDGE_TYPES = [
  'CAPABILITY', 'CONCEPT', 'BOUNDARY', 'EXTERNAL',
  'CONSTRAINT', 'RELATION', 'DATA_MODEL', 'WORKFLOW'
] as const;

/** LLM 配置默认值 */
export const LLM_DEFAULTS = {
  // model: 'qianfan-code-latest',
  // baseUrl: 'https://qianfan.baidubce.com/v2/coding',
  // apiKey: 'bce-v3/ALTAKSP-5CKAa1C5W0x1YL18PB6Qv/0716b4539325613116575694d9f83468d230103a',
  // apiKeyEnv: 'BAIDU_API_KEY',  // 环境变量名（可选）
  model: 'MiniMax-M2.7',
  baseUrl: 'https://api.minimaxi.com/v1',
  apiKey: 'sk-cp-hfw7ZO-Bj4MU3zyry-FqPvy2djwjb5UBkKI6gAE_XQO_5aFhQLd0XczpNgZQtE84emIORXehqkNDcRUF_qoO1SrJ8UCxD5YDhE__zIcxBJ4ymFTCC16bKDI',

  concurrency: 1,  // 降低并发数避免速率限制
  timeoutSeconds: 300,  // 5分钟，支持大型实体的知识生成
  maxRetries: 3,
};

/** Agent Runtime 配置默认值 */
export const AGENT_RUNTIME_DEFAULTS = {
  /** 默认上下文窗口大小 */
  defaultContextWindow: 128_000,
  /** 默认最大重试次数 */
  maxRetryAttempts: 3,
  /** 默认超时（秒） */
  timeoutSeconds: 300,
  /** 默认是否启用摘要 */
  enableSummarization: true,
  /** 默认是否启用文件工具 */
  enableFileTools: true,
  /** 默认是否启用写入操作 */
  enableWrite: true,
  /** 默认是否启用 todo list */
  enableTodoList: true,
  /** 默认是否启用 prompt caching */
  enablePromptCaching: true,
  /** 默认路由模式 */
  routingMode: 'auto' as const,
  /** 默认任务来源 */
  taskSource: 'knowledge_generate' as const,
};