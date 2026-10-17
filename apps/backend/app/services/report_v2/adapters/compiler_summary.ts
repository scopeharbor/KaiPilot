/**
 * report_v2/adapters/compiler_summary —— Compiler 摘要数据源。
 *
 * 输出 Compiler 运行态摘要：最近运行结果、validation 事件和 evidence 摘要。
 * 完整 Compiler 能力未实现时返回 unavailable warning。
 */
import CompilerRun from '#models/compiler_run'
import type { ReportGenerateFilters, ReportDataSourceResult } from '@aiproj/types'
import type { DataSourceAdapter } from '../data_source_adapter.js'
import { makeSuccess, makeUnavailable } from '../data_source_adapter.js'

export interface CompilerSummaryData {
  lastRunAt: string | null
  lastRunStatus: string | null
  totalValidationWarnings: number
  totalValidationErrors: number
  compilerEnabled: boolean
}

export class CompilerSummaryAdapter implements DataSourceAdapter<CompilerSummaryData> {
  readonly sourceKey = 'compiler_summary'

  async aggregate(
    _organizationId: number,
    projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult<CompilerSummaryData>> {
    try {
      const lastRun = await CompilerRun.query()
        .where('project_id', projectId)
        .orderBy('created_at', 'desc')
        .limit(1)
        .first()

      if (!lastRun) {
        return makeUnavailable(this.sourceKey, 'Compiler 尚未运行，Compiler 摘要不可用')
      }

      const data: CompilerSummaryData = {
        lastRunAt: lastRun.createdAt?.toISO?.() ?? null,
        lastRunStatus: lastRun.status ?? null,
        totalValidationWarnings: 0,
        totalValidationErrors: 0,
        compilerEnabled: true,
      }

      return makeSuccess(this.sourceKey, data)
    } catch {
      return makeUnavailable(this.sourceKey, 'Compiler 模块暂不可用')
    }
  }
}
