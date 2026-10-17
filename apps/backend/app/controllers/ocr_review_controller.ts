import OcrReviewService from '#services/ai_ocr/ocr_review_service'
import OcrReviewPolicy from '#policies/ocr_review_policy'
import AuditService from '#services/audit_service'
import { OcrDownstreamGuard } from '#services/ai_ocr/ocr_downstream_guard'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type { OcrPermissionAction, OcrSourceRef } from '@aiproj/types'
import {
  ocrConfirmationPreviewValidator,
  ocrConfirmationSaveValidator,
  ocrAcceptedExtractionListValidator,
} from '#validators/ocr_review'

/**
 * OCR 审查确认 Controller（v3-ocr-review-confirmation-flow §4.4）。
 *
 * 项目作用域下的 OCR 审查工作台端点：
 * - GET    review        审查详情
 * - GET    accepted      已接受提取列表
 * - POST   select        创建选择（验证用）
 * - POST   preview       确认预览
 * - POST   save          确认保存
 */
@inject()
export default class OcrReviewController {
  readonly #guard: OcrDownstreamGuard

  constructor(
    private reviewService: OcrReviewService,
    private policy: OcrReviewPolicy,
    private audit: AuditService,
  ) {
    this.#guard = new OcrDownstreamGuard(audit)
  }

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  /** 由 jobId 构造低敏来源引用（kind=attachment，与 review 工作台来源一致）。 */
  private toSourceRef(jobId: number): OcrSourceRef {
    return { type: 'ocr_source', id: jobId, kind: 'attachment' }
  }

  /**
   * 用 resolver 遮蔽审查工作台允许动作：仅移除被硬阻断（denied/stale/retention/privacy）
   * 的动作；`metadata_only` 不遮蔽（来源未落地时仍允许查看/选择）。
   */
  // 泛型透传元素类型：写死 string[] 会把审查详情里的动作字面量联合放宽成 string，
  // 回填 data.allowedActions 时就通不过编译。
  private async maskAllowedActions<T extends string>(
    user: User,
    orgId: number,
    projectId: number,
    jobId: number,
    original: readonly T[],
  ): Promise<T[]> {
    const sourceRef = this.toSourceRef(jobId)
    const base = { actorId: user.id, organizationId: orgId, projectId, sourceRef }
    const [confirmSnap, readSnap] = await Promise.all([
      this.#guard.resolve({ ...base, action: 'review_confirm' }),
      this.#guard.resolve({ ...base, action: 'accepted_text_read' }),
    ])

    const confirmBlocked = !this.#guard.isAllowed(confirmSnap)
    const readBlocked = !this.#guard.isAllowed(readSnap)

    const denied = new Set<OcrPermissionAction>()
    if (confirmBlocked) denied.add('review_confirm')
    if (readBlocked) denied.add('accepted_text_read')

    return original.filter((a) => {
      switch (a) {
        case 'confirm':
        case 'supersede':
        case 'copy':
        case 'export':
          return !denied.has('review_confirm')
        case 'view':
        case 'select':
        case 'preview_confirmation':
          return !denied.has('accepted_text_read')
        default:
          return true
      }
    })
  }

  /** GET /api/v1/projects/:projectId/ocr/document-jobs/:jobId/review */
  async review(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const jobId = Number(ctx.params.jobId)

    await this.policy.assertView(user, orgId, projectId)

    const data = await this.reviewService.getReviewDetail(jobId, orgId, projectId, user)

    // 用 resolver 遮蔽被硬阻断的允许动作（§6.1）
    const allowedActions = await this.maskAllowedActions(
      user,
      orgId,
      projectId,
      jobId,
      data.allowedActions,
    )
    data.allowedActions = allowedActions

    await this.audit.log({
      event: 'OCR_REVIEW_OPEN',
      userId: user.id,
      organizationId: orgId,
      projectId,
      entityType: 'ocr_document_job',
      entityId: jobId,
      metadata: { jobId, allowedActions },
    })

    return ctx.response.ok({ data })
  }

  /** GET /api/v1/projects/:projectId/ocr/document-jobs/:jobId/accepted-extractions */
  async acceptedExtractions(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const jobId = Number(ctx.params.jobId)

    await this.policy.assertView(user, orgId, projectId)

    const filters = await ctx.request.validateUsing(ocrAcceptedExtractionListValidator, {
      data: ctx.request.qs(),
    })

    // 路由本身按 :jobId 挂载，查询串未显式指定来源时默认收敛到该 job，避免越出路由语义
    const result = await this.reviewService['adapter'].getAcceptedExtractions(
      orgId,
      projectId,
      filters.sourceKind,
      filters.sourceId ?? jobId,
      filters.page,
      filters.perPage,
    )

    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /** POST /api/v1/projects/:projectId/ocr/document-jobs/:jobId/confirmation-preview */
  async confirmationPreview(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const jobId = Number(ctx.params.jobId)

    const input = await ctx.request.validateUsing(ocrConfirmationPreviewValidator)

    // 确认预览守卫：被拒则写低敏边界审计并阻止（§6.1）
    await this.#guard.guard({
      actorId: user.id,
      organizationId: orgId,
      projectId,
      action: 'review_confirm',
      sourceRef: this.toSourceRef(jobId),
    })

    const data = await this.reviewService.confirmationPreview(
      input.selection,
      orgId,
      projectId,
      user,
      input.reviewNote,
    )

    await this.audit.log({
      event: 'OCR_REVIEW_CONFIRMATION_PREVIEW',
      userId: user.id,
      organizationId: orgId,
      projectId,
      entityType: 'ocr_document_job',
      entityId: jobId,
      metadata: {
        jobId,
        previewHash: data.previewHash,
        sourceHash: data.sourceHash,
        candidateHash: data.candidateHash,
        selectedTextHash: data.selectedTextHash,
      },
    })

    return ctx.response.ok({ data })
  }

  /** POST /api/v1/projects/:projectId/ocr/document-jobs/:jobId/confirmation-save */
  async confirmationSave(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const jobId = Number(ctx.params.jobId)

    const input = await ctx.request.validateUsing(ocrConfirmationSaveValidator)

    // 确认保存守卫：被拒则写低敏边界审计并阻止（§6.1）
    await this.#guard.guard({
      actorId: user.id,
      organizationId: orgId,
      projectId,
      action: 'review_confirm',
      sourceRef: this.toSourceRef(jobId),
    })

    try {
      const data = await this.reviewService.confirmationSave(
        input.previewHash,
        input.selection,
        orgId,
        projectId,
        user,
        input.reviewNote,
      )

      await this.audit.log({
        event: 'OCR_REVIEW_CONFIRMATION_SAVED',
        userId: user.id,
        organizationId: orgId,
        projectId,
        entityType: 'ocr_review_accepted_extraction',
        entityId: data.extractionId,
        metadata: {
          jobId,
          extractionId: data.extractionId,
          sourceHash: data.sourceHash,
          candidateHash: data.candidateHash,
          selectedTextHash: data.selectedTextHash,
          pageRefs: data.pageRefs,
        },
      })

      return ctx.response.ok({ data })
    } catch (err: any) {
      if (err.message?.includes('STALE_SOURCE')) {
        await this.audit.log({
          event: 'OCR_REVIEW_STALE_BLOCKED',
          userId: user.id,
          organizationId: orgId,
          projectId,
          entityType: 'ocr_document_job',
          entityId: jobId,
          metadata: { jobId, reason: 'stale_source' },
        })
      }
      throw err
    }
  }
}
