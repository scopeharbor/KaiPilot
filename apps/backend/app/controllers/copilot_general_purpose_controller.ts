/**
 * v3-copilot-general-purpose-mode —— 通用问答端点控制器。
 *
 * 只做 HTTP 解析、权限校验、组织隔离与统一 envelope；核心判定逻辑下沉到
 * `services/copilot_general_purpose/copilot_general_purpose_mode_service`。
 *
 * 契约：成功 `{ data }`；错误 `{ error: { code, message, details? } }`。
 * 红线：本控制器**绝不写任何业务表**（通用模式结构性禁写）。
 *       不记录 prompt 与输出全文（低敏审计）。
 */

import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { ValidationException } from '#exceptions/api_exception'
import RbacService from '#services/rbac_service'
import AuditService from '#services/audit_service'
import {
  evaluateGeneralPurposeMode,
  buildAuditEntry,
  buildContextForGeneralPurposeEntry,
} from '#services/copilot_general_purpose/copilot_general_purpose_mode_service'

/**
 * 通用问答请求体校验 schema（简化版；完整校验由 validator 层承担）。
 */
interface GeneralPurposeRequestBody {
  message: string
  sessionId?: string
  requestedCapability?: string
}

@inject()
export default class CopilotGeneralPurposeController {
  constructor(
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  /**
   * POST /api/v1/ai/general-purpose —— 通用问答端点。
   *
   * 流程：
   * 1. 鉴权 + 组织隔离
   * 2. 权限校验（ai:trigger）
   * 3. 模式判定（全局边界检查）
   * 4. 返回判定结果或拒绝
   *
   * 本阶段不接入真实模型 provider（离线默认）。
   * 真实模型接入归独立 change（v3-copilot-web-search-tool / external-content-safety）。
   */
  async handle(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const body = await this.validateBody(ctx)

    // 1. 权限校验
    const permCheck = await this.rbac.check(user, 'ai:trigger' as never, organizationId)
    const hasPermission = permCheck.allowed

    // 2. 能力开关校验（组织级）
    const isCapabilityEnabled = await this.checkCapabilityEnabled(organizationId)

    // 3. 模式判定
    const decision = evaluateGeneralPurposeMode({
      userId: user.id,
      organizationId,
      message: body.message,
      hasAiTriggerPermission: hasPermission,
      isCapabilityEnabled,
    })

    // 4. 不可用时返回明确原因
    if (!decision.answerable) {
      // 审计：越权尝试或不可用
      const auditEntry = buildAuditEntry(
        !hasPermission ? 'unauthorized_attempt' : 'quota_exhausted',
        user.id,
        organizationId,
        { reason: decision.unavailabilityReason },
      )
      await this.auditLowSensitivity(auditEntry)

      // 无权限时不泄露更多信息（spec: revealing nothing beyond that fact）
      if (!hasPermission) {
        throw new ValidationException('无权使用通用问答', {
          code: 'PERMISSION_DENIED',
        })
      }

      // 组织关闭时表述为「能力未启用」（spec: described as a capability that is not enabled）
      if (!isCapabilityEnabled) {
        return ctx.response.ok({
          data: {
            available: false,
            reason: '能力未启用',
            sessionId: body.sessionId ?? null,
          },
        })
      }

      // 配额耗尽
      return ctx.response.ok({
        data: {
          available: false,
          reason: decision.unavailabilityReason ?? '配额已耗尽',
          sessionId: body.sessionId ?? null,
        },
      })
    }

    // 5. 模式进入审计
    const entryAudit = buildAuditEntry('mode_entered', user.id, organizationId, {
      capability: body.requestedCapability,
    })
    await this.auditLowSensitivity(entryAudit)

    // 6. 构建上下文（确保项目上下文已清理）
    const context = buildContextForGeneralPurposeEntry()

    // 7. 返回判定结果（本阶段不调用真实模型）
    return ctx.response.ok({
      data: {
        available: true,
        sessionId: body.sessionId ?? `gp-session-${Date.now().toString(36)}`,
        scope: context.scope,
        projectContextCleared: context.projectContextCleared,
        boundaryResults: decision.boundaryResults,
        quotaStatus: decision.quotaStatus,
        knowledgeLimitation: decision.knowledgeLimitation,
        // 本阶段：离线模式，不返回 answer
        // 真实模型接入后在此调用 provider 并流式返回
        offline: true,
        message: '通用问答端点已就绪。模型接入后将返回回答。',
      },
    })
  }

  /**
   * 组织级能力开关校验。
   * 未落地时返回 true（默认启用），后续消费 v3-plugin 能力开关。
   */
  private async checkCapabilityEnabled(_organizationId: number): Promise<boolean> {
    // 默认启用；组织级开关由 v3-plugin-first-scope-rebaseline 后续实现
    return true
  }

  /** 低敏审计转发（不含 prompt 与输出全文）。 */
  private async auditLowSensitivity(entry: {
    eventType: string
    userId: number
    organizationId: number
    timestamp: string
    metadata: Record<string, unknown>
  }) {
    try {
      // 复用既有 audit service，使用低敏事件类型
      await this.audit.log({
        event: entry.eventType as never,
        userId: entry.userId,
        organizationId: entry.organizationId,
        entityType: 'ai_general_purpose',
        metadata: entry.metadata,
      })
    } catch {
      // 审计失败不应阻塞主流程（降级）
    }
  }

  /** 请求体校验。 */
  private async validateBody(ctx: HttpContext): Promise<GeneralPurposeRequestBody> {
    const body = ctx.request.body() as Record<string, unknown>
    if (!body || typeof body.message !== 'string' || body.message.trim().length === 0) {
      throw new ValidationException('消息内容不能为空')
    }
    if (body.message.length > 10_000) {
      throw new ValidationException('消息内容过长（上限 10,000 字符）')
    }
    return {
      message: body.message.trim(),
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      requestedCapability:
        typeof body.requestedCapability === 'string' ? body.requestedCapability : undefined,
    }
  }

  /** 获取认证用户和租户上下文。 */
  private async requireAuth(ctx: HttpContext) {
    const { authUser, tenant } = ctx
    if (!authUser || !tenant) throw new ValidationException('缺少组织上下文')
    return { user: authUser, organizationId: tenant.organizationId }
  }
}
