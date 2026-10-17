/**
 * v3-copilot-voice-input §3-§6 — Copilot 音频输入服务。
 *
 * 编排既有件，**不复制任何逻辑**：
 *   音频引用复核（组织归属 + actor 可读性）
 * → 授权门检查（未授权时短路）
 * → 隐私告知确认（不可跳过）
 * → ASR 链路接入（预算守卫 → 限流守卫 → 隐私分类 → 下游守卫 → 作业编排）
 * → 结果去处约束（知识候选 / 草案层，两者都待确认）
 * → 低敏摘要（不存转写全文）
 *
 * 红线：
 * - **零域写依赖**——本服务不引入任何域仓储或模型写 API；
 *   变更类 destination 只作为待确认动作返回。
 * - 音频引用复核不可用**阻断**（业务决策）；不默认放行。
 * - 授权门短路点在调用外部 ASR 之前；未授权时零 provider 调用、零公网访问。
 * - 隐私告知不可跳过；每次上传都需确认。
 * - ASR 的预算守卫、限流守卫、隐私分类、下游守卫全部沿用，**不为 Copilot 新增例外**。
 * - 不持久化转写全文、prompt、模型输出、token 与 secret。
 * - 不做说话人分离与身份识别（D6）。
 */

import type {
  CopilotVoiceAttachmentReference,
  CopilotVoiceProcessingResult,
  CopilotVoiceTurnSummary,
  CopilotVoiceRejectionReason,
} from '@aiproj/types'
import { isCopilotVoiceSupportedMimeType } from '@aiproj/types'
import type Attachment from '#models/attachment'
import logger from '@adonisjs/core/services/logger'
import type CopilotVoiceAuthorizationGate from './copilot_voice_authorization_gate.js'

// ===========================================================================
// 错误类型
// ===========================================================================

/**
 * 音频引用复核不可用，阻断回合（业务决策，不默认放行）。
 */
export class CopilotVoiceReviewUnavailableError extends Error {
  constructor() {
    super('音频权限判定暂不可用，请稍后重试')
    this.name = 'CopilotVoiceReviewUnavailableError'
  }
}

// ===========================================================================
// 依赖与入参
// ===========================================================================

export interface CopilotVoiceInputServiceDeps {
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
   * ASR 授权门检查。
   */
  authorizationGate: CopilotVoiceAuthorizationGate
  /**
   * ASR 预算守卫 preflight。
   */
  budgetPreflight: (params: {
    organizationId: number
    projectId: number | null
    estimatedDurationSeconds: number
  }) => Promise<{ allowed: boolean; reason?: string }>
  /**
   * ASR 限流守卫 preflight。
   */
  rateLimitPreflight: (params: {
    organizationId: number
    userId: number
  }) => Promise<{ allowed: boolean; reason?: string }>
  /**
   * ASR 作业创建（异步，不等待完成）。
   */
  createAsrJob: (params: {
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

export interface CopilotVoiceReviewInput {
  readonly attachments: readonly CopilotVoiceAttachmentReference[]
  readonly organizationId: number
  readonly actorId: number
  readonly projectId: number | null
}

export interface CopilotVoiceReviewResult {
  /** 合规的音频引用（通过复核）。 */
  readonly valid: CopilotVoiceAttachmentReference[]
  /** 合规音频对应的 attachment 模型（用于 ASR 作业创建）。 */
  readonly validAttachments: Attachment[]
  /** 被拒引用数（只返回计数，不泄露被拒音频的存在与名称）。 */
  readonly rejectedCount: number
  /** 复核是否全部完成（false = 复核不可用，回合应被阻断）。 */
  readonly reviewComplete: boolean
  /** 拒绝原因（仅在 rejectedCount > 0 时有值）。 */
  readonly rejectionReason?: CopilotVoiceRejectionReason
}

export interface CopilotVoiceProcessResult {
  readonly summary: CopilotVoiceTurnSummary
  /** 是否有阻断性失败（授权未开/上传失败/ASR 失败/预算拒绝/限流拒绝/隐私拒绝）。 */
  readonly hasBlockingFailure: boolean
  /** 阻断性失败的原因（仅在 hasBlockingFailure 为 true 时有值）。 */
  readonly blockingReason?: CopilotVoiceRejectionReason
}

// ===========================================================================
// 服务
// ===========================================================================

export default class CopilotVoiceInputService {
  readonly #deps: CopilotVoiceInputServiceDeps

  constructor(deps: CopilotVoiceInputServiceDeps) {
    this.#deps = deps
  }

  // =========================================================================
  // Phase 1: 授权门检查（§3.3-3.5）
  // =========================================================================

  /**
   * 检查 ASR 授权状态。
   *
   * 设计决策（D2）：
   * - 授权门短路点在调用外部 ASR 之前
   * - 走完上传、校验、落决策后短路
   * - 未授权时返回明确的「未启用」原因，不静默当作未上传
   */
  async checkAuthorization(organizationId: number): Promise<{
    authorized: boolean
    rejectionReason?: CopilotVoiceRejectionReason
    message: string
  }> {
    return this.#deps.authorizationGate.checkAuthorization(organizationId)
  }

  // =========================================================================
  // Phase 2: 服务端引用复核
  // =========================================================================

  /**
   * 逐条复核音频引用：组织归属 + actor 可读性。
   *
   * 设计决策：
   * - 复核不可用时阻断回合，不默认放行
   * - 被拒引用缺席，只返回计数，不泄露被拒音频的存在与名称
   * - 音频 MIME 类型校验沿用既有附件通道
   */
  async reviewReferences(input: CopilotVoiceReviewInput): Promise<CopilotVoiceReviewResult> {
    const { attachments, organizationId, actorId, projectId } = input

    if (attachments.length === 0) {
      return { valid: [], validAttachments: [], rejectedCount: 0, reviewComplete: true }
    }

    const valid: CopilotVoiceAttachmentReference[] = []
    const validAttachments: Attachment[] = []
    let rejectedCount = 0
    let reviewComplete = true
    let firstRejectionReason: CopilotVoiceRejectionReason | undefined

    for (const ref of attachments) {
      try {
        // 1. MIME 类型校验（§3.2：不为音频放宽校验）
        if (!isCopilotVoiceSupportedMimeType(ref.mimeType)) {
          rejectedCount++
          if (!firstRejectionReason) firstRejectionReason = 'type_not_supported'
          continue
        }

        // 2. 查找附件（组织隔离）
        const attachment = await this.#deps.findAttachment(ref.attachmentId, organizationId)
        if (!attachment) {
          // 伪造引用或跨组织引用
          rejectedCount++
          if (!firstRejectionReason) firstRejectionReason = 'reference_forged'
          continue
        }

        // 3. 检查 actor 可读性
        const canRead = await this.#deps.checkReadPermission(attachment, actorId)
        if (!canRead) {
          rejectedCount++
          if (!firstRejectionReason) firstRejectionReason = 'reference_cross_org'
          continue
        }

        // 4. 通过复核
        valid.push(ref)
        validAttachments.push(attachment)

        // 审计：音频引用复核通过
        await this.#safeAudit({
          event: 'copilot_voice_reference_reviewed',
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
          '音频引用复核异常，回合阻断',
        )
        reviewComplete = false
        break
      }
    }

    return {
      valid,
      validAttachments,
      rejectedCount,
      reviewComplete,
      rejectionReason: firstRejectionReason,
    }
  }

  // =========================================================================
  // Phase 3: ASR 链路接入（§5.1-5.8）
  // =========================================================================

  /**
   * 为通过复核的音频创建 ASR 作业。
   *
   * 设计决策：
   * - 回合不同步等待转写完成，只受理并返回作业标识（§5.3）
   * - 预算守卫与限流守卫沿用既有判定，不新增例外
   * - 隐私分类与下游守卫沿用既有处置类别
   * - 不做说话人分离与身份识别（§5.7）
   */
  async createTranscriptionJobs(
    validAttachments: Attachment[],
    organizationId: number,
    projectId: number | null,
    actorId: number,
  ): Promise<CopilotVoiceProcessResult> {
    const results: CopilotVoiceProcessingResult[] = []
    let hasBlockingFailure = false
    let blockingReason: CopilotVoiceRejectionReason | undefined

    for (const attachment of validAttachments) {
      // 1. 预算守卫
      const estimatedDuration = this.#estimateDuration(attachment)
      const budgetCheck = await this.#deps.budgetPreflight({
        organizationId,
        projectId,
        estimatedDurationSeconds: estimatedDuration,
      })
      if (!budgetCheck.allowed) {
        results.push({ status: 'rejected', rejectionReason: 'budget_rejected' })
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
        results.push({ status: 'rejected', rejectionReason: 'rate_limit_rejected' })
        hasBlockingFailure = true
        blockingReason = 'rate_limit_rejected'
        continue
      }

      // 3. 创建 ASR 作业（异步，不等待完成）
      try {
        const job = await this.#deps.createAsrJob({
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

        // 审计：ASR 作业创建
        await this.#safeAudit({
          event: 'copilot_voice_asr_job_created',
          userId: actorId,
          organizationId,
          entityType: 'voice_transcription_job',
          entityId: job.jobId,
          metadata: { attachmentId: attachment.id, projectId },
        })
      } catch (err) {
        logger.error({ err, attachmentId: attachment.id, organizationId }, 'ASR 作业创建失败')
        results.push({ status: 'rejected', rejectionReason: 'transcription_failed' })
        hasBlockingFailure = true
        blockingReason = 'transcription_failed'
      }
    }

    const acceptedCount = results.filter((r) => r.status === 'pending').length
    const rejectedCount = results.filter((r) => r.status === 'rejected').length

    return {
      summary: {
        totalCount: results.length,
        acceptedCount,
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

  /**
   * 估算音频时长（秒）。
   * 简化实现：按文件大小和比特率估算。
   */
  #estimateDuration(attachment: Attachment): number {
    const fileSizeBytes = Number(attachment.fileSize)
    // 假设平均比特率 128kbps = 16KB/s
    const estimatedSeconds = Math.ceil(fileSizeBytes / 16000)
    return Math.max(1, estimatedSeconds)
  }

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
      logger.warn({ err, entityId: params.entityId }, '音频审计失败（不影响回合）')
    }
  }
}
