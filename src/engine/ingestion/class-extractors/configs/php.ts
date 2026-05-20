// gitnexus/src/core/ingestion/class-extractors/configs/php.ts

import { SupportedLanguages } from '../../../shared/index.js';
import type { ClassExtractionConfig } from '../../class-types.js';

export const phpClassConfig: ClassExtractionConfig = {
  language: SupportedLanguages.PHP,
  typeDeclarationNodes: ['class_declaration', 'interface_declaration', 'enum_declaration'],
  ancestorScopeNodeTypes: ['namespace_definition'],
};
