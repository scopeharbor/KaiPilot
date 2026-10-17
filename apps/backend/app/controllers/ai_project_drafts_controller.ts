/**
 * ai-draft-generation / T036·T037 —— 草案生成与审查 API（tasks 3.3）。
 *
 * 只做 HTTP 解析、权限、SSE 格式化与审计；生成/持久化/校验下沉到 services/ai_draft/*。
 * 契约：成功 `{ data }`；错误 `{ error: { code, message, details? } }`；SSE 事件为 UI 状态来源。
 * 红线：本控制器绝不写正式业务表；跨组织/他人草案一律 RESOURCE_NOT_FOUND（不泄露存在性）。
 */

import { scheduleProjectSignalDetection } from '#services/project_signal/signal_auto_detect'
import { assessDraft, replanDraft } from '#services/ai_planning/draft_replan_service'
import {
  applyFeasibilityDecision,
  assessFeasibility,
  negotiateFeasibility,
} from '#services/ai_planning/feasibility_service'
import type { HttpContext } from '@adonisjs/core/http'
import Project from '#models/project'
import type {
  ConfirmedProjectContext,
  ConfirmProjectDraftRequest,
  ProjectDraftGenerationStage,
  ProjectDraftModule,
  ProjectDraftStreamEvent,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import {
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import User from '#models/user'
import OrganizationMember from '#models/organization_member'
import type AiProjectDraft from '#models/ai_project_draft'
import AiProjectDraftValidation from '#models/ai_project_draft_validation'
import AiProjectDraftVersion from '#models/ai_project_draft_version'
import AiProjectDraftPolicy from '#policies/ai_project_draft_policy'
import AuditService, { AuditEvent, type AuditEventType } from '#services/audit_service'
import NotificationService from '#services/notification_service'
import { resolveAdapter } from '#services/ai_m0/resolver'
import {
  AiConnectionRequiredException,
  assertAiConnectionAvailable,
} from '#services/ai_m0/ai_connection_requirement'
import { ProjectDraftGenerationService } from '#services/ai_draft/generation_service'
import { resolveDraftGenerationBudget } from '#services/ai_draft/generation_budget'
import ProjectDraftSessionService from '#services/ai_draft/session_service'
import ProjectDraftImportService, { applyModifications } from '#services/ai_draft/import_service'
import type { ImportDraftResult } from '#services/ai_draft/import_service'
import {
  applyGenerationQualityGate,
  draftValidationGateway,
} from '#services/ai_draft/validation_gateway'
import { validateSemanticGrounding } from '#services/ai_draft/semantic_grounding_gate'
import { computePlanInsights } from '#services/ai_draft/plan_insights'
import {
  generateDraftBodySchema,
  confirmDraftBodySchema,
  validateDraftBodySchema,
  aiFixDraftBodySchema,
} from '#validators/ai_draft_validator'
import AiDraftFixService, { applyDraftFixOperations } from '#services/ai_draft/ai_draft_fix_service'
import type { GenerateDraftResult } from '#services/ai_draft/generation_service'
import type { DraftValidationReport } from '@aiproj/types'
import { draftGenerationRunner } from '#services/ai_draft/draft_generation_runner'
import {
  createScannerState,
  scanChunk,
  type ScannerState,
} from '#services/ai_draft/incremental_scanner'
import { LIVE_OUTPUT_FLUSH_CHARS, createOutputFlusher } from '#services/ai_draft/output_flusher'
import {
  isLiveOutputId,
  liveOutputHub,
  liveOutputOwner,
  streamCallToLiveOutput,
} from '#services/ai_live_output/live_output_hub'
import {
  planningDurationFactor,
  planningMemoryFacts,
  recallPlanningMemory,
} from '#services/ai_draft/planning_memory'
import { applyCoreAnswers, rawInputHasTeam } from '#services/ai_intent/core_information_needs'
import { contextTeamRoster } from '#services/ai_draft/resource_plan'
import { analyzePlanUnderstanding } from '#services/ai_draft/understanding_service'
import { analysisJobs } from '#services/ai_analysis/lucid_analysis_job_repository'
import { analysisJobRequestValidator } from '#validators/analysis_job_validator'
import { PROJECT_DRAFT_MODULES } from '@aiproj/types'

const DRAFT_MODEL_CAPABILITIES = ['project_draft', 'chat'] as const

/** 生成阶段 → 审查面板模块（阶段完成即推送对应模块完成事件）。 */
const STAGE_MODULES: Partial<Record<ProjectDraftGenerationStage, ProjectDraftModule[]>> = {
  charter_scope: ['charter'],
  wbs_tasks: ['wbs', 'tasks'],
  schedule_dependencies: ['dependencies', 'ganttPreview'],
  resources_risks_acceptance: ['acceptance', 'resource', 'risk', 'milestone'],
}
// 大型行业项目的最终复核要输出完整 ProjectDraft；仍会再被模型自身 maxOutputTokens 夹紧。
const PROJECT_DRAFT_MAX_OUTPUT_TOKENS = 262_144

/**
 * 计划体检（日历 / 产能 / 置信区间 / 阶段门 / 追溯链）写入草案 meta，随版本持久化供审查页展示。
 * 纯确定性推导；失败不影响草案本身（体检缺席时审查页只是不显示该面板）。
 */
function attachPlanInsights(
  result: {
    draft?: unknown
    meta?: { planInsights?: unknown; groundingManifest?: unknown } | null
  },
  rawInput: string,
): void {
  if (!result.draft || !result.meta) return
  try {
    result.meta.planInsights = computePlanInsights({
      draft: result.draft as Record<string, unknown>,
      rawInput,
      manifest: result.meta.groundingManifest as Parameters<
        typeof computePlanInsights
      >[0]['manifest'],
    })
  } catch {
    // 体检只是附加信息，不能因为它让一次十几分钟的生成失败。
  }
}

const DRAFT_FAILURE_MESSAGES: Record<string, string> = {
  GENERATION_BUDGET_EXHAUSTED:
    '生成阶段超过安全预算（耗时或模型输出长度），已停止本次生成；请重试。',
  MODEL_PROVIDER_CALL_FAILED: '模型供应商调用失败，请检查连接状态后重试。',
  MODEL_RESPONSE_JSON_INVALID: '模型返回的草案格式不完整，自动修复后仍无法解析。',
  MODEL_STAGE_OUTPUT_INCOMPLETE: '模型遗漏了当前阶段的必要内容，自动修复后仍不完整。',
  GROUNDING_VALIDATION_FAILED: '草案未完整覆盖已确认事实，已阻止进入确认导入。',
  STAGE_GENERATION_FAILED: '草案阶段生成失败，请根据当前输入重试。',
  AI_SERVICE_BUSY: '生成服务繁忙，请稍后重试。',
  AI_SERVICE_ERROR: '草案生成失败，请稍后重试或调整输入。',
}

function safeDraftFailureMessage(errorCode: string): string {
  return DRAFT_FAILURE_MESSAGES[errorCode] ?? DRAFT_FAILURE_MESSAGES.AI_SERVICE_ERROR!
}

function estimateDraftTokens(context: ConfirmedProjectContext): number {
  return Math.max(1, Math.ceil(context.rawInput.length / 4) + 2_000)
}

/** 写库重试一次：远端 PG（Supabase pooler）偶发断连时，连接池会为重试换一条新连接。 */
async function withOneRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch {
    return operation()
  }
}

function draftGenerationAbortSignal(): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort('draft-generation-timeout'),
    resolveDraftGenerationBudget().requestTimeoutMs,
  )
  timeout.unref?.()
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeout),
  }
}

@inject()
export default class AiProjectDraftsController {
  constructor(
    private readonly generation: ProjectDraftGenerationService,
    private readonly sessions: ProjectDraftSessionService,
    private readonly imports: ProjectDraftImportService,
    private readonly policy: AiProjectDraftPolicy,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  private readonly runner = draftGenerationRunner

  /** 全自动修正阻断项（测试可覆写）。 */
  draftFix = new AiDraftFixService()

  /** POST /api/v1/ai/project-drafts/stream —— 生成草案并以 SSE 推送模块进度。 */
  async stream(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const context = this.parseContext(ctx)

    // §6.1: 前置快速失败（openSse 之前，失败仍走 HTTP 错误契约）
    await this.groundTeamSize(context, organizationId)
    await this.attachPlanningMemory(context, organizationId, user.id)
    const body = ctx.request.body() as { connectionId?: number; modelId?: number }
    const resolved = await resolveAdapter({
      connectionId: body.connectionId,
      modelId: body.modelId,
      organizationId,
      requiredCapabilities: [...DRAFT_MODEL_CAPABILITIES],
      recordContext: {
        organizationId,
        userId: user.id,
        connectionId: body.connectionId ?? null,
        modelId: body.modelId ?? null,
        capability: 'project_draft',
        surface: 'ai-create-draft',
        workflowName: 'five-stage-project-draft-generation',
      },
    })
    // 没有可用 AI 连接：提示先去设置添加，不开流、不调用模型（个人版导出 3.3）
    assertAiConnectionAvailable(resolved)

    // 并发上限检查
    if (this.runner.activeCount >= this.runner.maxRunners) {
      throw new ValidationException('生成服务繁忙，请稍后重试。')
    }

    // §6.1: 预分配会话行，拿到 draftUid（此时尚未开流，失败仍可走 HTTP 错误）
    let session: AiProjectDraft
    let draftUid: string
    try {
      session = await this.sessions.createPending({
        organizationId,
        userId: user.id,
        projectType: context.parsedIntent.projectType,
      })
      draftUid = session.draftUid
    } catch (error) {
      // createPending 自身失败 → 尚未开流，直接走 HTTP 错误
      throw new ValidationException('无法创建草案会话，请稍后重试。')
    }

    // §6.1: 打开 SSE 通道（flush 后不可逆）
    const raw = this.openSse(ctx, draftUid)

    try {
      // 发 draft.started（SSE 先于模型调用打开）
      const startedEvent: ProjectDraftStreamEvent = {
        type: 'draft.started',
        draftId: draftUid,
        version: 1,
        sequence: 1,
        projectType: context.parsedIntent.projectType,
        modules: [...PROJECT_DRAFT_MODULES],
      }
      await this.sessions.appendEvent(session, startedEvent)
      this.writeSseEvents(raw, [startedEvent])

      // §6.1: 启动 runner（分离运行生成）
      const registered = this.runner.register(draftUid, session, 1, startedEvent.sequence)
      if (!registered) {
        const failedEvent: ProjectDraftStreamEvent = {
          type: 'draft.failed',
          draftId: draftUid,
          version: 1,
          sequence: 0,
          errorCode: 'AI_SERVICE_BUSY',
          message: '生成服务繁忙，请稍后重试。',
          consistency: 'failed',
          reasonCode: 'AI_SERVICE_BUSY',
        }
        await this.sessions.appendEvent(session, failedEvent)
        await this.sessions.setStatus(session, 'error')
        this.writeSseEvents(raw, [failedEvent])
        raw.end()
        return
      }

      // §5.2 + §6.1: 用 gateway.stream() 逐 chunk 流式生成
      const scannerState = createScannerState()
      // 分离运行：任何漏网的 rejection 都只能终止本次生成，绝不能冒泡成 unhandledRejection 杀进程。
      this.runStreamingGeneration(ctx, draftUid, session, context, resolved, scannerState).catch(
        (error) => {
          ctx.logger.error({ err: error, draftUid }, '草案后台生成异常退出')
          this.runner.fail(draftUid)
        },
      )

      // §6.1 + §6.3: tail 事件写 SSE
      let runnerOffset = 0
      while (this.runner.isRunning(draftUid)) {
        await this.runner.waitForChange(draftUid, 15_000)
        const batch = this.runner.readBatch(draftUid, runnerOffset)
        runnerOffset = batch.nextOffset
        if (!this.isWritable(raw)) return
        if (batch.events.length > 0) this.writeSseEvents(raw, batch.events)
      }

      // 生成结束后再 drain 一次，避免 complete 通知与 while 条件之间丢尾事件。
      const finalBatch = this.runner.readBatch(draftUid, runnerOffset)
      if (this.isWritable(raw) && finalBatch.events.length > 0) {
        this.writeSseEvents(raw, finalBatch.events)
      }
    } catch (error) {
      // §6.2: SSE 打开后的失败走流内 draft.failed
      // 客户端断开只停止当前 socket 写入；后台 runner 继续执行。
      if (this.runner.isRunning(draftUid)) return
      if (this.isWritable(raw)) {
        const failedEvent: ProjectDraftStreamEvent = {
          type: 'draft.failed',
          draftId: draftUid,
          version: 1,
          sequence: 0,
          errorCode: 'AI_SERVICE_ERROR',
          message: '草案生成失败，请稍后重试或调整输入。',
          consistency: 'failed',
          reasonCode: 'AI_SERVICE_ERROR',
        }
        await this.sessions.appendEvent(session, failedEvent).catch(() => undefined)
        this.writeSseEvents(raw, [failedEvent])
      }
    } finally {
      if (this.isWritable(raw)) raw.end()
    }
  }

  /**
   * POST /api/v1/ai/project-drafts/understanding —— 生成前的项目理解（问题 / 成功画面 / 能力地图）。
   * 返回给就绪页供用户确认或编辑，不创建正式项目；后台模式持久化可恢复结果。
   * 用户确认后随生成请求的 context.planUnderstanding 回传。
   */
  private async prepareUnderstanding(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const requestContext = structuredClone(ctx.request.input('context'))
    const context = this.parseContext(ctx)
    await this.groundTeamSize(context, organizationId)
    await this.attachPlanningMemory(context, organizationId, user.id)
    const body = ctx.request.body() as {
      connectionId?: number
      modelId?: number
      liveOutputId?: string
    }
    const liveId =
      isLiveOutputId(body.liveOutputId) &&
      liveOutputHub.claim(body.liveOutputId, liveOutputOwner(organizationId, user.id))
        ? body.liveOutputId
        : null
    return {
      userId: user.id,
      organizationId,
      context,
      requestContext,
      connectionId: body.connectionId,
      modelId: body.modelId,
      liveId,
    }
  }

  async understanding(ctx: HttpContext) {
    const args = await this.prepareUnderstanding(ctx)
    const abort = draftGenerationAbortSignal()
    try {
      return ctx.response.ok({
        data: await analyzePlanUnderstanding({ ...args, signal: abort.signal }),
      })
    } catch (error) {
      if (error instanceof AiConnectionRequiredException) throw error
      ctx.logger.warn({ err: error }, '项目理解生成失败')
      return ctx.response
        .status(502)
        .send({ error: { code: 'AI_SERVICE_ERROR', message: '项目理解生成失败，可以稍后重试。' } })
    } finally {
      abort.dispose()
    }
  }

  async understandingJob(ctx: HttpContext) {
    const args = await this.prepareUnderstanding(ctx)
    const { requestKey } = await ctx.request.validateUsing(analysisJobRequestValidator)
    const job = await analysisJobs.submit({
      owner: { organizationId: args.organizationId, userId: args.userId },
      requestKey,
      kind: 'understanding',
      input: {
        context: args.requestContext,
        connectionId: args.connectionId,
        modelId: args.modelId,
      },
      liveOutputId: args.liveId,
      run: (signal) => analyzePlanUnderstanding({ ...args, signal }),
    })
    if (args.liveId && job.liveOutputId !== args.liveId) liveOutputHub.close(args.liveId)
    return ctx.response.accepted({ data: job })
  }

  /**
   * 生成前评估能否如期完成（项目理解确认后、开始生成前）。只读、不落库：
   * 模型估工作量并指出矛盾（可调用计划工具箱），程序算产能与各方案的日期 / 人数。
   */
  async feasibility(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const context = this.parseContext(ctx)
    await this.groundTeamSize(context, organizationId)
    await this.attachPlanningMemory(context, organizationId, user.id)
    const body = ctx.request.body() as {
      connectionId?: number
      modelId?: number
      liveOutputId?: string
    }
    const liveId =
      isLiveOutputId(body.liveOutputId) &&
      liveOutputHub.claim(body.liveOutputId, liveOutputOwner(organizationId, user.id))
        ? body.liveOutputId
        : null
    try {
      const resolved = await this.resolvePlanningGateway(
        body,
        organizationId,
        user.id,
        'project-feasibility',
      )
      const assessment = await streamCallToLiveOutput(
        liveId,
        '评估工作量与能否如期完成',
        '1',
        (onText, onReasoning) =>
          assessFeasibility({
            gateway: resolved.gateway,
            context,
            now: new Date(),
            onText,
            onReasoning,
          }),
        resolved.model,
      )
      return ctx.response.ok({ data: { assessment } })
    } catch (error) {
      if (error instanceof AiConnectionRequiredException) throw error
      ctx.logger.warn({ err: error }, '可行性评估失败')
      return ctx.response.status(502).send({
        error: {
          code: 'AI_SERVICE_ERROR',
          message: '评估没有完成，可以直接开始生成，或稍后重试。',
        },
      })
    } finally {
      if (liveId) liveOutputHub.close(liveId)
    }
  }

  /** 就能否如期完成和用户对话：模型回应并提方案，程序核算数字；只返回建议，用户确认才生效。 */
  async negotiate(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const body = ctx.request.body() as {
      connectionId?: number
      modelId?: number
      liveOutputId?: string
      assessment?: unknown
      history?: unknown
      message?: unknown
    }
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message || message.length > 1_000)
      throw new ValidationException('请用 1–1000 字说说你的想法')
    // 审查页（/:id/replan/negotiate）：评估以服务端按这份草案真实排期算的为准，不信客户端带来的那份。
    const ownedSession = ctx.params.id ? await this.loadOwned(ctx, organizationId, user.id) : null
    const activeVersion = ownedSession ? await this.requireActiveVersion(ownedSession) : null
    const reviewDraft = activeVersion
      ? (activeVersion.draft as unknown as Record<string, unknown>)
      : null
    if (!reviewDraft && (typeof body.assessment !== 'object' || body.assessment === null)) {
      throw new ValidationException('缺少可行性评估结果')
    }
    const assessment = (reviewDraft ? assessDraft(reviewDraft) : body.assessment) as Parameters<
      typeof negotiateFeasibility
    >[0]['assessment']
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter(
        (turn): turn is { role: 'user' | 'assistant'; text: string } =>
          typeof turn === 'object' &&
          turn !== null &&
          ((turn as { role?: unknown }).role === 'user' ||
            (turn as { role?: unknown }).role === 'assistant') &&
          typeof (turn as { text?: unknown }).text === 'string',
      )
      .slice(-12)
    const liveId =
      isLiveOutputId(body.liveOutputId) &&
      liveOutputHub.claim(body.liveOutputId, liveOutputOwner(organizationId, user.id))
        ? body.liveOutputId
        : null
    try {
      const resolved = await this.resolvePlanningGateway(
        body,
        organizationId,
        user.id,
        'project-feasibility-negotiate',
      )
      const reply = await streamCallToLiveOutput(
        liveId,
        '商量能否如期完成',
        '1',
        (onText, onReasoning) =>
          negotiateFeasibility({
            onReasoning,
            gateway: resolved.gateway,
            assessment,
            history,
            message,
            now: new Date(),
            onText,
          }),
        resolved.model,
      )
      // 审查页（/:id/replan/negotiate）：方案按这份草案真实重排核算，而不是按人日粗算
      // （实测粗算说加人能提前 4 天，真实重排完工日不变——瓶颈在依赖链上）。
      if (reviewDraft && reply.proposal) {
        const { preview } = replanDraft(reviewDraft, reply.proposal.decision)
        reply.proposal = {
          ...reply.proposal,
          detail: `程序实际重排：${preview.summary}${preview.note ? preview.note : ''}`,
        }
      }
      return ctx.response.ok({ data: reply })
    } catch (error) {
      if (error instanceof AiConnectionRequiredException) throw error
      ctx.logger.warn({ err: error }, '可行性协商失败')
      return ctx.response.status(502).send({
        error: {
          code: 'AI_SERVICE_ERROR',
          message: '这次没有回应成功，请稍后再说一次，或直接选上面的方案。',
        },
      })
    } finally {
      if (liveId) liveOutputHub.close(liveId)
    }
  }

  private async resolvePlanningGateway(
    body: { connectionId?: number; modelId?: number },
    organizationId: number,
    userId: number,
    workflowName: string,
  ) {
    const resolved = await resolveAdapter({
      connectionId: body.connectionId,
      modelId: body.modelId,
      organizationId,
      requiredCapabilities: [...DRAFT_MODEL_CAPABILITIES],
      recordContext: {
        organizationId,
        userId,
        connectionId: body.connectionId ?? null,
        modelId: body.modelId ?? null,
        capability: 'project_draft',
        surface: 'ai-create-draft',
        workflowName,
      },
    })
    assertAiConnectionAvailable(resolved)
    return resolved
  }

  /** GET /:id/replan —— 审查页「能否如期完成」：按这份草案的实际排期给结论与方案（程序计算，不调模型）。 */
  async replanAssessment(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const active = await this.requireActiveVersion(session)
    const assessment = assessDraft(active.draft as unknown as Record<string, unknown>)
    return ctx.response.ok({ data: { assessment, version: active.version } })
  }

  /** POST /:id/replan/preview —— 按决定改草案并重排，只返回前后对比（不落库）。 */
  async replanPreview(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const active = await this.requireActiveVersion(session)
    const decision = this.parseReplanDecision(ctx)
    const { preview } = replanDraft(active.draft as unknown as Record<string, unknown>, decision)
    return ctx.response.ok({ data: { preview, version: active.version } })
  }

  /**
   * POST /:id/replan/apply —— 用户看过对比后确认：重排结果存成新的草案版本（origin=modified），
   * 重新校验；仍是草案，转正仍需审查确认（AI 只建议、不自动执行）。
   */
  async replanApply(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const active = await this.requireActiveVersion(session)
    const expected = Number((ctx.request.body() as { version?: unknown }).version)
    if (expected !== active.version) {
      throw new ValidationException('草案已有更新的版本，请刷新后再调整', {
        details: { expected, current: active.version },
      })
    }
    const decision = this.parseReplanDecision(ctx)
    const { draft } = replanDraft(active.draft as unknown as Record<string, unknown>, decision)
    const next = draft as unknown as typeof active.draft
    const baseReport = draftValidationGateway.validate({
      draft: next,
      phase: 'all',
      selection: null,
    })
    const semanticIssues = active.meta?.groundingManifest
      ? validateSemanticGrounding(next, active.meta.groundingManifest).blocking
      : []
    const report = active.meta
      ? applyGenerationQualityGate(baseReport, { meta: active.meta, qualityIssues: semanticIssues })
      : baseReport
    const meta = active.meta
      ? {
          ...active.meta,
          decisions: [
            ...(active.meta.decisions ?? []),
            {
              id: `dec-replan-${session.currentVersion + 1}`,
              decision: decision.summary,
              reason: '审查时协商后由你确认，程序按新条件重排',
              source: 'user' as const,
              stage: 'review',
            },
          ],
        }
      : active.meta
    await AiProjectDraftVersion.query()
      .where('draft_id', session.id)
      .where('status', 'active')
      .update({ status: 'superseded' })
    const version = session.currentVersion + 1
    await AiProjectDraftVersion.create({
      draftId: session.id,
      version,
      origin: 'modified',
      status: 'active',
      draft: next,
      meta,
      validation: report,
    })
    session.currentVersion = version
    session.status = 'reviewing'
    await session.save()
    await this.persistValidation(session, version, 'all', report)
    await this.auditLifecycle(ctx, session, AuditEvent.AI_DRAFT_REPLANNED)
    const detail = await this.sessions.getDetail(session)
    return ctx.response.ok({ data: detail })
  }

  private parseReplanDecision(ctx: HttpContext) {
    const raw = (ctx.request.body() as { decision?: unknown }).decision
    if (typeof raw !== 'object' || raw === null) throw new ValidationException('缺少调整方案')
    const record = raw as Record<string, unknown>
    const kinds = ['extend', 'add_people', 'defer', 'as_is', 'finish_early', 'custom'] as const
    const kind = kinds.find((item) => item === record.kind)
    if (!kind) throw new ValidationException('调整方案类型无效')
    const deadline =
      typeof record.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.deadline)
        ? record.deadline
        : null
    const team = (Array.isArray(record.team) ? record.team : [])
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        role: String(item.role ?? '')
          .trim()
          .slice(0, 40),
        headcount: Math.round(Number(item.headcount)),
      }))
      .filter((member) => member.role && member.headcount > 0 && member.headcount <= 200)
      .slice(0, 30)
    const deferred = (
      Array.isArray(record.deferredCapabilityIds) ? record.deferredCapabilityIds : []
    )
      .map(String)
      .slice(0, 30)
    const summary =
      typeof record.summary === 'string' && record.summary.trim()
        ? record.summary.trim().slice(0, 300)
        : '审查时协商调整'
    return {
      kind,
      summary,
      ...(deadline ? { deadline } : {}),
      ...(team.length > 0 ? { team } : {}),
      ...(deferred.length > 0 ? { deferredCapabilityIds: deferred } : {}),
    }
  }

  async legacyProjectDraft(ctx: HttpContext) {
    await this.requireTrigger(ctx)
    throw new ValidationException(
      'Legacy project draft endpoint is no longer supported; use /api/v1/ai/project-drafts/stream',
    )
  }

  /** GET /api/v1/ai/project-drafts/:id/events —— SSE 断点续传（Last-Event-ID 幂等恢复）。 */
  async events(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const cursor = this.readCursor(ctx)

    // §6.4: 检查 cursor 有效性——retention miss 或缺口不可补齐时返回 reset-required
    if (cursor > 0) {
      const firstAvailable = await this.sessions.minSequence(session.id)
      const hasEventAtCursor = await this.sessions.hasSequence(session.id, cursor)
      if ((firstAvailable !== null && cursor < firstAvailable) || !hasEventAtCursor) {
        const raw = this.openSse(ctx, session.draftUid)
        const resetEvent = this.buildResetRequiredEvent(session.draftUid, 'retention_expired')
        this.writeSseEvents(raw, [resetEvent])
        raw.end()
        return
      }
    }

    // §6.3: 先重放持久化事件
    const persisted = await this.sessions.eventsAfter(session, cursor)
    let lastSeq = cursor
    if (persisted.length > 0) {
      lastSeq = Math.max(lastSeq, ...persisted.map((e) => e.sequence))
    }

    const raw = this.openSse(ctx, session.draftUid)
    if (persisted.length > 0) this.writeSseEvents(raw, persisted)

    // §6.3: 若 runner 仍活跃则继续 tail（生成进行中恢复）
    const draftUid = session.draftUid
    if (this.runner.isRunning(draftUid)) {
      let runnerOffset = 0
      while (this.runner.isRunning(draftUid)) {
        await this.runner.waitForChange(draftUid, 15_000)
        const batch = this.runner.readBatch(draftUid, runnerOffset)
        runnerOffset = batch.nextOffset
        const newEvents = batch.events.filter(
          (event) =>
            event.type === 'draft.heartbeat' ||
            event.type === 'generation.output' ||
            event.sequence > lastSeq,
        )
        for (const event of newEvents) {
          if (event.type !== 'draft.heartbeat') lastSeq = Math.max(lastSeq, event.sequence)
        }
        if (!this.isWritable(raw)) return
        if (newEvents.length > 0) this.writeSseEvents(raw, newEvents)
      }

      const finalBatch = this.runner.readBatch(draftUid, runnerOffset)
      const finalEvents = finalBatch.events.filter(
        (event) =>
          event.type === 'draft.heartbeat' ||
          event.type === 'generation.output' ||
          event.sequence > lastSeq,
      )
      if (this.isWritable(raw) && finalEvents.length > 0) this.writeSseEvents(raw, finalEvents)
    }

    // 无缝追尾二次检查：终态可能恰好发生在“持久事件重放 → 注册实时 tail”窗口。
    // 再以最后连续 sequence 查询一次事实表，避免完成/失败事件被竞态吞掉。
    const tail = await this.sessions.eventsAfter(session, lastSeq)
    const unseenTail = tail.filter((event) => event.sequence > lastSeq)
    if (unseenTail.length > 0) {
      lastSeq = Math.max(lastSeq, ...unseenTail.map((event) => event.sequence))
      if (this.isWritable(raw)) this.writeSseEvents(raw, unseenTail)
    }

    if (this.isWritable(raw)) raw.end()
  }

  /** GET /api/v1/ai/project-drafts/:id —— 草案详情（恢复用）。 */
  async show(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const detail = await this.sessions.getDetail(session, {
      generationRunning: this.runner.isRunning(session.draftUid),
    })
    return ctx.response.ok({ data: detail })
  }

  async validate(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const active = await this.requireActiveVersion(session)
    const request = this.parseValidate(ctx)

    // 携带就地编辑（modifications）时，先服务端重算修改再跑 VE/HL，重检报告反映编辑后内容；
    // 未携带时对活动版本原样校验（与 confirm 路径的 applyModifications → validate 顺序一致）。
    const draft =
      request.modifications && request.modifications.length > 0
        ? applyModifications(active.draft, request.modifications)
        : active.draft

    const result = request.autoFix
      ? draftValidationGateway.autoFix?.({
          draft,
          phase: request.phase ?? 'all',
          selection: request.selection ?? null,
        })
      : null
    const baseReport =
      result?.report ??
      draftValidationGateway.validate({
        draft,
        phase: request.phase ?? 'all',
        selection: request.selection ?? null,
      })
    const semanticIssues = active.meta?.groundingManifest
      ? validateSemanticGrounding(result?.draft ?? draft, active.meta.groundingManifest).blocking
      : []
    const report = active.meta
      ? applyGenerationQualityGate(baseReport, { meta: active.meta, qualityIssues: semanticIssues })
      : baseReport

    let version = active.version
    if (result) {
      await AiProjectDraftVersion.query()
        .where('draft_id', session.id)
        .where('status', 'active')
        .update({ status: 'superseded' })
      version = session.currentVersion + 1
      await AiProjectDraftVersion.create({
        draftId: session.id,
        version,
        origin: 'auto_fixed',
        status: 'active',
        draft: result.draft,
        meta: active.meta,
        validation: report,
      })
      session.currentVersion = version
      session.status = 'reviewing'
      await session.save()
    } else {
      active.validation = report
      await active.save()
    }

    await this.persistValidation(session, version, request.phase ?? 'all', report)
    await this.auditValidation(
      ctx,
      session,
      report,
      request.autoFix ? (result?.diffs.length ?? 0) : 0,
    )
    return ctx.response.ok({ data: { version, report, autoFixDiffs: result?.diffs ?? [] } })
  }

  /**
   * POST /api/v1/ai/project-drafts/:id/ai-fix —— AI 同事全自动：草案有阻断项时请模型修正。
   *
   * 只有字段修改时零写入：返回合并后的修改与带着修改重算的校验报告，由调用方继续修或带着修改走
   * confirm。模型给出结构性操作（增删任务 / 依赖等）时落一个新的草案版本（字段修改并入，返回新
   * version 与空 modifications），仍不导入正式表。confirm 里服务端重算全部校验。
   * 没有可用的真实模型时 `unavailable=true`。
   */
  async aiFix(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const active = await this.requireActiveVersion(session)
    const parsed = aiFixDraftBodySchema.safeParse(ctx.request.body() ?? {})
    if (!parsed.success) {
      throw new ValidationException('草案修正请求不合法', { details: parsed.error.issues })
    }
    if (parsed.data.version !== undefined && parsed.data.version !== active.version) {
      throw new ValidationException('草案已有更新的版本，请载入最新版本后再修正', {
        details: { expected: active.version, received: parsed.data.version },
      })
    }
    const base = parsed.data.modifications ?? []
    const before = this.fullReport(active, applyModifications(active.draft, base))
    const respond = (data: Record<string, unknown>) =>
      ctx.response.ok({ data: { version: active.version, ...data } })
    if (before.blocking.length === 0) {
      return respond({
        modifications: base,
        applied: [],
        operations: [],
        reasons: [],
        report: before,
        model: null,
      })
    }
    const proposal = await this.draftFix.propose({
      organizationId,
      userId: user.id,
      draft: applyModifications(active.draft, base),
      blocking: before.blocking,
      previousModifications: base,
      connectionId: parsed.data.connectionId ?? null,
      modelId: parsed.data.modelId ?? null,
    })
    if (!proposal) {
      return respond({
        modifications: base,
        applied: [],
        operations: [],
        reasons: [],
        report: before,
        model: null,
        unavailable: true,
      })
    }
    const byPath = new Map(base.map((mod) => [mod.path, mod]))
    for (const mod of proposal.modifications) {
      byPath.delete(mod.path)
      byPath.set(mod.path, mod)
    }
    const modifications = [...byPath.values()]
    if (proposal.operations.length === 0) {
      const report = this.fullReport(active, applyModifications(active.draft, modifications))
      return respond({
        modifications,
        applied: proposal.modifications,
        operations: [],
        reasons: proposal.reasons,
        report,
        model: proposal.model,
      })
    }
    // 结构性操作（增删任务 / 依赖等）：落一个新的草案版本（仍只是草案，不写正式表），字段修改并入其中
    const fixed = applyDraftFixOperations(
      applyModifications(active.draft, modifications),
      proposal.operations,
    )
    const report = this.fullReport(active, fixed)
    await AiProjectDraftVersion.query()
      .where('draft_id', session.id)
      .where('status', 'active')
      .update({ status: 'superseded' })
    const version = session.currentVersion + 1
    await AiProjectDraftVersion.create({
      draftId: session.id,
      version,
      origin: 'modified',
      status: 'active',
      draft: fixed,
      meta: active.meta,
      validation: report,
    })
    session.currentVersion = version
    session.status = 'reviewing'
    await session.save()
    await this.persistValidation(session, version, 'all', report)
    await this.auditValidation(
      ctx,
      session,
      report,
      proposal.modifications.length + proposal.operations.length,
    )
    return ctx.response.ok({
      data: {
        version,
        modifications: [],
        applied: proposal.modifications,
        operations: proposal.operations,
        reasons: proposal.reasons,
        report,
        model: proposal.model,
      },
    })
  }

  /** 与 validate 端点同口径的完整校验（规则引擎 + 反幻觉 + 语义落地 + 生成质量门禁）。 */
  private fullReport(
    active: Awaited<ReturnType<AiProjectDraftsController['requireActiveVersion']>>,
    draft: NonNullable<typeof active.draft>,
  ): DraftValidationReport {
    const baseReport = draftValidationGateway.validate({ draft, phase: 'all', selection: null })
    const semanticIssues = active.meta?.groundingManifest
      ? validateSemanticGrounding(draft, active.meta.groundingManifest).blocking
      : []
    return active.meta
      ? applyGenerationQualityGate(baseReport, { meta: active.meta, qualityIssues: semanticIssues })
      : baseReport
  }

  async latestValidation(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const latest = await AiProjectDraftValidation.query()
      .where('draft_id', session.id)
      .orderBy('created_at', 'desc')
      .first()
    if (latest) return ctx.response.ok({ data: latest.report })

    const active = await this.sessions.activeVersion(session)
    return ctx.response.ok({ data: active?.validation ?? null })
  }

  /** POST /api/v1/ai/project-drafts/:id/save —— 保存为草稿（不写正式表）。 */
  async save(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    await this.sessions.save(session)
    await this.auditLifecycle(ctx, session, AuditEvent.AI_DRAFT_SAVED)
    const detail = await this.sessions.getDetail(session)
    return ctx.response.ok({ data: detail })
  }

  /** POST /api/v1/ai/project-drafts/:id/reject —— 拒绝草案（保留上下文，可重试）。 */
  async reject(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    await this.sessions.reject(session)
    await this.auditLifecycle(ctx, session, AuditEvent.AI_DRAFT_REJECTED)
    const detail = await this.sessions.getDetail(session)
    return ctx.response.ok({ data: detail })
  }

  /**
   * POST /api/v1/ai/project-drafts/:id/retry —— 复用同一会话重跑生成（SSE）。
   * 与全新生成的差别：不新建会话，版本 +1，事件序列续接；生成前加载
   * generationCheckpoint 作为 resume，已完成阶段（上下文/版本/provider 未变）
   * 直接复用产物，不再调用模型——慢模型下不再每次从 0 浪费十几分钟。
   */
  async retry(ctx: HttpContext) {
    const { user, organizationId } = await this.requireTrigger(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const context = this.parseContext(ctx)
    const draftUid = session.draftUid
    const nextVersion = session.currentVersion + 1

    // 与 stream() 相同的前置快速失败（openSse 之前仍走 HTTP 错误契约）
    await this.groundTeamSize(context, organizationId)
    await this.attachPlanningMemory(context, organizationId, user.id)
    const body = ctx.request.body() as { connectionId?: number; modelId?: number }
    const resolved = await resolveAdapter({
      connectionId: body.connectionId,
      modelId: body.modelId,
      organizationId,
      requiredCapabilities: [...DRAFT_MODEL_CAPABILITIES],
      recordContext: {
        organizationId,
        userId: user.id,
        connectionId: body.connectionId ?? null,
        modelId: body.modelId ?? null,
        capability: 'project_draft',
        surface: 'ai-create-draft',
        workflowName: 'five-stage-project-draft-generation',
      },
    })
    assertAiConnectionAvailable(resolved)

    if (this.runner.activeCount >= this.runner.maxRunners) {
      throw new ValidationException('生成服务繁忙，请稍后重试。')
    }

    // 会话回到生成中（此前是 error/rejected 等终态），孤儿会话检测依赖该状态。
    await this.sessions.setStatus(session, 'drafting')

    const raw = this.openSse(ctx, draftUid)

    try {
      const startedEvent: ProjectDraftStreamEvent = {
        type: 'draft.started',
        draftId: draftUid,
        version: nextVersion,
        sequence: 0,
        projectType: context.parsedIntent.projectType,
        modules: [...PROJECT_DRAFT_MODULES],
      }
      await this.sessions.appendEvent(session, startedEvent)
      this.writeSseEvents(raw, [startedEvent])

      const registered = this.runner.register(draftUid, session, nextVersion, startedEvent.sequence)
      if (!registered) {
        const failedEvent: ProjectDraftStreamEvent = {
          type: 'draft.failed',
          draftId: draftUid,
          version: nextVersion,
          sequence: 0,
          errorCode: 'AI_SERVICE_BUSY',
          message: '生成服务繁忙，请稍后重试。',
          consistency: 'failed',
          reasonCode: 'AI_SERVICE_BUSY',
        }
        await this.sessions.appendEvent(session, failedEvent)
        await this.sessions.setStatus(session, 'error')
        this.writeSseEvents(raw, [failedEvent])
        raw.end()
        return
      }

      const scannerState = createScannerState()
      // 分离运行：任何漏网 rejection 只终止本次生成，绝不冒泡成 unhandledRejection。
      this.runStreamingGeneration(ctx, draftUid, session, context, resolved, scannerState, {
        version: nextVersion,
        completion: 'retry',
      }).catch((error) => {
        ctx.logger.error({ err: error, draftUid }, '草案后台生成异常退出')
        this.runner.fail(draftUid)
      })

      let runnerOffset = 0
      while (this.runner.isRunning(draftUid)) {
        await this.runner.waitForChange(draftUid, 15_000)
        const batch = this.runner.readBatch(draftUid, runnerOffset)
        runnerOffset = batch.nextOffset
        if (!this.isWritable(raw)) return
        if (batch.events.length > 0) this.writeSseEvents(raw, batch.events)
      }

      const finalBatch = this.runner.readBatch(draftUid, runnerOffset)
      if (this.isWritable(raw) && finalBatch.events.length > 0) {
        this.writeSseEvents(raw, finalBatch.events)
      }
    } catch (error) {
      if (this.runner.isRunning(draftUid)) return
      if (this.isWritable(raw)) {
        const failedEvent: ProjectDraftStreamEvent = {
          type: 'draft.failed',
          draftId: draftUid,
          version: nextVersion,
          sequence: 0,
          errorCode: 'AI_SERVICE_ERROR',
          message: '草案生成失败，请稍后重试或调整输入。',
          consistency: 'failed',
          reasonCode: 'AI_SERVICE_ERROR',
        }
        await this.sessions.appendEvent(session, failedEvent).catch(() => undefined)
        this.writeSseEvents(raw, [failedEvent])
      }
    } finally {
      if (this.isWritable(raw)) raw.end()
    }
  }

  /** POST /api/v1/ai/project-drafts/:id/confirm —— 人工确认导入正式项目（唯一写正式表入口）。 */
  async confirm(ctx: HttpContext) {
    const { user, organizationId } = await this.requireConfirm(ctx)
    const session = await this.loadOwned(ctx, organizationId, user.id)
    const request = this.parseConfirm(ctx)

    const outcome = await this.imports.import(session, request, {
      organizationId,
      userId: user.id,
      requestId: ctx.request.id() ?? null,
    })

    await this.auditConfirm(ctx, session, outcome, request.confirmedVia ?? 'user')

    // P1 通知项目成员：AI 草案已确认导入
    // 导入摘要里不带项目名，直接读刚落库的项目（曾恒兜底成「新项目」）
    const importedProject = await Project.query()
      .where('id', outcome.projectId)
      .where('organization_id', organizationId)
      .first()
    const projectName =
      importedProject?.name ??
      outcome.selectionSummary?.projectName ??
      outcome.selectionSummary?.project_name ??
      '新项目'
    await this.notifications.createForUser({
      organizationId,
      recipientId: session.userId,
      type: 'ai_draft_confirmed',
      title: `AI 草案已确认导入：「${projectName}」`,
      body: `您确认的 AI 草案「${projectName}」已成功导入为正式项目。`,
      severity: 'info',
      projectId: outcome.projectId,
      targetType: 'project',
      targetId: outcome.projectId,
      actionUrl: `/projects/${outcome.projectId}`,
      metadata: {
        draftUid: session.draftUid,
        importedVersion: outcome.importedVersion,
        projectName,
      },
    })

    // 新项目落库：后台先做一次信号检测，首页与项目空间一开始就有真实信号
    scheduleProjectSignalDetection({ organizationId, projectId: outcome.projectId, user })
    return ctx.response.created({
      data: {
        projectId: outcome.projectId,
        createdCounts: outcome.createdCounts,
      },
    })
  }

  // ── §5.2 流式生成 ────────────────────────────────────────────────────────

  /**
   * 基于 gateway.stream() 的流式生成。
   * 逐 chunk 累积 rawText，驱动增量扫描器产出模块进度事件。
   * 生成完成后触发 completeGeneration 并记审计。
   */
  private async runStreamingGeneration(
    ctx: HttpContext,
    draftUid: string,
    session: AiProjectDraft,
    context: ConfirmedProjectContext,
    resolved: Awaited<ReturnType<typeof resolveAdapter>>,
    scannerState: ScannerState,
    options: { version?: number; completion?: 'create' | 'retry' } = {},
  ): Promise<void> {
    // 重试生成复用同一会话续跑（checkpoint 断点续跑在 generation.generate 的 resume 里），
    // 事件版本随之递增；首次生成恒为 1。
    const streamVersion = options.version ?? 1
    // 事件链必须始终保持 resolved：它要等 generate() 跑完才被 await，期间若链尾因写库失败
    // 而 reject（如 Supabase pooler 断开连接），无人接的 rejection 会让 Node 直接杀掉整个
    // 后端进程。写库失败先重试一次（连接池会换新连接），仍失败则记到 persistError，
    // 由下方每个 await 点转成本次生成的正常失败。
    let eventChain = Promise.resolve()
    let persistError: unknown = null
    const throwIfPersistFailed = () => {
      if (persistError) throw persistError
    }

    // v3-ai-draft-live-output-panel：模型真实输出的瞬时观察通道。
    // 只经 runner 内存队列广播（generation.output，sequence=0），绝不 appendEvent 落库；
    // 不推进语义 sequence，events 回放不包含输出文本。
    // 每次模型调用单独一条输出流（带编号与步骤名）：拆解候选、分支审查等会并发调用，
    // 混成一串会互相穿插；辅助调用（理解、拆解、审查、修复）也要推送，否则用户长时间看不到任何输出。
    let outputCallSeq = 0
    const pushOutput = (
      pieces: string[],
      lane: { callId: string; label: string; kind?: 'reasoning'; model?: string },
      done = false,
    ) => {
      for (const text of pieces) {
        this.runner.pushEvent(draftUid, {
          type: 'generation.output',
          draftId: draftUid,
          version: streamVersion,
          sequence: 0,
          text,
          ...lane,
        })
      }
      if (done) {
        this.runner.pushEvent(draftUid, {
          type: 'generation.output',
          draftId: draftUid,
          version: streamVersion,
          sequence: 0,
          text: '',
          ...lane,
          done: true,
        })
      }
    }

    const enqueue = (event: ProjectDraftStreamEvent) => {
      eventChain = eventChain.then(async () => {
        if (persistError) return
        try {
          await withOneRetry(() => this.sessions.appendEvent(session, event))
        } catch (error) {
          persistError = error
          ctx.logger.warn({ err: error, draftUid, eventType: event.type }, '草案事件写库失败')
          return
        }
        this.runner.pushEvent(draftUid, event)
      })
    }

    let lastReceivingChars = -1
    let latestReceivedChars = 0
    const enqueuePhase = (
      phase: Extract<ProjectDraftStreamEvent, { type: 'draft.progress' }>['phase'],
      receivedChars: number,
      attempt?: number,
    ) => {
      latestReceivedChars = Math.max(latestReceivedChars, receivedChars)
      // receiving 可能每个 token 都触发；按字符窗口降频，阶段切换不降频。
      if (
        phase === 'receiving' &&
        lastReceivingChars >= 0 &&
        receivedChars - lastReceivingChars < 512
      ) {
        return
      }
      if (phase === 'receiving') lastReceivingChars = receivedChars
      enqueue({
        type: 'draft.progress',
        draftId: draftUid,
        version: streamVersion,
        sequence: 0,
        phase,
        receivedChars,
        ...(attempt === undefined ? {} : { attempt }),
      })
    }

    try {
      const resume = await this.sessions.loadCheckpoint(session)
      const result = await this.generation.generate({
        context,
        resolved,
        resume,
        onAttemptFailed: (info) => {
          ctx.logger.warn({ draftUid, ...info }, '草案阶段尝试失败，准备重试或修复')
        },
        // checkpoint 只服务断点续跑；写库失败不值得为它丢掉整次生成。
        onCheckpoint: (checkpoint) => {
          // 阶段完成即推模块完成事件：分批生成时输出是多段 JSON 拼接，扫描器识别不出模块边界，
          // 进度曾停在「1/9」直到全部结束（实测 WBS、排期早已完成）。
          for (const stage of checkpoint.completedStages) {
            if (stage.status !== 'completed') continue
            for (const module of STAGE_MODULES[stage.stage] ?? []) {
              if (!scannerState.started.has(module)) {
                scannerState.started.add(module)
                enqueue({
                  type: 'module.delta',
                  draftId: draftUid,
                  version: streamVersion,
                  sequence: 0,
                  module,
                  status: 'generating',
                })
              }
              if (!scannerState.emitted.has(module)) {
                scannerState.emitted.add(module)
                enqueue({
                  type: 'module.completed',
                  draftId: draftUid,
                  version: streamVersion,
                  sequence: 0,
                  module,
                })
              }
            }
          }
          return withOneRetry(() => this.sessions.saveCheckpoint(session, checkpoint)).catch(
            (error) => {
              ctx.logger.warn({ err: error, draftUid }, '草案阶段 checkpoint 写库失败，继续生成')
            },
          )
        },
        rawTextProvider: async ({
          prompt,
          strategy,
          jsonSchema,
          onChunk,
          sentence,
          maxOutputTokens,
          attempt,
          stageAttempt,
          promptName,
        }) => {
          await resolved.throttle?.(estimateDraftTokens(context))
          let rawText = ''
          const abort = draftGenerationAbortSignal()
          const lane = {
            callId: String(++outputCallSeq),
            label: sentence ?? promptName ?? '生成结构化项目草案',
          }
          const laneFlusher = createOutputFlusher(LIVE_OUTPUT_FLUSH_CHARS)
          const reasoningFlusher = createOutputFlusher(LIVE_OUTPUT_FLUSH_CHARS)
          const reasoningLane = { ...lane, kind: 'reasoning' as const }
          // 调用一开始就占一条道（空文本，带模型名）：模型思考到吐出首字常要十几秒，否则面板这段时间是空的。
          pushOutput([''], { ...lane, model: resolved.model })
          try {
            for await (const chunk of resolved.gateway.stream({
              sentence: sentence ?? '生成结构化项目草案',
              promptSet: prompt,
              strategy,
              jsonSchema,
              maxOutputTokens: Math.min(
                maxOutputTokens ?? PROJECT_DRAFT_MAX_OUTPUT_TOKENS,
                PROJECT_DRAFT_MAX_OUTPUT_TOKENS,
              ),
              signal: abort.signal,
              attemptNumber: stageAttempt ?? attempt + 1,
              promptName: promptName ?? 'draft.single',
            })) {
              if (chunk.kind === 'error') {
                // 循环中止：丢弃本次已累积的输出，交给上层以干净上下文重试。
                if (chunk.errorKind === 'repetition_loop') {
                  ctx.logger.warn(
                    { draftUid, promptName, attempt: stageAttempt, detail: chunk.errorMessage },
                    '模型输出陷入重复循环，已中止请求并丢弃输出',
                  )
                } else {
                  // 只记供应商错误摘要（截断），不含提示词与输出正文；否则断流原因无从排查。
                  ctx.logger.warn(
                    {
                      draftUid,
                      promptName,
                      attempt: stageAttempt,
                      errorKind: chunk.errorKind,
                      detail: chunk.errorMessage?.slice(0, 300),
                      receivedChars: rawText.length,
                    },
                    '模型流式调用出错',
                  )
                }
                throw new Error(chunk.errorKind ?? 'adapter_stream_error')
              }
              if (chunk.kind === 'text' && chunk.text) {
                rawText += chunk.text
                pushOutput(laneFlusher.push(chunk.text), lane)
                onChunk?.(chunk.text)
              }
              if (chunk.kind === 'reasoning' && chunk.text) {
                pushOutput(reasoningFlusher.push(chunk.text), reasoningLane)
              }
            }
          } finally {
            pushOutput(reasoningFlusher.flush(), reasoningLane)
            pushOutput(laneFlusher.flush(), lane, true)
            abort.dispose()
          }
          return rawText
        },
        maxRetries: 2,
        useStagePipeline: true,
        onPhase: enqueuePhase,
        onChunk: (chunk) => {
          const scanResult = scanChunk(scannerState, chunk)
          for (const intent of scanResult.intents) {
            enqueue(
              intent.kind === 'module.delta'
                ? {
                    type: 'module.delta',
                    draftId: draftUid,
                    version: streamVersion,
                    sequence: 0,
                    module: intent.module,
                    status: 'generating',
                  }
                : {
                    type: 'module.completed',
                    draftId: draftUid,
                    version: streamVersion,
                    sequence: 0,
                    module: intent.module,
                  },
            )
          }
        },
      })
      await eventChain
      throwIfPersistFailed()
      attachPlanInsights(result, context.rawInput)

      // §4.3: 反幻觉校验
      const validation = result.draft
        ? applyGenerationQualityGate(draftValidationGateway.validate({ draft: result.draft }), {
            meta: result.meta,
            qualityIssues: result.qualityIssues,
          })
        : null

      // 扫描降级或模型修复新增字段时，只能在权威草案校验成功后补齐模块状态。
      if (result.status === 'completed' && result.draft) {
        for (const module of PROJECT_DRAFT_MODULES) {
          if (!scannerState.started.has(module)) {
            enqueue({
              type: 'module.delta',
              draftId: draftUid,
              version: streamVersion,
              sequence: 0,
              module,
              status: 'generating',
            })
          }
          if (!scannerState.emitted.has(module)) {
            enqueue({
              type: 'module.completed',
              draftId: draftUid,
              version: streamVersion,
              sequence: 0,
              module,
            })
          }
        }
      }

      if (validation && validation.warning.length > 0) {
        enqueue({
          type: 'validation.warning',
          draftId: draftUid,
          version: streamVersion,
          sequence: 0,
          issues: validation.warning,
        })
      }
      enqueuePhase('persisting', latestReceivedChars)
      await eventChain
      throwIfPersistFailed()

      // 持久化最终结果（重试走版本 +1 语义，事件已在流式路径逐条落库）
      if (options.completion === 'retry') {
        await this.sessions.completeRetryGeneration(session, { result, validation })
      } else {
        await this.sessions.completeGeneration(session, { result, validation })
      }

      // §6.4: 生成完成后审计
      await this.auditGeneration(ctx, session, result, validation)

      // 发送完成事件
      const draftEvent: ProjectDraftStreamEvent =
        result.status === 'completed' && result.draft && validation
          ? {
              type: 'draft.completed',
              draftId: draftUid,
              version: streamVersion,
              sequence: 0,
              draft: result.draft,
              meta: result.meta,
              validation,
            }
          : {
              type: 'draft.failed',
              draftId: draftUid,
              version: streamVersion,
              sequence: 0,
              errorCode: result.errorCode ?? 'AI_SERVICE_ERROR',
              message: safeDraftFailureMessage(result.errorCode ?? 'AI_SERVICE_ERROR'),
              consistency: result.consistency,
              stage: result.stage ?? result.meta?.failure?.stage,
              reasonCode: result.reasonCode ?? result.errorCode ?? result.meta?.failure?.reasonCode,
              errors:
                result.meta?.failure?.errors ??
                (result.errors
                  ? result.errors.slice(0, 20).map((e) => ({ path: e.path, message: e.message }))
                  : undefined),
            }

      enqueue(draftEvent)
      await eventChain
      throwIfPersistFailed()
      if (draftEvent.type === 'draft.completed') this.runner.complete(draftUid)
      else this.runner.fail(draftUid)
    } catch (error) {
      // §6.2: 流内失败
      try {
        await this.sessions.setStatus(session, 'error')
      } catch {
        /* ignore cleanup errors */
      }
      const failedEvent: ProjectDraftStreamEvent = {
        type: 'draft.failed',
        draftId: draftUid,
        version: streamVersion,
        sequence: 0,
        errorCode: 'AI_SERVICE_ERROR',
        message: '草案生成失败，请稍后重试或调整输入。',
        consistency: 'failed',
        reasonCode: 'AI_SERVICE_ERROR',
      }
      await eventChain
      // 事件链已因写库失败停摆时 enqueue 会被跳过；终态事件改为尽力落库、必定推送，
      // 保证前端收到 draft.failed 而不是一直停在「生成中」。
      await this.sessions.appendEvent(session, failedEvent).catch(() => undefined)
      this.runner.pushEvent(draftUid, failedEvent)
      await this.auditLifecycle(ctx, session, AuditEvent.AI_DRAFT_FAILED).catch(() => undefined)
      this.runner.fail(draftUid)
    }
  }

  // ── 内部助手 ────────────────────────────────────────────────────────────

  private async requireTrigger(ctx: HttpContext): Promise<{ user: User; organizationId: number }> {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!organizationId) throw new PermissionDeniedException('缺少组织上下文')
    if (!(await this.policy.canTrigger(user, organizationId))) {
      await this.audit.log({
        event: AuditEvent.PERMISSION_DENIED,
        severity: 'warning',
        userId: user.id,
        organizationId,
        requestId: ctx.request.id() ?? null,
        entityType: 'ai_project_draft',
        metadata: { attempted: 'ai:trigger' },
      })
      throw new PermissionDeniedException('无权使用 AI 草案生成')
    }
    return { user, organizationId }
  }

  private async requireConfirm(ctx: HttpContext): Promise<{ user: User; organizationId: number }> {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!organizationId) throw new PermissionDeniedException('缺少组织上下文')
    if (!(await this.policy.canConfirm(user, organizationId))) {
      await this.audit.log({
        event: AuditEvent.PERMISSION_DENIED,
        severity: 'warning',
        userId: user.id,
        organizationId,
        requestId: ctx.request.id() ?? null,
        entityType: 'ai_project_draft',
        metadata: { attempted: 'ai:confirm' },
      })
      throw new PermissionDeniedException('无权确认导入 AI 草案')
    }
    return { user, organizationId }
  }

  private parseContext(ctx: HttpContext): ConfirmedProjectContext {
    const parsed = generateDraftBodySchema.safeParse(ctx.request.body())
    if (!parsed.success) {
      throw new ValidationException('草案生成入参无效', { details: parsed.error.issues })
    }
    // gate 通过后用原始 body 的完整 context（避免裁剪生成所需字段）。
    const context = (ctx.request.body() as { context: ConfirmedProjectContext }).context
    // 澄清里确认的开始日期 / 工期 / 团队在服务端据回答记录重新解析成结构化字段，
    // 生成不再依赖模型自行猜日期或人数（core_information_needs.ts）
    // 用户在「能否如期完成」协商里确认的决定（改截止日 / 团队 / 移到第二期）由程序套用。
    return applyFeasibilityDecision(applyCoreAnswers(context, context.adaptiveLedger, new Date()))
  }

  private parseConfirm(ctx: HttpContext): ConfirmProjectDraftRequest {
    const parsed = confirmDraftBodySchema.safeParse(ctx.request.body())
    if (!parsed.success) {
      throw new ValidationException('草案确认入参无效', { details: parsed.error.issues })
    }
    return parsed.data as ConfirmProjectDraftRequest
  }

  private parseValidate(ctx: HttpContext) {
    const parsed = validateDraftBodySchema.safeParse(ctx.request.body() ?? {})
    if (!parsed.success) {
      throw new ValidationException('草案校验请求不合法', { details: parsed.error.issues })
    }
    return parsed.data
  }

  private async requireActiveVersion(session: AiProjectDraft) {
    const active = await this.sessions.activeVersion(session)
    if (!active || !active.draft) {
      throw new ValidationException('草案尚无可校验的活动版本')
    }
    return active
  }

  /**
   * teamSize 兜底：用户未显式给出团队人数时，以组织实际在岗成员数作为 AI 假设，
   * 避免「组织只有一个人」等与现实不符的假设。仅兜底、不覆盖显式值（AI 只建议）。
   * （polish-v1-ui-and-assignment / D6）
   */
  private async groundTeamSize(
    context: ConfirmedProjectContext,
    organizationId: number,
  ): Promise<void> {
    if (context.resolvedFields?.teamSize || context.assumptions?.teamSize) return
    // 原话里已写明团队（名册或人数）：以原话为准，组织总人数不是项目团队（实测 6 人项目被推成 31 人）。
    if (contextTeamRoster(context).length > 0 || rawInputHasTeam(context.rawInput)) return
    const rows = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .count('*', 'total')
    const count = Number((rows[0] as { $extras?: { total?: number } })?.$extras?.total ?? 0)
    if (count <= 0) return
    if (!context.assumptions) context.assumptions = {}
    context.assumptions.teamSize = {
      value: count,
      marker: {
        confidence: 0.6,
        source: 'inferred',
        reason: '根据组织现有在岗成员数推断，需人工确认。',
        needsConfirmation: true,
      },
    }
  }

  /**
   * 跨生成的规划记忆：从本组织已转正的草案、正式任务与实际执行数据里推出（只读）。
   * 查询失败不影响生成——记忆只是参考。
   */
  private async attachPlanningMemory(
    context: ConfirmedProjectContext,
    organizationId: number,
    userId: number,
  ): Promise<void> {
    context.planningMemory = undefined
    try {
      const memory = await recallPlanningMemory({
        organizationId,
        userId,
        projectType: context.parsedIntent?.projectType ?? null,
      })
      const facts = planningMemoryFacts(memory)
      const durationFactor = planningDurationFactor(memory)
      if (facts.length > 0 || durationFactor) context.planningMemory = { facts, durationFactor }
    } catch (error) {
      logger.warn({ err: error, organizationId }, '规划记忆读取失败，本次生成不使用历史记忆')
    }
  }

  private async loadOwned(
    ctx: HttpContext,
    organizationId: number,
    userId: number,
  ): Promise<AiProjectDraft> {
    const draftUid = ctx.params.id as string
    const session = await this.sessions.findForUser(draftUid, organizationId, userId)
    if (!session) throw new ResourceNotFoundException('草案不存在')
    return session
  }

  private readCursor(ctx: HttpContext): number {
    const header = ctx.request.header('last-event-id')
    const query = ctx.request.qs().after
    return Number(header ?? query ?? 0) || 0
  }

  private async auditGeneration(
    ctx: HttpContext,
    session: AiProjectDraft,
    result: GenerateDraftResult,
    validation: DraftValidationReport | null,
  ): Promise<void> {
    const event =
      result.status === 'completed' ? AuditEvent.AI_DRAFT_GENERATED : AuditEvent.AI_DRAFT_FAILED
    await this.audit.log({
      event,
      userId: session.userId,
      organizationId: session.organizationId,
      requestId: ctx.request.id() ?? null,
      entityType: 'ai_project_draft',
      // 仅统计元数据：禁止 rawInput / 回答正文 / 完整草案 JSON / 密钥入审计（tasks 3.7）。
      metadata: {
        draftUid: session.draftUid,
        version: session.currentVersion,
        projectType: session.projectType,
        structuredStrategy: result.meta.structuredStrategy,
        consistency: result.consistency,
        fallbackUsed: result.meta.fallbackUsed,
        usingRealAdapter: result.meta.usingRealAdapter,
        moduleCounts: result.meta.moduleCounts,
        errors: result.errors?.slice(0, 5) ?? [],
        validation: validation ? this.validationSummary(validation) : null,
        // task 6.1：阶段/可确认性/provenance 只写低敏摘要，不写正文/回复原文。
        stages: (result.meta.stages ?? []).map((stage) => ({
          stage: stage.stage,
          status: stage.status,
          attemptCount: stage.attemptCount,
          errorCodes: stage.errorCodes,
        })),
        confirmability: result.meta.confirmability
          ? {
              status: result.meta.confirmability.status,
              reasonCount: result.meta.confirmability.reasons.length,
            }
          : null,
        provenance: result.meta.provenance
          ? {
              requestedStrategy: result.meta.provenance.requestedStrategy,
              effectiveStrategy: result.meta.provenance.effectiveStrategy,
              provider: result.meta.provenance.provider,
              fallbackUsed: result.meta.provenance.fallbackUsed,
            }
          : null,
        repairCount: result.meta.repairs?.length ?? 0,
      },
    })
  }

  private async auditLifecycle(
    ctx: HttpContext,
    session: AiProjectDraft,
    event: AuditEventType,
  ): Promise<void> {
    await this.audit.log({
      event,
      userId: session.userId,
      organizationId: session.organizationId,
      requestId: ctx.request.id() ?? null,
      entityType: 'ai_project_draft',
      metadata: {
        draftUid: session.draftUid,
        version: session.currentVersion,
        status: session.status,
      },
    })
  }

  private async persistValidation(
    session: AiProjectDraft,
    version: number,
    phase: 'self_checking' | 'validating' | 'all',
    report: DraftValidationReport,
  ): Promise<void> {
    await AiProjectDraftValidation.create({
      draftId: session.id,
      version,
      phase,
      confidenceScore: report.confidenceScore,
      overallRiskLevel: report.overallRiskLevel,
      canConfirm: report.canConfirm,
      report,
      autoFixDiffs: report.autoFixDiffs,
    })
  }

  private async auditValidation(
    ctx: HttpContext,
    session: AiProjectDraft,
    report: DraftValidationReport,
    autoFixCount: number,
  ): Promise<void> {
    await this.audit.log({
      event: autoFixCount > 0 ? AuditEvent.AI_DRAFT_AUTO_FIXED : AuditEvent.AI_DRAFT_VALIDATED,
      severity: report.blocking.length > 0 ? 'warning' : 'info',
      userId: session.userId,
      organizationId: session.organizationId,
      requestId: ctx.request.id() ?? null,
      entityType: 'ai_project_draft',
      entityId: session.id,
      metadata: {
        draftUid: session.draftUid,
        version: session.currentVersion,
        confidenceScore: report.confidenceScore,
        overallRiskLevel: report.overallRiskLevel,
        blocking: report.blocking.length,
        warning: report.warning.length,
        info: report.info.length,
        autoFixCount,
        failedRules: report.ruleResults.filter((item) => item.failed).map((item) => item.ruleId),
      },
    })
  }

  private async auditConfirm(
    ctx: HttpContext,
    session: AiProjectDraft,
    outcome: ImportDraftResult,
    confirmedVia: 'user' | 'ai_colleague_autopilot',
  ): Promise<void> {
    await this.audit.log({
      event: AuditEvent.AI_DRAFT_CONFIRMED,
      userId: session.userId,
      organizationId: session.organizationId,
      projectId: outcome.projectId,
      requestId: ctx.request.id() ?? null,
      entityType: 'project',
      entityId: outcome.projectId,
      // 仅元数据：draftUid / 版本 / 选择摘要 / 校验摘要 / 创建计数（禁止草案正文与输入原文，tasks 3.7）。
      metadata: {
        draftUid: session.draftUid,
        importedVersion: outcome.importedVersion,
        projectType: session.projectType,
        selection: outcome.selectionSummary,
        validation: this.validationSummary(outcome.validation),
        createdCounts: outcome.createdCounts,
        confirmedVia,
        ...(confirmedVia === 'ai_colleague_autopilot'
          ? { confirmedViaLabel: '由 AI 同事全自动转正（用户已选择全自动）' }
          : {}),
      },
    })
  }

  private validationSummary(v: DraftValidationReport): Record<string, unknown> {
    return {
      overallRiskLevel: v.overallRiskLevel,
      confidenceScore: v.confidenceScore,
      blocking: v.blocking.length,
      warning: v.warning.length,
      info: v.info.length,
      canConfirm: v.canConfirm,
    }
  }

  private openSse(ctx: HttpContext, draftUid?: string) {
    const raw = ctx.response.response
    const origin = ctx.request.header('origin')
    if (origin) {
      raw.setHeader('Access-Control-Allow-Origin', origin)
      raw.setHeader('Access-Control-Allow-Credentials', 'true')
      raw.setHeader('Vary', 'Origin')
      raw.setHeader('Access-Control-Expose-Headers', 'X-Draft-ID')
    }
    if (draftUid) {
      raw.setHeader('X-Draft-ID', draftUid)
    }
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache, no-transform')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('X-Accel-Buffering', 'no')
    raw.flushHeaders?.()
    return raw
  }

  private writeSseEvents(raw: ReturnType<typeof this.openSse>, events: ProjectDraftStreamEvent[]) {
    for (const event of events) {
      raw.write(`id: ${event.sequence}\n`)
      raw.write(`event: ${event.type}\n`)
      raw.write(`data: ${JSON.stringify(event)}\n\n`)
      const flush = (raw as typeof raw & { flush?: () => void }).flush
      if (typeof flush === 'function') flush.call(raw)
    }
  }

  private isWritable(raw: ReturnType<typeof this.openSse>): boolean {
    return !raw.destroyed && !raw.writableEnded
  }

  /** §6.4: 构建 reset-required 事件（retention miss / contract 不兼容）。使用 draft.failed
   *  类型 + 稳定 reason code 告知客户端需从 detail 端点重建 cursor。 */
  private buildResetRequiredEvent(
    draftUid: string,
    reason: 'retention_expired' | 'unsupported_version' | 'contract_conflict',
    message?: string,
  ): ProjectDraftStreamEvent {
    const reasonCodes: Record<string, string> = {
      retention_expired: 'STREAM_RETENTION_MISS',
      unsupported_version: 'STREAM_CONTRACT_INCOMPATIBLE',
      contract_conflict: 'STREAM_REPLAY_RESET_REQUIRED',
    }
    return {
      type: 'draft.failed',
      draftId: draftUid,
      version: 1,
      sequence: 0,
      errorCode: reasonCodes[reason] ?? 'RESET_REQUIRED',
      message:
        message ??
        `游标不可续接（${reason}），请从 GET /api/v1/ai/project-drafts/${draftUid} 获取当前状态后重建 cursor。`,
      consistency: 'failed',
    }
  }
}
