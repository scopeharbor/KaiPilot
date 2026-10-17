/**
 * v2-project-compiler-foundation —— ManifestBuilder（tasks 5.1）。
 *
 * 由骨架蓝图直接生成最小 Manifest，不调用 LLM。
 * Manifest 必须包含 3 个参考 Stage 的执行顺序与实体依赖。
 * 支持更新实体状态。
 */
import type {
  FoundationGenerationManifest as GenerationManifest,
  FoundationManifestEntity as ManifestEntity,
  ManifestExecutionStep,
  FoundationManifestEntityStatus as ManifestEntityStatus,
  ManifestStepStatus,
} from '@aiproj/compiler-spec'

export interface StageEvidence {
  contextPacketRef?: string
  inputArtifactRefs?: string[]
  outputArtifactRef?: string
  validationFeedbackRef?: string
  attemptNumber?: number
  modelMode?: string
  tokenCostSummary?: string
}

export interface StageBlueprint {
  stageId: string
  phase: string
  dependsOn: string[]
  parallelGroup?: string
  entities: Array<{
    entityId: string
    kind: ManifestEntity['kind']
  }>
}

export class ManifestBuilderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestBuilderError'
  }
}

/**
 * ManifestBuilder —— 生成并管理 GenerationManifest。
 *
 * Foundation 阶段：从蓝图直出最小 Manifest（零 LLM）。
 * Manifest 包含 Stage 执行计划与实体依赖关系。
 */
export class ManifestBuilder {
  #manifest: GenerationManifest

  constructor(runId: number, blueprints: StageBlueprint[]) {
    if (blueprints.length === 0) {
      throw new ManifestBuilderError('At least one stage blueprint is required')
    }

    const entities: ManifestEntity[] = []
    const executionPlan: ManifestExecutionStep[] = []

    for (const bp of blueprints) {
      executionPlan.push({
        stageId: bp.stageId,
        phase: bp.phase,
        dependsOn: bp.dependsOn,
        parallelGroup: bp.parallelGroup,
        status: 'pending',
        retryCount: 0,
      })

      for (const ent of bp.entities) {
        entities.push({
          entityId: ent.entityId,
          kind: ent.kind,
          stageId: bp.stageId,
          status: 'pending',
        })
      }
    }

    this.#manifest = {
      runId,
      schemaVersion: '2.0',
      entities,
      executionPlan,
      totalStages: blueprints.length,
      completedStages: 0,
      failedStages: 0,
    }
  }

  /** 获取当前 Manifest。 */
  get(): GenerationManifest {
    return { ...this.#manifest }
  }

  /** 获取未完成的 Stage 步骤（按依赖顺序）。 */
  getPendingSteps(): ManifestExecutionStep[] {
    return this.#manifest.executionPlan.filter((s) => s.status === 'pending')
  }

  /** 更新实体状态。 */
  updateEntityStatus(entityId: string, status: ManifestEntityStatus): void {
    const entity = this.#manifest.entities.find((e) => e.entityId === entityId)
    if (entity) {
      entity.status = status
    }
  }

  /** 更新 Stage 状态，并同步更新关联实体状态与计数。 */
  updateStepStatus(stageId: string, status: ManifestStepStatus, errorSummary?: string): void {
    const step = this.#manifest.executionPlan.find((s) => s.stageId === stageId)
    if (!step) {
      throw new ManifestBuilderError(`Step not found: ${stageId}`)
    }

    step.status = status
    if (errorSummary) {
      step.errorSummary = errorSummary
    }

    // 同步更新关联的实体状态
    for (const entity of this.#manifest.entities) {
      if (entity.stageId === stageId) {
        if (status === 'completed') {
          entity.status = 'completed'
        } else if (status === 'failed') {
          entity.status = 'failed'
        } else if (status === 'needs_human_review') {
          entity.status = 'needs_human_review'
        } else if (status === 'skipped') {
          entity.status = 'skipped'
        }
      }
    }

    // 更新计数
    this.#manifest.completedStages = this.#manifest.executionPlan.filter(
      (s) => s.status === 'completed',
    ).length
    this.#manifest.failedStages = this.#manifest.executionPlan.filter(
      (s) => s.status === 'failed',
    ).length
  }

  /**
   * 检查依赖是否全部完成。
   * 依赖未完成时下游不能解锁。
   */
  areDependenciesMet(stageId: string): { met: boolean; blocking: string[] } {
    const step = this.#manifest.executionPlan.find((s) => s.stageId === stageId)
    if (!step) return { met: false, blocking: [`Step not found: ${stageId}`] }

    const blocking: string[] = []
    for (const depId of step.dependsOn) {
      const dep = this.#manifest.executionPlan.find((s) => s.stageId === depId)
      if (!dep) {
        blocking.push(`Dependency not found: ${depId}`)
      } else if (dep.status !== 'completed') {
        blocking.push(depId)
      }
    }

    return { met: blocking.length === 0, blocking }
  }
}
