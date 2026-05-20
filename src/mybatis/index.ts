/**
 * MyBatis Mapper Support
 *
 * Provides parsing and extraction for MyBatis mapper.xml files.
 */

export {
  isMapperXmlFile,
  parseMapperXml,
  extractTableNamesFromSql,
  type MapperXmlDocument,
  type SqlStatement,
} from './xml-language.js';

export {
  parseMapperFile,
  findMapperFiles,
  parseAllMapperFiles,
  buildTableMapperMap,
  type MapperInfo,
  type MapperStatement,
} from './mapper-parser.js';

export {
  buildLineageEdges,
  buildMapperMethodBindings,
  buildSqlLineage,
  getTableLineage,
  enrichDbContextWithLineage,
  type SqlLineageEdge,
  type MapperMethodBinding,
} from './sql-lineage.js';