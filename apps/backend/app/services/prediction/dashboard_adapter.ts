/**
 * ProjectPredictionDashboardAdapter —— Dashboard 预测摘要适配器。
 *
 * 只读适配器，读取时不得创建快照或调用 AI。
 *
 * v2-ai-risk-progress-prediction / design D10
 */
import type { DashboardPredictionSummary } from '@aiproj/types'
import ProjectPredictionSnapshot from '#models/project_prediction_snapshot'
import ProjectPredictionSignal from '#models/project_prediction_signal'

export default class ProjectPredictionDashboardAdapter {
  /**
   * 获取项目 Dashboard 预测摘要。
   * 只读：不会创建新快照，不会调用 AI。
   */
  async getSummary(organizationId: number, projectId: number): Promise<DashboardPredictionSummary> {
    const snapshot = await ProjectPredictionSnapshot.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('stale', false)
      .whereNotIn('status', ['dismissed'])
      .orderBy('generated_at', 'desc')
      .first()

    if (!snapshot) {
      return {
        snapshotId: null,
        window: null,
        status: null,
        signalCount: 0,
        criticalCount: 0,
        highCount: 0,
        maxSeverity: null,
        stale: false,
        staleReason: null,
        warnings: [],
        available: false,
        confirmedAt: null,
        hasAiExplanation: false,
      }
    }

    // 获取信号按严重度分布
    const signals = await ProjectPredictionSignal.query().where('snapshot_id', snapshot.id)
    const criticalCount = signals.filter((s) => s.severity === 'critical').length
    const highCount = signals.filter((s) => s.severity === 'high').length
    const maxSeverity = criticalCount > 0 ? 'critical' : highCount > 0 ? 'high' : 'info'

    const hasAiExplanation =
      snapshot.aiExplanation !== null && (snapshot.aiExplanation as any)?.status !== undefined

    return {
      snapshotId: snapshot.id,
      window: snapshot.window,
      status: snapshot.status,
      signalCount: signals.length,
      criticalCount,
      highCount,
      maxSeverity,
      stale: snapshot.stale,
      staleReason: snapshot.staleReason,
      warnings: (snapshot.warnings ?? []) as any[],
      available: true,
      confirmedAt: snapshot.confirmedAt?.toISO() ?? null,
      hasAiExplanation,
    }
  }
}
