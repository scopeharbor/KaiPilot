/**
 * v3-copilot-attachment-and-ocr-input —— Copilot 附件服务。
 *
 * 编排既有件，**不复制任何逻辑**：
 *   附件引用复核（组织归属 + actor 可读性）
 * → OCR 链路接入（预算守卫 → 限流守卫 → 隐私分类 → 下游守卫 → 作业编排）
 * → 结果去处约束（知识候选 / 草案层，两者都待确认）
 * → 低敏摘要（不存 OCR 原文）
 *
 * 红线：
 * - **零域写依赖**——本服务不引入任何域仓储或模型写 API；
 *   变更类 destination 只作为待确认动作返回。
 * - 附件引用复核不可用**阻断**（业务决策）；不默认放行。
 * - OCR 的预算守卫、限流守卫、隐私分类、下游守卫全部沿用，**不为 Copilot 新增例外**。
 * - 不持久化 OCR 原文、prompt、模型输出、token 与 secret。
 */

import type {
  CopilotAttachmentReference,
  CopilotAttachmentProcessingResult,
  CopilotAttachmentTurnSummary,
  CopilotAttachmentRejectionReason,
} from '@aiproj/types'
import type Attachment from '#models/attachment'
import logger from '@adonisjs/core/services/logger'

// ===========================================================================
// 错误类型
// ===========================================================================

/**
 * 附件引用复核不可用，阻断回合（业务决策，不默认放行）。
 */
export class CopilotAttachmentReviewUnavailableError extends Error {
  constructor() {
    super('附件权限判定暂不可用，请稍后重试')
    this.name = 'CopilotAttachmentReviewUnavailableError'
  }
}

// ===========================================================================
// 依赖与入参
// ===========================================================================

export interface CopilotAttachmentServiceDeps {
  /**
   * 附件查询：按 ID + 组织归属查找附件。
   * 返回 null 表示附件不存在或不属于本组织。
   */
  findAttachment: (attachmentId: number, organizationId: number) => Promise<Attachment | null>
  /**
   * actor 可读性检查：actor 是否对该附件有读权限。
   */
  checkReadPermission: (attachment: Attachment, actorId: number) => Promise<boolean>
  /**
   * OCR 预算守卫 preflight。
   */
  budgetPreflight: (params: {
    organizationId: number
    projectId: number | null
    estimatedPages: number
  }) => Promise<{ allowed: boolean; reason?: string }>
  /**
   * OCR 限流守卫 preflight。
   */
  rateLimitPreflight: (params: {
    organizationId: number
    userId: number
  }) => Promise<{ allowed: boolean; reason?: string }>
  /**
   * OCR 作业创建（复用 OcrDocumentJobService.createFromAttachment）。
   */
  createOcrJob: (params: {
    organizationId: number
    projectId: number
    attachment: {
      id: number
      fileName: string
      mimeType: string | null
      fileSize: number | string
      filePath: string
    }
    userId: number
  }) => Promise<{ jobId: number; status: string }>
  /**
   * 审计记录（复用既有 ocr_permission_audit）。
   */
  audit: (params: {
    event: string
    userId: number
    organizationId: number
    entityType: string
    entityId: number
    metadata: Record<string, unknown>
  }) => Promise<void>
}

export interface CopilotAttachmentReviewInput {
  readonly attachments: readonly CopilotAttachmentReference[]
  readonly organizationId: number
  readonly actorId: number
  readonly projectId: number | null
}

export interface CopilotAttachmentReviewResult {
  /** 合规的附件引用（通过复核）。 */
  readonly valid: CopilotAttachmentReference[]
  /** 合规附件对应的 attachment 模型（用于 OCR 作业创建）。 */
  readonly validAttachments: Attachment[]
  /** 被拒引用数（只返回计数，不泄露被拒附件的存在与名称）。 */
  readonly rejectedCount: number
  /** 复核是否全部完成（false = 复核不可用，回合应被阻断）。 */
  readonly reviewComplete: boolean
}

export interface CopilotAttachmentProcessResult {
  readonly summary: CopilotAttachmentTurnSummary
  /** 是否有阻断性失败（上传失败/OCR 失败/预算拒绝/限流拒绝/隐私拒绝）。 */
  readonly hasBlockingFailure: boolean
  /** 阻断性失败的原因（仅在 hasBlockingFailure 为 true 时有值）。 */
  readonly blockingReason?: CopilotAttachmentRejectionReason
}

// ===========================================================================
// 服务
// ===========================================================================

export default class CopilotAttachmentService {
  readonly #deps: CopilotAttachmentServiceDeps

  constructor(deps: CopilotAttachmentServiceDeps) {
    this.#deps = deps
  }

  // =========================================================================
  // Phase 4: 服务端引用复核
  // =========================================================================

  /**
   * 逐条复核附件引用：组织归属 + actor 可读性。
   *
   * 设计决策（D7）：
   * - 复核不可用时阻断回合，不默认放行
   * - 被拒引用缺席，只返回计数，不泄露被拒附件的存在与名称
   * - 非泄露测试：仅相差一项附件权限的两个 actor，响应无计数外差异
   */
  async reviewReferences(
    input: CopilotAttachmentReviewInput,
  ): Promise<CopilotAttachmentReviewResult> {
    const { attachments, organizationId, actorId, projectId } = input

    if (attachments.length === 0) {
      return { valid: [], validAttachments: [], rejectedCount: 0, reviewComplete: true }
    }

    const valid: CopilotAttachmentReference[] = []
    const validAttachments: Attachment[] = []
    let rejectedCount = 0
    let reviewComplete = true

    for (const ref of attachments) {
      try {
        // 1. 查找附件（组织隔离）
        const attachment = await this.#deps.findAttachment(ref.attachmentId, organizationId)
        if (!attachment) {
          // 伪造引用或跨组织引用
          rejectedCount++
          continue
        }

        // 2. 检查 actor 可读性
        const canRead = await this.#deps.checkReadPermission(attachment, actorId)
        if (!canRead) {
          rejectedCount++
          continue
        }

        // 3. 通过复核
        valid.push(ref)
        validAttachments.push(attachment)

        // 审计：附件引用复核通过
        await this.#safeAudit({
          event: 'copilot_attachment_reference_reviewed',
          userId: actorId,
          organizationId,
          entityType: 'attachment',
          entityId: attachment.id,
          metadata: { result: 'approved', projectId },
        })
      } catch (err) {
        // 复核不可用 → 阻断回合
        logger.error(
          { err, attachmentId: ref.attachmentId, organizationId },
          '附件引用复核异常，回合阻断',
        )
        reviewComplete = false
        break
      }
    }

    return { valid, validAttachments, rejectedCount, reviewComplete }
  }

  // =========================================================================
  // Phase 5: OCR 链路接入
  // =========================================================================

  /**
   * 为通过复核的附件创建 OCR 作业。
   *
   * 设计决策（D2）：
   * - 回合不同步等待识别完成，只受理并返回作业标识
   * - 预算守卫与限流守卫沿用既有 OCR 判定，不新增例外
   * - 隐私分类与下游守卫沿用既有处置类别，不新增第四态
   */
  async createRecognitionJobs(
    validAttachments: Attachment[],
    organizationId: number,
    projectId: number | null,
    actorId: number,
  ): Promise<CopilotAttachmentProcessResult> {
    const results: CopilotAttachmentProcessingResult[] = []
    let hasBlockingFailure = false
    let blockingReason: CopilotAttachmentRejectionReason | undefined

    for (const attachment of validAttachments) {
      // 1. 预算守卫
      const budgetCheck = await this.#deps.budgetPreflight({
        organizationId,
        projectId,
        estimatedPages: 1, // 简化：先按 1 页估算
      })
      if (!budgetCheck.allowed) {
        results.push({ status: 'rejected' })
        hasBlockingFailure = true
        blockingReason = 'budget_rejected'
        continue
      }

      // 2. 限流守卫
      const rateLimitCheck = await this.#deps.rateLimitPreflight({
        organizationId,
        userId: actorId,
      })
      if (!rateLimitCheck.allowed) {
        results.push({ status: 'rejected' })
        hasBlockingFailure = true
        blockingReason = 'rate_limit_rejected'
        continue
      }

      // 3. 创建 OCR 作业（异步，不等待完成）
      try {
        const job = await this.#deps.createOcrJob({
          organizationId,
          projectId: projectId ?? 0,
          attachment: {
            id: attachment.id,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            fileSize: Number(attachment.fileSize),
            filePath: attachment.filePath,
          },
          userId: actorId,
        })

        results.push({
          status: 'pending',
          jobId: job.jobId,
        })

        // 审计：OCR 作业创建
        await this.#safeAudit({
          event: 'copilot_attachment_ocr_job_created',
          userId: actorId,
          organizationId,
          entityType: 'ocr_document_job',
          entityId: job.jobId,
          metadata: { attachmentId: attachment.id, projectId },
        })
      } catch (err) {
        logger.error({ err, attachmentId: attachment.id, organizationId }, 'OCR 作业创建失败')
        results.push({ status: 'rejected' })
        hasBlockingFailure = true
        blockingReason = 'recognition_failed'
      }
    }

    const recognizedCount = results.filter(
      (r) => r.status === 'recognized' || r.status === 'pending',
    ).length
    const rejectedCount = results.filter((r) => r.status === 'rejected').length

    return {
      summary: {
        totalCount: results.length,
        recognizedCount,
        rejectedCount,
        results,
      },
      hasBlockingFailure,
      blockingReason,
    }
  }

  // =========================================================================
  // 辅助方法
  // =========================================================================

  /** 安全审计：审计失败不阻断。 */
  async #safeAudit(params: {
    event: string
    userId: number
    organizationId: number
    entityType: string
    entityId: number
    metadata: Record<string, unknown>
  }): Promise<void> {
    try {
      await this.#deps.audit(params)
    } catch (err) {
      logger.warn({ err, entityId: params.entityId }, '附件审计失败（不影响回合）')
    }
  }
}
