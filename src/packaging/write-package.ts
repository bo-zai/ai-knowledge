import { ensureDir, removeDir, writeText } from '../shared/fs.js';
import YAML from 'yaml';
import { getDirForType } from '../knowledge/type-directory-map.js';

export async function writePackage(input: {
  repoPath: string;
  bootstrapDir: string;
  manifest: unknown;
  catalog: unknown;
  objects: Array<{ id: string; type: string; content: string }>;
}): Promise<void> {
  const basePath = `${input.repoPath}/${input.bootstrapDir}`;

  // 全量重建，避免旧对象残留污染当前结果
  try {
    await removeDir(basePath);
  } catch {
    // Windows 上真实仓库目录可能被索引器或编辑器短暂占用。
    // 这里退化为原地覆盖，保证本次生成不会因为目录锁直接失败。
  }

  // 创建目录结构
  await ensureDir(basePath);
  await ensureDir(`${basePath}/objects`);
  await ensureDir(`${basePath}/.internal/reports`);

  // 创建对象类型子目录
  const typeDirs = ['terms', 'contracts', 'flows', 'modules', 'open', 'ownership', 'validation', 'db'];
  for (const dir of typeDirs) {
    await ensureDir(`${basePath}/objects/${dir}`);
  }

  // 写入 manifest
  await writeText(`${basePath}/manifest.yaml`, YAML.stringify(input.manifest));

  // 写入 catalog
  await writeText(`${basePath}/catalog.yaml`, YAML.stringify(input.catalog));

  // 写入对象文件
  for (const object of input.objects) {
    const typeDir = getDirForType(object.type as any);
    await writeText(`${basePath}/objects/${typeDir}/${object.id}.md`, object.content);
  }
}
