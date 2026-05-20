import { parseMapperFile } from '../src/mybatis/mapper-parser.ts';

async function main() {
  const mapper = await parseMapperFile('D:/workspace/other_project/music-education-admin/src/main/resources/mappers/CategoryMapper.xml');
  console.log('Mapper parsed:');
  console.log('namespace:', mapper?.namespace);
  console.log('statements count:', mapper?.statements.length);
  console.log('statements:', mapper?.statements.map(s => ({ id: s.id, type: s.type, includeRefs: s.includeRefs, resultType: s.resultType, resultMap: s.resultMap })));
  console.log('resultMaps count:', mapper?.resultMaps.length);
  console.log('resultMaps:', mapper?.resultMaps.map(r => ({ id: r.id, type: r.type, mappingCount: r.mappings.length })));
  console.log('sqlFragments count:', mapper?.sqlFragments.length);
  console.log('sqlFragments:', mapper?.sqlFragments.map(f => ({ id: f.id, partsCount: f.rawSqlParts.length })));
}

main().catch(console.error);