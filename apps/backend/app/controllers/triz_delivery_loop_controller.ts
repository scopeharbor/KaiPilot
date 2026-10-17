/**
 * v3-triz-to-delivery-closed-loop —— TrizDeliveryLoopController（task 9.2）。
 *
 * 薄 Controller：认证上下文解析 → Policy 判定 → validator 解析请求 →
 * 委派 Service → 统一 {data} / {data, meta} / 错误信封。零业务逻辑。
 *
 * feature flag（task 9.3）：`TRIZ_DELIVERY_LOOP_ENABLED` 于 controller 内按请求校验；
 * off 时本组全部端点 404 非泄露（不影响历史只读与其他 TRIZ 路由——本组是唯一入口）。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizDeliveryLoopPolicy from '#policies/triz_delivery_loop_policy'
import { ClosedLoopReadModelService } from '#services/triz_delivery_loop/closed_loop_read_model_service'
import {
  TrizDeliveryLinkService,
  TrizDlLinkValidationError,
} from '#services/triz_delivery_loop/link_service'
import {
  TrizDeliveryVerificationService,
  TrizDlVerificationError,
} from '#services/triz_delivery_loop/verification_service'
import { createDefaultTrizDlRegistry } from '#services/triz_delivery_loop/default_read_adapters'
import {
  trizDeliveryLoopListValidator,
  trizDeliveryLoopItemValidator,
  trizDeliveryLoopLinkPreviewValidator,
  trizDeliveryLoopLinkConfirmValidator,
  trizDeliveryLoopVerifyValidator,
  trizDeliveryLoopReopenValidator,
} from '#validators/triz_delivery_loop'
import ApiException from '#exceptions/api_exception'
import {
  ResourceNotFoundException,
  ValidationException,
  PermissionDeniedException,
} from '#exceptions/api_exception'
import type User from '#models/user'

const FEATURE_FLAG = 'TRIZ_DELIVERY_LOOP_ENABLED'

@inject()
export default class TrizDeliveryLoopController {
  private readModel: ClosedLoopReadModelService
  private linkService: TrizDeliveryLinkService
  private verificationService: TrizDeliveryVerificationService

  constructor(private policy: TrizDeliveryLoopPolicy) {
    const registry = createDefaultTrizDlRegistry()
    this.readModel = new ClosedLoopReadModelService(registry)
    this.linkService = new TrizDeliveryLinkService(registry)
    this.verificationService = new TrizDeliveryVerificationService(this.readModel)
  }

  // ── helpers ──

  private flagEnabled(): boolean {
    return ['1', 'true', 'yes'].includes(String(process.env[FEATURE_FLAG] ?? '').toLowerCase())
  }

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  /** flag 关闭 → 与资源不存在不可区分（非泄露）。 */
  private assertFlag(_ctx: HttpContext) {
    if (!this.flagEnabled()) {
      throw new ResourceNotFoundException('资源不存在')
    }
  }

  // ── GET summary ──

  async summary(ctx: HttpContext) {
    this.assertFlag(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = Number(ctx.params.projectId)
    if (!(await this.policy.view(user, orgId, projectId))) {
      throw new ResourceNotFoundException('资源不存在')
    }
    const body = await trizDeliveryLoopListValidator.validate({
      projectId,
      ...ctx.request.qs(),
    })
    const result = await this.readModel.list({
      organizationId: orgId,
      projectId,
      actorUserId: user.id,
      page: body.page,
      perPage: body.perPage ?? 20,
      postureFilter: body.posture,
    })
    return { data: result.summary }
  }

  // ── GET items ──

  async index(ctx: HttpContext) {
    this.assertFlag(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = Number(ctx.params.projectId)
    if (!(await this.policy.view(user, orgId, projectId))) {
      throw new ResourceNotFoundException('资源不存在')
    }
    const body = await trizDeliveryLoopListValidator.validate({
      projectId,
      ...ctx.request.qs(),
    })
    const result = await this.readModel.list({
      organizationId: orgId,
      projectId,
      actorUserId: user.id,
      page: body.page,
      perPage: body.perPage ?? 20,
      postureFilter: body.posture,
    })
    return {
      data: result.items,
      meta: {
        page: result.meta.page,
        perPage: result.meta.perPage,
        total: result.summary.visibleItemCount,
      },
    }
  }

  // ── GET items/:itemId ──

  async show(ctx: HttpContext) {
    this.assertFlag(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = Number(ctx.params.projectId)
    if (!(await this.policy.view(user, orgId, projectId))) {
      throw new ResourceNotFoundException('资源不存在')
    }
    const body = await trizDeliveryLoopItemValidator.validate({
      projectId,
      itemId: String(ctx.params.itemId),
    })
    void body
    const detail = await this.readModel.detail(
      `link-${String(ctx.params.itemId).replace(/^link-/, '')}`,
      {
        organizationId: orgId,
        projectId,
      },
    )
    return { data: detail }
  }

  // ── GET items/:itemId/ready（task 10.8/10.10：验证/重审对话框的就绪与指纹来源，零写入）──

  async showReadiness(ctx: HttpContext) {
    this.assertFlag(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = Number(ctx.params.projectId)
    if (!(await this.policy.view(user, orgId, projectId))) {
      throw new ResourceNotFoundException('资源不存在')
    }
    const body = await trizDeliveryLoopItemValidator.validate({
      projectId,
      itemId: String(ctx.params.itemId),
    })
    const itemId = `link-${body.itemId.replace(/^link-/, '')}`
    const readiness = await this.verificationService.readiness(orgId, projectId, itemId)
    return {
      data: {
        itemId,
        ready: readiness.ready,
        blockingReasons: readiness.blockingReasons,
        verificationFingerprint: readiness.verificationFingerprint,
        effectiveConclusion: readiness.effectiveConclusion,
      },
    }
  }

  // ── POST links/preview ──

  async linksPreview(ctx: HttpContext) {
    this.assertFlag(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = Number(ctx.params.projectId)
    if (!(await this.policy.link(user, orgId, projectId))) {
      throw new ResourceNotFoundException('资源不存在')
    }
    const body = await trizDeliveryLoopLinkPreviewValidator.validate({
      projectId,
      ...ctx.request.body(),
    })
    try {
      const res = await this.linkService.preview(orgId, projectId, body)
      return { data: res }
    } catch (error) {
      if (error instanceof TrizDlLinkValidationError) {
        throw this.mapLinkError(error)
      }
      throw error
    }
  }

  // ── POST links/confirm ──

  async linksConfirm(ctx: HttpContext) {
    this.assertFlag(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = Number(ctx.params.projectId)
    if (!(await this.policy.link(user, orgId, projectId))) {
      throw new ResourceNotFoundException('资源不存在')
    }
    const body = await trizDeliveryLoopLinkConfirmValidator.validate({
      projectId,
      ...ctx.request.body(),
    })
    if (!body.confirmation.acknowledgedOnlyLinkWrite) {
      ctx.response.status(422)
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: '必须显式确认“只写关联”后才能提交',
        },
      }
    }
    try {
      const res = await this.linkService.confirm(orgId, projectId, user.id, {
        request: {
          projectId,
          decisionLogId: body.decisionLogId,
          deliveryRefs: body.deliveryRefs,
          contextRefs: body.contextRefs,
        },
        previewFingerprint: body.previewFingerprint,
      })
      return { data: res }
    } catch (error) {
      if (error instanceof TrizDlLinkValidationError) {
        throw this.mapLinkError(error)
      }
      throw error
    }
  }

  // ── POST items/:itemId/verifications ──

  async storeVerification(ctx: HttpContext) {
    this.assertFlag(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = Number(ctx.params.projectId)
    if (!(await this.policy.verify(user, orgId, projectId))) {
      throw new ResourceNotFoundException('资源不存在')
    }
    const body = await trizDeliveryLoopVerifyValidator.validate({
      projectId,
      itemId: String(ctx.params.itemId),
      ...ctx.request.body(),
    })
    try {
      const res = await this.verificationService.recordVerification(orgId, projectId, user.id, {
        itemId: `link-${body.itemId.replace(/^link-/, '')}`,
        conclusion: body.conclusion,
        observationWindow: body.observationWindow,
        baselineSummary: body.baselineSummary,
        targetSummary: body.targetSummary,
        actualResult: body.actualResult,
        reason: body.reason,
        evidenceRefs: body.evidenceRefs,
        verificationFingerprint: body.verificationFingerprint,
        supersedesEventId: body.supersedesEventId,
      })
      return { data: res }
    } catch (error) {
      if (error instanceof TrizDlVerificationError) {
        throw this.mapVerifyError(error)
      }
      throw error
    }
  }

  // ── POST items/:itemId/reopen ──

  async storeReopen(ctx: HttpContext) {
    this.assertFlag(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = Number(ctx.params.projectId)
    if (!(await this.policy.reopen(user, orgId, projectId))) {
      throw new ResourceNotFoundException('资源不存在')
    }
    const body = await trizDeliveryLoopReopenValidator.validate({
      projectId,
      itemId: String(ctx.params.itemId),
      ...ctx.request.body(),
    })
    try {
      const res = await this.verificationService.requestReopen(orgId, projectId, user.id, {
        itemId: `link-${body.itemId.replace(/^link-/, '')}`,
        reason: body.reason,
        currentFingerprint: body.currentFingerprint,
      })
      return { data: res }
    } catch (error) {
      if (error instanceof TrizDlVerificationError) {
        throw this.mapVerifyError(error)
      }
      throw error
    }
  }

  // ── error mapping（统一信封 + 409/422/404）──

  private mapLinkError(error: TrizDlLinkValidationError): ApiException {
    switch (error.code) {
      case 'PREVIEW_STALE':
      case 'ENTITY_HIDDEN':
      case 'DECISION_NOT_ACTIVE':
        return new ApiException(error.message, { status: 409, code: 'TRIZ_DL_PREVIEW_STALE' })
      case 'DUPLICATE_REFS':
      case 'REFS_OVERFLOW':
      case 'CROSS_KIND':
      case 'NO_REQUIRED_DELIVERY':
      case 'DECISION_INVALID':
      default:
        return new ValidationException(error.message)
    }
  }

  private mapVerifyError(error: TrizDlVerificationError): ApiException {
    switch (error.code) {
      case 'FINGERPRINT_STALE':
        return new ApiException(error.message, { status: 409, code: 'TRIZ_DL_VERIFICATION_STALE' })
      case 'AUTOMATION_DENIED':
        return new PermissionDeniedException(error.message)
      case 'NOT_READY':
      case 'EVIDENCE_INVALID':
      case 'POSTURE_INELIGIBLE':
      case 'TEXT_OVERFLOW':
      default:
        return new ValidationException(error.message, { code: 'TRIZ_DL_NOT_READY' })
    }
  }
}
