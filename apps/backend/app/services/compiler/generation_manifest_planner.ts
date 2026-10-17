/**
 * GenerationManifestPlanner —— 从 Contract 派生 Manifest，生成实体登记、依赖、批次、执行顺序和 DeepSeek V4 Flash 输出预算。
 *
 * Manifest 必须从 Generation Contract 派生，包含实体登记册、批次计划、执行阶段、
 * 模型模式选择、Token 预算、验证规则和输出引用。
 * 任何未登记的实体禁止进入 PDM 或 Ledger。
 *
 * @aiproj/backend compiler
 */

import type {
  BatchPlan,
  EntityValidator,
  ExecutionPhase,
  GenerationContract,
  GenerationManifest,
  ManifestEntity,
  TokenBudget,
} from '@aiproj/compiler-spec'

export interface PlannerOptions {
  /** Manifest 版本（递增）。 */
  manifestVersion: number
  /** 默认每批最大实体数。 */
  defaultBatchSize?: number
  /** 默认实体输出 budget（token）。 */
  defaultEntityBudget?: number
  /** 默认最大重试次数。 */
  defaultMaxRetries?: number
  /** 复杂实体类型（应启用 thinking 模式）。 */
  thinkingEntityTypes?: string[]
}

export interface EntityGenerationHint {
  entityId: string
  stageId?: string
  strategy?: ManifestEntity['strategy']
  modelMode?: ManifestEntity['modelMode']
  maxOutputBudget?: number
  dependencies?: string[]
  batchId?: string
  maxRetries?: number
}

export class ManifestPlannerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestPlannerError'
  }
}

const DEFAULT_OPTIONS: Required<PlannerOptions> = {
  manifestVersion: 1,
  defaultBatchSize: 5,
  defaultEntityBudget: 4096,
  defaultMaxRetries: 3,
  thinkingEntityTypes: ['workstream', 'milestone'],
}

/**
 * GenerationManifestPlanner —— 从 Contract 派生 Manifest。
 *
 * 核心职责：
 * - 将 Contract 中的 expected entities 转换为 Manifest entities
 * - 按 stage/phase 建立批次计划
 * - 分配模型模式（thinking vs non-thinking）
 * - 计算 Token 预算
 * - 绑定验证器
 */
export class GenerationManifestPlanner {
  readonly #options: Required<PlannerOptions>

  constructor(options?: PlannerOptions) {
    this.#options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * 从 Contract 生成完整 Manifest。
   *
   * @param contract    GenerationContract
   * @param hints       实体级覆盖提示（stage 分配、策略选择）
   * @param runId       编译运行 ID
   * @returns           完整的 GenerationManifest
   */
  plan(
    contract: GenerationContract,
    hints: EntityGenerationHint[],
    _runId: number,
  ): GenerationManifest {
    const entities = this.#buildEntities(contract, hints)
    const batchPlan = this.#buildBatchPlan(entities)
    const executionPhases = this.#buildExecutionPhases(batchPlan)
    const tokenBudget = this.#computeTokenBudget(entities, batchPlan)

    return {
      meta: {
        schemaVersion: '2.0',
        manifestVersion: this.#options.manifestVersion,
        generatedAt: new Date().toISOString(),
        contractVersion: contract.meta.contractVersion,
        contractHash: contract.contentHash,
      },
      entities,
      batchPlan,
      executionPhases,
      tokenBudget,
      totalEntities: entities.length,
      completedEntities: 0,
      failedEntities: 0,
    }
  }

  /**
   * 校验 Manifest 是否覆盖 Contract 全部必需实体。
   * 用于 Task 2.4 覆盖率校验。
   */
  validateCoverage(
    contract: GenerationContract,
    manifest: GenerationManifest,
  ): { covered: boolean; missingIds: string[]; extras: string[] } {
    const contractRequiredIds = new Set(
      contract.expectedEntities.filter((e) => e.required).map((e) => e.entityId),
    )
    const manifestIds = new Set(manifest.entities.map((e) => e.entityId))

    const missingIds = [...contractRequiredIds].filter((id) => !manifestIds.has(id))
    const extras = [...manifestIds].filter(
      (id) => !contract.expectedEntities.some((ce) => ce.entityId === id),
    )

    return {
      covered: missingIds.length === 0,
      missingIds,
      extras,
    }
  }

  /**
   * 分配实体到批次（按深度优先和依赖顺序）。
   * 公共方法，供外部测试和执行器使用。
   */
  assignBatches(
    entities: ManifestEntity[],
  ): { batchId: string; entityIds: string[]; stageId: string }[] {
    const batches: { batchId: string; entityIds: string[]; stageId: string }[] = []

    // 按 stageId 分组
    const byStage = new Map<string, ManifestEntity[]>()
    for (const entity of entities) {
      const list = byStage.get(entity.stageId) ?? []
      list.push(entity)
      byStage.set(entity.stageId, list)
    }

    let batchCounter = 0
    for (const [stageId, stageEntities] of byStage) {
      // 按依赖排序（无依赖的在前）
      const sorted = this.#topologicalSort(stageEntities)

      // 分批
      for (let i = 0; i < sorted.length; i += this.#options.defaultBatchSize) {
        batchCounter++
        const batchEntities = sorted.slice(i, i + this.#options.defaultBatchSize)
        batches.push({
          batchId: `batch_${stageId}_${batchCounter}`,
          entityIds: batchEntities.map((e) => e.entityId),
          stageId,
        })
      }
    }

    return batches
  }

  // ── Private: Entity Building ──

  /** 从 Contract 构建 Manifest entities。 */
  #buildEntities(contract: GenerationContract, hints: EntityGenerationHint[]): ManifestEntity[] {
    const hintMap = new Map(hints.map((h) => [h.entityId, h]))

    return contract.expectedEntities.map((expected) => {
      const hint = hintMap.get(expected.entityId)
      const isComplex = this.#options.thinkingEntityTypes.includes(expected.entityType)

      return {
        entityId: expected.entityId,
        entityType: expected.entityType,
        contractRef: expected.entityId,
        label: expected.label,
        parentEntityId: expected.parentRef,
        dependencies: expected.parentRef ? [expected.parentRef] : [],
        stageId: hint?.stageId ?? this.#inferStageId(expected),
        batchId: hint?.batchId,
        strategy: hint?.strategy ?? 'llm_generate',
        modelMode: hint?.modelMode ?? (isComplex ? 'thinking' : 'non-thinking'),
        maxOutputBudget: hint?.maxOutputBudget ?? this.#options.defaultEntityBudget,
        validators: this.#defaultValidators(expected),
        status: 'pending',
        outputRef: undefined,
        attemptCount: 0,
        maxRetries: hint?.maxRetries ?? this.#options.defaultMaxRetries,
      }
    })
  }

  /** 默认验证器（按实体类型绑定）。 */
  #defaultValidators(expected: GenerationContract['expectedEntities'][0]): EntityValidator[] {
    const validators: EntityValidator[] = [
      {
        validatorId: `json_schema_${expected.entityType}`,
        validatorType: 'json_schema',
        description: `${expected.label} 必须通过 JSON schema 校验`,
        config: {},
      },
      {
        validatorId: `contract_match_${expected.entityType}`,
        validatorType: 'contract_match',
        description: `${expected.label} 必须匹配 Contract 定义`,
        config: {},
      },
    ]

    // 有父实体的加引用完整性校验
    if (expected.parentRef) {
      validators.push({
        validatorId: `ref_${expected.entityId}`,
        validatorType: 'reference_integrity',
        description: `${expected.label} 必须引用有效的父实体`,
        config: {},
      })
    }

    return validators
  }

  /** 推测 Stage ID（按实体类型映射到阶段）。 */
  #inferStageId(expected: GenerationContract['expectedEntities'][0]): string {
    const stageMap: Record<string, string> = {
      workstream: 'stage_intent_parsing',
      work_package: 'stage_intent_parsing',
      task_l1: 'stage_structuring',
      task_l2: 'stage_structuring',
      milestone: 'stage_intent_parsing',
      risk: 'stage_analysis',
      resource: 'stage_analysis',
      stakeholder: 'stage_understanding',
    }
    return stageMap[expected.entityType] ?? 'stage_intent_parsing'
  }

  /** 构建批次计划。 */
  #buildBatchPlan(entities: ManifestEntity[]): BatchPlan[] {
    const batches = this.assignBatches(entities)
    return batches.map((b) => {
      const batchEntities = b.entityIds
        .map((id) => entities.find((e) => e.entityId === id)!)
        .filter(Boolean)
      const modelMode = batchEntities.some((e) => e.modelMode === 'thinking')
        ? 'thinking'
        : 'non-thinking'
      const maxTokens = batchEntities.reduce((sum, e) => sum + e.maxOutputBudget, 0)

      return {
        batchId: b.batchId,
        entityIds: b.entityIds,
        stageId: b.stageId,
        maxTokens: Math.max(maxTokens, 1024),
        jsonSchemaName: `entity_batch_${b.batchId}`,
        modelMode,
        strategy: 'llm_generate',
      }
    })
  }

  /** 构建执行阶段。 */
  #buildExecutionPhases(batchPlan: BatchPlan[]): ExecutionPhase[] {
    const byStage = new Map<string, BatchPlan[]>()
    for (const batch of batchPlan) {
      const list = byStage.get(batch.stageId) ?? []
      list.push(batch)
      byStage.set(batch.stageId, list)
    }

    const phases: ExecutionPhase[] = []
    let phaseCounter = 0
    for (const [stageId, batches] of byStage) {
      phaseCounter++
      phases.push({
        phaseId: `phase_${stageId}`,
        phase: stageId.replace('stage_', ''),
        dependsOn: [],
        batchIds: batches.map((b) => b.batchId),
      })
    }

    return phases
  }

  /** 计算 Token 预算。 */
  #computeTokenBudget(entities: ManifestEntity[], batchPlan: BatchPlan[]): TokenBudget {
    const perEntity: Record<string, number> = {}
    const perBatch: Record<string, number> = {}
    let totalEstimated = 0

    for (const entity of entities) {
      perEntity[entity.entityId] = entity.maxOutputBudget
      totalEstimated += entity.maxOutputBudget
    }

    for (const batch of batchPlan) {
      perBatch[batch.batchId] = batch.maxTokens
    }

    return { totalEstimated, perBatch, perEntity }
  }

  /** 拓扑排序（按依赖关系）。 */
  #topologicalSort(entities: ManifestEntity[]): ManifestEntity[] {
    const visited = new Set<string>()
    const sorted: ManifestEntity[] = []
    const entityMap = new Map(entities.map((e) => [e.entityId, e]))

    function visit(entityId: string): void {
      if (visited.has(entityId)) return
      visited.add(entityId)

      const entity = entityMap.get(entityId)
      if (entity) {
        for (const dep of entity.dependencies) {
          if (entityMap.has(dep)) {
            visit(dep)
          }
        }
        sorted.push(entity)
      }
    }

    for (const entity of entities) {
      visit(entity.entityId)
    }

    return sorted
  }
}
