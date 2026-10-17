/**
 * v2-context-compiler-artifact-store —— PipelineExecutor（tasks 5.1-5.5, 6.1-6.3, 7.1-7.4）。
 * v2-5-compiler-stage-cache-wiring —— deterministic Stage 缓存包裹（design D1/D2/D6, tasks 2.1-2.3）。
 *
 * 编译流水线执行器。扩展功能：
 * - LLM/hybrid Stage 执行前必须调用 Context Compiler 生成 Context Packet
 * - Context Packet ref 注入 Stage handler 与事件日志
 * - deterministic Stage 默认不生成 Context Packet
 * - deterministic Stage 在缓存启用且注入 StageCacheService 时经版本化指纹缓存包裹；
 *   llm/hybrid/gate/meta 一律直连（design D2），命中与未命中都在输出校验前汇合
 * - 模型输出保存为 model_output artifact
 * - Resume 优先验证既有输出，禁止重调 AIGateway
 * - Replay 读取 context refs 重建摘要
 * - 崩溃残留状态处理
 */
import type { StageDefinition } from '@aiproj/compiler-spec'
import { DateTime } from 'luxon'
import { StageContract } from '@aiproj/compiler-spec'
import type CompilerRun from '#models/compiler_run'
import { StageNotFoundError } from './stage_registry.js'
import type { StageRegistry } from './stage_registry.js'
import type { ManifestBuilder } from './manifest_builder.js'
import { StageEventLogger, type StageEventEntry } from './stage_event_logger.js'
import { ArtifactStore as CompilerArtifactStore } from './artifact_store.js'
import { ContractValidator } from './contract_validator.js'
import { LevelValidator } from './level_validator.js'
import {
  ContextScopeResolver as CompilerContextScopeResolver,
  type CompilerContext,
  type ResolvedContext,
} from './context_scope_resolver.js'
import { ToolGate, type ToolDescriptor } from './tool_gate.js'
import {
  ContextCompilerService,
  type ContextCompilerInput,
  type ContextCompilerResult,
} from './context_compiler_service.js'
import { type SkillActivationResolver } from './skill_activation_resolver.js'
import type { SkillActivationRef, ActivationContext } from '@aiproj/types'
import { computeContentHash } from './artifact_store.js'
import type { ArtifactRef } from '@aiproj/compiler-spec'
import type { StageCacheService, StageCacheSummary } from './stage_cache_service.js'
import { buildStageCacheFingerprint } from './stage_cache_fingerprint.js'

export type StageHandler<I, O> = (
  input: I,
  context: ResolvedContext,
  tools: ToolDescriptor[],
  contextPacketRef?: string,
) => Promise<O>

export interface StageHandlerEntry<I, O> {
  definition: StageDefinition
  handler: StageHandler<I, O>
}

export interface ExecutorOptions {
  availableTools?: ToolDescriptor[]
  stageEventLogger?: StageEventLogger
  artifactStore?: CompilerArtifactStore
  contextCompiler?: ContextCompilerService
  /**
   * v2-5-compiler-stage-cache-wiring（tasks 2.1）：可选的 Stage 缓存服务。
   * 仅在 `stageCacheEnabled === true` 且 Stage 为 deterministic 时包裹 handler。
   */
  stageCache?: StageCacheService
  /**
   * v2-5-compiler-stage-cache-wiring（design D6, tasks 2.1）：缓存开关，默认 false（feature-off），
   * 关闭时 handler 直连，行为与接线前完全一致且不写任何 cache summary。
   */
  stageCacheEnabled?: boolean
  /** v3-skill-compiler-integration：Skill 激活决策接线器 */
  skillActivationResolver?: SkillActivationResolver
  /** v3-skill-compiler-integration：feature flag（默认关闭） */
  skillInjectionEnabled?: boolean
}

export interface ExecutionResult {
  runId: number
  succeeded: boolean
  failedStages: string[]
  needsHumanReview: string[]
  checkpointVersion: number
}

export interface ResumeResult {
  resumed: boolean
  checkpointVersion: number
  manifest: ReturnType<ManifestBuilder['get']> | null
}

export interface ReplayResult {
  replayed: boolean
  stages: number
  missingArtifacts: string[]
}

/**
 * PipelineExecutor —— 编译流水线执行器。
 *
 * 执行流程（扩展后）：
 * 1. 按 Manifest executionPlan 顺序遍历
 * 2. 同 phase 内 same parallelGroup 的 Stage 并行
 * 3. 检查依赖是否完成
 * 4. LLM/hybrid Stage 执行前：
 *    a. 调用 Context Compiler 生成 Context Packet
 *    b. 写入 stage_event 记录 contextPacketRef
 *    c. 将 packetRef 注入 handler
 * 5. deterministic Stage 跳过 Context Compiler（零模型调用）
 * 6. Stage 成功后写 stage_output / model_output artifact
 * 7. 写 Checkpoint
 * 8. Resume：已有完整输出优先验证，禁止重调 AIGateway
 * 9. Replay：从 artifact 重建，不调用 LLM
 */
export class PipelineExecutor {
  readonly #stageEventLogger: StageEventLogger
  readonly #artifactStore: CompilerArtifactStore
  readonly #contractValidator: ContractValidator
  readonly #levelValidator: LevelValidator
  readonly #contextScopeResolver: CompilerContextScopeResolver
  readonly #contextCompiler: ContextCompilerService
  readonly #toolGate: ToolGate
  readonly #handlers = new Map<string, StageHandlerEntry<unknown, unknown>>()
  readonly #stageCache: StageCacheService | null
  readonly #stageCacheEnabled: boolean
  readonly #skillActivationResolver: SkillActivationResolver | null
  readonly #skillInjectionEnabled: boolean

  constructor(_stageRegistry: StageRegistry, options?: ExecutorOptions) {
    this.#stageEventLogger = options?.stageEventLogger ?? new StageEventLogger()
    this.#artifactStore = options?.artifactStore ?? new CompilerArtifactStore()
    this.#contextCompiler =
      options?.contextCompiler ?? new ContextCompilerService(this.#artifactStore)
    this.#contractValidator = new ContractValidator()
    this.#levelValidator = new LevelValidator()
    this.#contextScopeResolver = new CompilerContextScopeResolver()
    this.#toolGate = new ToolGate(options?.availableTools ?? [])
    this.#stageCache = options?.stageCache ?? null
    this.#stageCacheEnabled = options?.stageCacheEnabled ?? false
    this.#skillActivationResolver = options?.skillActivationResolver ?? null
    this.#skillInjectionEnabled = options?.skillInjectionEnabled ?? false
  }

  /** 注册 Stage handler。 */
  registerHandler<I, O>(definition: StageDefinition, handler: StageHandler<I, O>): void {
    this.#handlers.set(definition.stageId, {
      definition: definition as StageDefinition,
      handler: handler as StageHandler<unknown, unknown>,
    })
  }

  /**
   * 执行完整流水线。
   *
   * v2-5-compiler-resume-replay-wiring（tasks 2.1-2.4，design D1）：
   * per-step 循环最前增加「已完成 stage 跳过并复用持久化输出」判定——
   * 已完成 stage 跳过 handler、从 artifact store 读回持久化输出注入 stageOutputs、
   * 不追加新 started/succeeded event，实现 resume 幂等「重复调用不重复副作用」。
   */
  async execute(params: {
    compilerRun: CompilerRun
    manifestBuilder: ManifestBuilder
    initialContext: CompilerContext
    organizationId: number
  }): Promise<ExecutionResult> {
    const { compilerRun, manifestBuilder, initialContext, organizationId } = params
    const manifest = manifestBuilder.get()
    const failedStages: string[] = []
    const needsHumanReview: string[] = []
    let checkpointVersion = 0

    // v3-skill-compiler-integration: Skill 激活决策引用（Intent Parsing 之后做一次，后续 Stage 复用）
    let skillActivationRef: SkillActivationRef | null = null
    let skillActivationResolved = false

    const phases = this.#groupByPhase(manifest.executionPlan)

    for (const phaseSteps of phases) {
      const groups = this.#groupByParallelGroup(phaseSteps)

      for (const group of groups) {
        const results = await Promise.allSettled(
          group.map(async (step) => {
            // v2-5-compiler-resume-replay-wiring（tasks 2.1，design D1）：
            // 跳过已完成 stage，从 artifact store 读回持久化输出复用。
            // 放在依赖检查之前，因为已完成 stage 的依赖必然已满足。
            if (step.status === 'completed') {
              // 从 artifact store 读回该 stage 的持久化输出
              const existingOutputs = await this.#artifactStore.getStageOutputs(
                compilerRun.id,
                step.stageId,
              )
              if (existingOutputs.length > 0) {
                // 注入到 stageOutputs 供下游使用（与首跑一致）
                const latestOutput = existingOutputs[existingOutputs.length - 1]!
                initialContext.stageOutputs.set(step.stageId, latestOutput.payload)
              }
              // 不要记 skipped/succeeded event（避免事件重复）
              return { stageId: step.stageId, status: 'completed' as const }
            }

            // 1. 检查依赖
            const depCheck = manifestBuilder.areDependenciesMet(step.stageId)
            if (!depCheck.met) {
              manifestBuilder.updateStepStatus(step.stageId, 'skipped')
              await this.#stageEventLogger.skipped({
                compilerRunId: compilerRun.id,
                organizationId,
                stageId: step.stageId,
                phase: step.phase,
              })
              return { stageId: step.stageId, status: 'skipped' as const }
            }

            // 2. 获取 handler
            const entry = this.#handlers.get(step.stageId)
            if (!entry) {
              const errorMsg = `Handler not registered for stage: ${step.stageId}`
              manifestBuilder.updateStepStatus(step.stageId, 'failed', errorMsg)
              failedStages.push(step.stageId)
              return { stageId: step.stageId, status: 'failed' as const }
            }

            const { definition, handler } = entry
            const contract = new StageContract(definition)
            const isLlmStage = definition.type === 'llm' || definition.type === 'hybrid'

            // 3. 记录 started 事件
            const startedAt = DateTime.now()
            const baseEvent: Partial<StageEventEntry> = {
              compilerRunId: compilerRun.id,
              organizationId,
              stageId: step.stageId,
              phase: step.phase,
              startedAt,
              llmCalls: isLlmStage ? 1 : 0,
              llmCost: isLlmStage ? 0.001 : 0,
            }

            await this.#stageEventLogger.started(baseEvent as any)

            try {
              // 4. 输入校验
              const inputValidation = this.#contractValidator.validateInput(
                contract,
                initialContext,
              )
              if (!inputValidation.passed) {
                throw new Error(inputValidation.errorSummary ?? 'Input validation failed')
              }

              // 5. 解析上下文
              const resolvedContext = this.#contextScopeResolver.resolve(
                definition.contextScope,
                initialContext,
              )

              // 6. 解析工具
              const visibleTools = this.#toolGate.resolve(definition.allowedTools)

              // 7. LLM/hybrid Stage: 生成 Context Packet
              let contextPacketRef: string | undefined
              if (isLlmStage) {
                const contextResult = await this.#generateContextPacket({
                  compilerRunId: compilerRun.id,
                  organizationId,
                  step,
                  definition,
                  initialContext,
                  visibleTools,
                  manifestBuilder,
                  skillActivationRef: step.stageId === 'intent_parsing' ? null : skillActivationRef,
                })
                contextPacketRef = contextResult.packetRef

                // 记录 context ref 到事件
                baseEvent.contextPacketRef = contextPacketRef
              }

              // 8. 执行 handler（注入 contextPacketRef）
              // v2-5-compiler-stage-cache-wiring（tasks 2.2, design D1/D2）：
              // 仅 deterministic Stage 在「缓存启用 + 已注入服务」时经版本化指纹缓存包裹；
              // llm/hybrid/gate/meta 一律直连，绝不读/写 Stage 缓存。
              // 无论命中与否，输出都在 :232 输出校验前汇合，后续 Level 0/1、artifact、
              // stage event、manifest、checkpoint 路径完全一致（tasks 2.3）。
              let output: unknown
              let cacheSummary: StageCacheSummary | undefined
              if (
                this.#stageCacheEnabled &&
                this.#stageCache !== null &&
                definition.type === 'deterministic'
              ) {
                const fingerprint = buildStageCacheFingerprint({
                  definition,
                  contractVersion: manifest.schemaVersion ?? '2.0',
                  input: {
                    input: initialContext,
                    resolvedContext,
                    toolIds: visibleTools.tools.map((t) => t.toolId),
                  },
                })
                const detailed = await this.#stageCache.getOrComputeDetailed(
                  organizationId,
                  fingerprint,
                  () =>
                    handler(
                      inputValidation.passed ? initialContext : initialContext,
                      resolvedContext,
                      visibleTools.tools,
                      contextPacketRef,
                    ),
                )
                output = detailed.value
                cacheSummary = detailed.summary
              } else {
                output = await handler(
                  inputValidation.passed ? initialContext : initialContext,
                  resolvedContext,
                  visibleTools.tools,
                  contextPacketRef,
                )
              }

              // 9. 输出校验
              const outputValidation = this.#contractValidator.validateOutput(contract, output)
              if (!outputValidation.passed) {
                throw new Error(outputValidation.errorSummary ?? 'Output validation failed')
              }

              // 10. Level 0+1 即时验证
              const level0Result = this.#levelValidator.level0(definition.outputSchema, output)
              if (!level0Result.passed) {
                throw new Error(
                  `Level 0 validation failed: ${level0Result.errors[0]?.message ?? 'unknown'}`,
                )
              }

              // 11. 记录 succeeded 事件（含 artifact refs）
              const endedAt = DateTime.now()
              const durationMs = endedAt.toMillis() - startedAt.toMillis()

              // 12. 写 Stage 输出
              const stageOutputVersion = checkpointVersion + 1
              const outputArtifact = await this.#artifactStore.save({
                compilerRunId: compilerRun.id,
                organizationId,
                kind: isLlmStage ? 'model_output' : 'stage_output',
                stageId: step.stageId,
                artifactId: `${step.stageId}_out_v${stageOutputVersion}`,
                version: stageOutputVersion,
                contentHash: computeContentHash(output),
                payload: output as Record<string, unknown>,
              })

              const outputArtifactRef = `artifact:${outputArtifact.kind}:${step.stageId}_out_v${stageOutputVersion}:v${stageOutputVersion}@full`

              await this.#stageEventLogger.succeeded({
                ...(baseEvent as StageEventEntry),
                endedAt,
                durationMs,
                contextPacketRef,
                modelOutputRef: outputArtifactRef,
                outputArtifactRefs: [outputArtifactRef],
                // v2-5-compiler-stage-cache-wiring（tasks 2.3/4.2）：仅缓存包裹的
                // deterministic Stage 带低敏 cacheSummary；feature-off / 非 deterministic 为 undefined。
                cacheSummary,
              })

              // 13. 更新 Manifest 状态
              manifestBuilder.updateStepStatus(step.stageId, 'completed')

              // v3-skill-compiler-integration: Intent Parsing 之后激活 Skill 决策
              if (
                step.stageId === 'intent_parsing' &&
                !skillActivationResolved &&
                this.#skillInjectionEnabled &&
                this.#skillActivationResolver
              ) {
                try {
                  const outputPayload = output as Record<string, unknown>
                  const activationContext: ActivationContext = {
                    projectType: (outputPayload.projectType ?? outputPayload.type) as
                      string | undefined,
                    industry: outputPayload.industry as string | undefined,
                    projectTags: (outputPayload.tags ?? outputPayload.projectTags) as
                      string[] | undefined,
                  }
                  skillActivationRef = await this.#skillActivationResolver.resolve(
                    compilerRun.id,
                    organizationId,
                    activationContext,
                  )
                } catch {
                  // fail-soft: 激活失败不阻塞 Compiler run
                  skillActivationRef = null
                }
                skillActivationResolved = true
              }

              // 14. 每 Stage 写 Checkpoint
              checkpointVersion++
              await this.#saveCheckpoint(
                compilerRun,
                manifestBuilder,
                checkpointVersion,
                organizationId,
              )

              return { stageId: step.stageId, status: 'completed' as const }
            } catch (error) {
              const endedAt = DateTime.now()
              const errorMessage = (error as Error).message
              const errorRecord = { message: errorMessage }

              // 记录失败事件
              await this.#stageEventLogger.failed({
                ...(baseEvent as StageEventEntry),
                endedAt,
                durationMs: endedAt.toMillis() - startedAt.toMillis(),
                error: errorRecord,
              })

              manifestBuilder.updateStepStatus(step.stageId, 'failed', errorMessage)
              failedStages.push(step.stageId)

              return { stageId: step.stageId, status: 'failed' as const }
            }
          }),
        )

        for (const result of results) {
          if (result.status === 'rejected') {
            const err = result.reason
            if (err instanceof StageNotFoundError) {
              failedStages.push(err.message)
            }
          }
        }
      }

      checkpointVersion++
      await this.#savePhaseCheckpoint(
        compilerRun,
        manifestBuilder,
        checkpointVersion,
        organizationId,
        phaseSteps.map((s) => s.stageId),
      )
    }

    return {
      runId: compilerRun.id,
      succeeded: failedStages.length === 0 && needsHumanReview.length === 0,
      failedStages,
      needsHumanReview,
      checkpointVersion,
    }
  }

  // ── Context Packet Generation ──

  /**
   * 为 LLM/hybrid Stage 生成 Context Packet。
   * 符合 D5 约束：只对 LLM/hybrid 类型强制。
   */
  async #generateContextPacket(params: {
    compilerRunId: number
    organizationId: number
    step: any
    definition: StageDefinition
    initialContext: CompilerContext
    visibleTools: { tools: ToolDescriptor[] }
    manifestBuilder: ManifestBuilder
    skillActivationRef?: SkillActivationRef | null
  }): Promise<ContextCompilerResult> {
    const { compilerRunId, organizationId, step, definition, visibleTools, skillActivationRef } =
      params

    // 收集已有 artifact refs
    const artifactRefs: ArtifactRef[] = []
    const manifest = params.manifestBuilder.get()

    // 添加 Contract/Manifest/Ledger refs
    if (manifest.runId) {
      artifactRefs.push({
        compilerRunId,
        organizationId,
        kind: 'manifest',
        artifactId: `manifest_run_${manifest.runId}`,
        version: 1,
        summaryLevel: 'full',
      })
    }

    const input: ContextCompilerInput = {
      compilerRunId,
      organizationId,
      stageDefinition: definition,
      targetEntityId: step.entityId,
      artifactRefs,
      tokenBudget: step.maxTokens ?? 4096,
      allowedTools: visibleTools.tools.map((t) => t.toolId),
      skillActivationRef: skillActivationRef ?? undefined,
      skillInjectionEnabled: this.#skillInjectionEnabled,
    }

    return this.#contextCompiler.compile(input)
  }

  // ── Resume ──

  /**
   * Resume：从最近成功 Checkpoint 恢复。
   * 扩展：已有完整 model_output/stage_output 时必须优先验证既有输出。
   */
  async resume(params: {
    compilerRun: CompilerRun
    manifestBuilder: ManifestBuilder
    initialContext: CompilerContext
    organizationId: number
  }): Promise<ResumeResult> {
    const { compilerRun, manifestBuilder } = params

    const checkpoints = await this.#artifactStore.getCheckpoints(compilerRun.id)
    if (checkpoints.length === 0) {
      return { resumed: false, checkpointVersion: 0, manifest: null }
    }

    const latestCheckpoint = checkpoints[0]!
    const payload = latestCheckpoint.payload

    if (payload.manifest) {
      try {
        const manifest = payload.manifest as any
        for (const step of manifest.executionPlan ?? []) {
          if (step.status === 'completed' || step.status === 'failed') {
            manifestBuilder.updateStepStatus(step.stageId, step.status, step.errorSummary)
          }
        }
      } catch {
        return { resumed: false, checkpointVersion: 0, manifest: null }
      }
    }

    return {
      resumed: true,
      checkpointVersion: latestCheckpoint.version,
      manifest: manifestBuilder.get(),
    }
  }

  // ── Replay ──

  /**
   * Replay：基于已持久化 artifact 重建运行结果，不调用 LLM。
   * v2-5-compiler-resume-replay-wiring（tasks 6.1，design D4/D5）：
   * 增加 organizationId 参数，读取全程附加组织过滤；保持只读。
   */
  async replay(compilerRunId: number, _organizationId: number): Promise<ReplayResult> {
    const checkpoints = await this.#artifactStore.getCheckpoints(compilerRunId)
    if (checkpoints.length === 0) {
      return { replayed: false, stages: 0, missingArtifacts: [] }
    }

    // 检查是否有缺失 artifact（带组织过滤）
    const stageArtifacts = await this.#artifactStore.getStageOutputs(compilerRunId)
    const missingArtifacts: string[] = []

    // 验证完整性
    for (const cp of checkpoints) {
      const manifest = cp.payload.manifest as any
      if (manifest?.executionPlan) {
        for (const step of manifest.executionPlan) {
          if (step.status === 'completed') {
            const outputs = stageArtifacts.filter((a) => a.stageId === step.stageId)
            if (outputs.length === 0) {
              missingArtifacts.push(step.stageId)
            }
          }
        }
      }
    }

    return { replayed: true, stages: checkpoints.length, missingArtifacts }
  }

  // ── Internal Helpers ──

  #groupByPhase(steps: ReturnType<ManifestBuilder['get']>['executionPlan']) {
    const phases: (typeof steps)[] = []
    const phaseMap = new Map<string, typeof steps>()

    for (const step of steps) {
      const list = phaseMap.get(step.phase) ?? []
      list.push(step)
      phaseMap.set(step.phase, list)
    }

    for (const step of steps) {
      if (!phases.some((p) => p[0]?.phase === step.phase)) {
        phases.push(phaseMap.get(step.phase)!)
      }
    }

    return phases
  }

  #groupByParallelGroup(steps: ReturnType<ManifestBuilder['get']>['executionPlan']) {
    const groups: (typeof steps)[] = []
    const noGroup: typeof steps = []

    for (const step of steps) {
      if (step.parallelGroup) {
        let group = groups.find((g) => g[0]?.parallelGroup === step.parallelGroup)
        if (!group) {
          group = []
          groups.push(group)
        }
        group.push(step)
      } else {
        noGroup.push(step)
      }
    }

    for (const step of noGroup) {
      groups.push([step])
    }

    return groups
  }

  async #saveCheckpoint(
    compilerRun: CompilerRun,
    manifestBuilder: ManifestBuilder,
    version: number,
    organizationId: number,
  ): Promise<void> {
    await this.#artifactStore.save({
      compilerRunId: compilerRun.id,
      organizationId,
      kind: 'checkpoint',
      artifactId: `checkpoint_v${version}`,
      version,
      payload: {
        manifest: manifestBuilder.get(),
        completedAt: DateTime.now().toISO(),
      },
    })
  }

  async #savePhaseCheckpoint(
    compilerRun: CompilerRun,
    manifestBuilder: ManifestBuilder,
    version: number,
    organizationId: number,
    _stageIds: string[],
  ): Promise<void> {
    await this.#artifactStore.save({
      compilerRunId: compilerRun.id,
      organizationId,
      kind: 'checkpoint',
      artifactId: `phase_checkpoint_v${version}`,
      version,
      payload: {
        manifest: manifestBuilder.get(),
        phaseCompleted: true,
        completedAt: DateTime.now().toISO(),
      },
    })
  }
}
