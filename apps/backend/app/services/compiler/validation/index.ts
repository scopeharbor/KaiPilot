/**
 * @aiproj/backend —— Validation Module 入口。
 *
 * 导出所有 Service、类型、接口和工具。
 * 模块遵循 AdonisJS Service 层规范，不依赖 Controller/HTTP/request。
 */

export type { ValidationInputContext, VGateProfile } from './types.js'

export type { EvidenceEntry, EvidenceType, ValidationEvidenceWriter } from './interfaces.js'
export { InMemoryEvidenceWriter } from './interfaces.js'

export { HvRuleRegistry, SeDimensionRegistry, EvaluationProfileService } from './registry/index.js'
export type {
  HvRegistryEntry,
  HvImplementationEntry,
  SeDimensionEntry,
  EvaluationProfile,
} from './registry/index.js'

export { HardValidationSuite, DefaultHvRuleEvaluator, FixtureAdapter } from './hard_suite/index.js'
export type {
  DeterministicInputProvider,
  HvRuleEvaluator,
  FixtureProviderOptions,
} from './hard_suite/index.js'
