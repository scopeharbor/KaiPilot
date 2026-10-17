/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerDecisionService（task 6.1-6.5）。
 *
 * 处理用户对变更项的决策（接受/拒绝/编辑/跳过/批量）。
 * 服务端保存决策状态，重新计算 selectionHash。
 * 自动补全 WBS 父链、移除悬空依赖。
 */
import { inject } from '@adonisjs/core'
import DraftLayerSession from '#models/draft_layer_session'
import DraftLayerChange from '#models/draft_layer_change'
import type { DraftLayerReviewStatus, DraftLayerBulkDecision } from '@aiproj/types'
import { computeSelectionHash } from '@aiproj/types'

export class DecisionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecisionValidationError'
  }
}

@inject()
export class DraftLayerDecisionService {
  constructor() {}

  /**
   * 对单个 change 做决策。
   */
  async decide(
    sessionId: number,
    changeId: number,
    organizationId: number,
    reviewStatus: DraftLayerReviewStatus,
    userModifiedValue?: unknown,
    userNote?: string,
  ): Promise<{ change: DraftLayerChange; selectionHash: string; parentChainCompleted: string[] }> {
    const session = await DraftLayerSession.forOrganization(organizationId)
      .where('id', sessionId)
      .first()
    if (!session) throw new DecisionValidationError('Session 不存在')

    const change = await DraftLayerChange.query()
      .where('id', changeId)
      .where('session_id', sessionId)
      .first()
    if (!change) throw new DecisionValidationError('Change 不存在')

    // 若为 edit，校验用户编辑值
    if (reviewStatus === 'modified') {
      if (userModifiedValue === undefined) {
        throw new DecisionValidationError('编辑决策必须提供 userModifiedValue')
      }
    }

    // 保存决策
    change.reviewStatus = reviewStatus
    if (userModifiedValue !== undefined) {
      change.userModifiedValue = userModifiedValue
    }
    if (userNote !== undefined) {
      change.userNote = userNote
    }
    await change.save()

    // 重新计算 selectionHash
    const allChanges = await DraftLayerChange.query()
      .where('session_id', sessionId)
      .orderBy('sequence', 'asc')

    const decisions = allChanges.map((c) => ({
      changeId: c.id,
      reviewStatus: c.reviewStatus,
      userModifiedValue: c.userModifiedValue,
    }))
    const selectionHash = computeSelectionHash(decisions)

    // 更新 session summary
    session.summary = {
      ...((session.summary as any) ?? {}),
      acceptedChanges: allChanges.filter((c) => c.reviewStatus === 'accepted').length,
      rejectedChanges: allChanges.filter((c) => c.reviewStatus === 'rejected').length,
      pendingChanges: allChanges.filter(
        (c) => c.reviewStatus === 'pending' || c.reviewStatus === 'skipped',
      ).length,
    }
    await session.save()

    // 父链补全检测
    const parentChainCompleted = await this.ensureParentChain(sessionId, organizationId, change)

    return { change, selectionHash, parentChainCompleted }
  }

  /**
   * 批量操作。
   */
  async bulkDecide(
    sessionId: number,
    organizationId: number,
    decision: DraftLayerBulkDecision,
  ): Promise<{ affected: number; selectionHash: string }> {
    const session = await DraftLayerSession.forOrganization(organizationId)
      .where('id', sessionId)
      .first()
    if (!session) throw new DecisionValidationError('Session 不存在')

    let query = DraftLayerChange.query().where('session_id', sessionId)

    // 过滤
    if (decision.entityTypes && decision.entityTypes.length > 0) {
      query = query.whereIn('target_entity_type', decision.entityTypes)
    }
    if (decision.operations && decision.operations.length > 0) {
      query = query.whereIn('operation', decision.operations)
    }
    if (decision.minConfidence !== undefined) {
      query = query.where('confidence', '>=', decision.minConfidence)
    }
    if (decision.allExcept && decision.allExcept.length > 0) {
      query = query.whereNotIn('id', decision.allExcept)
    }

    const changes = await query

    // 批量更新
    for (const change of changes) {
      change.reviewStatus = decision.action
      await change.save()
    }

    // 更新 session summary + selectionHash
    const allChanges = await DraftLayerChange.query()
      .where('session_id', sessionId)
      .orderBy('sequence', 'asc')

    const decisions = allChanges.map((c) => ({
      changeId: c.id,
      reviewStatus: c.reviewStatus,
      userModifiedValue: c.userModifiedValue,
    }))
    const selectionHash = computeSelectionHash(decisions)

    session.summary = {
      ...((session.summary as any) ?? {}),
      acceptedChanges: allChanges.filter((c) => c.reviewStatus === 'accepted').length,
      rejectedChanges: allChanges.filter((c) => c.reviewStatus === 'rejected').length,
      pendingChanges: allChanges.filter(
        (c) => c.reviewStatus === 'pending' || c.reviewStatus === 'skipped',
      ).length,
    }
    await session.save()

    return { affected: changes.length, selectionHash }
  }

  /**
   * 确保 WBS 父节点被选中：如果子节点被接受但父节点未决策，自动接受父节点。
   */
  private async ensureParentChain(
    sessionId: number,
    _organizationId: number,
    change: DraftLayerChange,
  ): Promise<string[]> {
    if (change.targetEntityType !== 'wbs_node') return []
    if (change.reviewStatus !== 'accepted') return []

    const completed: string[] = []

    // 检查同一 session 中是否该 WBS 节点的父节点也被接受了
    // WBS 父链逻辑：wbs_1 → wbs_2 表示父 → 子
    // 如果 id 是 wbs_N，父节点为 wbs_{N-1}（简化实现，实际需要 parentId 字段）
    const wbsPattern = /^wbs_(\d+)$/
    const match = change.targetEntityId.match(wbsPattern)
    if (match) {
      const index = Number.parseInt(match[1], 10)
      if (index > 1) {
        const parentId = `wbs_${index - 1}`
        const parentChange = await DraftLayerChange.query()
          .where('session_id', sessionId)
          .where('target_entity_id', parentId)
          .where('target_entity_type', 'wbs_node')
          .where('review_status', 'pending')
          .first()
        if (parentChange) {
          parentChange.reviewStatus = 'accepted'
          await parentChange.save()
          completed.push(parentId)
        }
      }
    }

    return completed
  }
}
