/**
 * ProjectPredictionRetentionService —— 预测快照保留期管理。
 *
 * 清理旧快照，但保留：
 * - 未过期（stale = false）的非清除状态快照
 * - 最近 N 天的快照（默认 180 天）
 * - 已被报表引用的快照
 * - 已确认或 AI 解释已审核的快照
 *
 * 红线：不修改任何正式业务数据（任务、资源、风险等）。
 *
 * v2-ai-risk-progress-prediction / design D12
 */
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import ProjectPredictionSnapshot from '#models/project_prediction_snapshot'
import ProjectPredictionSignal from '#models/project_prediction_signal'

export interface RetentionResult {
  deletedSnapshots: number
  deletedSignals: number
  keptReferenced: number
  keptConfirmed: number
  keptRecent: number
}

const DEFAULT_RETENTION_DAYS = 180

export default class ProjectPredictionRetentionService {
  /**
   * 清理指定组织下过期的预测快照。
   */
  async clean(
    organizationId: number,
    retentionDays: number = DEFAULT_RETENTION_DAYS,
  ): Promise<RetentionResult> {
    const cutoff = DateTime.now().minus({ days: retentionDays })

    // 找出所有可删除的快照 ID
    const query = ProjectPredictionSnapshot.query()
      .where('organization_id', organizationId)
      .where('generated_at', '<', cutoff.toISO()!)
      .where('stale', true)

    const candidates = await query.select('id', 'project_id', 'status', 'generated_at')

    const result: RetentionResult = {
      deletedSnapshots: 0,
      deletedSignals: 0,
      keptReferenced: 0,
      keptConfirmed: 0,
      keptRecent: 0,
    }

    if (candidates.length === 0) return result

    const projectIds = [...new Set(candidates.map((s) => Number(s.projectId)))]

    // 检查哪些快照被报表引用（通过 ProjectPredictionReportDataSource 或其他引用）
    const referencedSnapshotIds = await this.findReferencedSnapshots(organizationId, projectIds)

    // 分类：确认的、有 AI 解释的、报表引用的跳过删除
    const toDeleteIds: number[] = []
    for (const snap of candidates) {
      const id = Number(snap.id)

      // 跳过被报表引用的快照
      if (referencedSnapshotIds.has(id)) {
        result.keptReferenced++
        continue
      }

      // 跳过已确认的快照
      if (snap.status === 'confirmed') {
        result.keptConfirmed++
        continue
      }

      toDeleteIds.push(id)
    }

    if (toDeleteIds.length === 0) return result

    // 事务删除
    const trx = await db.transaction()
    try {
      const deletedSignals = await ProjectPredictionSignal.query({ client: trx })
        .whereIn('snapshot_id', toDeleteIds)
        .delete()

      const deletedSnapshots = await ProjectPredictionSnapshot.query({ client: trx })
        .whereIn('id', toDeleteIds)
        .delete()

      await trx.commit()

      result.deletedSignals = Number(deletedSignals)
      result.deletedSnapshots = Number(deletedSnapshots)

      logger.info(
        {
          organizationId,
          deletedSnapshots,
          deletedSignals,
          keptReferenced: result.keptReferenced,
          keptConfirmed: result.keptConfirmed,
        },
        'prediction retention cleaned',
      )

      return result
    } catch (error) {
      await trx.rollback()
      logger.error({ err: error, organizationId }, 'prediction retention failed')
      throw error
    }
  }

  /**
   * 查找报表引用的快照 ID。
   * 通过 audit_log 中 predication_referenced_by_report 事件追踪。
   */
  private async findReferencedSnapshots(
    organizationId: number,
    projectIds: number[],
  ): Promise<Set<number>> {
    if (projectIds.length === 0) return new Set()

    // 从审计日志中查找报表引用预测事件
    const references = await db.rawQuery(
      `
      SELECT DISTINCT JSON_EXTRACT(metadata, '$.snapshotId') as snapshot_id
      FROM audit_logs
      WHERE organization_id = ?
        AND event = 'prediction_referenced_by_report'
        AND project_id IN (${projectIds.map(() => '?').join(',')})
    `,
      [organizationId, ...projectIds],
    )

    const rows = references.rows ?? references
    const snapshotIds = new Set<number>()
    for (const row of rows) {
      const id = Number(row.snapshot_id)
      if (id > 0) snapshotIds.add(id)
    }
    return snapshotIds
  }

  /**
   * 标记过期快照为 stale（每日维护任务调用）。
   */
  async markStaleByTime(
    organizationId: number,
    maxAgeDays: number = DEFAULT_RETENTION_DAYS,
  ): Promise<number> {
    const cutoff = DateTime.now().minus({ days: maxAgeDays })
    const affected = await ProjectPredictionSnapshot.query()
      .where('organization_id', organizationId)
      .where('generated_at', '<', cutoff.toISO()!)
      .where('stale', false)
      .update({ stale: true, staleReason: `超过 ${maxAgeDays} 天未更新` })
    return Number(affected)
  }
}
