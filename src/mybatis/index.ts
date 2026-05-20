/**
 * MyBatis Mapper Support
 *
 * Provides parsing and extraction for MyBatis mapper.xml files.
 */

// Export shared evidence types
export {
  // Core types
  type SqlPart,
  type StatementDraft,
  type SqlFragment,
  type ResultMapDef,
  type MapperDocument,
  type ResolvedStatement,
  // Reference types
  type StatementTableRef,
  type StatementFieldRef,
  // Evidence types
  type EntityEvidence,
  type CallerEvidence,
  type MapperMethodBinding,
  type DbTableEvidenceBundle,
  type GapInfo,
} from './types.js';

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
  type MapperMethodBinding as SqlLineageMapperMethodBinding,
} from './sql-lineage.js';