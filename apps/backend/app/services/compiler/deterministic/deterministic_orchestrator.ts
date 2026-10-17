/**
 * Deterministic Engine —— 编排执行器。
 *
 * 按 pipeline 顺序执行各 deterministic service：
 * graph validation → schedule → critical path → resource load → hard validation → diff
 *
 * @aiproj/backend
 */

import type {
  CriticalPathResult,
  Dependency,
  DeterministicEngineResult,
  GraphValidationInput,
  GraphValidationResult,
  HardValidationReport,
  PdmDiff,
  ResourceLoadInput,
  ResourceLoadResult,
  ScheduleResult,
  TaskDependency,
} from '@aiproj/compiler-spec'
import type { DeterministicContext, DeterministicEngineOrchestrator } from './interfaces.js'
import {
  DeterministicEngineResultBuilder,
  EngineEvidenceBuilder,
  computeInputSignature,
} from './utils.js'
import { GraphValidator } from './graph_validator.js'
import { ScheduleEngine } from './schedule_engine.js'
import { CriticalPathCalculator } from './critical_path_service.js'
import { ResourceLoadCalculator } from './resource_load_service.js'
import { HardValidator } from './hard_validator.js'
import { PdmDiffService } from './diff_service.js'

export class DeterministicOrchestrator implements DeterministicEngineOrchestrator {
  readonly #graphValidator: GraphValidator
  readonly #scheduleEngine: ScheduleEngine
  readonly #criticalPath: CriticalPathCalculator
  readonly #resourceLoad: ResourceLoadCalculator
  readonly #hardValidator: HardValidator
  readonly #diffService: PdmDiffService

  constructor() {
    this.#graphValidator = new GraphValidator()
    this.#scheduleEngine = new ScheduleEngine()
    this.#criticalPath = new CriticalPathCalculator()
    this.#resourceLoad = new ResourceLoadCalculator()
    this.#hardValidator = new HardValidator()
    this.#diffService = new PdmDiffService()
  }

  async execute(params: {
    graphInput: GraphValidationInput
    tasks: Record<string, TaskDependency>
    dependencies: Dependency[]
    resourceInput?: ResourceLoadInput
    pdmBefore?: unknown
    pdmAfter?: unknown
    context: DeterministicContext
  }): Promise<DeterministicEngineResult> {
    const { graphInput, tasks, dependencies, resourceInput, pdmBefore, pdmAfter, context } = params
    const builder = new DeterministicEngineResultBuilder()

    // ── Stage 1: Graph Validation ──
    const graphInputSignature = computeInputSignature(graphInput)
    const graphResult: GraphValidationResult = await this.#graphValidator.validate(
      graphInput,
      context,
    )

    const graphEvidence = new EngineEvidenceBuilder(context.stageId, graphInputSignature)
      .setOutputSummary({ ruleCount: graphResult.rules.length, passed: graphResult.passed })
      .setBlockingCount(graphResult.blocking.length)
      .build()
    builder.withGraphValidation(graphResult).addEvidence(graphEvidence)

    // ── Stage 2: Schedule ──
    const scheduleInputSignature = computeInputSignature({ tasks: Object.keys(tasks) })
    const scheduleResult: ScheduleResult = await this.#scheduleEngine.compute(
      tasks,
      graphResult,
      context,
    )

    const scheduleEvidence = new EngineEvidenceBuilder(context.stageId, scheduleInputSignature)
      .setOutputSummary({ scheduledCount: Object.keys(scheduleResult.scheduled).length })
      .setBlockingCount(scheduleResult.blocked ? 1 : 0)
      .build()
    builder.withSchedule(scheduleResult).addEvidence(scheduleEvidence)

    // ── Stage 3: Critical Path ──
    const cpInputSignature = computeInputSignature({ taskIds: Object.keys(tasks) })
    const cpResult: CriticalPathResult = await this.#criticalPath.compute(
      scheduleResult,
      tasks,
      dependencies,
      graphResult,
      context,
    )

    const cpEvidence = new EngineEvidenceBuilder(context.stageId, cpInputSignature)
      .setOutputSummary({ criticalPathLength: cpResult.criticalPathIds.length })
      .setBlockingCount(cpResult.blocked ? 1 : 0)
      .build()
    builder.withCriticalPath(cpResult).addEvidence(cpEvidence)

    // ── Stage 4: Resource Load ──
    if (resourceInput) {
      const rlInputSignature = computeInputSignature(resourceInput)
      const rlResult: ResourceLoadResult = await this.#resourceLoad.compute(
        resourceInput,
        graphResult,
        context,
      )

      const rlEvidence = new EngineEvidenceBuilder(context.stageId, rlInputSignature)
        .setOutputSummary({ overloadDays: rlResult.overloadDays })
        .setWarningCount(rlResult.warnings.length)
        .build()
      builder.withResourceLoad(rlResult).addEvidence(rlEvidence)
    }

    // ── Stage 5: Hard Validation ──
    const hvInputSignature = computeInputSignature({ blocked: builder.build().blocked })
    const hvResult: HardValidationReport = await this.#hardValidator.validate(
      builder.build(),
      context,
    )

    const hvEvidence = new EngineEvidenceBuilder(context.stageId, hvInputSignature)
      .setOutputSummary({ rules: hvResult.rules.length, passed: hvResult.passed })
      .setBlockingCount(hvResult.blocking.length)
      .setWarningCount(hvResult.warnings.length)
      .build()
    builder.withHardValidation(hvResult).addEvidence(hvEvidence)

    // ── Stage 6: Diff ──
    if (pdmBefore !== undefined && pdmAfter !== undefined) {
      const diffInputSignature = computeInputSignature({ hasBefore: true, hasAfter: true })
      const diffResult: PdmDiff = await this.#diffService.generate(pdmBefore, pdmAfter, context)

      const diffEvidence = new EngineEvidenceBuilder(context.stageId, diffInputSignature)
        .setOutputSummary({ totalChanges: diffResult.totalChanges })
        .addDiffRuleIds(diffResult.items.map((i) => i.ruleId).filter(Boolean) as string[])
        .build()
      builder.withDiff(diffResult).addEvidence(diffEvidence)
    }

    return builder.build()
  }
}
