/**
 * v2-triz-decision-log-traceability —— Draft Layer 集成适配器（tasks 8.1–8.3）。
 *
 * 在 Draft Apply 阶段校验 TRIZ-sourced 变更项是否已有对应的决策日志。
 * 若缺少决策日志，可阻止 Apply 或发出警告。
 */
import type { TrizDecisionSubjectRef } from '@aiproj/types'
import TrizDecisionLog from '#models/triz_decision_log'
import logger from '@adonisjs/core/services/logger'

export interface DraftDecisionValidationResult {
  /** 是否可以继续 Apply */
  canProceed: boolean
  /** 阻止/警告原因列表 */
  reasons: string[]
}

/**
 * TrizDecisionDraftAdapter —— Draft Layer 决策日志校验适配器。
 *
 * 在 Draft Apply 前扫描所有 TRIZ-sourced 变更项，
 * 检查每个项是否有关联的决策日志。
 */
export class TrizDecisionDraftAdapter {
  constructor() {}

  /**
   * 校验 draft items 中 TRIZ 来源的项是否已有对应决策日志。
   *
   * @param draftItems      Draft 变更项列表（含 subjectRefs 元数据）
   * @param organizationId  当前组织 ID
   * @returns               校验结果
   */
  async validateDecisionRefs(
    draftItems: Array<{ subjectRefs?: TrizDecisionSubjectRef[] }>,
    organizationId: number,
  ): Promise<DraftDecisionValidationResult> {
    const reasons: string[] = []

    // 收集所有 TRIZ-sourced 的 refs
    const trizRefs = draftItems
      .flatMap((item) => item.subjectRefs ?? [])
      .filter(
        (ref) =>
          ref.kind === 'contradiction' ||
          ref.kind === 'analysis_artifact' ||
          ref.kind === 'resolution_path',
      )

    if (trizRefs.length === 0) {
      return { canProceed: true, reasons: [] }
    }

    // 对每个 TRIZ ref，查找是否有对应决策日志
    for (const ref of trizRefs) {
      const hasDecision = await this.hasDecisionLog(organizationId, ref)
      if (!hasDecision) {
        reasons.push(
          `TRIZ 来源「${ref.title ?? ref.id}」缺少关联决策日志。` +
            `建议先为此来源创建决策日志再执行 Apply。`,
        )
      }
    }

    return {
      canProceed: reasons.length === 0,
      reasons,
    }
  }

  /**
   * 阻止缺少决策日志的 TRIZ-sourced Draft Apply。
   * 有阻止原因时返回 false，不抛出异常。
   */
  async blockTrizItemsWithoutDecisions(
    draftItems: Array<{ subjectRefs?: TrizDecisionSubjectRef[] }>,
    organizationId: number,
  ): Promise<{ blocked: boolean; reasons: string[] }> {
    const result = await this.validateDecisionRefs(draftItems, organizationId)

    if (!result.canProceed) {
      logger.warn(
        { reasons: result.reasons, organizationId },
        'TRIZ decision validation blocked Draft Apply',
      )
    }

    return {
      blocked: !result.canProceed,
      reasons: result.reasons,
    }
  }

  // ── Private ──

  private async hasDecisionLog(
    organizationId: number,
    ref: TrizDecisionSubjectRef,
  ): Promise<boolean> {
    try {
      const count = await TrizDecisionLog.query()
        .where('organization_id', organizationId)
        .whereRaw("json_extract(subject_refs, '$[*].kind') LIKE ?", [`%"${ref.kind}"%`])
        .whereRaw("json_extract(subject_refs, '$[*].id') LIKE ?", [`%"${ref.id}"%`])
        .where('decision_status', 'active')
        .limit(1)
        .count('* as total')

      const total = typeof count[0]?.$extras?.total === 'number' ? count[0].$extras.total : 0
      return total > 0
    } catch {
      // SQLite JSON 查询可能出错，容错返回 true（不阻止）
      logger.warn({ ref }, 'Failed to check decision log existence (JSON query)')
      return true
    }
  }
}
