/**
 * v3-copilot-suggestion-inbox — CopilotSuggestionInboxController（任务 7.2）
 *
 * 只做 HTTP 解析、权限上下文、审计转发。
 * 核心逻辑下沉到 services/copilot_inbox/*。
 * 契约：成功 `{ data }`；错误 `{ error: { code, message, details? } }`。
 * 红线：本控制器**绝不写正式业务表**；采纳必经草案层通道。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import { InboxQueryService } from '#services/copilot_inbox/inbox_query_service'
import { InboxStateService } from '#services/copilot_inbox/inbox_state_service'
import { InboxAggregator } from '#services/copilot_inbox/inbox_aggregator'
import { InboxExpiryChecker } from '#services/copilot_inbox/inbox_expiry'
import { InboxContentResolver } from '#services/copilot_inbox/inbox_content_resolver'
import type { InboxEntryState, InboxSourceKind, InboxSeverity } from '@aiproj/types'
import { isInboxAction } from '@aiproj/types'

@inject()
export default class CopilotSuggestionInboxController {
  constructor(
    private readonly queryService: InboxQueryService,
    private readonly stateService: InboxStateService,
    private readonly aggregator: InboxAggregator,
    private readonly expiryChecker: InboxExpiryChecker,
    private readonly audit: AuditService,
    private readonly contentResolver: InboxContentResolver,
  ) {}

  /**
   * GET /api/v1/copilot-suggestion-inbox — 查询收件箱条目。
   *
   * 条目表只存引用；返回前按主来源回源投影正文（`content`），不写回表。
   */
  async index(ctx: HttpContext) {
    const { user, organizationId } = this.requireAuth(ctx)
    const {
      projectId,
      sourceKind,
      state,
      severity,
      since,
      until,
      page = '1',
      perPage = '20',
    } = ctx.request.qs()

    const result = await this.queryService.query({
      organizationId,
      projectId: projectId ? Number(projectId) : undefined,
      sourceKind: sourceKind as InboxSourceKind | undefined,
      state: state as InboxEntryState | undefined,
      severity: severity as InboxSeverity | undefined,
      since,
      until,
      page: Number(page),
      perPage: Math.min(Number(perPage), 100),
    })

    const entries = await this.contentResolver.resolve(user, organizationId, result.entries)
    return ctx.response.json({ data: { ...result, entries } })
  }

  /**
   * GET /api/v1/copilot-suggestion-inbox/unread-count — 获取未读计数。
   */
  async unreadCount(ctx: HttpContext) {
    const { organizationId } = this.requireAuth(ctx)
    const { projectId } = ctx.request.qs()

    const count = await this.queryService.getUnreadCount({
      organizationId,
      projectId: projectId ? Number(projectId) : undefined,
    })

    return ctx.response.json({ data: { unreadCount: count } })
  }

  /**
   * POST /api/v1/copilot-suggestion-inbox/:id/action — 状态变更（mark_read / adopt / dismiss）。
   */
  async action(ctx: HttpContext) {
    const { user, organizationId } = this.requireAuth(ctx)
    const { id } = ctx.params
    const { action: actionType } = ctx.request.body() as { action?: string }

    if (!actionType || !isInboxAction(actionType)) {
      throw new ValidationException('action 非法：只接受 mark_read / adopt / dismiss', {
        details: [{ field: 'action', message: '只接受 mark_read / adopt / dismiss' }],
      })
    }

    // 查找条目（组织隔离）
    const entry = await this.queryService.getEntryById(organizationId, id)
    if (!entry) {
      return ctx.response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '收件箱条目不存在' },
      })
    }

    let result
    switch (actionType) {
      case 'mark_read':
        result = this.stateService.markRead(entry)
        break
      case 'adopt':
        result = await this.stateService.adopt(entry, {
          organizationId,
          projectId: Number(entry.projectId),
          actorId: user.id,
        })
        break
      case 'dismiss':
        result = this.stateService.dismiss(entry)
        break
      default:
        return ctx.response.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: '未知操作' },
        })
    }

    if (!result.success) {
      return ctx.response.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: result.error },
      })
    }

    // 落库状态迁移。此前缺这一步：stateService 只做纯状态机计算，控制器算完就返回，
    // 结果连审计都写了、表里却没变——下一次请求仍读到旧状态，mark_read 之后 adopt
    // 会拿 unread 去迁移而被状态机拒绝。
    // 终态（adopted / dismissed）只写 state：模型的 guardTerminalState 钩子规定
    // 「终态只允许改 state 与 updated_at」，同批写 actionedAt 会被它直接抛错拒绝。
    // mark_read 是非终态，可以顺带落已读时间。
    await this.queryService.updateEntry(id, {
      state: result.newState,
      ...(actionType === 'mark_read' ? { readAt: DateTime.now() } : {}),
    })

    // 审计
    await this.audit.log({
      event: AuditEvent.COPILOT_INBOX_STATE_CHANGED,
      userId: user.id,
      organizationId,
      entityType: 'copilot_suggestion_inbox',
      entityId: Number(id),
      metadata: {
        action: actionType,
        previousState: result.previousState,
        newState: result.newState,
      },
    })

    return ctx.response.json({
      data: {
        entryId: id,
        previousState: result.previousState,
        newState: result.newState,
        previewSessionId: result.previewSessionId,
      },
    })
  }

  /**
   * POST /api/v1/copilot-suggestion-inbox/refresh — 刷新聚合（触发过期检查）。
   */
  async refresh(ctx: HttpContext) {
    const { user, organizationId } = this.requireAuth(ctx)
    const { projectId } = ctx.request.body() as { projectId?: number }

    if (!projectId) {
      throw new ValidationException('projectId 必填', {
        details: [{ field: 'projectId', message: 'projectId 必填' }],
      })
    }

    // 聚合五来源
    const aggregateResult = await this.aggregator.aggregate({
      organizationId,
      projectId,
      actorId: user.id,
    })

    // 检查已有条目的过期状态
    const existingEntries = await this.queryService.getEntriesByProject(organizationId, projectId)
    const expiryResults = await this.expiryChecker.checkBatchExpiry(existingEntries)

    // 更新过期条目
    for (const [entryId, expiryResult] of expiryResults) {
      if (expiryResult.expired) {
        const entry = existingEntries.find((e) => e.id === entryId)
        if (entry) {
          const expireResult = this.stateService.expire(entry)
          if (expireResult.success) {
            await this.queryService.updateEntry(entryId, {
              state: 'expired',
              expiryReason: expiryResult.reason,
              expiryDetail: expiryResult.detail,
            })
          }
        }
      }
    }

    // 落库聚合结果——**必须在过期检查之后**。
    // upsert 会把条目的 sourceRefs 刷成来源当前哈希；若先落库，过期检查拿到的就已经是
    // 新哈希，与来源自然一致，来源变更再也判不出过期（实测：expired 恒为 0）。
    // spec 要求「来源依赖的事实变更即判过期并说明原因」，故顺序不可颠倒。
    const persisted = await this.queryService.upsertAggregated(
      organizationId,
      projectId,
      aggregateResult.entries,
    )
    return ctx.response.json({
      data: {
        aggregated: aggregateResult.entries.length,
        created: persisted.created,
        updated: persisted.updated,
        skippedTerminal: persisted.skippedTerminal,
        missingSources: aggregateResult.missingSources,
        expired: Array.from(expiryResults.values()).filter((r) => r.expired).length,
      },
    })
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * 认证与组织上下文。
   *
   * **抛异常而非 return 响应体**：返回响应对象不会中断调用方，未登录时后续
   * 查询仍会带着 undefined 的 organizationId 执行——那既是类型错误，也是越权风险。
   * 统一走 ApiException，由默认 handler 渲染 `{ error: { code, message } }`。
   */
  private requireAuth(ctx: HttpContext): { user: User; organizationId: number } {
    const user = ctx.auth.getUserOrFail() as User
    // 组织上下文取自 tenant 中间件（与 ai_connections_controller 同一范式），
    // 不从 user 上读——User 模型没有 organizationId 字段。
    const organizationId = ctx.tenant?.organizationId
    if (!organizationId) {
      throw new PermissionDeniedException('缺少组织上下文')
    }
    return { user, organizationId: Number(organizationId) }
  }
}
