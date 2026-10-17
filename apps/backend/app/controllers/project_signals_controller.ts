/**
 * v3-triz-contradiction-copilot W3 任务 3.4 —— 被动雷达信号 API 控制器。
 *
 * 端点（前缀 `/api/v1/projects/:projectId/signals`）：
 * - `GET /` 列表（统一 `{ data, meta }` 信封；按领域权限裁剪证据字段）；
 * - `POST /:signalId/dismiss` 忽略（`open → dismissed`）；
 * - `POST /:signalId/adopt` 采纳（`open → adopted`，可关联分析记录）。
 *
 * HTTP 入口只做请求解析、策略判定、响应格式化与**拒绝留痕**；业务全部在
 * `ProjectSignalService`（本 change 的雷达服务）。
 *
 * 只读约定：列表**零写入**（状态过期只在检测写入路径发生）；状态流转写的是雷达自有信号表，
 * 业务表（任务 / 风险 / 议题 / 里程碑 / 资源）零写入。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import ProjectSignalPolicy, {
  type ProjectSignalPolicyDecision,
} from '#policies/project_signal_policy'
import ProjectSignalService, {
  PROJECT_SIGNAL_RADAR_TOOL_NAME,
} from '#services/project_signal/project_signal_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import { hashParameters } from '#services/ai_tools/ai_tools_audit_helper'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import {
  adoptValidator,
  detectValidator,
  dismissValidator,
  listValidator,
} from '#validators/project_signal'
import type User from '#models/user'

@inject()
export default class ProjectSignalsController {
  constructor(
    private readonly policy: ProjectSignalPolicy,
    private readonly signals: ProjectSignalService,
    private readonly audit: AuditService,
  ) {}

  /** 信号列表（低置信 → 角色首页建议队列；高置信 → 项目空间信号卡，同一契约）。 */
  async index(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const query = await ctx.request.validateUsing(listValidator, {
      data: { projectId, ...ctx.request.qs() },
    })

    const decision = await this.policy.authorizeView(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'list', startedAt)

    const result = await this.signals.list({
      organizationId,
      projectId,
      user,
      status: query.status,
      confidenceTier: query.confidenceTier,
      signalType: query.signalType,
      page: query.page,
      perPage: query.perPage,
      domainAccess: decision.domainAccess,
    })

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /** 忽略信号（同观测窗证据不再复发）。 */
  async dismiss(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = await ctx.request.validateUsing(dismissValidator, {
      data: { projectId, signalId: ctx.params.signalId, ...ctx.request.body() },
    })

    const decision = await this.policy.authorizeTransition(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'dismiss', startedAt)

    const record = await this.signals.dismiss({
      organizationId,
      projectId,
      user,
      signalId: Number(body.signalId),
      note: body.note ?? null,
      requestId: this.requestIdOf(ctx),
    })

    return ctx.response.ok({ data: this.signals.toDTO(record, decision.domainAccess) })
  }

  /** 采纳信号（可关联分析记录，形成「信号 ↔ 分析」双向可追溯）。 */
  async adopt(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = await ctx.request.validateUsing(adoptValidator, {
      data: { projectId, signalId: ctx.params.signalId, ...ctx.request.body() },
    })

    const decision = await this.policy.authorizeTransition(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'adopt', startedAt)

    const record = await this.signals.adopt({
      organizationId,
      projectId,
      user,
      signalId: Number(body.signalId),
      analysisId: body.analysisId ?? null,
      note: body.note ?? null,
      requestId: this.requestIdOf(ctx),
    })

    return ctx.response.ok({ data: this.signals.toDTO(record, decision.domainAccess) })
  }

  /** 手动触发检测并返回计数摘要（零 Token 规则计算；零业务写）。 */
  async detect(ctx: HttpContext) {
    const startedAt = Date.now()
    const user = this.currentUser(ctx)
    const organizationId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const body = await ctx.request.validateUsing(detectValidator, {
      data: { projectId, ...ctx.request.body() },
    })

    const decision = await this.policy.authorizeDetect(user, organizationId, projectId)
    await this.assertAuthorized(ctx, decision, 'detect', startedAt)

    const result = await this.signals.detectAndPersist({
      organizationId,
      projectId,
      user,
      asOfDate: body.asOfDate,
      windowDays: body.windowDays,
      requestId: this.requestIdOf(ctx),
    })

    await this.audit.log({
      event: AuditEvent.AI_RECOMMENDATION_GENERATED,
      userId: Number(user.id),
      organizationId,
      projectId,
      requestId: this.requestIdOf(ctx),
      entityType: 'project_signal',
      entityId: null,
      metadata: {
        toolName: PROJECT_SIGNAL_RADAR_TOOL_NAME,
        parametersHash: hashParameters({
          action: 'manual_detect',
          asOfDate: result.detection.asOfDate,
          windowDays: body.windowDays,
        }),
        status: 'SUCCESS',
        durationMs: Date.now() - startedAt,
        action: 'manual_detect',
        createdCount: result.created.length,
        refreshedCount: result.refreshed.length,
        expiredCount: result.expired,
        totalDetected: result.detection.signals.length,
      },
    })

    return ctx.response.ok({
      data: {
        createdCount: result.created.length,
        refreshedCount: result.refreshed.length,
        expiredCount: result.expired,
        totalDetected: result.detection.signals.length,
        asOfDate: result.detection.asOfDate,
      },
    })
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private requestIdOf(ctx: HttpContext): string | null {
    return ctx.request.id() ?? null
  }

  /**
   * 策略判定失败：跨组织 / 不存在统一 404（RL-05 不泄露存在性），其余 403；
   * 两类拒绝都留痕（spec「信号读取的权限隔离与审计」第 3 条：越权拒绝产生审计事件）。
   */
  private async assertAuthorized(
    ctx: HttpContext,
    decision: ProjectSignalPolicyDecision,
    action: string,
    startedAt: number,
  ): Promise<void> {
    if (decision.allowed) return

    const crossOrg = decision.reason === 'cross_org_denied'
    const errorCode = crossOrg ? 'RESOURCE_NOT_FOUND' : 'PERMISSION_DENIED'
    const parameters = {
      action,
      missingPermission: decision.missingPermission,
      reason: decision.reason,
    }

    await this.audit.log({
      event: AuditEvent.AI_RECOMMENDATION_STATUS_CHANGED,
      userId: Number(this.currentUser(ctx).id),
      organizationId: this.orgIdOf(ctx),
      projectId: this.projectIdFrom(ctx),
      requestId: this.requestIdOf(ctx),
      entityType: 'project_signal',
      entityId: null,
      // 低敏：只记动作名、缺失权限码与入参哈希（RL-12）。
      metadata: {
        toolName: PROJECT_SIGNAL_RADAR_TOOL_NAME,
        parametersHash: hashParameters(parameters),
        status: 'REJECTED',
        durationMs: Date.now() - startedAt,
        errorCode,
        ...parameters,
      },
    })

    if (crossOrg) throw new ResourceNotFoundException('项目不存在或无权访问')
    throw new PermissionDeniedException(
      `缺少信号读取所需权限 (${decision.missingPermission ?? 'project:view'})`,
    )
  }
}
