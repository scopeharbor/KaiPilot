'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { useStrategyExecutionCockpit } from '@/hooks/use-strategy-execution-cockpit'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import {
  parseCockpitUrlFilters,
  serializeCockpitUrlFilters,
} from '@/lib/api/strategy-execution-cockpit'
import {
  cockpitTargetAriaLabel,
  resolveCockpitTargetHref,
} from '@/lib/strategy-execution-cockpit-nav'
import type { CockpitSortKey, CockpitSummary } from '@aiproj/types'

/**
 * /strategy-execution-cockpit —— 战略执行驾驶舱工作台（v3-strategy-execution-cockpit §5.3）。
 *
 * 只读视图：cycle/scope 顶栏、战略 KPI/freshness strip、objective-to-execution 矩阵、
 * 有界注意力队列、优先级/投入/资源/风险摘要与安全下钻。不提供 confirm/apply/一键执行。
 */
export default function StrategyExecutionCockpitPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const organizationId = useCurrentOrganizationId()
  const query = useMemo(
    () => parseCockpitUrlFilters(Object.fromEntries(searchParams.entries())),
    [searchParams],
  )
  const { data, isLoading, isError } = useStrategyExecutionCockpit(query)

  const applyFilters = useCallback(
    (query: Parameters<typeof serializeCockpitUrlFilters>[0]) => {
      const qs = serializeCockpitUrlFilters(query)
      router.replace('/strategy-execution-cockpit' + qs, { scroll: false })
    },
    [router],
  )

  if (organizationId === null) {
    return <div className="p-6 text-sm text-gray-500">请先选择组织以查看战略执行驾驶舱。</div>
  }

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-gray-500" data-cockpit-loading>
        正在加载战略执行驾驶舱…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-6 text-sm text-red-600" data-cockpit-error>
        驾驶舱暂不可用，请稍后重试。
      </div>
    )
  }

  return <CockpitBody summary={data} applyFilters={applyFilters} />
}

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, unknown: 0 }

function sortCockpitRows(
  rows: Array<CockpitSummary['objectiveRows'][number]>,
  key: CockpitSortKey,
  order: 'asc' | 'desc',
): Array<CockpitSummary['objectiveRows'][number]> {
  const value = (row: CockpitSummary['objectiveRows'][number]): number | string => {
    switch (key) {
      case 'priority':
        return PRIORITY_RANK[row.priorityBand] ?? 0
      case 'progress':
        return row.progress
      case 'mapping_coverage':
        return row.coveragePercent ?? -1
      case 'risk':
        return row.attentionReasons.length
      case 'title':
      default:
        return row.objectiveTitle
    }
  }
  return [...rows].sort((a, b) => {
    const av = value(a)
    const bv = value(b)
    let delta: number
    if (typeof av === 'string' && typeof bv === 'string') {
      delta = av.localeCompare(bv)
    } else {
      delta = Number(av) - Number(bv)
    }
    return order === 'asc' ? delta : -delta
  })
}

function CockpitBody({
  summary,
  applyFilters,
}: {
  summary: CockpitSummary
  applyFilters: (q: Parameters<typeof serializeCockpitUrlFilters>[0]) => void
}) {
  const { meta, cycleContext, kpis, objectiveRows, attention, sourceFreshness, warnings } = summary
  const [sortKey, setSortKey] = useState<CockpitSortKey>('risk')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const sortedRows = useMemo(
    () => sortCockpitRows(objectiveRows, sortKey, sortOrder),
    [objectiveRows, sortKey, sortOrder],
  )
  const toggleSort = (key: CockpitSortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortOrder('desc')
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl py-6" data-cockpit-page>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">战略执行驾驶舱</h1>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {meta.overallStatus}
        </span>
        <span className="text-sm text-gray-500">{cycleContext.title ?? '未选择周期'}</span>
        <button
          type="button"
          className="min-h-[44px] rounded-md border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-blue-600"
          onClick={() => applyFilters({})}
        >
          重置筛选
        </button>
      </div>

      {meta.overallStatus === 'empty' && (
        <div className="mb-4 rounded border bg-gray-50 p-3 text-sm" data-cockpit-empty>
          当前组织暂无可见战略范围。
        </div>
      )}
      {meta.overallStatus === 'unavailable' && (
        <div className="mb-4 rounded border bg-red-50 p-3 text-sm" data-cockpit-unavailable>
          驾驶舱数据暂不可用。
        </div>
      )}
      {meta.overallStatus === 'degraded' && (
        <div className="mb-4 rounded border bg-amber-50 p-3 text-sm" data-cockpit-degraded>
          部分来源降级，以下结果可能不完整。
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="mb-4 space-y-1 text-xs text-amber-700" data-cockpit-warnings>
          {warnings.map((warning) => (
            <li key={warning.code + (warning.source ?? '')}>
              {warning.code}: {warning.message}
            </li>
          ))}
        </ul>
      )}

      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-cockpit-kpis>
        {kpis.map((metric) => (
          <div key={metric.key} className="rounded-lg border p-3">
            <div className="text-xs text-gray-500">{metric.key}</div>
            <div className="mt-1 text-xl font-semibold">{metric.value ?? '—'}</div>
            <div className="text-xs text-gray-400">{metric.source}</div>
          </div>
        ))}
      </section>

      <section className="mb-4" data-cockpit-matrix>
        <h2 className="mb-2 text-sm font-medium">目标 → 执行矩阵</h2>
        {objectiveRows.length === 0 ? (
          <div className="text-sm text-gray-500">无可见战略目标。</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="py-2 pr-3">
                    <button
                      type="button"
                      className="min-h-[44px] cursor-pointer underline focus-visible:outline-2 focus-visible:outline-blue-600"
                      onClick={() => toggleSort('title')}
                    >
                      目标
                    </button>
                  </th>
                  <th className="py-2 pr-3">
                    <button
                      type="button"
                      className="min-h-[44px] cursor-pointer underline focus-visible:outline-2 focus-visible:outline-blue-600"
                      onClick={() => toggleSort('progress')}
                    >
                      进度
                    </button>
                  </th>
                  <th className="py-2 pr-3">KR</th>
                  <th className="py-2 pr-3">映射项目</th>
                  <th className="py-2 pr-3">
                    <button
                      type="button"
                      className="min-h-[44px] cursor-pointer underline focus-visible:outline-2 focus-visible:outline-blue-600"
                      onClick={() => toggleSort('mapping_coverage')}
                    >
                      覆盖
                    </button>
                  </th>
                  <th className="py-2 pr-3">
                    <button
                      type="button"
                      className="min-h-[44px] cursor-pointer underline focus-visible:outline-2 focus-visible:outline-blue-600"
                      onClick={() => toggleSort('risk')}
                    >
                      关注
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.objectiveId} className="border-b">
                    <td className="py-2 pr-3">
                      <Link
                        className="inline-flex min-h-[44px] items-center text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600"
                        href={resolveCockpitTargetHref(row.target)}
                        aria-label={cockpitTargetAriaLabel(row.target)}
                      >
                        {row.objectiveTitle}
                      </Link>
                      <span className="ml-2 text-xs text-gray-400">优先级 {row.priorityBand}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        投入 {row.investmentAlignment}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        资源/风险 {row.resourceRiskPressure ?? '—'}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{row.progress}%</td>
                    <td className="py-2 pr-3">
                      {row.behindKeyResultCount}/{row.keyResultCount}
                    </td>
                    <td className="py-2 pr-3">{row.mappedProjects.length}</td>
                    <td className="py-2 pr-3">{row.coveragePercent ?? '—'}</td>
                    <td className="py-2 pr-3">{row.attentionReasons.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-4 md:hidden" data-cockpit-mobile-list>
        <h2 className="mb-2 text-sm font-medium">目标执行概览（窄屏）</h2>
        {sortedRows.length === 0 ? (
          <div className="text-sm text-gray-500">无可见战略目标。</div>
        ) : (
          <ul className="space-y-2">
            {sortedRows.map((row) => (
              <li key={row.objectiveId} className="rounded-lg border p-3">
                <Link
                  className="text-sm text-blue-600 hover:underline"
                  href={resolveCockpitTargetHref(row.target)}
                  aria-label={cockpitTargetAriaLabel(row.target)}
                >
                  {row.objectiveTitle}
                </Link>
                <div className="mt-1 text-xs text-gray-500">
                  进度 {row.progress}% · KR {row.behindKeyResultCount}/{row.keyResultCount} · 覆盖{' '}
                  {row.coveragePercent ?? '—'}
                </div>
                <div className="mt-1 text-xs text-gray-400">
                  优先级 {row.priorityBand} · 投入 {row.investmentAlignment} · 资源/风险{' '}
                  {row.resourceRiskPressure ?? '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-4" data-cockpit-attention>
        <h2 className="mb-2 text-sm font-medium">关注队列</h2>
        {attention.length === 0 ? (
          <div className="text-sm text-gray-500">当前无关注项。</div>
        ) : (
          <ul className="space-y-2">
            {attention.map((item) => (
              <li key={item.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                    {item.severity}
                  </span>
                  <span className="text-xs text-gray-500">{item.reasonCode}</span>
                  <span className="text-xs text-gray-400">rule {item.ruleVersion}</span>
                </div>
                <div className="mt-1 text-sm">{item.message}</div>
                <div className="mt-1 text-xs text-gray-500">{item.basis}</div>
                {item.target && item.target.authorized && (
                  <Link
                    className="mt-2 inline-flex min-h-[44px] items-center text-xs text-blue-600 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600"
                    href={resolveCockpitTargetHref(item.target)}
                    aria-label={cockpitTargetAriaLabel(item.target)}
                  >
                    安全查看详情
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label="战略摘要区"
        role="group"
        className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3"
        data-cockpit-summaries
      >
        <div className="rounded-lg border p-3">
          <div className="text-xs text-gray-500">组合交通灯</div>
          <div className="mt-1 text-sm">
            {summary.portfolioTrafficLight.available
              ? '红 ' +
                summary.portfolioTrafficLight.redCount +
                ' · 黄 ' +
                summary.portfolioTrafficLight.yellowCount +
                ' · 绿 ' +
                summary.portfolioTrafficLight.greenCount
              : summary.portfolioTrafficLight.forbidden
                ? '无权限'
                : '不可用'}
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-gray-500">优先级 / 投入</div>
          <div className="mt-1 text-sm">
            {summary.priorityInvestment.available
              ? '错配 ' + (summary.priorityInvestment.priorityMismatchCount ?? 0)
              : summary.priorityInvestment.forbidden
                ? '无权限'
                : summary.priorityInvestment.unsupportedFinancial
                  ? '财务不支持'
                  : '不可用'}
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-gray-500">资源 / 风险</div>
          <div className="mt-1 text-sm">
            {summary.resourceRisk.available
              ? '压力 ' + (summary.resourceRisk.pressureCount ?? 0)
              : summary.resourceRisk.forbidden
                ? '无权限'
                : '不可用'}
          </div>
        </div>
      </section>

      <section className="text-xs text-gray-400" data-cockpit-freshness>
        <div>metricVersion: {meta.metricVersion}</div>
        <div>
          sourceFreshness: {sourceFreshness.map((f) => f.source + ':' + f.status).join(', ')}
        </div>
      </section>
    </div>
  )
}
