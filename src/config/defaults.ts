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
  model: 'qianfan-code-latest',
  baseUrl: 'https://qianfan.baidubce.com/v2/coding',
  apiKey: 'bce-v3/ALTAKSP-5CKAa1C5W0x1YL18PB6Qv/0716b4539325613116575694d9f83468d230103a',
  apiKeyEnv: 'BAIDU_API_KEY',  // 环境变量名（可选）

  concurrency: 1,  // 降低并发数避免速率限制
  timeoutSeconds: 120,
  maxRetries: 3,
};