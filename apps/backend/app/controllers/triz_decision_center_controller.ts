/**
 * v3-triz-decision-center —— TrizDecisionCenterController。
 *
 * HTTP 入口，只处理请求解析、权限校验、响应格式化。
 * 业务逻辑下沉到 TrizDecisionCenterService。
 *
 * 端点：
 *  GET  /api/v1/projects/:projectId/triz-decision-center/summary   — 摘要
 *  GET  /api/v1/projects/:projectId/triz-decision-center/items      — 队列列表
 *  GET  /api/v1/projects/:projectId/triz-decision-center/items/:itemId — 详情
 *  GET  /api/v1/projects/:projectId/triz-decision-center/readiness  — Draft readiness
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizDecisionCenterPolicy from '#policies/triz_decision_center_policy'
import TrizDecisionCenterService from '#services/triz_decision/triz_decision_center_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  trizDecisionCenterSummaryValidator,
  trizDecisionCenterListValidator,
  trizDecisionCenterDetailValidator,
  trizDecisionCenterReadinessValidator,
} from '#validators/triz_decision_center'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import logger from '@adonisjs/core/services/logger'

@inject()
export default class TrizDecisionCenterController {
  constructor(
    private policy: TrizDecisionCenterPolicy,
    private service: TrizDecisionCenterService,
    private audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  private async guardView(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.view(user, orgId, projectId))) {
      // 权限拒绝审计（低敏：仅记录拒绝类别，不泄露隐藏来源标题/证据/目标详情）
      await this.audit
        .log({
          event: AuditEvent.TRIZ_DECISION_CENTER_READ_DENIED,
          userId: user.id,
          organizationId: orgId,
          projectId,
          entityType: 'triz_decision_center',
          entityId: 0,
          metadata: {
            action: 'view',
            status: 'denied',
            reason: 'rbac',
          },
        })
        .catch((err) => {
          logger.error({ err }, 'TRIZ decision center read denied audit failed')
        })
      throw new PermissionDeniedException('无权查看 TRIZ 决策中心')
    }
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/projects/:projectId/triz-decision-center/summary
   *
   * 返回决策中心摘要：各队列计数、来源计数、warning 聚合、近期关键决策。
   */
  async summary(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    await ctx.request.validateUsing(trizDecisionCenterSummaryValidator, {
      data: { projectId },
    })

    const result = await this.service.summary(orgId, projectId)

    // 低敏审计（只读读取，含 status/warning，不含敏感 payload）
    await this.audit
      .log({
        event: AuditEvent.TRIZ_DECISION_CENTER_SUMMARY_READ,
        userId: this.currentUser(ctx).id,
        organizationId: orgId,
        projectId,
        entityType: 'triz_decision_center',
        entityId: 0,
        metadata: {
          action: 'summary_read',
          status: 'ok',
          totalItems: result.data.totalItems,
          readyForDraftCount: result.data.readyForDraftCount,
          blockedCount: result.data.blockedCount,
          warningCount: Object.values(result.data.warningCounts).reduce(
            (a: number, b: number) => a + b,
            0,
          ),
        },
      })
      .catch((err) => {
        logger.error({ err }, 'TRIZ decision center summary audit log failed')
      })

    return ctx.response.ok(result)
  }

  /**
   * GET /api/v1/projects/:projectId/triz-decision-center/items
   *
   * 返回可过滤、分页、排序的决策中心队列列表。
   */
  async index(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const params = await ctx.request.validateUsing(trizDecisionCenterListValidator, {
      data: { projectId, ...ctx.request.qs() },
    })

    const result = await this.service.list(orgId, projectId, {
      status: params.status,
      sourceKind: params.sourceKind,
      warning: params.warning,
      priority: params.priority,
      search: params.search,
      page: params.page,
      perPage: params.perPage,
      sort: params.sort,
    })

    return ctx.response.ok(result)
  }

  /**
   * GET /api/v1/projects/:projectId/triz-decision-center/items/:itemId
   *
   * 返回单个决策中心项的详情，包含证据链和决策时间线。
   */
  async show(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    const params = await ctx.request.validateUsing(trizDecisionCenterDetailValidator, {
      data: { projectId, itemId: ctx.params.itemId },
    })

    const result = await this.service.detail(orgId, projectId, params.itemId)

    return ctx.response.ok(result)
  }

  /**
   * GET /api/v1/projects/:projectId/triz-decision-center/readiness
   *
   * 返回 Draft readiness 分组结果。
   */
  async readiness(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)

    await ctx.request.validateUsing(trizDecisionCenterReadinessValidator, {
      data: { projectId },
    })

    const result = await this.service.readiness(orgId, projectId)

    return ctx.response.ok(result)
  }
}
