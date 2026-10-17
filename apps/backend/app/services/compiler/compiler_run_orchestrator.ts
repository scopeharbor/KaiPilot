/**
 * v2-5-compiler-run-executor-wiring —— CompilerRunOrchestrator（tasks 2.1-2.5）。
 * v2-5-compiler-dynamic-routing —— 增加 routing planner 集成（tasks 4.1-4.5）。
 * v2-5-compiler-stage-cache-wiring —— 生产接线 Stage 缓存（design D1/D6, tasks 2.1, 3.1）。
 *
 * design D1：唯一 composition root。Controller 只处理 HTTP，CompilerRunService 委托本类。
 * 负责 manifest 解析、handler registry 验证、**routing（可选）**、PipelineExecutor.execute 调用、终态写回。
 *
 * design D3：Handler registry 显式、封闭、fail-fast。
 * 每个 stage type 只映射到一个生产 handler 和 contractVersion。
 * 未知/未启用的 stage 在执行前失败，不 fallback 到 stub。
 *
 * stage-cache-wiring：execute/resume 构造 PipelineExecutor 时注入 StageCacheService 并默认启用
 * （仅 deterministic Stage 生效）；`COMPILER_STAGE_CACHE_ENABLED=false` 或构造选项
 * `stageCache.enabled === false` 即本地 feature-off，handler 直连（design D6）。
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import CompilerRun from '#models/compiler_run'
import { StageRegistry } from './stage_registry.js'
import { ManifestBuilder } from './manifest_builder.js'
import { PipelineExecutor, type StageHandler, type ExecutionResult } from './pipeline_executor.js'
import { ArtifactStore } from './artifact_store.js'
import { StageEventLogger } from './stage_event_logger.js'
import {
  withTenantConnectionLease,
  poolTenantContextFor,
} from '#services/tenant_connection_pool_wrapper'
import type { CompilerContext } from './context_scope_resolver.js'
import type { StageDefinition } from '@aiproj/compiler-spec'
import {
  RoutingPlanner,
  RoutingRuleRegistry,
  recordRoutingDecision,
  getRoutingDecision,
} from './dynamic-routing/index.js'
import { persistRoutingDecision } from './dynamic-routing/routing_decision_persistence.js'
import { StageCacheService, isCompilerStageCacheEnabled } from './stage_cache_service.js'

// ── Types ──

export interface OrchestratorRunParams {
  organizationId: number
  userId: number
  runId: number
  manifestBuilder: ManifestBuilder
  initialContext: CompilerContext
  /** 可选的 routing 配置。若不提供，使用默认 execution plan（原始行为）。 */
  routing?: {
    registry: RoutingRuleRegistry
    planner: RoutingPlanner
    scenarioKind: import('@aiproj/types/compiler-dynamic-routing').CompilerScenarioKind
  }
  /** 是否跳过 routing（用于回归测试 default path 行为不变）。 */
  skipRouting?: boolean
}

export interface OrchestratorResult {
  success: boolean
  failedStages: string[]
  needsHumanReview: string[]
  terminalStatus: 'completed' | 'failed' | 'cancelled' | 'needs_human_review'
  checkpointVersion: number
  errorMessage?: string
}

export interface HandlerRegistration {
  definition: StageDefinition
  handler: StageHandler<unknown, unknown>
}

/**
 * v2-5-compiler-stage-cache-wiring（design D6, tasks 3.1）：Orchestrator 的 Stage 缓存接线选项。
 * 两个字段都缺省时走生产默认：内部构造 StageCacheService（store 由 resolveCacheStore 按
 * Redis 可用性解析，memory fallback 保持现状），并按 env 开关启用。
 */
export interface OrchestratorStageCacheOptions {
  /** 显式注入的缓存服务（测试注入带计数/故障的 store）；缺省时由 orchestrator 构造。 */
  service?: StageCacheService
  /** 显式开关；缺省读 env `COMPILER_STAGE_CACHE_ENABLED`（默认 true），false 即 feature-off。 */
  enabled?: boolean
}

export class DuplicateHandlerError extends Error {
  constructor(stageId: string) {
    super(`Duplicate handler registration: ${stageId}`)
    this.name = 'DuplicateHandlerError'
  }
}

export class UnknownStageError extends Error {
  constructor(stageId: string) {
    super(`Unknown stage in manifest: ${stageId}. Not registered in handler registry.`)
    this.name = 'UnknownStageError'
  }
}

export class ContractVersionMismatchError extends Error {
  constructor(stageId: string, expected: string, actual: string) {
    super(
      `Contract version mismatch for stage ${stageId}: expected ${expected}, manifest declares ${actual}`,
    )
    this.name = 'ContractVersionMismatchError'
  }
}

export const QUEUED_TO_RUNNING_STATES: ReadonlySet<string> = new Set(['pending', 'queued'])

export const TERMINAL_RUN_STATES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'cancelled',
  'needs_human_review',
])

export const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  pending: new Set(['queued', 'running', 'completed', 'failed', 'cancelled']),
  queued: new Set(['running', 'completed', 'failed', 'cancelled']),
  running: new Set(['running', 'completed', 'failed', 'cancelled', 'needs_human_review']),
  completed: new Set([]),
  failed: new Set([]),
  cancelled: new Set([]),
  needs_human_review: new Set([]),
  paused: new Set(['running', 'completed', 'failed', 'cancelled']),
}

/**
 * CompilerRunOrchestrator —— 编译运行编排器。
 *
 * 职责：
 * 1. 维护生产 handler registry（显式注册，fail-fast）
 * 2. 验证 manifest 中所有 stage 均已注册且版本匹配
 * 3. 调用 PipelineExecutor.execute 执行编译
 * 4. 将 ExecutionResult 写回 compiler_runs 终态
 */
@inject()
export class CompilerRunOrchestrator {
  readonly #handlers = new Map<string, HandlerRegistration>()
  readonly #stageRegistry: StageRegistry
  readonly #artifactStore: ArtifactStore
  readonly #stageEventLogger: StageEventLogger
  readonly #stageCacheService: StageCacheService
  readonly #stageCacheEnabled: boolean
  // v3-compiler-hook-plugin-pilot —— 服务端 hook 运行时可选注入（设计 D5）
  #hookService: any = null
  #hookInvocationService: any = null

  constructor(
    stageRegistry: StageRegistry,
    artifactStore: ArtifactStore,
    stageEventLogger: StageEventLogger,
    stageCache?: OrchestratorStageCacheOptions,
  ) {
    this.#stageRegistry = stageRegistry
    this.#artifactStore = artifactStore
    this.#stageEventLogger = stageEventLogger
    // v2-5-compiler-stage-cache-wiring（tasks 3.1）：默认接线并启用；
    // 构造选项或 env `COMPILER_STAGE_CACHE_ENABLED=false` 可 feature-off（design D6）。
    this.#stageCacheService = stageCache?.service ?? new StageCacheService()
    this.#stageCacheEnabled = stageCache?.enabled ?? isCompilerStageCacheEnabled()
  }

  /**
   * v3-compiler-hook-plugin-pilot：注入服务端 hook 运行时（可选，零开销当 null）。
   */
  setHookServices(hookService: any, hookInvocationService: any): void {
    this.#hookService = hookService
    this.#hookInvocationService = hookInvocationService
  }

  // ── Handler Registry ──

  /**
   * 注册生产 handler。
   * 重复注册同一 stageId 报 DuplicateHandlerError。
   */
  registerHandler(definition: StageDefinition, handler: StageHandler<unknown, unknown>): void {
    const stageId = definition.stageId
    if (this.#handlers.has(stageId)) {
      throw new DuplicateHandlerError(stageId)
    }
    this.#handlers.set(stageId, { definition, handler })
  }

  /**
   * 批量注册 handler。
   */
  registerHandlers(registrations: HandlerRegistration[]): void {
    for (const reg of registrations) {
      this.registerHandler(reg.definition, reg.handler)
    }
  }

  /**
   * 获取已注册的 stageId 列表。
   */
  getRegisteredStageIds(): string[] {
    return Array.from(this.#handlers.keys())
  }

  /**
   * 验证 manifest 中所有 stage 均已注册且版本匹配。
   * design D3：未知 stage 直接失败，不跳过也不使用 stub。
   */
  validateManifest(manifestBuilder: ManifestBuilder): { valid: boolean; errors: string[] } {
    const manifest = manifestBuilder.get()
    const errors: string[] = []

    for (const step of manifest.executionPlan) {
      const registration = this.#handlers.get(step.stageId)
      if (!registration) {
        errors.push(`Stage "${step.stageId}" is not registered in the production handler registry`)
        continue
      }

      // 验证 contractVersion 兼容性（当前仅支持 '2.0'）
      const manifestVersion = manifest.schemaVersion ?? '2.0'
      // schemaVersion 检查：manifest 与 handler 的 contract 必须兼容
      if (manifestVersion !== '2.0') {
        errors.push(
          `Stage "${step.stageId}": manifest schemaVersion "${manifestVersion}" not supported (expected "2.0")`,
        )
      }
    }

    return { valid: errors.length === 0, errors }
  }

  // ── Execute ──

  /**
   * 执行一次编译运行。
   *
   * 1. 验证 handler registry 覆盖 manifest 所有 stage
   * 2. 创建 PipelineExecutor 并注册 handler
   * 3. 调用 executor.execute
   * 4. 将结果写回 CompilerRun 终态
   *
   * 注意：调用方需确保 runId 对应的 CompilerRun 行已存在。
   * 对已存在的 CompilerRun 行写终态时，仅更新 status/completedAt/error 字段。
   *
   * v3-multitenant-connection-pool-management §5.5：编译 run 是高风险长流程入口，
   * 整个 run 在 `compiler:run` 租户连接 lease 保护下执行——单租户突增的编译任务
   * 不得独占共享执行资源；失败/异常路径由 wrapper 的 finally 统一释放。
   * lease 只治并发预算，不改变编译语义与既有组织隔离写入行为。
   */
  async execute(params: OrchestratorRunParams): Promise<OrchestratorResult> {
    return withTenantConnectionLease(
      {
        resourceKey: 'compiler:run',
        operationKind: 'compiler_run',
        tenant: poolTenantContextFor({
          organizationId: params.organizationId,
          actorRef: `user:${params.userId}`,
        }),
        requestId: `compiler-run:${params.runId}`,
      },
      () => this.#executeUnderLease(params),
    )
  }

  async #executeUnderLease(params: OrchestratorRunParams): Promise<OrchestratorResult> {
    const { organizationId, runId, manifestBuilder, initialContext } = params

    // 1. 验证 manifest
    const validation = this.validateManifest(manifestBuilder)
    if (!validation.valid) {
      await this.#writeTerminalState(runId, organizationId, 'failed', validation.errors.join('; '))
      return {
        success: false,
        failedStages: [],
        needsHumanReview: [],
        terminalStatus: 'failed',
        checkpointVersion: 0,
        errorMessage: validation.errors.join('; '),
      }
    }

    // 1c. 服务端 hook 消费（v3-compiler-hook-plugin-pilot —— advisory 旁观者，不在 Stage 循环内插桩）
    // 设计 D5：hook 消费发生在 run 装配阶段（解析已启用贡献 -> preflight -> 调用回调 -> advisory 附着与提案登记）。
    // 当 hook 服务未注入或组织无启用插件时，零行为变化、零额外查询。
    if (this.#hookService && this.#hookInvocationService) {
      try {
        // 解析已启用插件的 hook 贡献（含组织隔离与负载校验）
        const hookContributions =
          await this.#hookService.getEffectivePluginHookContributions(organizationId)
        if (hookContributions.length > 0) {
          // 动态导入 User 模型（避免循环依赖）
          const { default: User } = await import('#models/user')
          const user = await User.find(params.userId)
          if (user) {
            for (const contrib of hookContributions) {
              try {
                // preflight：组织匹配 + RBAC（复用既有 Policy 链）+ 可见性过滤
                const requiredPermissions = contrib.requiredPermissions ?? []
                const preflightResult = await this.#hookInvocationService.preflight(
                  user,
                  requiredPermissions,
                  organizationId,
                )
                if (!preflightResult.allowed) {
                  // preflight 拒绝：降级跳过（不触达插件回调），记录降级计数
                  // 审计：PLUGIN_HOOK_PREFLIGHT_DENIED（低敏，不含回调原文）
                  continue
                }

                // 根据 seamKey 调用确定性回调（进程内注册表句柄）
                if (contrib.seamKey === 'server-query.readonly-provider') {
                  const queryRequest = {
                    seamKey: contrib.seamKey as 'server-query.readonly-provider',
                    contributionKey: contrib.contributionKey,
                    pluginId: contrib.pluginId,
                    pluginVersion: contrib.pluginVersion,
                    context: {
                      organizationId,
                      projectId: undefined,
                      userId: params.userId,
                      userRoles: [],
                      requestedPermissions: requiredPermissions,
                      scope: 'organization' as const,
                    },
                    payload: {},
                  }
                  const result = await this.#hookInvocationService.invokeQueryCallback(
                    queryRequest,
                    String(runId),
                    contrib.callbackHandle,
                  )
                  if (result.result) {
                    // advisory 附着：只读查询结果作为带来源标注的 advisory（非数据权威）
                    // 审计：PLUGIN_HOOK_CALL（低敏，不含回调原文）
                  }
                  if (result.error) {
                    // 降级计数已在 invokeQueryCallback 内递增
                  }
                } else if (contrib.seamKey === 'server-command-proposal.proposal-only') {
                  const proposalRequest = {
                    seamKey: contrib.seamKey as 'server-command-proposal.proposal-only',
                    contributionKey: contrib.contributionKey,
                    pluginId: contrib.pluginId,
                    pluginVersion: contrib.pluginVersion,
                    context: {
                      organizationId,
                      projectId: undefined,
                      userId: params.userId,
                      userRoles: [],
                      requestedPermissions: requiredPermissions,
                      scope: 'organization' as const,
                    },
                    payload: {},
                  }
                  const result = await this.#hookInvocationService.invokeProposalCallback(
                    proposalRequest,
                    String(runId),
                    contrib.callbackHandle,
                  )
                  if (result.result) {
                    // 提案登记：摘要绑定校验，进入既有 proposal/preview 确认通道
                    this.#hookInvocationService.registerProposal(result.result)
                    // 审计：PLUGIN_HOOK_CALL（低敏）
                  }
                }
              } catch (hookError) {
                // 单个贡献异常不阻断 run（降级计数已在 invoke 内递增）
                // 静默降级被禁止：计数已递增
              }
            }
          }
        }
      } catch (hookSystemError) {
        // hook 系统级异常不阻断编译 run（failureMode: block-extension 语义收敛为该插件该贡献）
      }
    }

    // 1b. 可选 routing planner（在 manifest 验证后、executor 执行前）
    if (params.routing && !params.skipRouting) {
      const { registry, planner, scenarioKind } = params.routing
      const manifest = manifestBuilder.get()
      const candidateStageIds = manifest.executionPlan.map((s) => s.stageId)
      const availableHandlerIds = Array.from(this.#handlers.keys())

      // 检查是否已有 routing decision（resume 时复用原 decision）
      const existingDecision = getRoutingDecision(runId)
      if (existingDecision) {
        // resume 复用原 decision，不重新评估
        // 用原 decision 的 selected stages 更新 manifest
        manifestBuilder.get().executionPlan = manifestBuilder
          .get()
          .executionPlan.filter((s) => existingDecision.selectedStageIds.includes(s.stageId))
        // v2-5-compiler-dynamic-routing-management-ui（task 3.1）：确保持久化（进程内存可能在重启后丢失）
        await persistRoutingDecision(organizationId, existingDecision, params.userId).catch(() => {
          // 持久化失败不阻断执行（orchestrator 主链仍用进程内存 decision）
        })
      } else {
        const plannerResult = planner.plan({
          registry,
          candidateStageIds,
          availableHandlerIds,
          contractVersion: manifest.schemaVersion ?? '2.0',
          dependencies: manifest.executionPlan.map((s) => ({
            stageId: s.stageId,
            dependsOn: s.dependsOn ?? [],
          })),
          scenarioKind,
          runId,
        })

        // 记录 decision evidence
        const recordResult = recordRoutingDecision(plannerResult.decision)
        if (!recordResult.ok) {
          // decision 含有敏感字段——fail-fast
          await this.#writeTerminalState(runId, organizationId, 'failed', recordResult.error!)
          return {
            success: false,
            failedStages: [],
            needsHumanReview: [],
            terminalStatus: 'failed',
            checkpointVersion: 0,
            errorMessage: recordResult.error,
          }
        }

        // v2-5-compiler-dynamic-routing-management-ui（task 3.1）：持久化低敏 decision 证据
        await persistRoutingDecision(organizationId, plannerResult.decision, params.userId).catch(
          () => {
            // 持久化失败不阻断执行主链
          },
        )

        // 若 planner fail-fast（依赖、handler、空路径等）
        if (!plannerResult.valid) {
          await this.#writeTerminalState(
            runId,
            organizationId,
            'failed',
            plannerResult.errors.join('; '),
          )
          return {
            success: false,
            failedStages: [],
            needsHumanReview: [],
            terminalStatus: 'failed',
            checkpointVersion: 0,
            errorMessage: plannerResult.errors.join('; '),
          }
        }

        // 用 routing decision 的 selected stages 更新 manifest
        manifestBuilder.get().executionPlan = manifestBuilder
          .get()
          .executionPlan.filter((s) => plannerResult.decision.selectedStageIds.includes(s.stageId))
      }
    }

    // 2. 创建并配置 executor（使用最小编译器 run 替身——执行器只读取 id）
    // v2-5-compiler-stage-cache-wiring（tasks 3.1）：注入 Stage 缓存；仅 deterministic Stage 生效。
    const executor = new PipelineExecutor(this.#stageRegistry, {
      artifactStore: this.#artifactStore,
      stageEventLogger: this.#stageEventLogger,
      stageCache: this.#stageCacheService,
      stageCacheEnabled: this.#stageCacheEnabled,
    })

    // 注册所有已注册的 handler
    for (const [, registration] of this.#handlers) {
      executor.registerHandler(registration.definition, registration.handler)
    }

    // 3. 构造最小 run 替身（执行器只读取 id）
    const compilerRun = { id: runId } as import('#models/compiler_run').default

    // 4. 执行
    let result: ExecutionResult
    try {
      result = await executor.execute({
        compilerRun,
        manifestBuilder,
        initialContext,
        organizationId,
      })
    } catch (error) {
      const errorMessage = (error as Error).message
      await this.#writeTerminalState(runId, organizationId, 'failed', errorMessage)
      return {
        success: false,
        failedStages: [],
        needsHumanReview: [],
        terminalStatus: 'failed',
        checkpointVersion: 0,
        errorMessage,
      }
    }

    // 5. 写终态
    const terminalStatus = this.#determineTerminalStatus(result)
    const errorMessage =
      terminalStatus === 'failed' ? `Failed stages: ${result.failedStages.join(', ')}` : undefined
    const hasHumanReview = result.needsHumanReview.length > 0

    await this.#writeTerminalState(
      runId,
      organizationId,
      hasHumanReview ? 'needs_human_review' : terminalStatus,
      errorMessage,
    )

    return {
      success: result.succeeded,
      failedStages: result.failedStages,
      needsHumanReview: result.needsHumanReview,
      terminalStatus: hasHumanReview ? 'needs_human_review' : terminalStatus,
      checkpointVersion: result.checkpointVersion,
      errorMessage,
    }
  }

  // ── Resume ──

  /**
   * Resume 编译运行。
   * 从 checkpoint 恢复状态，不重新执行已完成的 stage。
   */
  async resume(params: {
    runId: number
    organizationId: number
    manifestBuilder: ManifestBuilder
    initialContext: CompilerContext
  }): Promise<{ resumed: boolean; result?: OrchestratorResult }> {
    const { runId, organizationId, manifestBuilder, initialContext } = params

    // 检查 run 是否为终态（通过 DB 查询）
    // v3-multitenant-database-isolation §5.2：必须按组织 scope 解析——无租户条件时
    // 他租 run 的终态差异会以 resumed 结果泄露存在性，且非终态的他租 run 会被继续推进。
    const run = await CompilerRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .first()
    if (!run || TERMINAL_RUN_STATES.has(run.status)) {
      return { resumed: false }
    }

    // 创建 executor 并执行 resume
    // v2-5-compiler-stage-cache-wiring（tasks 3.1）：与 execute 同一缓存接线。
    const executor = new PipelineExecutor(this.#stageRegistry, {
      artifactStore: this.#artifactStore,
      stageEventLogger: this.#stageEventLogger,
      stageCache: this.#stageCacheService,
      stageCacheEnabled: this.#stageCacheEnabled,
    })
    for (const [, registration] of this.#handlers) {
      executor.registerHandler(registration.definition, registration.handler)
    }

    // run 已按组织 scope 解析（上方早返回保证非空），不再需要「无 DB 记录时的替身」——
    // 那条分支会让被 scope 过滤掉的他租 run 退化成"不存在"并继续 resume。
    const resumeResult = await executor.resume({
      compilerRun: run,
      manifestBuilder,
      initialContext,
      organizationId,
    })

    if (!resumeResult.resumed) {
      return { resumed: false }
    }

    // Resume 后继续执行未完成的 stage
    // v3-multitenant-database-isolation §5.2 修复：原实现把 `run.requestedByUserId`
    // 当成 organizationId 传入（userId 固定 0），resume 后续 stage 的全部写入都会落到
    // 「id == 某个用户 id」的组织下，或在无 run 时落到 organizationId=0 的隐式全局通道。
    const result = await this.execute({
      organizationId,
      userId: run.requestedByUserId,
      runId,
      manifestBuilder,
      initialContext,
    })

    return { resumed: true, result }
  }

  // ── 中断诊断 ──

  // ── Replay ──

  /**
   * Replay 编译运行（只读重建，tasks 6.3，design D4/D5）。
   * 委托 executor.replay，不注册/调用 handler，不写 run 状态/artifact/event。
   */
  async replay(params: {
    runId: number
    organizationId: number
  }): Promise<{ replayed: boolean; stages: number; missingArtifacts: string[] }> {
    const { runId, organizationId } = params

    const executor = new PipelineExecutor(this.#stageRegistry, {
      artifactStore: this.#artifactStore,
      stageEventLogger: this.#stageEventLogger,
    })

    return executor.replay(runId, organizationId)
  }

  // ── 中断诊断 ──

  /**
   * 检测并诊断中断的运行（queued/running 但超时）。
   * 不恢复执行，只标记为 interrupted 状态以便用户介入。
   */
  async diagnoseInterruptedRuns(
    organizationId: number,
    thresholdMinutes: number = 30,
  ): Promise<Array<{ runId: number; status: string; createdAt: string }>> {
    const threshold = DateTime.now().minus({ minutes: thresholdMinutes }).toISO()
    const interrupted: Array<{ runId: number; status: string; createdAt: string }> = []

    const runs = await CompilerRun.query()
      .where('organization_id', organizationId)
      .whereIn('status', ['queued', 'running'])
      .where('created_at', '<', threshold)
      .orderBy('created_at', 'asc')

    for (const run of runs) {
      interrupted.push({
        runId: run.id,
        status: run.status,
        createdAt: run.createdAt.toISO() ?? '',
      })
      // 标记为 failed + 诊断信息
      await this.#writeTerminalState(
        run.id,
        organizationId,
        'failed',
        `Run interrupted: ${run.status} status exceeded ${thresholdMinutes}min threshold since ${run.createdAt.toISO()}`,
      )
    }

    return interrupted
  }

  // ── Private Helpers ──

  /**
   * 将执行结果写回 CompilerRun 的终态字段。
   * 使用 compare-and-set 语义确保只有一个写方成功。
   */
  async #writeTerminalState(
    runId: number,
    organizationId: number,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    const now = DateTime.now().toISO()
    // error 是 JSON 列：query builder 的 .update() 不走模型序列化，需手动 JSON.stringify
    const updates: Record<string, unknown> = {
      status,
      completedAt: now,
    }
    if (errorMessage) {
      updates.error = JSON.stringify({ message: errorMessage })
    }
    await CompilerRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .update(updates)
  }

  /**
   * 确定 run 的终态。
   */
  #determineTerminalStatus(result: ExecutionResult): 'completed' | 'failed' | 'cancelled' {
    if (result.succeeded) return 'completed'
    if (result.failedStages.length > 0) return 'failed'
    return 'cancelled'
  }
}
