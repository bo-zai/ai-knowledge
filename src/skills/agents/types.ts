/**
 * Agent 接口定义
 *
 * 每个 AI Agent 需实现此接口，定义 skill 文件的输出位置和格式
 */

/**
 * Agent 接口
 */
export interface Agent {
  /** Agent 名称（用于日志和识别） */
  name: string;

  /** Agent 标识符（用于命令行参数） */
  id: string;

  /**
   * 获取 skill 目录路径
   * @param repoPath 项目根目录
   * @returns skill 目录的绝对路径
   */
  getSkillDir(repoPath: string): string;

  /**
   * 检查 skill 是否已初始化
   * @param repoPath 项目根目录
   * @returns true 表示已初始化
   */
  isInitialized(repoPath: string): Promise<boolean>;

  /**
   * 初始化 skill 目录结构
   * @param config 初始化配置
   * @returns 初始化结果
   */
  initialize(config: SkillInitConfig): Promise<SkillInitResult>;

  /**
   * 生成 AGENTS.md 内容（如果需要）
   * @param repoPath 项目根目录
   * @returns AGENTS.md 内容，如果不需要则返回 null
   */
  generateAgentsMd?(repoPath: string): Promise<string | null>;
}

/**
 * Skill 初始化配置
 */
export interface SkillInitConfig {
  /** 项目根目录 */
  repoPath: string;

  /** 是否强制重新初始化 */
  force?: boolean;

  /** 是否更新 AGENTS.md */
  updateAgentsMd?: boolean;

  /** 是否 verbose 输出 */
  verbose?: boolean;
}

/**
 * Skill 初始化结果
 */
export interface SkillInitResult {
  /** Agent 名称 */
  agentName: string;

  /** Skill 目录路径 */
  skillDir: string;

  /** 已创建的文件 */
  files: SkillFile[];

  /** 是否成功 */
  success: boolean;

  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * Skill 文件信息
 */
export interface SkillFile {
  /** skill 名称（kebab-case） */
  name: string;

  /** skill 文件名 */
  filename: string;

  /** skill 内容 */
  content: string;
}