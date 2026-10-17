/**
 * OKR Dashboard Backflow 只读摘要 reader（v3-okr-dashboard §4.1）。
 *
 * 边界（写死红线）：
 *   - 只做 SELECT + COUNT + MAX；不生成 candidate、不重算 suggestion、不 confirm/reject、
 *     不改 KR value、不 flush 缓存、不写审计事件、不触发外部通知。
 *   - 组织隔离：全部查询自动附加 `organization_id = ?` 过滤。
 *   - 未启用/未接入/失败 → 一律返回 `unavailable = true`，永不抛出上游异常。
 *   - forbidden 判定由调用方（OkrDashboardService）通过 policy 完成，此处不做权限判断。
 *
 * 消费者：OkrDashboardService.resolveBackflow()。为了让测试可以注入 fake reader，
 * OkrDashboardService 支持通过构造函数覆盖默认实例。
 */

import OkrProgressBackflowSuggestion from '#models/okr_progress_backflow_suggestion'
import { OKR_BACKFLOW_SUGGESTION_STATUSES, OKR_BACKFLOW_WARNING_CODES } from '@aiproj/types'

/**
 * Reader 返回值—与共享契约 `OkrDashboardBackflowSummary` 保持形状兼容，
 * 但保留 `unavailable` 字段供聚合 helper 做降级决策。
 */
export interface OkrDashboardBackflowReaderResult {
  available: boolean
  unavailable?: boolean
  candidateCount: number
  conflictCount: number
  staleCount: number
  lastRefreshedAt: string | null
}

export interface OkrDashboardBackflowReader {
  read(organizationId: number): Promise<OkrDashboardBackflowReaderResult>
}

/**
 * 默认 Reader：直接读 `okr_progress_backflow_suggestions` 表，返回只读汇总。
 *
 * 汇总口径（Dashboard 层稳定语义）：
 *   - candidateCount：pending + needs_review 数量（尚未 confirm/reject/stale 的候选）
 *   - conflictCount：warnings JSON 里包含 MANUAL_OVERRIDE_CONFLICT / CONCURRENT_UPDATE_CONFLICT
 *     / BASE_PROGRESS_VERSION_MISMATCH / SUGGESTION_HASH_MISMATCH 的候选数量
 *   - staleCount：status='stale' 或 warnings 里含 STALE_SOURCE 的候选数量
 *   - lastRefreshedAt：所有未软删候选 calculatedAt 的最大值
 */
export class DefaultOkrDashboardBackflowReader implements OkrDashboardBackflowReader {
  async read(organizationId: number): Promise<OkrDashboardBackflowReaderResult> {
    try {
      // 仅 SELECT——不引入 join、聚合触发器或外键 side effect。
      const rows = await OkrProgressBackflowSuggestion.query()
        .where('organization_id', organizationId)
        .whereNull('deleted_at')

      let candidateCount = 0
      let conflictCount = 0
      let staleCount = 0
      let lastRefreshedAt: string | null = null

      const CONFLICT_CODES = new Set<string>([
        OKR_BACKFLOW_WARNING_CODES.MANUAL_OVERRIDE_CONFLICT,
        OKR_BACKFLOW_WARNING_CODES.CONCURRENT_UPDATE_CONFLICT,
        OKR_BACKFLOW_WARNING_CODES.BASE_PROGRESS_VERSION_MISMATCH,
        OKR_BACKFLOW_WARNING_CODES.SUGGESTION_HASH_MISMATCH,
      ])

      for (const row of rows) {
        const status = row.status
        const warnings = safeParseWarnings(row.warningsJson)

        if (
          status === OKR_BACKFLOW_SUGGESTION_STATUSES.PENDING ||
          status === OKR_BACKFLOW_SUGGESTION_STATUSES.NEEDS_REVIEW
        ) {
          candidateCount++
        }

        if (status === OKR_BACKFLOW_SUGGESTION_STATUSES.STALE) {
          staleCount++
        } else if (warnings.some((w) => w === OKR_BACKFLOW_WARNING_CODES.STALE_SOURCE)) {
          staleCount++
        }

        if (warnings.some((w) => CONFLICT_CODES.has(w))) {
          conflictCount++
        }

        const iso = row.calculatedAt?.toISO?.() ?? null
        if (iso && (lastRefreshedAt === null || iso > lastRefreshedAt)) {
          lastRefreshedAt = iso
        }
      }

      return {
        available: true,
        candidateCount,
        conflictCount,
        staleCount,
        lastRefreshedAt,
      }
    } catch {
      // Reader 失败必须降级——绝不让 Dashboard 因为回流 unavailable 而 500。
      return {
        available: false,
        unavailable: true,
        candidateCount: 0,
        conflictCount: 0,
        staleCount: 0,
        lastRefreshedAt: null,
      }
    }
  }
}

/**
 * 空 Reader：当 backflow 能力尚未接入或环境不支持时使用。
 * 始终返回 unavailable，永不查库。
 */
export class NullOkrDashboardBackflowReader implements OkrDashboardBackflowReader {
  async read(_organizationId: number): Promise<OkrDashboardBackflowReaderResult> {
    return {
      available: false,
      unavailable: true,
      candidateCount: 0,
      conflictCount: 0,
      staleCount: 0,
      lastRefreshedAt: null,
    }
  }
}

function safeParseWarnings(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => (typeof entry === 'string' ? entry : entry?.code))
      .filter((code): code is string => typeof code === 'string')
  } catch {
    return []
  }
}
