/**
 * OcrResultLifecycleClassifier — OCR 结果生命周期分类器（v3-ocr-result-persistence-and-retention §4.3）
 *
 * 职责：
 * - 将 OCR job/page/candidate/accepted_extraction 记录分类到敏感度类别
 * - 确定生命周期状态（active/reviewable/accepted/superseded/expired/purge_pending/purged/hold_blocked）
 * - 计算保留资格时间戳
 * - 基于记录的文本内容/哈希/状态/时间进行分类
 */

import { DateTime } from 'luxon'
import {
  type OcrRetentionSensitivityCategory,
  type OcrRetentionLifecycleState,
  type OcrRetentionPolicy,
  type OcrRetentionRecordKind,
  retentionDaysForCategory,
  computeRetentionDeadlineIso,
  isRetentionDeadlineReached,
} from '@aiproj/types'

export interface LifecycleClassification {
  sensitivityCategory: OcrRetentionSensitivityCategory
  lifecycleState: OcrRetentionLifecycleState
  retentionDeadline: string | null
  eligibleForCleanup: boolean
  eligibleAt: string | null
}

export interface RecordForClassification {
  kind: OcrRetentionRecordKind
  id: number
  status: string // job status / candidate status / extraction status
  hasText: boolean
  hasAcceptedExtraction: boolean // 是否有 accepted extraction 引用
  isSuperseded: boolean
  hasHold: boolean
  createdAt: string // ISO
  purgedAt: string | null
  redactedAt: string | null
  confirmedAt: string | null
  supersededAt: string | null
  /** 记录的来源哈希（可用于清理预览项的指纹计算） */
  sourceHash?: string | null
  /** 记录的内容哈希（可用于清理预览项的指纹计算） */
  contentHash?: string | null
}

export class OcrResultLifecycleClassifier {
  /**
   * 对单条记录进行分类
   */
  classify(record: RecordForClassification, policy: OcrRetentionPolicy): LifecycleClassification {
    const sensitivity = this.#classifySensitivity(record)
    const lifecycle = this.#classifyLifecycle(record)
    const deadline = this.#computeDeadline(record, policy, sensitivity)
    const now = DateTime.utc()

    let eligibleForCleanup = false
    let eligibleAt: string | null = null

    if (lifecycle === 'purged') {
      // 已是终态
    } else if (record.hasHold) {
      // hold 阻止清理
    } else if (
      ['expired', 'purge_pending'].includes(lifecycle) &&
      deadline &&
      isRetentionDeadlineReached({
        baseIso: record.createdAt,
        retentionDays: retentionDaysForCategory(policy, sensitivity),
        nowIso: now.toISO()!,
      })
    ) {
      eligibleForCleanup = true
      eligibleAt = computeRetentionDeadlineIso(
        record.createdAt,
        retentionDaysForCategory(policy, sensitivity),
      )
    }

    return {
      sensitivityCategory: sensitivity,
      lifecycleState: lifecycle,
      retentionDeadline: deadline,
      eligibleForCleanup,
      eligibleAt,
    }
  }

  /** 对多条记录批量分类 */
  classifyMany(
    records: RecordForClassification[],
    policy: OcrRetentionPolicy,
  ): Map<number, LifecycleClassification> {
    const results = new Map<number, LifecycleClassification>()
    for (const record of records) {
      results.set(record.id, this.classify(record, policy))
    }
    return results
  }

  // ── private ──

  #classifySensitivity(record: RecordForClassification): OcrRetentionSensitivityCategory {
    switch (record.kind) {
      case 'job':
        return 'job_metadata'
      case 'page':
        return 'page_state'
      case 'candidate':
        return record.hasText ? 'candidate_text' : 'candidate_metadata'
      case 'accepted_extraction':
        return record.hasText ? 'accepted_extraction_text' : 'accepted_extraction_metadata'
    }
  }

  #classifyLifecycle(record: RecordForClassification): OcrRetentionLifecycleState {
    if (record.hasHold) return 'hold_blocked'
    if (record.purgedAt) return 'purged'
    if (record.redactedAt) return 'purged'

    switch (record.kind) {
      case 'job': {
        const status = record.status
        if (['completed', 'confirmed'].includes(status)) return 'accepted'
        if (['failed', 'cancelled'].includes(status)) return 'expired'
        return 'active'
      }
      case 'page': {
        const status = record.status
        if (status === 'completed') return 'accepted'
        if (status === 'failed') return 'expired'
        return 'active'
      }
      case 'candidate': {
        if (record.isSuperseded) return 'superseded'
        const status = record.status
        if (status === 'confirmed') return 'accepted'
        if (status === 'failed') return 'expired'
        return 'reviewable'
      }
      case 'accepted_extraction': {
        if (record.isSuperseded) return 'superseded'
        if (record.status === 'current') return 'accepted'
        return 'accepted'
      }
    }
  }

  #computeDeadline(
    record: RecordForClassification,
    policy: OcrRetentionPolicy,
    sensitivity: OcrRetentionSensitivityCategory,
  ): string | null {
    const days = retentionDaysForCategory(policy, sensitivity)
    if (!days) return null
    return computeRetentionDeadlineIso(record.createdAt, days)
  }
}
