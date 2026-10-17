/**
 * v2-5-compiler-run-executor-wiring —— CompilerRunService（tasks 2.1-3.6）。
 *
 * 发起编译、查询 run 状态、查询 Stage events、读取最新 Ledger/PDM 预览、
 * Resume run。所有查询自动附加 organization_id。
 *
 * 扩展：startRun 现在通过 CompilerRunOrchestrator 驱动完整编译流程。
 * design D1：Controller 只处理 HTTP，service 委托 orchestrator。
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'
import CompilerRun from '#models/compiler_run'
import CompilerStageEvent from '#models/compiler_stage_event'
import { StageRegistry } from './stage_registry.js'
import { ManifestBuilder, type StageBlueprint } from './manifest_builder.js'
import { PipelineExecutor } from './pipeline_executor.js'
import type { CompilerContext } from './context_scope_resolver.js'
import { ArtifactStore } from './artifact_store.js'
import { CompilerRunOrchestrator, type OrchestratorResult } from './compiler_run_orchestrator.js'
import type { CompletenessLedger } from '@aiproj/compiler-spec'

export interface StartRunParams {
  organizationId: number
  userId: number
  input: Record<string, unknown>
  idempotencyKey?: string
  orchestrator?: CompilerRunOrchestrator
  manifestBlueprints?: StageBlueprint[]
  templateSnapshot?: Record<string, unknown> | null
  templateSelectionDigest?: string | null
}

export interface StageEventQuery {
  page?: number
  perPage?: number
}

export interface PaginatedResult<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

@inject()
export class CompilerRunService {
  constructor(
    readonly stageRegistry: StageRegistry,
    readonly artifactStore: ArtifactStore,
  ) {}

  /**
   * 发起编译。
   *
   * V2.5 扩展（tasks 3.1-3.3）：
   * 1. 幂等检查：相同 idempotencyKey + organizationId 时返回既有 run
   * 2. 创建 queued run
   * 3. 如果提供了 orchestrator，通过编排器执行完整编译
   */
  async startRun(params: StartRunParams): Promise<CompilerRun> {
    // 幂等检查
    if (params.idempotencyKey) {
      const existing = await CompilerRun.query()
        .where('organization_id', params.organizationId)
        .where('idempotency_key', params.idempotencyKey)
        .first()

      if (existing) {
        return existing
      }
    }

    // 创建 queued run
    const inputHash = this.#computeInputHash(params.input)
    const run = await CompilerRun.create({
      organizationId: params.organizationId,
      requestedByUserId: params.userId,
      status: 'queued',
      input: params.input,
      currentPhase: null,
      currentStage: null,
      startedAt: DateTime.now(),
      idempotencyKey: params.idempotencyKey ?? null,
      inputHash: inputHash,
      templateSnapshot: params.templateSnapshot ?? null,
      templateSelectionDigest: params.templateSelectionDigest ?? null,
    } as any)

    // 如果提供了 orchestrator 和 blueprints，异步执行编译
    if (params.orchestrator && params.manifestBlueprints && params.manifestBlueprints.length > 0) {
      // 使用 setTimeout 异步执行，不阻塞 HTTP 返回
      setImmediate(async () => {
        try {
          await this.#executeWithOrchestrator(
            run,
            params.orchestrator!,
            params.manifestBlueprints!,
            {
              userInput: params.input,
              runMetadata: {
                compilerRunId: run.id,
                organizationId: params.organizationId,
                requestedByUserId: params.userId,
              },
              stageOutputs: new Map(),
              blueprints: {},
              fullDraft: {},
            },
          )
        } catch {
          // 异步执行失败不抛到 HTTP 层——run 已创建，查询端可看到失败状态
        }
      })
    }

    return run
  }

  /**
   * 执行异步编译（由 controller 在创建 run 后调用）。
   * 从 queued 推进到 running，并通过 orchestrator 执行。
   */
  async executeCompilation(params: {
    run: CompilerRun
    orchestrator: CompilerRunOrchestrator
    manifestBuilder: ManifestBuilder
    initialContext: CompilerContext
  }): Promise<OrchestratorResult> {
    const { run, orchestrator, manifestBuilder, initialContext } = params

    // queued → running
    await CompilerRun.query()
      .where('id', run.id)
      .whereIn('status', ['queued', 'running'])
      .update({ status: 'running' })

    // 通过 orchestrator 执行
    return orchestrator.execute({
      organizationId: run.organizationId,
      userId: run.requestedByUserId,
      runId: run.id,
      manifestBuilder,
      initialContext,
    })
  }

  /**
   * 快速校验（不含幂等写入）。用于 controller 先校验再创建。
   */
  async validateIdempotency(
    organizationId: number,
    idempotencyKey?: string,
  ): Promise<{ conflict: boolean; existingRunId?: number }> {
    if (!idempotencyKey) return { conflict: false }

    const existing = await CompilerRun.query()
      .where('organization_id', organizationId)
      .where('idempotency_key', idempotencyKey)
      .first()

    if (existing) {
      return { conflict: true, existingRunId: existing.id }
    }

    return { conflict: false }
  }

  /** 查询 run 状态。 */
  async getRun(organizationId: number, runId: number): Promise<CompilerRun | null> {
    return CompilerRun.forOrganization(organizationId).where('id', runId).first()
  }

  /** 查询 Stage events。 */
  async getEvents(
    organizationId: number,
    runId: number,
    query?: StageEventQuery,
  ): Promise<PaginatedResult<CompilerStageEvent>> {
    const page = query?.page ?? 1
    const perPage = query?.perPage ?? 50

    const baseQuery = CompilerStageEvent.forOrganization(organizationId).where(
      'compiler_run_id',
      runId,
    )

    const total = await baseQuery
      .clone()
      .count('* as total')
      .then((r) => {
        const row = r[0]
        return Number((row as any)?.$extras?.total ?? (row as any)?.total ?? 0)
      })

    const data = await baseQuery
      .orderBy('id', 'asc')
      .offset((page - 1) * perPage)
      .limit(perPage)

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    }
  }

  /** 读取最新 Ledger（从 artifact 恢复）。 */
  async getLatestLedger(organizationId: number, runId: number): Promise<CompletenessLedger | null> {
    const run = await this.getRun(organizationId, runId)
    if (!run) return null

    const artifact = await this.artifactStore.latest(runId, 'ledger')
    if (!artifact) return null

    return artifact.payload as unknown as CompletenessLedger
  }

  /** 读取最新 PDM 预览（从 artifact 恢复）。 */
  async getLatestPdm(
    organizationId: number,
    runId: number,
  ): Promise<Record<string, unknown> | null> {
    const run = await this.getRun(organizationId, runId)
    if (!run) return null

    const artifact = await this.artifactStore.latest(runId, 'pdm')
    if (!artifact) return null

    return artifact.payload
  }

  /** Resume run。 */
  async resumeRun(
    organizationId: number,
    runId: number,
    executor: PipelineExecutor,
    manifestBuilder: ManifestBuilder,
    initialContext: CompilerContext,
  ): Promise<{ resumed: boolean; run: CompilerRun | null }> {
    const run = await this.getRun(organizationId, runId)
    if (!run) return { resumed: false, run: null }

    const result = await executor.resume({
      compilerRun: run,
      manifestBuilder,
      initialContext,
      organizationId,
    })

    return { resumed: result.resumed, run }
  }

  /**
   * Resume 运行级 compare-and-set 推进护栏（tasks 3.1，design D2）。
   * 原子转移：只将一个 RESUMABLE 状态的 run 推进到 running。
   * 返回 affected 行数，0 表示已有推进方或终态。
   */
  async #acquireResumeLock(
    runId: number,
    organizationId: number,
  ): Promise<{ acquired: boolean; currentStatus?: string }> {
    const RESUMABLE: ReadonlySet<string> = new Set(['pending', 'queued', 'running', 'paused'])
    const affected = (await CompilerRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .whereIn('status', Array.from(RESUMABLE))
      .update({ status: 'running' })) as unknown as number

    if (affected > 0) {
      return { acquired: true }
    }

    // 未抢到：查当前状态返回
    const run = await CompilerRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .first()
    return { acquired: false, currentStatus: run?.status ?? 'unknown' }
  }

  // ── 幂等 Key 存储（用于 resume idempotency key） ──
  static readonly _resumeIdempotencyResults = new Map<
    string,
    { resumed: boolean; result?: OrchestratorResult }
  >()

  /**
   * 通过 orchestrator resume 编译。
   * v2-5-compiler-resume-replay-wiring（tasks 3.1/3.3/4.1-4.3，design D2/D3）：
   * - CAS 推进护栏防止并发重入
   * - 从 checkpoint 还原真实 manifest，删除硬编码 3-stage stub
   * - 无可还原 checkpoint 时返回 resumed=false
   * - 可选 idempotency key：相同 key 重试返回同一结果不重复推进（tasks 3.3）
   */
  async resumeCompilation(
    orchestrator: CompilerRunOrchestrator,
    runId: number,
    organizationId: number,
    idempotencyKey?: string,
  ): Promise<{ resumed: boolean; result?: OrchestratorResult }> {
    // 幂等 key 检查（tasks 3.3）：相同 key 直接返回已有结果
    if (idempotencyKey) {
      const key = `${organizationId}:${runId}:${idempotencyKey}`
      const existing = CompilerRunService._resumeIdempotencyResults.get(key)
      if (existing) {
        return existing
      }
    }

    // CAS 推进护栏：同一 run 同时只有一个推进方
    const lock = await this.#acquireResumeLock(runId, organizationId)
    if (!lock.acquired) {
      return { resumed: false }
    }

    // v3-multitenant-database-isolation §5.2：resume 必须先按组织 scope 解析 run。
    // 原实现用 CompilerRun.find(runId) 无租户条件，他租 runId 可被恢复推进（跨租写入）。
    const run = await CompilerRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .first()
    if (!run) return { resumed: false }

    // 从 checkpoint 还原真实 manifest
    const checkpoints = await this.artifactStore.getCheckpoints(runId)
    if (checkpoints.length === 0) {
      // 无可还原 checkpoint → 写回 queued 允许再次尝试
      await CompilerRun.query()
        .where('id', runId)
        .where('organization_id', organizationId)
        .update({ status: 'queued' })
      return { resumed: false }
    }

    const latestCheckpoint = checkpoints[0]!
    const payload = latestCheckpoint.payload as any
    const savedManifest = payload?.manifest

    if (!savedManifest?.executionPlan || savedManifest.executionPlan.length === 0) {
      // checkpoint 不含有效 manifest → 回退到 queued
      await CompilerRun.query()
        .where('id', runId)
        .where('organization_id', organizationId)
        .update({ status: 'queued' })
      return { resumed: false }
    }

    // 从 savedManifest 还原 blueprints
    const blueprints: StageBlueprint[] = savedManifest.executionPlan.map((step: any) => ({
      stageId: step.stageId,
      phase: step.phase ?? 'default',
      dependsOn: step.dependsOn ?? [],
      entities: step.entities ?? [],
    }))

    const manifestBuilder = new ManifestBuilder(runId, blueprints)

    // 回填 stage 状态（completed/failed）
    for (const step of savedManifest.executionPlan ?? []) {
      if (step.status === 'completed' || step.status === 'failed') {
        manifestBuilder.updateStepStatus(step.stageId, step.status, step.errorSummary)
      }
    }

    const initialContext = {
      userInput: run.input,
      runMetadata: {
        compilerRunId: run.id,
        organizationId,
        requestedByUserId: run.requestedByUserId,
      },
      stageOutputs: new Map<string, unknown>(),
      blueprints: {},
      fullDraft: {},
    }

    const result = await orchestrator.resume({
      runId,
      organizationId,
      manifestBuilder,
      initialContext,
    })

    // 存储幂等 key 结果（tasks 3.3）
    if (idempotencyKey) {
      const key = `${organizationId}:${runId}:${idempotencyKey}`
      CompilerRunService._resumeIdempotencyResults.set(key, result)
    }

    return result
  }

  /**
   * Replay run（只读重建，tasks 6.2，design D4/D5）。
   * 委托 orchestrator.replay，不写 run 状态/artifact/event。
   */
  async replayRun(
    organizationId: number,
    runId: number,
    orchestrator: CompilerRunOrchestrator,
  ): Promise<{ replayed: boolean; stages: number; missingArtifacts: string[] }> {
    const run = await this.getRun(organizationId, runId)
    if (!run) {
      return { replayed: false, stages: 0, missingArtifacts: [] }
    }

    return orchestrator.replay({ runId, organizationId })
  }

  // ── Private ──

  /** 通过编排器执行编译（v3-template-compiler-plugin-integration：先做 template overlay）。 */
  async #executeWithOrchestrator(
    run: CompilerRun,
    orchestrator: CompilerRunOrchestrator,
    blueprints: StageBlueprint[],
    initialContext: import('#services/compiler/context_scope_resolver').CompilerContext,
  ): Promise<OrchestratorResult> {
    const manifestBuilder = new ManifestBuilder(run.id, blueprints)

    // queued → running
    await CompilerRun.query()
      .where('id', run.id)
      .whereIn('status', ['queued', 'running'])
      .update({ status: 'running' })

    // v3-template-compiler-plugin-integration: host defaults < template < user, with blocking
    let effectiveContext = initialContext
    const snapshot = (run as any).templateSnapshot as Record<string, unknown> | null
    if (snapshot) {
      try {
        const { HOST_DEFAULT_COMPILER_INPUT, applyTemplateOverlay } =
          await import('./compiler_template_overlay_service.js')
        const overlay = applyTemplateOverlay({
          hostDefaults: HOST_DEFAULT_COMPILER_INPUT as Record<string, unknown>,
          snapshot: snapshot as any,
          userInput: (run.input as Record<string, unknown>) ?? {},
        })
        const hasBlocking = overlay.findings.some((f) => f.severity === 'blocking')
        if (!hasBlocking) {
          effectiveContext = {
            ...initialContext,
            userInput: overlay.merged as Record<string, unknown>,
          }
        }
      } catch {
        // overlay 失败则沿用原始 input，不阻断编排
      }
    }

    // 通过编排器执行
    return orchestrator.execute({
      organizationId: run.organizationId,
      userId: run.requestedByUserId,
      runId: run.id,
      manifestBuilder,
      initialContext: effectiveContext,
    })
  }

  /** 计算输入的确定性 hash。 */
  #computeInputHash(input: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex')
  }
}
