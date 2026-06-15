import { fileExists, readText } from '../shared/fs.js';
import { logger } from '../shared/logger.js';

/** 模型能力类型 */
export type ModelCapability = 'generation' | 'analysis' | 'refinement';

/** 模型层级类型 */
export type ModelTier = 'premium' | 'economy' | 'local';

/** 单个模型配置 */
export interface MultiModelConfig {
  /** 模型唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** API 基础 URL */
  baseUrl: string;
  /** 模型名称 */
  model: string;
  /** API 密钥（支持环境变量引用 ${ENV_VAR}） */
  apiKey?: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 模型层级 */
  tier?: ModelTier;
  /** 模型能力列表 */
  capabilities?: ModelCapability[];
}

/** 路由规则 */
export interface RoutingRule {
  /** 任务类型 */
  taskType: string;
  /** 偏好的层级 */
  preferredTier?: ModelTier;
  /** 指定模型 ID（优先级最高） */
  preferredModelId?: string;
}

/** 路由配置 */
export interface RoutingConfig {
  /** 默认模型 ID */
  defaultModel?: string;
  /** 备用模型 ID */
  fallbackModel?: string;
  /** 路由规则列表 */
  rules?: RoutingRule[];
}

/** 多模型配置文件结构 */
export interface MultiModelsFile {
  /** 模型列表 */
  models: MultiModelConfig[];
  /** 路由配置 */
  routing?: RoutingConfig;
}

/** 验证后的模型配置（包含解析后的 apiKey） */
export interface ValidatedModelConfig extends MultiModelConfig {
  /** 解析后的 API 密钥 */
  apiKey: string;
  /** 是否有效 */
  isValid: boolean;
  /** 验证错误信息 */
  validationError?: string;
}

/** 环境变量引用正则：${ENV_VAR} */
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** 最小 maxTokens 值 */
const MIN_MAX_TOKENS = 32000;

/** 最大 maxTokens 值 */
const MAX_MAX_TOKENS = 1000000;

/** 默认 maxTokens 值 */
const DEFAULT_MAX_TOKENS = 128000;

/**
 * 解析环境变量引用
 * 支持 ${ENV_VAR} 格式，会从 process.env 中读取
 * 如果环境变量不存在，返回原始值
 */
export function resolveApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    return '';
  }

  // 如果不包含 ${} 格式，直接返回
  if (!apiKey.includes('${')) {
    return apiKey;
  }

  // 使用 replace 替换所有环境变量引用（避免 matchAll 兼容性问题）
  return apiKey.replace(ENV_VAR_PATTERN, (match, envVarName: string) => {
    const envValue = process.env[envVarName];
    if (envValue) {
      return envValue;
    }
    logger.warn(`环境变量 ${envVarName} 未设置，API 密钥可能无效`);
    return match;
  });
}

/**
 * 验证 baseUrl 格式
 */
function validateBaseUrl(baseUrl: string): { valid: boolean; error?: string } {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'baseUrl 不能为空' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'baseUrl 必须以 http:// 或 https:// 开头' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'baseUrl 格式无效' };
  }
}

/**
 * 验证 maxTokens 值
 */
function validateMaxTokens(maxTokens: unknown): number {
  if (maxTokens === undefined || maxTokens === null) {
    return DEFAULT_MAX_TOKENS;
  }

  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens)) {
    logger.warn(`maxTokens 必须是数字，使用默认值 ${DEFAULT_MAX_TOKENS}`);
    return DEFAULT_MAX_TOKENS;
  }

  const clamped = Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Math.floor(maxTokens)));
  if (clamped !== maxTokens) {
    logger.warn(`maxTokens ${maxTokens} 超出范围，调整为 ${clamped}`);
  }
  return clamped;
}

/**
 * 验证单个模型配置
 */
export function validateModelConfig(config: MultiModelConfig): ValidatedModelConfig {
  const errors: string[] = [];

  // 必填字段验证
  if (!config.id?.trim()) {
    errors.push('id 不能为空');
  }

  if (!config.name?.trim()) {
    errors.push('name 不能为空');
  }

  if (!config.model?.trim()) {
    errors.push('model 不能为空');
  }

  // baseUrl 验证
  const baseUrlValidation = validateBaseUrl(config.baseUrl);
  if (!baseUrlValidation.valid) {
    errors.push(baseUrlValidation.error!);
  }

  // apiKey 验证和解析
  const resolvedApiKey = resolveApiKey(config.apiKey);
  if (!resolvedApiKey && config.tier !== 'local') {
    errors.push('apiKey 不能为空（本地模型除外）');
  }

  // maxTokens 验证
  const validMaxTokens = validateMaxTokens(config.maxTokens);

  const isValid = errors.length === 0;

  return {
    ...config,
    apiKey: resolvedApiKey,
    maxTokens: validMaxTokens,
    isValid,
    validationError: isValid ? undefined : errors.join('; '),
  };
}

/**
 * 加载多模型配置文件
 */
export async function loadMultiModelsFile(filePath: string): Promise<MultiModelsFile> {
  if (!(await fileExists(filePath))) {
    logger.warn(`多模型配置文件不存在: ${filePath}`);
    return { models: [] };
  }

  try {
    const content = await readText(filePath);
    const parsed = JSON.parse(content) as MultiModelsFile | null;

    if (!parsed || !Array.isArray(parsed.models)) {
      logger.warn(`配置文件格式无效: ${filePath}`);
      return { models: [] };
    }

    return parsed;
  } catch (error) {
    logger.error(`加载配置文件失败: ${filePath}`, error);
    return { models: [] };
  }
}

/**
 * 获取验证后的模型列表
 */
export function getValidatedModels(configFile: MultiModelsFile): ValidatedModelConfig[] {
  const validated = configFile.models.map(validateModelConfig);

  // 过滤有效模型
  const validModels = validated.filter(m => m.isValid);
  const invalidModels = validated.filter(m => !m.isValid);

  if (invalidModels.length > 0) {
    logger.warn(`有 ${invalidModels.length} 个模型配置无效，已跳过`);
    for (const model of invalidModels) {
      logger.debug(`无效模型 ${model.id}: ${model.validationError}`);
    }
  }

  return validModels;
}

/**
 * 根据任务类型选择模型
 * 选择优先级：指定模型 ID > 偏好层级 > 默认模型
 */
export function selectModelForTask(
  configFile: MultiModelsFile,
  taskType: string,
  validatedModels: ValidatedModelConfig[]
): ValidatedModelConfig | null {
  if (validatedModels.length === 0) {
    logger.warn('没有可用的验证模型');
    return null;
  }

  const routing = configFile.routing;

  // 查找匹配的规则
  const matchedRule = routing?.rules?.find(rule => rule.taskType === taskType);

  // 优先使用指定模型 ID
  if (matchedRule?.preferredModelId) {
    const model = validatedModels.find(m => m.id === matchedRule.preferredModelId);
    if (model) {
      logger.debug(`使用指定模型: ${model.id} (任务类型: ${taskType})`);
      return model;
    }
    logger.warn(`指定模型 ${matchedRule.preferredModelId} 不存在或无效`);
  }

  // 按层级筛选
  const preferredTier = matchedRule?.preferredTier;
  if (preferredTier) {
    const tierModels = validatedModels.filter(m => m.tier === preferredTier);
    if (tierModels.length > 0) {
      logger.debug(`使用层级 ${preferredTier} 的模型: ${tierModels[0].id}`);
      return tierModels[0];
    }
  }

  // 使用默认模型
  if (routing?.defaultModel) {
    const model = validatedModels.find(m => m.id === routing.defaultModel);
    if (model) {
      logger.debug(`使用默认模型: ${model.id}`);
      return model;
    }
  }

  // 返回第一个有效模型
  logger.debug(`使用第一个可用模型: ${validatedModels[0].id}`);
  return validatedModels[0];
}

/**
 * 获取备用模型
 */
export function getFallbackModel(
  configFile: MultiModelsFile,
  validatedModels: ValidatedModelConfig[]
): ValidatedModelConfig | null {
  const fallbackId = configFile.routing?.fallbackModel;
  if (fallbackId) {
    const model = validatedModels.find(m => m.id === fallbackId);
    if (model) {
      return model;
    }
  }

  // 返回最后一个有效模型（通常是最便宜的）
  return validatedModels.length > 1 ? validatedModels[validatedModels.length - 1] : null;
}