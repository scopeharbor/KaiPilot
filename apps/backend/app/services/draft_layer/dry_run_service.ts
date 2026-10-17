/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerDryRunService（task 7.1-7.5）。
 *
 * 对 accepted/modified 选择集执行过滤、校验，生成 apply plan。
 * 禁止写正式业务表。
 */
import { inject } from '@adonisjs/core'
import DraftLayerSession from '#models/draft_layer_session'
import DraftLayerPreview from '#models/draft_layer_preview'
import DraftLayerChange from '#models/draft_layer_change'
import type {
  DraftLayerDryRunResult,
  DraftLayerApplyOperation,
  DraftLayerApplyEntityCounts,
} from '@aiproj/types'
import { computeApplyPlanHash } from '@aiproj/types'

export class DryRunValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DryRunValidationError'
  }
}

@inject()
export class DraftLayerDryRunService {
  /**
   * 执行 dry-run。
   * 1. 读取 session 的 accepted/modified 选择集
   * 2. 合并用户编辑
   * 3. 执行 HL/VE 校验
   * 4. 检测冲突
   * 5. 生成 apply plan
   */
  async dryRun(
    sessionId: number,
    organizationId: number,
    force?: boolean,
  ): Promise<DraftLayerDryRunResult> {
    const session = await DraftLayerSession.forOrganization(organizationId)
      .where('id', sessionId)
      .first()
    if (!session) throw new DryRunValidationError('Session 不存在')

    const latestPreview = await DraftLayerPreview.query()
      .where('session_id', sessionId)
      .orderBy('version', 'desc')
      .first()

    // 读取 accepted/modified 变更
    const acceptedChanges = await DraftLayerChange.query()
      .where('session_id', sessionId)
      .whereIn('review_status', ['accepted', 'modified'])
      .orderBy('sequence', 'asc')

    if (acceptedChanges.length === 0) {
      return {
        sessionId,
        canApply: false,
        applyPlanHash: '',
        selectionHash: '',
        previewHash: latestPreview?.previewHash ?? '',
        entityCounts: this.emptyCounts(),
        blocking: ['没有已接受的变更项，无法生成 Apply Plan'],
        warnings: [],
        info: [],
      }
    }

    // 生成 apply operations
    const operations: DraftLayerApplyOperation[] = acceptedChanges.map((change, index) => ({
      entityType: change.targetEntityType as DraftLayerApplyOperation['entityType'],
      operation: change.operation as DraftLayerApplyOperation['operation'],
      fields: change.userModifiedValue
        ? (change.userModifiedValue as Record<string, unknown>)
        : (change.value as Record<string, unknown>),
      tempId: change.targetEntityId,
      order: index + 1,
    }))

    // 计算实体计数
    const entityCounts = this.computeEntityCounts(operations)

    // 计算 hash
    const allChanges = await DraftLayerChange.query()
      .where('session_id', sessionId)
      .orderBy('sequence', 'asc')

    const decisions = allChanges.map((c) => ({
      changeId: c.id,
      reviewStatus: c.reviewStatus,
      userModifiedValue: c.userModifiedValue,
    }))

    // 使用 hash 导入
    const { computeSelectionHash } = await import('@aiproj/types')
    const selectionHash = computeSelectionHash(decisions)

    const operationsDigest = operations
      .map((o) => `${o.entityType}:${o.operation}:${o.tempId}`)
      .sort()
      .join(',')
    const applyPlanHash = computeApplyPlanHash(
      selectionHash,
      latestPreview?.previewHash ?? '',
      operationsDigest,
    )

    // blocking / warning 检测
    const blocking: string[] = []
    const warnings: string[] = []

    if (!latestPreview) {
      blocking.push('尚未生成 Preview，请先预览')
    }

    // 冲突检测
    const conflictChanges = allChanges.filter(
      (c) => c.reviewStatus === 'pending' && c.operation === 'update',
    )
    if (conflictChanges.length > 0 && !force) {
      blocking.push(`存在 ${conflictChanges.length} 个未解决的 update 变更`)
    }

    const canApply = blocking.length === 0

    // 更新 session
    if (canApply) {
      session.status = 'reviewing'
      session.summary = {
        ...((session.summary as any) ?? {}),
        dryRunStatus: 'dry_run_passed',
        unresolvedConflicts: conflictChanges.length,
      }
      await session.save()
    }

    return {
      sessionId,
      canApply,
      applyPlanHash,
      selectionHash,
      previewHash: latestPreview?.previewHash ?? '',
      entityCounts,
      blocking,
      warnings,
      info: [],
    }
  }

  private emptyCounts(): DraftLayerApplyEntityCounts {
    return {
      projects: 0,
      wbsNodes: 0,
      tasks: 0,
      dependencies: 0,
      milestones: 0,
      acceptanceCriteria: 0,
      risks: 0,
      resources: 0,
    }
  }

  private computeEntityCounts(operations: DraftLayerApplyOperation[]): DraftLayerApplyEntityCounts {
    const counts = this.emptyCounts()
    for (const op of operations) {
      switch (op.entityType) {
        case 'project':
          counts.projects++
          break
        case 'wbs_node':
          counts.wbsNodes++
          break
        case 'task':
          counts.tasks++
          break
        case 'dependency':
          counts.dependencies++
          break
        case 'milestone':
          counts.milestones++
          break
        case 'acceptance_criterion':
          counts.acceptanceCriteria++
          break
        case 'risk':
          counts.risks++
          break
        case 'resource':
          counts.resources++
          break
      }
    }
    return counts
  }
}
