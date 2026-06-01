/**
 * 快速检查 music-education-admin 的业务发现 + 证据
 * 不依赖 LLM，只做 discovery + evidence bundle 输出
 */
import { discoverCapabilities } from '../src/slicing/capability-discovery.js';
import { buildEvidenceBundle } from '../src/evidence/capability-evidence-builder.js';
import { inspect } from 'util';

const repoRoot = process.argv[2] ?? 'D:/workspace/other_project/music-education-admin';
const targetTerms = process.argv.slice(3).filter(Boolean);

console.log('=== 发现阶段 ===');
const candidates = await discoverCapabilities({ repoRoot, targetTerms, targetPaths: [] });

console.log(`发现 ${candidates.length} 个候选能力\n`);

if (candidates.length === 0) {
  console.log('无候选');
  process.exit(0);
}

const top = candidates.sort((a, b) => b.confidence - a.confidence)[0];
console.log('最高置信度候选:', top.candidateId, `conf=${top.confidence}`);
console.log('  名称候选:', top.nameCandidates);
console.log('  相关术语:', top.relatedTerms);
console.log('  入口点:', top.primaryEntryPoints.length);
console.log('  行为锚点:', top.behaviorAnchors.length);
console.log('  数据锚点:', top.dataAnchors.length);
console.log('  测试锚点:', top.testAnchors.length);
console.log('  文档锚点:', top.docAnchors.length);
console.log('  模块簇:', top.moduleClusters.length);
console.log('  风险:', top.risks);
console.log('  缺失信号:', top.missingSignals);

console.log('\n=== 证据包 ===');
const bundle = buildEvidenceBundle(top, 'music-education-admin');

for (const section of [
  ['entryPoints', bundle.entryPoints],
  ['flowTraces', bundle.flowTraces],
  ['behaviorSlices', bundle.behaviorSlices],
  ['dataContracts', bundle.dataContracts],
  ['moduleSurfaces', bundle.moduleSurfaces],
  ['validationAnchors', bundle.validationAnchors],
  ['docs', bundle.docs],
] as const) {
  const [name, items] = section;
  if (items.length > 0) {
    console.log(`\n--- ${name} (${items.length}) ---`);
    for (const item of items.slice(0, 5)) {
      console.log('  ' + inspect(item, { depth: 2, colors: true, maxStringLength: 120 }));
    }
    if (items.length > 5) console.log(`  ... 还有 ${items.length - 5} 项`);
  }
}
