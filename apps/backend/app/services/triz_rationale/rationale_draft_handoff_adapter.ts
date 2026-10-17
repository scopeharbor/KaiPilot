/**
 * v2-triz-recommendation-rationale-ui —— Draft Layer Handoff 适配器（§5.1–5.3）。
 *
 * 从 TRIZ 推荐理由面板创建 Draft Layer 候选输入。
 * 正式 apply 仍需 Preview → Diff → Dry-run → 权限校验 → 人工确认。
 */
import { inject } from '@adonisjs/core'
import type { RationaleSourceRef, RationaleSourceType, RationaleWarning } from '@aiproj/types'

export interface HandoffPayload {
  organizationId: number
  projectId: number
  userId: number
  targetType: RationaleSourceType
  targetId: string
  sourceRefs: RationaleSourceRef[]
  selectedPrinciple: string | null
  warningSummary: string | null
}

export interface HandoffResult {
  draftSessionId: number | null
  handoffStatus: 'candidate_created' | 'stale' | 'handed_off'
  warnings: RationaleWarning[]
}

@inject()
export default class RationaleDraftHandoffAdapter {
  /**
   * 创建 Draft Layer 候选输入。
   * 只创建待审查上下文，不修改正式业务数据。
   */
  async createCandidate(_payload: HandoffPayload): Promise<HandoffResult> {
    // 首版实现：占位返回 candidate_created
    // TODO: v2-ai-draft-layer-preview-diff-apply 归档后接入 Draft Layer API
    return {
      draftSessionId: null,
      handoffStatus: 'candidate_created',
      warnings: [],
    }
  }
}
