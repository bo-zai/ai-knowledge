import fs from 'fs/promises';
import path from 'path';
import type { CapabilityCandidate, EntrySignal, BehaviorSignal, DataSignal, TestSignal, DocSignal, ModuleCluster } from './capability-candidate-schema.js';

const DOMAIN_PHRASES = [
  'db object',
  'knowledge object',
  'description source',
  'mybatis mapper',
  'sql evidence',
  'field description',
  'bootstrap knowledge',
  'evidence bundle',
  'capability candidate',
  'knowledge generation',
];

export type DiscoverCapabilitiesInput = {
  repoRoot: string;
  targetTerms?: string[];
  targetPaths?: string[];
};

export function normalizeCapabilityTerms(input: string): string[] {
  let normalized = input;
  // 先处理 domain phrases
  const foundPhrases: string[] = [];
  for (const phrase of DOMAIN_PHRASES) {
    const regex = new RegExp(phrase, 'gi');
    if (regex.test(normalized)) {
      foundPhrases.push(phrase);
      normalized = normalized.replace(regex, ' ');
    }
  }

  // 拆分 camelCase 和 PascalCase
  normalized = normalized.replace(/([a-z])([A-Z])/g, '$1 $2');
  normalized = normalized.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // 拆分 kebab-case 和 snake_case
  normalized = normalized.replace(/[-_]/g, ' ');

  // 分词并转小写
  const words = normalized
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 0);

  // 合并去重
  const allTerms = [...new Set([...foundPhrases, ...words])];
  return allTerms;
}

async function scanDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await scanDirectory(fullPath));
      } else if (entry.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch {
    // 目录不存在或无法访问
  }
  return files;
}

function computeConfidence(
  entrySignal: number,
  behaviorSignal: number,
  dataSignal: number,
  testSignal: number,
  docSignal: number,
  graphCohesion: number,
): number {
  return (
    entrySignal * 0.25 +
    behaviorSignal * 0.20 +
    dataSignal * 0.20 +
    testSignal * 0.15 +
    docSignal * 0.05 +
    graphCohesion * 0.15
  );
}

async function analyzeModuleClusters(targetPaths: string[], repoRoot: string): Promise<ModuleCluster[]> {
  const clusters: ModuleCluster[] = [];
  for (const targetPath of targetPaths) {
    const fullPath = path.resolve(repoRoot, targetPath);
    const files = await scanDirectory(fullPath);
    if (files.length > 0) {
      const moduleNames = files.map(f => path.basename(f, path.extname(f)));
      clusters.push({
        rootPath: targetPath,
        moduleNames: [...new Set(moduleNames)],
        cohesionScore: 0.75, // MVP: 使用固定值
      });
    }
  }
  return clusters;
}

async function collectBehaviorSignals(targetPaths: string[], repoRoot: string): Promise<BehaviorSignal[]> {
  const signals: BehaviorSignal[] = [];
  for (const targetPath of targetPaths) {
    const fullPath = path.resolve(repoRoot, targetPath);
    const files = await scanDirectory(fullPath);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8').catch(() => '');
      const lines = content.split('\n');
      for (const line of lines) {
        const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        if (funcMatch) {
          const name = funcMatch[1];
          const terms = normalizeCapabilityTerms(name);
          signals.push({
            location: path.relative(repoRoot, file),
            verb: terms[0] || name,
            object: terms.slice(1).join(' ') || name,
          });
        }
      }
    }
  }
  return signals;
}

async function collectDataSignals(targetPaths: string[], repoRoot: string): Promise<DataSignal[]> {
  const signals: DataSignal[] = [];
  for (const targetPath of targetPaths) {
    const fullPath = path.resolve(repoRoot, targetPath);
    const files = await scanDirectory(fullPath);
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8').catch(() => '');
      const lines = content.split('\n');
      for (const line of lines) {
        const typeMatch = line.match(/(?:export\s+)?(?:interface|type)\s+(\w+)/);
        if (typeMatch) {
          signals.push({
            kind: 'type',
            location: path.relative(repoRoot, file),
            name: typeMatch[1],
          });
        }
      }
    }
  }
  return signals;
}

async function collectTestSignals(repoRoot: string): Promise<TestSignal[]> {
  const signals: TestSignal[] = [];
  const testDirs = ['tests', 'test'];
  for (const testDir of testDirs) {
    const files = await scanDirectory(path.join(repoRoot, testDir));
    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8').catch(() => '');
      const lines = content.split('\n');
      for (const line of lines) {
        const testMatch = line.match(/(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)/);
        if (testMatch) {
          signals.push({
            location: path.relative(repoRoot, file),
            testName: testMatch[1],
          });
        }
      }
    }
  }
  return signals;
}

export async function discoverCapabilities(input: DiscoverCapabilitiesInput): Promise<CapabilityCandidate[]> {
  const { repoRoot, targetTerms = [], targetPaths = [] } = input;

  if (targetTerms.length === 0 && targetPaths.length === 0) {
    return [];
  }

  const candidates: CapabilityCandidate[] = [];

  // 收集信号
  const behaviorAnchors = await collectBehaviorSignals(targetPaths, repoRoot);
  const dataAnchors = await collectDataSignals(targetPaths, repoRoot);
  const testAnchors = await collectTestSignals(repoRoot);
  const moduleClusters = await analyzeModuleClusters(targetPaths, repoRoot);

  // 计算 confidence breakdown
  const entrySignal = targetPaths.length > 0 ? 0.75 : 0.5;
  const behaviorSignal = behaviorAnchors.length > 5 ? 0.85 : behaviorAnchors.length > 0 ? 0.6 : 0.3;
  const dataSignal = dataAnchors.length > 3 ? 0.9 : dataAnchors.length > 0 ? 0.6 : 0.3;
  const testSignal = testAnchors.length > 5 ? 0.75 : testAnchors.length > 0 ? 0.5 : 0.2;
  const docSignal = 0.4; // MVP: 使用固定值
  const graphCohesion = moduleClusters.length > 1 ? 0.75 : 0.5;

  const confidence = computeConfidence(entrySignal, behaviorSignal, dataSignal, testSignal, docSignal, graphCohesion);

  // 生成候选名称
  const nameCandidates: string[] = [];
  const relatedTerms: string[] = [...targetTerms];

  // 从 target terms 合并 domain phrases
  for (const term of targetTerms) {
    const normalized = normalizeCapabilityTerms(term);
    relatedTerms.push(...normalized);
  }

  // 尝试组合名称
  if (targetTerms.includes('db') && targetTerms.includes('knowledge')) {
    nameCandidates.push('DB knowledge generation');
    if (!relatedTerms.includes('db object')) {
      relatedTerms.push('db object');
    }
  }
  if (targetTerms.includes('mybatis')) {
    nameCandidates.push('MyBatis evidence processing');
    if (!relatedTerms.includes('mybatis mapper')) {
      relatedTerms.push('mybatis mapper');
    }
  }

  // 如果没有匹配，使用通用名称
  if (nameCandidates.length === 0) {
    nameCandidates.push(targetTerms.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ') + ' capability');
  }

  // 构建候选
  const candidate: CapabilityCandidate = {
    candidateId: `CAND-${targetTerms.map(t => t.toUpperCase()).join('-')}`,
    nameCandidates,
    confidence,
    confidenceBreakdown: {
      entrySignal,
      behaviorSignal,
      dataSignal,
      testSignal,
      docSignal,
      graphCohesion,
    },
    primaryEntryPoints: [],
    behaviorAnchors,
    dataAnchors,
    testAnchors,
    docAnchors: [],
    moduleClusters,
    relatedTerms: [...new Set(relatedTerms)],
    risks: ['no_external_boundary_found'],
    missingSignals: ['No explicit external DB ownership contract found'],
  };

  // 只返回置信度 >= 0.55 的候选
  if (candidate.confidence >= 0.55) {
    candidates.push(candidate);
  }

  return candidates;
}
