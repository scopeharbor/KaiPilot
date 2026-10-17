/**
 * v3-unified-ai-output-quality-ledger §5.1 —— 既有草案校验的只读投影。
 *
 * 核心纪律：
 * - ai_project_draft_validations 表不迁移、不改写、不 schema-modify；
 * - 只读投影使其历史在统一视图中可用；
 * - 与新写入记录去重（同一校验只计一次）。
 */

import type { DraftValidationProjection, QualityValidationRecord } from '@aiproj/types'
import AiProjectDraftValidation from '#models/ai_project_draft_validation'

export interface ProjectionDeduplicationResult {
  /** 投影行数。 */
  projectionCount: number
  /** 新记录行数。 */
  newRecordCount: number
  /** 去重后总行数。 */
  dedupedTotal: number
  /** 去重掉的行数。 */
  dedupedOverhead: number
}

export class QualityProjectionService {
  /**
   * 从 ai_project_draft_validations 表只读投影。
   * 不写入、不修改原表。
   */
  async projectDraftValidations(
    organizationId: number,
    limit: number = 100,
  ): Promise<DraftValidationProjection[]> {
    // 组织过滤在 SQL 层完成：验证记录经 draftId 关联 ai_project_drafts，
    // 后者带 organization_id。原实现的 `.filter(() => true)` 等于**不过滤**——
    // 任何调用方都会拿到全部组织的草案验证记录（跨租户泄露）。
    const validations = await AiProjectDraftValidation.query()
      .whereHas('draftSession', (draftQuery) => {
        draftQuery.where('organization_id', organizationId)
      })
      .preload('draftSession')
      .orderBy('created_at', 'desc')
      .limit(limit)

    return validations.map((v) => ({
      id: v.id,
      draftId: v.draftId,
      version: v.version,
      phase: v.phase,
      confidenceScore: v.confidenceScore,
      overallRiskLevel: v.overallRiskLevel,
      canConfirm: v.canConfirm,
      report: v.report,
      autoFixDiffs: v.autoFixDiffs,
      createdAt: v.createdAt?.toISO() ?? new Date().toISOString(),
      projectionSource: 'draft_validation_table' as const,
    }))
  }

  /**
   * 将投影行转换为 QualityValidationRecord 的近似形状（用于聚合去重）。
   */
  projectionToRecord(projection: DraftValidationProjection): QualityValidationRecord {
    // 从既有 report JSON 中提取逐检查项结果（如果存在）
    const report = projection.report as Record<string, unknown> | null
    const ruleResults = report?.ruleResults as Array<{
      ruleId: string
      severity: string
      message: string
      path: string | null
    }> | null

    const checkResults = (ruleResults ?? []).map((r) => ({
      checkId: r.ruleId,
      hit: r.severity === 'blocking',
      severity: r.severity as 'blocking' | 'warning' | 'info',
      locationRef: r.path,
      contentHash: null,
      message: r.message,
    }))

    const hitCheckIds = checkResults.filter((r) => r.hit).map((r) => r.checkId)

    return {
      id: projection.id,
      organizationId: 1, // 投影行需要通过 draft → project → organization 解析
      artifactRef: `draft:v1:attempt:${projection.draftId}:${projection.version}`,
      capabilitySurface: 'draft',
      validatorCategory: 'hard',
      validatorVersion: '1.0.0',
      checkResults,
      hitCheckIds,
      confidenceScore: projection.confidenceScore,
      overallRiskLevel: projection.overallRiskLevel as 'low' | 'medium' | 'high' | 'critical',
      canConfirm: projection.canConfirm,
      autoFixTrace: null,
      sanitizedReport: checkResults.map((r) => ({
        checkId: r.checkId,
        hit: r.hit,
        severity: r.severity,
        locationRef: r.locationRef,
        contentHash: r.contentHash,
      })),
      idempotencyKey: `projection:${projection.draftId}:${projection.version}`,
      createdAt: projection.createdAt,
    }
  }

  /**
   * 去重：投影与新记录的同一校验只计一次。
   * 按 artifactRef 去重（投影优先）。
   */
  deduplicate(
    projections: DraftValidationProjection[],
    newRecords: QualityValidationRecord[],
  ): ProjectionDeduplicationResult {
    const seen = new Set<string>()
    let dedupedOverhead = 0

    // 先计入投影
    for (const p of projections) {
      seen.add(`draft:v1:attempt:${p.draftId}:${p.version}`)
    }

    // 新记录中与投影重复的不计
    let newCount = 0
    for (const r of newRecords) {
      if (seen.has(r.artifactRef)) {
        dedupedOverhead++
      } else {
        newCount++
        seen.add(r.artifactRef)
      }
    }

    return {
      projectionCount: projections.length,
      newRecordCount: newCount,
      dedupedTotal: projections.length + newCount,
      dedupedOverhead,
    }
  }
}

export const qualityProjectionService = new QualityProjectionService()
