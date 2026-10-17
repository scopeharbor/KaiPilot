import RiskHistory from '#models/risk_history'
import { DateTime } from 'luxon'

export interface RiskHistoryEntry {
  organizationId: number
  projectId: number
  riskId: number
  eventType: string
  actorId: number | null
  summary: Record<string, unknown> | null
  sourceType?: string
  sourceRef?: string | null
}

/**
 * RiskHistoryService — 写入低敏风险历史记录并提供分页读取。
 *
 * 记录的字段变化、状态变化、复查、应对计划和候选采纳/拒绝事件。
 * 低敏摘要不包含密码、完整描述或敏感业务数据。
 */
export default class RiskHistoryService {
  /**
   * 记录一条风险历史。
   */
  async record(entry: RiskHistoryEntry): Promise<RiskHistory> {
    return RiskHistory.create({
      organizationId: entry.organizationId,
      projectId: entry.projectId,
      riskId: entry.riskId,
      eventType: entry.eventType,
      actorId: entry.actorId,
      summary: entry.summary,
      sourceType: entry.sourceType ?? 'manual',
      sourceRef: entry.sourceRef ?? null,
      occurredAt: DateTime.now(),
    })
  }

  /**
   * 查询指定风险的历史记录，按时间倒序分页。
   */
  async list(
    organizationId: number,
    projectId: number,
    riskId: number,
    page = 1,
    perPage = 20,
  ): Promise<{
    data: RiskHistory[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const query = RiskHistory.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('risk_id', riskId)
      .orderBy('occurred_at', 'desc')

    const result = await query.paginate(page, perPage)
    return {
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /**
   * 查询项目风险历史（用于趋势/聚合）。
   */
  async listByProject(
    organizationId: number,
    projectId: number,
    eventType?: string,
    page = 1,
    perPage = 50,
  ): Promise<{
    data: RiskHistory[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const query = RiskHistory.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('occurred_at', 'desc')

    if (eventType) {
      query.where('event_type', eventType)
    }

    const result = await query.paginate(page, perPage)
    return {
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }
}
