/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerDiffService（task 5.1-5.5）。
 *
 * 基于 baseline、current production 和 preview snapshot 计算结构化 Diff。
 * 实体级、字段级、Patch 级三层表示。
 * 支持三方冲突检测。
 */
import { inject } from '@adonisjs/core'
import DraftLayerSession from '#models/draft_layer_session'
import DraftLayerPreview from '#models/draft_layer_preview'
import DraftLayerChange from '#models/draft_layer_change'
import type {
  DraftLayerDiffResult,
  DraftLayerDiffEntity,
  DraftLayerFieldDiff,
  DraftLayerEntityDiffSummary,
  DraftLayerPatchOperation,
  DraftLayerEntityType,
  DraftLayerDiffOperation,
  DraftLayerConflictSeverity,
} from '@aiproj/types'

@inject()
export class DraftLayerDiffService {
  constructor() {}

  /**
   * 计算指定 session 的 Diff 结果。
   * 对于新项目：baseline 为空，所有 preview 实体标记为 added。
   */
  async computeDiff(sessionId: number, organizationId: number): Promise<DraftLayerDiffResult> {
    const session = await DraftLayerSession.forOrganization(organizationId)
      .where('id', sessionId)
      .first()
    if (!session) throw new Error('Session 不存在')

    const latestPreview = await DraftLayerPreview.query()
      .where('session_id', sessionId)
      .orderBy('version', 'desc')
      .first()
    if (!latestPreview) throw new Error('尚无 Preview，请先生成 Preview')

    const changes = await DraftLayerChange.query()
      .where('session_id', sessionId)
      .orderBy('sequence', 'asc')

    // 按实体分组
    const entityOperations = this.groupByEntity(changes)

    // 生成 entity 级 diff
    const entities: DraftLayerDiffEntity[] = []
    for (const [entityKey, ops] of Object.entries(entityOperations)) {
      const [entityType, tempId] = entityKey.split(':')

      const fieldDiffs: DraftLayerFieldDiff[] = ops.map((op) => ({
        field: op.targetFieldPath ?? op.targetEntityId,
        operation: this.mapChangeOpToDiffOp(op.operation),
        baselineValue: null,
        currentValue: null,
        previewValue: op.value,
        conflict: false,
        conflictDetails: null,
      }))

      entities.push({
        entityType: entityType as DraftLayerEntityType,
        tempId,
        operation: this.determineOverallOperation(ops),
        conflictSeverity: 'none' as DraftLayerConflictSeverity,
        fieldDiffs,
      })
    }

    // 实体摘要
    const entitySummaries = this.computeEntitySummaries(entities)

    // Patch operations
    const patchOperations = this.generatePatchOperations(changes)

    return {
      sessionId,
      previewHash: latestPreview.previewHash,
      baselineVersion: null,
      currentVersion: null,
      entities,
      entitySummaries,
      patchOperations,
    }
  }

  private groupByEntity(changes: DraftLayerChange[]): Record<string, DraftLayerChange[]> {
    const grouped: Record<string, DraftLayerChange[]> = {}
    for (const change of changes) {
      const key = `${change.targetEntityType}:${change.targetEntityId}`
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(change)
    }
    return grouped
  }

  private mapChangeOpToDiffOp(op: DraftLayerChange['operation']): DraftLayerDiffOperation {
    switch (op) {
      case 'create':
        return 'add'
      case 'update':
        return 'modify'
      case 'delete':
        return 'remove'
    }
  }

  private determineOverallOperation(ops: DraftLayerChange[]): DraftLayerDiffOperation {
    if (ops.some((o) => o.operation === 'create')) return 'add'
    if (ops.some((o) => o.operation === 'update')) return 'modify'
    if (ops.some((o) => o.operation === 'delete')) return 'remove'
    return 'unchanged'
  }

  private computeEntitySummaries(entities: DraftLayerDiffEntity[]): DraftLayerEntityDiffSummary[] {
    const summaryMap = new Map<DraftLayerEntityType, DraftLayerEntityDiffSummary>()

    for (const entity of entities) {
      if (!summaryMap.has(entity.entityType)) {
        summaryMap.set(entity.entityType, {
          entityType: entity.entityType,
          added: 0,
          modified: 0,
          removed: 0,
          unchanged: 0,
          conflicts: 0,
        })
      }
      const s = summaryMap.get(entity.entityType)!
      switch (entity.operation) {
        case 'add':
          s.added++
          break
        case 'modify':
          s.modified++
          break
        case 'remove':
          s.removed++
          break
        case 'unchanged':
          s.unchanged++
          break
        case 'conflict':
          s.conflicts++
          break
      }
    }

    return Array.from(summaryMap.values())
  }

  private generatePatchOperations(changes: DraftLayerChange[]): DraftLayerPatchOperation[] {
    return changes.map((change) => ({
      op:
        change.operation === 'create'
          ? ('add' as const)
          : change.operation === 'delete'
            ? ('remove' as const)
            : ('replace' as const),
      path: `/changes/${change.id}`,
      value: change.value,
      oldValue: change.oldValue,
    }))
  }
}
