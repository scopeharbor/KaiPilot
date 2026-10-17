/**
 * ProjectPredictionReportDataSource —— 报表预测快照数据源。
 *
 * 输出 sourceHash、warnings、确认状态、严重度分布和权限过滤结果。
 * 读取时不得创建快照或调用 AI。
 *
 * v2-ai-risk-progress-prediction / design D10
 */
import type { PredictionDataWarning } from '@aiproj/types'
import ProjectPredictionSnapshot from '#models/project_prediction_snapshot'
import ProjectPredictionSignal from '#models/project_prediction_signal'

export interface PredictionReportData {
  sourceHash: string
  snapshotId: number
  window: number
  status: string
  warnings: PredictionDataWarning[]
  severityDistribution: Record<string, number>
  signalCount: number
  stale: boolean
  confirmedAt: string | null
  generatedAt: string
}

export default class ProjectPredictionReportDataSource {
  /**
   * 获取预测快照报表数据。
   * @param snapshotId 可选，不传则返回最新快照
   */
  async getData(
    organizationId: number,
    projectId: number,
    snapshotId?: number,
  ): Promise<PredictionReportData | null> {
    let snapshot
    if (snapshotId) {
      snapshot = await ProjectPredictionSnapshot.query()
        .where('id', snapshotId)
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .first()
    } else {
      snapshot = await ProjectPredictionSnapshot.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereNotIn('status', ['dismissed'])
        .orderBy('generated_at', 'desc')
        .first()
    }

    if (!snapshot) return null

    const signals = await ProjectPredictionSignal.query().where('snapshot_id', snapshot.id)
    const severityDistribution: Record<string, number> = {}
    for (const sig of signals) {
      severityDistribution[sig.severity] = (severityDistribution[sig.severity] ?? 0) + 1
    }

    return {
      sourceHash: snapshot.sourceHash,
      snapshotId: snapshot.id,
      window: snapshot.window,
      status: snapshot.status,
      warnings: (snapshot.warnings ?? []) as PredictionDataWarning[],
      severityDistribution,
      signalCount: signals.length,
      stale: snapshot.stale,
      confirmedAt: snapshot.confirmedAt?.toISO() ?? null,
      generatedAt: snapshot.generatedAt.toISO() ?? snapshot.generatedAt.toString(),
    }
  }

  /**
   * 检查项目是否有可用的预测快照（用于报表决策）。
   */
  async hasAvailableSnapshot(organizationId: number, projectId: number): Promise<boolean> {
    const count = await ProjectPredictionSnapshot.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('stale', false)
      .whereNotIn('status', ['dismissed'])
      .count('* as total')
      .then((r) => Number(r[0].$extras.total ?? 0))
    return count > 0
  }
}
