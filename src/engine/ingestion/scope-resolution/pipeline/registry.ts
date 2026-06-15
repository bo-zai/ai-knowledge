/**
 * Per-language `ScopeResolver` registry — the lookup the generic
 * `scopeResolutionPhase` uses to pick the right resolver for each
 * migrated language.
 *
 * Adding a language is one line: implement a `ScopeResolver` in
 * `languages/<lang>/scope-resolver.ts` and register it here. The
 * phase picks it up automatically — no workflow changes, no
 * per-language pipeline phase file.
 *
 * 已移植语言: Python, CSharp, TypeScript, Go, Java, JavaScript, Kotlin
 * 待移植语言: Ruby, Rust, Swift, Dart, PHP, Vue, C, C++, COBOL (需要额外依赖)
 */

import { SupportedLanguages } from '../../../shared/index.js';
import type { ScopeResolver } from '../contract/scope-resolver.js';
import { pythonScopeResolver } from '../../languages/python/scope-resolver.js';
import { csharpScopeResolver } from '../../languages/csharp/scope-resolver.js';
import { typescriptScopeResolver } from '../../languages/typescript/scope-resolver.js';
import { goScopeResolver } from '../../languages/go/scope-resolver.js';
import { javaScopeResolver } from '../../languages/java/scope-resolver.js';
import { javascriptScopeResolver } from '../../languages/javascript/scope-resolver.js';
import { kotlinScopeResolver } from '../../languages/kotlin/scope-resolver.js';

/** Map of `SupportedLanguages` → `ScopeResolver`. The scope-resolution phase
 *  iterates this map directly — every registered resolver runs. This is the
 *  single source of truth for which languages resolve via scope-resolution. */
export const SCOPE_RESOLVERS: ReadonlyMap<SupportedLanguages, ScopeResolver> = new Map<
  SupportedLanguages,
  ScopeResolver
>([
  [SupportedLanguages.Python, pythonScopeResolver],
  [SupportedLanguages.CSharp, csharpScopeResolver],
  [SupportedLanguages.TypeScript, typescriptScopeResolver],
  [SupportedLanguages.Go, goScopeResolver],
  [SupportedLanguages.Java, javaScopeResolver],
  [SupportedLanguages.JavaScript, javascriptScopeResolver],
  [SupportedLanguages.Kotlin, kotlinScopeResolver],
]);