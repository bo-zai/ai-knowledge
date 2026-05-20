import type { SliceEvidenceBundle, EvidenceFact } from './types.js';

// 仓库级证据构建
export function buildRepoEvidenceBundle(input: {
  repoPath: string;
  repoName: string;
  techStack?: string[];
  entryPoints?: string[];
  configFiles?: string[];
}): SliceEvidenceBundle {
  const facts: EvidenceFact[] = [
    {
      id: 'F-REPO-001',
      claim: `仓库 ${input.repoName} 位于 ${input.repoPath}`,
      source_kind: 'filesystem',
      refs: [{ file: input.repoPath }],
    },
  ];

  if (input.techStack && input.techStack.length > 0) {
    facts.push({
      id: 'F-REPO-002',
      claim: `技术栈包含: ${input.techStack.join(', ')}`,
      source_kind: 'filesystem',
      refs: [{ file: `${input.repoPath}/package.json` }],
    });
  }

  if (input.entryPoints && input.entryPoints.length > 0) {
    facts.push({
      id: 'F-REPO-003',
      claim: `入口文件: ${input.entryPoints.join(', ')}`,
      source_kind: 'gitnexus',
      refs: input.entryPoints.map((f) => ({ file: f })),
    });
  }

  return {
    slice: {
      id: `repo:${input.repoName}`,
      kind: 'community',
      title: input.repoName,
      scope: input.repoPath,
      seed: input.repoName,
    },
    facts,
    symbols: [],
    relations: [],
    snippets: [],
    tables: [],
    tests: [],
    gaps: [],
  };
}

// 切片级证据构建 - 路由
export function buildRouteSliceEvidence(input: {
  route: string;
  handlerFile: string;
  method: string;
  path: string;
  middleware?: string[];
  responseShape?: Array<{ name: string; type: string }>;
  errorShape?: Array<{ code: string; message: string }>;
  tests?: string[];
}): SliceEvidenceBundle {
  const facts: EvidenceFact[] = [
    {
      id: 'F-ROUTE-001',
      claim: `路由 ${input.method} ${input.path} 由 ${input.handlerFile} 处理`,
      source_kind: 'gitnexus',
      refs: [{ file: input.handlerFile }],
    },
  ];

  if (input.middleware && input.middleware.length > 0) {
    facts.push({
      id: 'F-ROUTE-002',
      claim: `中间件链: ${input.middleware.join(' -> ')}`,
      source_kind: 'gitnexus',
      refs: [{ file: input.handlerFile }],
    });
  }

  const gaps: Array<{ id: string; kind: string; question: string; reason: string }> = [];

  if (!input.responseShape || input.responseShape.length === 0) {
    gaps.push({
      id: 'G-ROUTE-001',
      kind: 'missing-shape',
      question: `路由 ${input.route} 的响应结构是什么？`,
      reason: '无法从代码中提取响应结构',
    });
  }

  return {
    slice: {
      id: `route:${input.route}`,
      kind: 'route',
      title: input.route,
      scope: input.handlerFile,
      seed: input.route,
    },
    facts,
    symbols: [
      {
        id: `S-${input.route}-handler`,
        name: input.handlerFile.split('/').pop() ?? input.handlerFile,
        kind: 'function',
        file: input.handlerFile,
        role: 'handler',
      },
    ],
    relations: [],
    snippets: [],
    tables: [],
    tests: input.tests ?? [],
    gaps,
  };
}

// 切片级证据构建 - 进程
export function buildProcessSliceEvidence(input: {
  processName: string;
  entryFile: string;
  steps: Array<{ order: number; action: string; actor: string; file?: string }>;
  outcomes?: string[];
  errorHandling?: string[];
}): SliceEvidenceBundle {
  const facts: EvidenceFact[] = [
    {
      id: 'F-PROCESS-001',
      claim: `进程 ${input.processName} 从 ${input.entryFile} 开始`,
      source_kind: 'gitnexus',
      refs: [{ file: input.entryFile }],
    },
  ];

  const symbols: Array<{ id: string; name: string; kind: string; file: string; role?: string }> = [];
  const relations: Array<{ type: string; from: string; to: string; reason?: string }> = [];

  // 构建步骤符号和关系
  for (const step of input.steps) {
    if (step.file) {
      symbols.push({
        id: `S-${input.processName}-STEP-${step.order}`,
        name: step.action,
        kind: 'function',
        file: step.file,
        role: `step-${step.order}`,
      });

      if (step.order > 1) {
        const prevStep = input.steps.find((s) => s.order === step.order - 1);
        if (prevStep) {
          relations.push({
            type: 'CALLS',
            from: `S-${input.processName}-STEP-${prevStep.order}`,
            to: `S-${input.processName}-STEP-${step.order}`,
            reason: '进程步骤顺序',
          });
        }
      }
    }
  }

  const gaps: Array<{ id: string; kind: string; question: string; reason: string }> = [];

  if (!input.errorHandling || input.errorHandling.length === 0) {
    gaps.push({
      id: 'G-PROCESS-001',
      kind: 'missing-error-handling',
      question: `进程 ${input.processName} 如何处理错误？`,
      reason: '未发现错误处理代码',
    });
  }

  return {
    slice: {
      id: `process:${input.processName}`,
      kind: 'process',
      title: input.processName,
      scope: input.entryFile,
      seed: input.processName,
    },
    facts,
    symbols,
    relations,
    snippets: [],
    tables: [],
    tests: [],
    gaps,
  };
}

// 切片级证据构建 - 模块/工具
export function buildModuleSliceEvidence(input: {
  moduleName: string;
  filePath: string;
  exports: Array<{ name: string; kind: string }>;
  imports: string[];
  dependsOn?: string[];
  usedBy?: string[];
}): SliceEvidenceBundle {
  const facts: EvidenceFact[] = [
    {
      id: 'F-MOD-001',
      claim: `模块 ${input.moduleName} 定义在 ${input.filePath}`,
      source_kind: 'gitnexus',
      refs: [{ file: input.filePath }],
    },
    {
      id: 'F-MOD-002',
      claim: `导出: ${input.exports.map((e) => e.name).join(', ')}`,
      source_kind: 'gitnexus',
      refs: [{ file: input.filePath }],
    },
  ];

  const symbols = input.exports.map((exp, idx) => ({
    id: `S-${input.moduleName}-EXPORT-${idx}`,
    name: exp.name,
    kind: exp.kind,
    file: input.filePath,
    role: 'export',
  }));

  const relations: Array<{ type: string; from: string; to: string; reason?: string }> = [];

  for (const dep of input.imports) {
    relations.push({
      type: 'IMPORTS',
      from: input.moduleName,
      to: dep,
      reason: '模块依赖',
    });
  }

  return {
    slice: {
      id: `module:${input.moduleName}`,
      kind: 'tool',
      title: input.moduleName,
      scope: input.filePath,
      seed: input.moduleName,
    },
    facts,
    symbols,
    relations,
    snippets: [],
    tables: [],
    tests: [],
    gaps: [],
  };
}

// 切片级证据构建 - 数据库表
export function buildDatabaseSliceEvidence(input: {
  tableName: string;
  schemaName: string;
  sourceFile: string;
  sourceKind: 'ddl' | 'migration' | 'orm' | 'sql' | 'inferred';
  fields: Array<{ name: string; type: string; description?: string; source: 'comment' | 'inferred' }>;
  primaryKey?: string[];
  foreignKeys?: Array<{ field: string; targetTable: string }>;
  readBy?: string[];
  writeBy?: string[];
}): SliceEvidenceBundle {
  const facts: EvidenceFact[] = [
    {
      id: 'F-DB-001',
      claim: `表 ${input.schemaName}.${input.tableName} 存在于 ${input.sourceFile}`,
      source_kind: input.sourceKind,
      refs: [{ file: input.sourceFile }],
    },
  ];

  if (input.primaryKey && input.primaryKey.length > 0) {
    facts.push({
      id: 'F-DB-002',
      claim: `主键: ${input.primaryKey.join(', ')}`,
      source_kind: input.sourceKind,
      refs: [{ file: input.sourceFile }],
    });
  }

  const gaps: Array<{ id: string; kind: string; question: string; reason: string }> = [];

  // 检查是否有 inferred 字段描述
  const inferredFields = input.fields.filter((f) => f.source === 'inferred');
  if (inferredFields.length > 0) {
    gaps.push({
      id: 'G-DB-001',
      kind: 'inferred-description',
      question: `字段 ${inferredFields.map((f) => f.name).join(', ')} 的描述来自推断，需要验证`,
      reason: '缺少源注释',
    });
  }

  return {
    slice: {
      id: `database:${input.tableName}`,
      kind: 'database',
      title: input.tableName,
      scope: `${input.schemaName}.${input.tableName}`,
      seed: input.tableName,
    },
    facts,
    symbols: [],
    relations: input.foreignKeys?.map((fk) => ({
      type: 'FK',
      from: `${input.tableName}.${fk.field}`,
      to: fk.targetTable,
      reason: '外键关系',
    })) ?? [],
    snippets: [],
    tables: [input.tableName],
    tests: [],
    gaps,
  };
}