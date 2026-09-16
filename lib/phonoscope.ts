/**
 * Phonoscope module compiler — facade. The body lives in lib/phonoscope/; this
 * file keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3).
 *
 *   phonoscope/types.ts            manifest, setting and compiled-module shapes
 *   phonoscope/constants.ts        engine version, id patterns, limits, core
 *                                  palette slots, the built-in module YAML
 *   phonoscope/expression.ts       the `=expr` tokenizer and bytecode compiler
 *   phonoscope/normalize-model.ts  boundary, settings and palette-slot validation
 *   phonoscope/compile.ts          compilePhonoscopeModule / Yaml, stable JSON
 */
export type {
  PhonoscopeBoundaryMode,
  PhonoscopeCompiledExpression,
  PhonoscopeCompiledModule,
  PhonoscopeCompileResult,
  PhonoscopeControlCurve,
  PhonoscopeControlOption,
  PhonoscopeControlType,
  PhonoscopeInstruction,
  PhonoscopeModuleSummary,
  PhonoscopePaletteSlot,
  PhonoscopeSetting,
} from "./phonoscope/types";
export {
  BUILTIN_PHONOSCOPE_MODULE_YAML,
  PHONOSCOPE_CORE_PALETTE_SLOTS,
  PHONOSCOPE_ENGINE_VERSION,
  PHONOSCOPE_LIMITS,
  PHONOSCOPE_MODULE_ID,
  PHONOSCOPE_MODULE_VERSION,
  PHONOSCOPE_PACKAGE_NAME,
} from "./phonoscope/constants";
export { compilePhonoscopeExpression } from "./phonoscope/expression";
export { compilePhonoscopeModule, compilePhonoscopeYaml, stablePhonoscopeJson } from "./phonoscope/compile";
