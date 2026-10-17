/**
 * Deterministic Engine —— 模块入口。
 *
 * 导出所有 service 实现和工具。
 *
 * @aiproj/backend
 */

export { GraphValidator } from './graph_validator.js'
export { ScheduleEngine } from './schedule_engine.js'
export { CriticalPathCalculator } from './critical_path_service.js'
export { ResourceLoadCalculator } from './resource_load_service.js'
export { HardValidator } from './hard_validator.js'
export { PdmDiffService } from './diff_service.js'

export type {
  DeterministicContext,
  DeterministicEngineOrchestrator,
  DiffService,
  GraphValidationService,
  HardValidationService,
  ResourceLoadService,
  ScheduleService,
} from './interfaces.js'

export {
  DETERMINISTIC_ENGINE_VERSION,
  DETERMINISTIC_RULE_SET_VERSION,
  DeterministicEngineResultBuilder,
  EngineEvidenceBuilder,
  computeInputSignature,
} from './utils.js'

export {
  DEFAULT_CALENDAR,
  countWorkingDaysBetween,
  durationToDateRange,
  isWorkingDay,
  nextWorkingDay,
  toDateStr,
  toDateTime,
} from './working_calendar.js'
