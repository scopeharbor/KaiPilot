/**
 * Deterministic Engine —— 服务接口定义。
 *
 * 所有 deterministic service 实现的接口契约。
 * 每个 service 接收 PDM 子集 + context，返回 computed 结果 + evidence。
 *
 * @aiproj/backend
 */

import type {
  CriticalPathResult,
  DeterministicEngineResult,
  GraphValidationInput,
  GraphValidationResult,
  HardValidationReport,
  PdmDiff,
  ResourceLoadInput,
  ResourceLoadResult,
  ScheduleResult,
  WorkingCalendar,
} from '@aiproj/compiler-spec'

// ── Service Context ──

export interface DeterministicContext {
  /** 项目日历。 */
  calendar: WorkingCalendar
  /** 项目基准日期（用于无显式日期的任务）。 */
  projectStartDate: string
  /** Stage ID（用于证据追踪）。 */
  stageId: string
  /** 组织 ID（用于数据隔离）。 */
  organizationId?: number
}

// ── Service Interface ──

export interface GraphValidationService {
  readonly name: string
  validate(
    input: GraphValidationInput,
    context: DeterministicContext,
  ): Promise<GraphValidationResult>
}

export interface ScheduleService {
  readonly name: string
  compute(
    tasks: Record<string, import('@aiproj/compiler-spec').TaskDependency>,
    graphValidation: GraphValidationResult,
    context: DeterministicContext,
  ): Promise<ScheduleResult>
}

export interface CriticalPathService {
  readonly name: string
  compute(
    scheduleResult: ScheduleResult,
    tasks: Record<string, import('@aiproj/compiler-spec').TaskDependency>,
    dependencies: import('@aiproj/compiler-spec').Dependency[],
    graphValidation: GraphValidationResult,
    context: DeterministicContext,
  ): Promise<CriticalPathResult>
}

export interface ResourceLoadService {
  readonly name: string
  compute(
    input: ResourceLoadInput,
    graphValidation: GraphValidationResult,
    context: DeterministicContext,
  ): Promise<ResourceLoadResult>
}

export interface HardValidationService {
  readonly name: string
  validate(
    engineResult: DeterministicEngineResult,
    context: DeterministicContext,
  ): Promise<HardValidationReport>
}

export interface DiffService {
  readonly name: string
  generate(before: unknown, after: unknown, context: DeterministicContext): Promise<PdmDiff>
  /**
   * 验证对同一 base 回放 diff 后的一致性。
   */
  replay(base: unknown, diff: PdmDiff): Promise<{ match: boolean; target: unknown }>
}

// ── Engine Orchestrator ──

export interface DeterministicEngineOrchestrator {
  /**
   * 运行完整 deterministic pipeline：
   * graph validation → schedule → critical path → resource load → hard validation → diff
   */
  execute(params: {
    graphInput: GraphValidationInput
    tasks: Record<string, import('@aiproj/compiler-spec').TaskDependency>
    dependencies: import('@aiproj/compiler-spec').Dependency[]
    resourceInput?: ResourceLoadInput
    pdmBefore?: unknown
    pdmAfter?: unknown
    context: DeterministicContext
  }): Promise<DeterministicEngineResult>
}
