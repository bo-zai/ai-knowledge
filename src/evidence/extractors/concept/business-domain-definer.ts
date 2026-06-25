/**
 * 业务域定义器
 *
 * 根据表锚点和候选定义业务域边界。
 *
 * 功能：
 * - 跨模块表 -> 跨模块业务域
 * - 单模块表 -> 单模块业务域
 * - 表关联 -> 业务域合并
 */

import type {
  TableAnchor,
  ConceptCandidate,
  BusinessDomain,
  GitCommitEvidence,
  RelatedTableInfo,
} from "./types.js";

/**
 * 业务域定义器配置
 */
export interface BusinessDomainDefinerConfig {
  /** 关联强度阈值（低于此值不合并域） */
  mergeThreshold?: number;
  /** 是否自动推断域名称 */
  inferDomainName?: boolean;
}

/**
 * 业务域定义器实现
 */
export class BusinessDomainDefinerImpl {
  private readonly config: Required<BusinessDomainDefinerConfig>;

  constructor(config?: BusinessDomainDefinerConfig) {
    this.config = {
      mergeThreshold: config?.mergeThreshold ?? 0.5,
      inferDomainName: config?.inferDomainName ?? true,
    };
  }

  /**
   * 定义业务域
   *
   * @param tableAnchors - 表锚点列表
   * @param candidates - 概念候选列表
   * @returns 业务域列表
   */
  async define(
    tableAnchors: TableAnchor[],
    candidates: ConceptCandidate[],
  ): Promise<BusinessDomain[]> {
    // 1. 为每个表锚点创建初始业务域
    const initialDomains = this.createInitialDomains(tableAnchors, candidates);

    // 2. 根据表关联关系合并业务域
    const mergedDomains = this.mergeDomainsByRelation(
      initialDomains,
      tableAnchors,
    );

    // 3. 补充域名称和模块信息
    const finalizedDomains = this.finalizeDomains(mergedDomains);

    return finalizedDomains;
  }

  /**
   * 为每个表锚点创建初始业务域
   *
   * 每个表锚点对应一个初始域
   */
  private createInitialDomains(
    tableAnchors: TableAnchor[],
    candidates: ConceptCandidate[],
  ): Map<string, BusinessDomain> {
    const domainMap = new Map<string, BusinessDomain>();

    for (const anchor of tableAnchors) {
      const domainId = `domain-${anchor.tableName}`;

      // 获取与该表相关的候选
      const relatedCandidates = candidates.filter(
        (c) => c.tableAnchor.tableName === anchor.tableName,
      );

      // 合并所有候选的 Git commit 信息
      const allCommits = this.mergeGitCommits(relatedCandidates);

      // 构建覆盖模块信息
      const coveredModules = this.buildCoveredModules(anchor);

      domainMap.set(domainId, {
        domainId,
        domainName: this.inferDomainName(anchor.tableName),
        coreTables: [anchor],
        relatedTables: [],
        coveredModules,
        isCrossModuleDomain: anchor.isCrossModule,
        candidates: relatedCandidates,
        gitCommits: allCommits,
      });
    }

    return domainMap;
  }

  /**
   * 根据表关联关系合并业务域
   *
   * 如果两个表有强关联（关联置信度超过阈值），合并它们的业务域
   */
  private mergeDomainsByRelation(
    domainMap: Map<string, BusinessDomain>,
    tableAnchors: TableAnchor[],
  ): Map<string, BusinessDomain> {
    // 构建表名到锚点的映射
    const anchorMap = new Map<string, TableAnchor>();
    for (const anchor of tableAnchors) {
      anchorMap.set(anchor.tableName, anchor);
    }

    // 构建表名到域的映射
    const tableToDomain = new Map<string, string>();
    for (const [domainId, domain] of domainMap) {
      for (const table of domain.coreTables) {
        tableToDomain.set(table.tableName, domainId);
      }
    }

    // 分析关联关系，找出需要合并的域
    const mergeGroups: string[][] = [];
    const processedTables = new Set<string>();

    for (const anchor of tableAnchors) {
      if (processedTables.has(anchor.tableName)) {
        continue;
      }

      // 查找强关联的表
      const stronglyRelatedTables = this.findStronglyRelatedTables(
        anchor,
        anchorMap,
        this.config.mergeThreshold,
      );

      if (stronglyRelatedTables.length > 0) {
        // 创建合并组
        const group = [anchor.tableName, ...stronglyRelatedTables];
        mergeGroups.push(group);

        // 标记为已处理
        group.forEach((t) => processedTables.add(t));
      } else {
        // 单独的表，标记为已处理
        processedTables.add(anchor.tableName);
      }
    }

    // 执行合并
    for (const group of mergeGroups) {
      if (group.length > 1) {
        this.mergeDomainGroup(group, domainMap, tableToDomain, anchorMap);
      }
    }

    return domainMap;
  }

  /**
   * 找出与指定表强关联的表列表
   *
   * 关联置信度超过阈值的表
   */
  private findStronglyRelatedTables(
    anchor: TableAnchor,
    anchorMap: Map<string, TableAnchor>,
    threshold: number,
  ): string[] {
    const relatedTables: string[] = [];

    if (!anchor.relatedTables) {
      return relatedTables;
    }

    for (const related of anchor.relatedTables) {
      // 检查关联置信度
      if (related.confidence >= threshold) {
        // 检查目标表是否也在锚点列表中（已发现的表）
        if (anchorMap.has(related.tableName)) {
          relatedTables.push(related.tableName);
        }
      }
    }

    return relatedTables;
  }

  /**
   * 合并一组表对应的业务域
   *
   * 将多个表合并到第一个表对应的域中
   */
  private mergeDomainGroup(
    tableGroup: string[],
    domainMap: Map<string, BusinessDomain>,
    tableToDomain: Map<string, string>,
    anchorMap: Map<string, TableAnchor>,
  ): void {
    // 获取第一个表的域作为主域
    const primaryTable = tableGroup[0];
    const primaryDomainId = tableToDomain.get(primaryTable);
    if (!primaryDomainId) {
      return;
    }

    const primaryDomain = domainMap.get(primaryDomainId);
    if (!primaryDomain) {
      return;
    }

    // 合并其他表
    for (let i = 1; i < tableGroup.length; i++) {
      const table = tableGroup[i];
      const domainId = tableToDomain.get(table);

      if (!domainId || domainId === primaryDomainId) {
        continue;
      }

      const otherDomain = domainMap.get(domainId);
      if (!otherDomain) {
        continue;
      }

      // 合并核心表
      primaryDomain.coreTables.push(...otherDomain.coreTables);

      // 合并候选
      primaryDomain.candidates.push(...otherDomain.candidates);

      // 合并 Git commit
      primaryDomain.gitCommits.push(...otherDomain.gitCommits);

      // 合并覆盖模块
      for (const module of otherDomain.coveredModules) {
        // 去重添加
        if (
          !primaryDomain.coveredModules.some(
            (m) => m.moduleName === module.moduleName,
          )
        ) {
          primaryDomain.coveredModules.push(module);
        }
      }

      // 更新跨模块标记
      primaryDomain.isCrossModuleDomain =
        primaryDomain.isCrossModuleDomain || otherDomain.isCrossModuleDomain;

      // 移除被合并的域
      domainMap.delete(domainId);

      // 更新表到域的映射
      tableToDomain.set(table, primaryDomainId);
    }

    // 重新计算相关表列表
    const allCoreTables = new Set(
      primaryDomain.coreTables.map((t) => t.tableName),
    );
    primaryDomain.relatedTables = [];

    for (const coreTable of primaryDomain.coreTables) {
      const anchor = anchorMap.get(coreTable.tableName);
      if (anchor?.relatedTables) {
        for (const related of anchor.relatedTables) {
          // 相关表不在核心表列表中才添加
          if (!allCoreTables.has(related.tableName)) {
            primaryDomain.relatedTables.push(
              anchorMap.get(related.tableName) ||
                ({
                  tableName: related.tableName,
                  columns: [],
                  traceSources: [],
                  isCrossModule: false,
                  moduleCount: 0,
                  moduleNames: [],
                  aggregatedConfidence: 0,
                } as TableAnchor),
            );
          }
        }
      }
    }
  }

  /**
   * 补充域名称和模块信息
   *
   * 为每个域生成最终的业务域名称
   */
  private finalizeDomains(
    domainMap: Map<string, BusinessDomain>,
  ): BusinessDomain[] {
    const domains: BusinessDomain[] = [];

    for (const domain of domainMap.values()) {
      // 根据核心表推断域名称
      domain.domainName = this.generateDomainName(domain);

      // 对覆盖模块排序（primary 在前）
      domain.coveredModules.sort((a, b) => {
        if (a.role === "primary" && b.role !== "primary") return -1;
        if (a.role !== "primary" && b.role === "primary") return 1;
        return b.entryPointCount - a.entryPointCount;
      });

      // 对 Git commit 按相关度排序
      domain.gitCommits.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // 限制 commit 数量（最多 10 条）
      domain.gitCommits = domain.gitCommits.slice(0, 10);

      domains.push(domain);
    }

    return domains;
  }

  /**
   * 合并多个候选的 Git commit 信息
   *
   * 去重并按相关度排序
   */
  private mergeGitCommits(candidates: ConceptCandidate[]): GitCommitEvidence[] {
    const commitMap = new Map<string, GitCommitEvidence>();

    for (const candidate of candidates) {
      for (const commit of candidate.gitCommits) {
        // 去重：使用 commit hash 作为唯一标识
        const existing = commitMap.get(commit.commitHash);
        if (existing) {
          // 合并变更文件列表
          existing.changedFiles.push(...commit.changedFiles);
          // 更新相关度（取最大值）
          existing.relevanceScore = Math.max(
            existing.relevanceScore,
            commit.relevanceScore,
          );
        } else {
          commitMap.set(commit.commitHash, commit);
        }
      }
    }

    // 按相关度排序
    return [...commitMap.values()]
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 10);
  }

  /**
   * 构建覆盖模块信息
   *
   * 从表锚点的 traceSources 提取模块信息
   */
  private buildCoveredModules(
    anchor: TableAnchor,
  ): BusinessDomain["coveredModules"] {
    const modules: BusinessDomain["coveredModules"] = [];
    const processedModules = new Set<string>();

    // 收集所有涉及模块
    for (let i = 0; i < anchor.traceSources.length; i++) {
      const source = anchor.traceSources[i];
      const moduleName = source.moduleName;

      if (processedModules.has(moduleName)) {
        continue;
      }

      processedModules.add(moduleName);

      // 第一个模块为主模块，其他为辅助模块
      const role = i === 0 ? "primary" : "supporting";

      modules.push({
        moduleName,
        modulePath: source.modulePath,
        role,
        entryPointCount: source.entryPoints.length,
      });
    }

    return modules;
  }

  /**
   * 推断业务域名称
   *
   * 从表名推断业务域名称
   */
  private inferDomainName(tableName: string): string {
    // 去除常见后缀
    const baseName = tableName.replace(
      /_(?:order|info|detail|record|log|config|setting|data)$/i,
      "",
    );

    // 转换为中文描述
    // snake_case -> 中文描述
    const parts = baseName.split("_");

    // 仅作为通用兜底词典，优先依赖仓库自身证据而非预置行业词。
    const nameMap: Record<string, string> = {
      // === 电商领域 ===
      brand: "品牌",
      cart: "购物车",
      category: "分类",
      coupon: "优惠券",
      delivery: "配送",
      distributor: "分销商",
      flash: "闪购",
      inventory: "库存",
      order: "订单",
      product: "商品",
      promotion: "促销",
      refund: "退款",
      retailer: "零售商",
      return: "退货",
      review: "评价",
      shipping: "发货",
      sku: "规格",
      spec: "规格",
      stock: "库存",
      supplier: "供应商",
      warehouse: "仓库",
      wishlist: "心愿单",
      // === 教育领域 ===
      assignment: "作业",
      certificate: "证书",
      chapter: "章节",
      classroom: "教室",
      course: "课程",
      curriculum: "课程体系",
      diploma: "毕业证",
      enrollment: "报名",
      exam: "考试",
      grade: "成绩",
      homework: "家庭作业",
      lesson: "课时",
      quiz: "测验",
      schedule: "课表",
      scholarship: "奖学金",
      score: "分数",
      section: "小节",
      semester: "学期",
      student: "学生",
      syllabus: "教学大纲",
      teacher: "教师",
      tuition: "学费",
      // === 金融领域 ===
      account: "账户",
      asset: "资产",
      audit: "审计",
      balance: "余额",
      bill: "账单",
      budget: "预算",
      charge: "收费",
      credit: "信用",
      debit: "借记",
      deposit: "存款",
      equity: "权益",
      expense: "支出",
      fee: "手续费",
      interest: "利息",
      invoice: "发票",
      liability: "负债",
      loan: "贷款",
      loss: "亏损",
      payment: "支付",
      profit: "利润",
      rate: "费率",
      receipt: "收据",
      revenue: "收入",
      tax: "税务",
      transaction: "交易",
      withdraw: "取款",
      // === 医疗领域 ===
      appointment: "预约",
      claim: "理赔",
      clinic: "诊所",
      diagnosis: "诊断",
      doctor: "医生",
      hospital: "医院",
      insurance: "保险",
      medication: "药物",
      nurse: "护士",
      patient: "患者",
      pharmacy: "药房",
      prescription: "处方",
      record: "病历",
      report: "报告",
      surgery: "手术",
      treatment: "治疗",
      // === 物流领域 ===
      carrier: "承运商",
      clearance: "清关",
      container: "集装箱",
      customs: "海关",
      dispatch: "调度",
      freight: "运费",
      manifest: "货运单",
      package: "包裹",
      pallet: "托盘",
      parcel: "包裹",
      port: "港口",
      receive: "收货",
      route: "路线",
      shipment: "货物",
      terminal: "终端",
      tracking: "追踪",
      transfer: "转运",
      // === 通用业务 ===
      address: "地址",
      analytics: "分析",
      backup: "备份",
      chat: "聊天",
      comment: "评论",
      config: "配置",
      dashboard: "仪表盘",
      export: "导出",
      feedback: "反馈",
      filter: "筛选",
      import: "导入",
      label: "标签",
      log: "日志",
      member: "会员",
      message: "消息",
      metric: "指标",
      notification: "通知",
      paginate: "分页",
      rating: "评分",
      restore: "恢复",
      search: "搜索",
      setting: "设置",
      sort: "排序",
      statistic: "统计",
      sync: "同步",
      tag: "标签",
      user: "用户",
    };

    // 拼接名称
    const chineseParts = parts.map((part) => {
      const lower = part.toLowerCase();
      return nameMap[lower] || this.capitalizeFirst(part);
    });

    return `${chineseParts.join("")}管理域`;
  }

  /**
   * 为业务域生成名称
   *
   * 如果域包含多个表，使用主表名称或组合名称
   */
  private generateDomainName(domain: BusinessDomain): string {
    if (domain.coreTables.length === 1) {
      return this.inferDomainName(domain.coreTables[0].tableName);
    }

    // 多表域：使用主表名称 + "聚合域"
    const primaryTable = domain.coreTables[0].tableName;
    const baseName = this.inferDomainName(primaryTable).replace("管理域", "");

    // 如果涉及跨模块，添加标记
    if (domain.isCrossModuleDomain) {
      return `${baseName}跨模块聚合域`;
    }

    return `${baseName}聚合域`;
  }

  /**
   * 首字母大写
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
}

/**
 * 创建业务域定义器实例
 */
export function createBusinessDomainDefiner(
  config?: BusinessDomainDefinerConfig,
): BusinessDomainDefinerImpl {
  return new BusinessDomainDefinerImpl(config);
}
