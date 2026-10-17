/**
 * v3-unified-ai-output-quality-ledger §4 —— 质量记录器单一入口。
 *
 * 核心纪律：
 * - 全部能力面（draft/risk/prediction/pmo/triz/report/health）必须通过本入口落账；
 * - 逐检查项结果在写时拆解，不在读时解析 report；
 * - 校验器版本随记录落盘，支撑按版本分组趋势查询；
 * - 自动修复尝试与结果留痕；
 * - 幂等键防重复写入；
 * - 记账失败可降级，但 can_confirm=false 必须继续阻断确认。
 *
 * 不新增也不修改任何反幻觉检查逻辑。
 */

import type { QualityRecordingInput } from '@aiproj/types'
import { sanitizeQualityReport, qualityReportHasForbiddenKeys } from '@aiproj/types'
import QualityValidationResult from '#models/quality_validation_result'
import { DateTime } from 'luxon'

export interface QualityRecorderResult {
  /** 写入是否成功。 */
  success: boolean
  /** 写入的记录 ID（成功时）。 */
  recordId: number | null
  /** 幂等命中（已存在，跳过写入）。 */
  idempotentHit: boolean
  /** 降级信息（写入失败时）。 */
  degradation: {
    recordingFailed: boolean
    businessVerdictNotConfirmable: boolean
    confirmationBlocked: boolean
  }
}

export class QualityRecorderService {
  /**
   * 单一入口：记录一条校验结果。
   * 所有能力面必须通过本方法落账，不得旁路。
   */
  async record(input: QualityRecordingInput): Promise<QualityRecorderResult> {
    // 幂等检查：已存在则跳过
    const existing = await QualityValidationResult.query()
      .where('idempotency_key', input.idempotencyKey)
      .first()

    if (existing) {
      return {
        success: true,
        recordId: existing.id,
        idempotentHit: true,
        degradation: {
          recordingFailed: false,
          businessVerdictNotConfirmable: !input.canConfirm,
          confirmationBlocked: !input.canConfirm,
        },
      }
    }

    // 脱敏：确保 report 不含产物正文
    const sanitizedReport = sanitizeQualityReport(input.checkResults)

    // 安全检查：report 不得含禁止内容键
    const forbiddenKeys = qualityReportHasForbiddenKeys(
      Object.fromEntries(sanitizedReport.map((r, i) => [`entry_${i}`, r])),
    )
    if (forbiddenKeys) {
      // 如果 sanitizer 后仍含禁止键，拒绝写入
      return {
        success: false,
        recordId: null,
        idempotentHit: false,
        degradation: {
          recordingFailed: true,
          businessVerdictNotConfirmable: !input.canConfirm,
          confirmationBlocked: !input.canConfirm,
        },
      }
    }

    try {
      const record = await QualityValidationResult.create({
        organizationId: input.organizationId,
        artifactRef: input.artifactRef,
        capabilitySurface: input.capabilitySurface,
        validatorCategory: 'hard',
        validatorVersion: input.validatorVersion,
        checkResults: input.checkResults,
        hitCheckIds: input.hitCheckIds,
        confidenceScore: input.confidenceScore,
        overallRiskLevel: input.overallRiskLevel,
        canConfirm: input.canConfirm,
        autoFixTrace: input.autoFixTrace ?? null,
        sanitizedReport,
        idempotencyKey: input.idempotencyKey,
        createdAt: DateTime.utc(),
      })

      return {
        success: true,
        recordId: record.id,
        idempotentHit: false,
        degradation: {
          recordingFailed: false,
          businessVerdictNotConfirmable: !input.canConfirm,
          confirmationBlocked: !input.canConfirm,
        },
      }
    } catch {
      // 记账失败降级：不得回滚业务事件、不得改变终态
      return {
        success: false,
        recordId: null,
        idempotentHit: false,
        degradation: {
          recordingFailed: true,
          businessVerdictNotConfirmable: !input.canConfirm,
          // 关键：确认阻断 = 业务判定，不依赖记账是否成功
          confirmationBlocked: !input.canConfirm,
        },
      }
    }
  }

  /**
   * 批量记录（多个能力面的校验结果）。
   */
  async recordBatch(inputs: QualityRecordingInput[]): Promise<QualityRecorderResult[]> {
    const results: QualityRecorderResult[] = []
    for (const input of inputs) {
      results.push(await this.record(input))
    }
    return results
  }

  /**
   * 按幂等键查询已有记录（只读，不写入）。
   */
  async findByIdempotencyKey(idempotencyKey: string): Promise<QualityValidationResult | null> {
    return QualityValidationResult.query().where('idempotency_key', idempotencyKey).first()
  }

  /**
   * 按组织与能力面查询记录（只读）。
   */
  async listByOrganizationAndSurface(
    organizationId: number,
    capabilitySurface: string,
    limit: number = 50,
  ): Promise<QualityValidationResult[]> {
    return QualityValidationResult.query()
      .where('organization_id', organizationId)
      .where('capability_surface', capabilitySurface)
      .orderBy('created_at', 'desc')
      .limit(limit)
  }
}

export const qualityRecorderService = new QualityRecorderService()
