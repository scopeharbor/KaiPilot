/**
 * v2-triz-decision-log-traceability —— Source Attribution 集成适配器（tasks 9.1–9.3）。
 *
 * 从 source attribution refs 提取决策日志摘要，
 * 扩展 Source Attribution 查询加入决策日志信息。
 */
import TrizDecisionLog from '#models/triz_decision_log'
import type { TrizDecisionSourceRef, TrizDecisionLogEntry } from '@aiproj/types'

/**
 * TrizDecisionSourceAdapter —— Source Attribution 决策日志适配器。
 *
 * 提供决策日志摘要查询功能，
 * 用于在 Source Attribution 面板中展示关联的决策日志信息。
 */
export class TrizDecisionSourceAdapter {
  constructor() {}

  /**
   * 根据 source attribution refs 获取关联的决策日志摘要。
   *
   * @param sourceAttributionRefs  来源归属 refs
   * @param organizationId         当前组织 ID
   * @returns                      决策日志摘要条目列表
   */
  async getDecisionSummaries(
    sourceAttributionRefs: TrizDecisionSourceRef[],
    organizationId: number,
  ): Promise<TrizDecisionLogEntry[]> {
    if (!sourceAttributionRefs || sourceAttributionRefs.length === 0) {
      return []
    }

    const entries: TrizDecisionLogEntry[] = []

    for (const ref of sourceAttributionRefs) {
      // 在决策日志的 sourceRefs JSON 中匹配 kind+id
      const logs = await TrizDecisionLog.query()
        .where('organization_id', organizationId)
        .where('decision_status', 'active')
        .whereRaw("json_extract(source_refs, '$[*].kind') LIKE ?", [`%"${ref.kind}"%`])
        .whereRaw("json_extract(source_refs, '$[*].id') LIKE ?", [`%"${ref.id}"%`])
        .limit(10)
        .orderBy('created_at', 'desc')

      for (const log of logs) {
        entries.push(this.toEntry(log))
      }
    }

    return entries
  }

  /**
   * 扩展 Source Attribution 查询参数（预留）。
   * 未来可在此方法中注入决策日志相关的查询逻辑。
   */
  async extendSourceQuery(baseQuery: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      ...baseQuery,
      includeDecisionLogs: true,
    }
  }

  // ── DTO ──

  private toEntry(log: TrizDecisionLog): TrizDecisionLogEntry {
    return {
      id: log.id,
      organizationId: log.organizationId,
      projectId: log.projectId,
      decisionType: log.decisionType as TrizDecisionLogEntry['decisionType'],
      decisionStatus: log.decisionStatus as TrizDecisionLogEntry['decisionStatus'],
      subjectRefs: log.subjectRefs,
      sourceRefs: log.sourceRefs,
      artifactHashes: log.artifactHashes,
      reasonSummary: log.reasonSummary,
      reasonHash: log.reasonHash,
      alternativeSummary: log.alternativeSummary,
      supersedesDecisionLogId: log.supersedesDecisionLogId,
      supersededByDecisionLogId: null,
      createdBy: log.createdBy,
      createdAt: log.createdAt.toISO()!,
      updatedAt: log.updatedAt?.toISO() ?? null,
    }
  }
}
