/**
 * v3-copilot-action-and-preview-boundary —— CopilotActionController（任务 4.x/5.x 端点）。
 *
 * 只做 HTTP 解析、权限上下文、审计转发；核心逻辑下沉到
 * `services/copilot_action/*`（构建器 / 确认前校验 / 决策翻译）。
 * 契约：成功 `{ data }`；错误 `{ error: { code, message, details? } }`。
 * 红线：本控制器**绝不写正式业务表**；禁止客户端指定 organizationId；
 * 所有可持久化动作必经草案层通道与显式人工确认。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { ValidationException } from '#exceptions/api_exception'
import {
  CopilotActionBuilder,
  CopilotActionBuildError,
} from '#services/copilot_action/action_builder'
import {
  CopilotActionDecisionService,
  CopilotDecisionError,
} from '#services/copilot_action/copilot_action_decision_service'
import RbacService from '#services/rbac_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  copilotActionSubmitSchema,
  copilotActionConfirmSchema,
} from '#validators/copilot_action_validator'

@inject()
export default class CopilotActionController {
  constructor(
    private readonly builder: CopilotActionBuilder,
    private readonly decision: CopilotActionDecisionService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  /**
   * POST /api/v1/ai/copilot-actions/submit —— 把 Copilot 建议物化为草案层会话 + change set。
   * 只写草案态行；正式业务表零写入（spec Requirement 1）。
   */
  async submit(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const body = await copilotActionSubmitSchema.parseAsync(ctx.request.body())

    try {
      const { session, changes } = await this.builder.materializeAction({
        organizationId,
        userId: user.id,
        actionCardId: body.actionCardId,
        normalizedActionInput: body.normalizedActionInput,
        idempotencyKey: body.idempotencyKey,
        sourceSignaturePrefixes: body.sourceSignaturePrefixes,
        reliedOnSubstitutedDefaults: body.reliedOnSubstitutedDefaults,
        changeInputs: body.changes.map((c) => ({
          targetRef: c.targetRef,
          operation: c.operation,
          value: c.value,
          oldValue: c.oldValue ?? null,
          confidence: c.confidence,
          dependsOn: c.dependsOn ?? [],
        })),
      })

      await this.audit.log({
        event: AuditEvent.COPILOT_ACTION_PRODUCED,
        organizationId,
        userId: user.id,
        metadata: {
          actionCardId: body.actionCardId,
          draftSessionId: session.id,
          changeCount: changes.length,
          idempotencyKey: body.idempotencyKey,
        },
      })

      return ctx.response.created({
        data: {
          sessionId: session.id,
          changeIds: changes.map((c) => c.id),
        },
      })
    } catch (error) {
      if (error instanceof CopilotActionBuildError) {
        throw new ValidationException(error.message)
      }
      throw error
    }
  }

  /**
   * POST /api/v1/ai/copilot-actions/confirm —— 人工确认（服务端复核 + 翻译为既有草案层决策）。
   * 权限：动作声明的所需权限在此经 RbacService 逐项复核（服务端复核，不信任客户端渲染）。
   */
  async confirm(ctx: HttpContext) {
    const { user, organizationId } = await this.requireAuth(ctx)
    const body = await copilotActionConfirmSchema.parseAsync(ctx.request.body())

    // 服务端权限复核：逐项解析 actor 实际权限集（供确认前校验使用）
    const actorPermissions: string[] = []
    for (const permission of body.requiredPermissions) {
      const result = await this.rbac.check(user, permission as never, organizationId)
      if (result.allowed) actorPermissions.push(permission)
    }

    try {
      const result = await this.decision.decide({
        sessionId: body.sessionId,
        organizationId,
        userId: user.id,
        actionCardId: body.actionCardId,
        changeId: body.changeId,
        decision: body.decision,
        userModifiedValue: body.userModifiedValue,
        userNote: body.userNote ?? undefined,
        requiredPermissions: body.requiredPermissions,
        actorPermissions,
        requestSources: body.requestSources,
        recordedSources: body.recordedSources,
        confirmedTargetRefs: body.confirmedTargetRefs,
        writeTargetRefs: body.writeTargetRefs,
        dryRunCanApply: body.dryRunCanApply,
        idempotencyKey: body.idempotencyKey,
        existingResultIdempotencyKey: null,
        attempt: body.attempt,
        maxRetries: body.maxRetries,
      })

      return { data: result }
    } catch (error) {
      if (error instanceof CopilotDecisionError) throw new ValidationException(error.message)
      throw error
    }
  }

  /** 获取认证用户和租户上下文。 */
  private async requireAuth(ctx: HttpContext) {
    const { authUser, tenant } = ctx
    if (!authUser || !tenant) throw new ValidationException('缺少组织上下文')
    return { user: authUser, organizationId: tenant.organizationId }
  }
}
