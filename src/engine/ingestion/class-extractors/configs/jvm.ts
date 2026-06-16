// gitnexus/src/core/ingestion/class-extractors/configs/jvm.ts

import { SupportedLanguages } from '../../../shared/index.js';
import type { ClassExtractionConfig } from '../../class-types.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';

// ---------------------------------------------------------------------------
// Java annotations extraction
// ---------------------------------------------------------------------------

/**
 * 从 JVM 类声明节点提取注解
 * Java 的注解位于 modifiers 子节点中
 */
function extractJvmClassAnnotations(node: SyntaxNode): string[] | undefined {
  const annotations: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && child.type === 'modifiers') {
      for (let j = 0; j < child.namedChildCount; j++) {
        const mod = child.namedChild(j);
        if (mod && (mod.type === 'marker_annotation' || mod.type === 'annotation')) {
          const nameNode = mod.childForFieldName('name') ?? mod.firstNamedChild;
          if (nameNode) annotations.push('@' + nameNode.text);
        }
      }
    }
  }
  return annotations.length > 0 ? annotations : undefined;
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------

export const javaClassConfig: ClassExtractionConfig = {
  language: SupportedLanguages.Java,
  typeDeclarationNodes: [
    'class_declaration',
    'interface_declaration',
    'enum_declaration',
    'record_declaration',
  ],
  fileScopeNodeTypes: ['package_declaration'],
  ancestorScopeNodeTypes: [
    'class_declaration',
    'interface_declaration',
    'enum_declaration',
    'record_declaration',
  ],
  extractAnnotations: extractJvmClassAnnotations,
};

// ---------------------------------------------------------------------------
// Kotlin
// ---------------------------------------------------------------------------

/**
 * 从 Kotlin 类声明节点提取注解
 * Kotlin 的注解也位于 modifiers 子节点中
 */
function extractKotlinClassAnnotations(node: SyntaxNode): string[] | undefined {
  const annotations: string[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && child.type === 'modifiers') {
      for (let j = 0; j < child.namedChildCount; j++) {
        const mod = child.namedChild(j);
        if (mod && mod.type === 'annotation') {
          // Kotlin annotation 结构: @AnnotationName 或 @AnnotationName(...)
          const nameNode = mod.childForFieldName('name') ?? mod.firstNamedChild;
          if (nameNode) annotations.push('@' + nameNode.text);
        }
      }
    }
  }
  return annotations.length > 0 ? annotations : undefined;
}

export const kotlinClassConfig: ClassExtractionConfig = {
  language: SupportedLanguages.Kotlin,
  typeDeclarationNodes: ['class_declaration', 'object_declaration', 'companion_object'],
  fileScopeNodeTypes: ['package_header'],
  ancestorScopeNodeTypes: ['class_declaration', 'object_declaration', 'companion_object'],
  extractType(node) {
    if (node.type !== 'class_declaration') return undefined;
    return node.children.some((child) => child?.text === 'interface') ? 'Interface' : 'Class';
  },
  extractAnnotations: extractKotlinClassAnnotations,
};
