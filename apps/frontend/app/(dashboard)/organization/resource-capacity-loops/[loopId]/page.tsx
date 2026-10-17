'use client'

import { useParams } from 'next/navigation'
import { useRcclLoopDetail, useSimulateRcclLoop } from '@/hooks/use-resource-capacity-loops'

/**
 * 闭环详情工作台（§8.5–8.12）。
 *
 * 分区：
 * - 基线区：容量×技能×时间桶（表格 fallback，fact/hypothesis 双重区分）；
 * - 情景与建议区：advisory 文案、covered/uncovered、候选 provenance；
 * - 选择与 handoff 姿态区：loop 选择 ≠ 下游 confirm/apply，UI 不持有确认句柄；
 * - 观察/复核时间线：非因果中文文案。
 */

const STATE_LABELS: Record<string, string> = {
  draft: '草稿',
  simulated: '已模拟',
  selected: '已选择',
  'handed-off': '已移交',
  observing: '观察中',
  reviewed: '已复核',
  closed: '已关闭',
  cancelled: '已取消',
}

export default function ResourceCapacityLoopDetailPage() {
  const routeParams = useParams()
  const loopId = Number(routeParams?.loopId ?? 0)
  const { data, isLoading, isError } = useRcclLoopDetail(loopId > 0 ? loopId : null)
  const simulate = useSimulateRcclLoop(loopId > 0 ? loopId : 0)

  if (isLoading) {
    return (
      <div className="space-y-3 p-4" aria-busy="true" data-testid="rccl-detail-loading">
        <div className="h-6 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded border bg-muted" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-4" role="alert" data-testid="rccl-detail-error">
        <p className="text-sm text-destructive">闭环不存在或无权访问</p>
      </div>
    )
  }

  const d = data

  return (
    <div className="space-y-6 p-4">
      <header>
        <h1 className="text-lg font-semibold">{d.loop.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          状态：<span data-testid="rccl-state">{STATE_LABELS[d.loop.state] ?? d.loop.state}</span> ·
          修订 v{d.loop.revision} · 窗口 {d.loop.windowStart} ~ {d.loop.windowEnd}
        </p>
      </header>

      {/* ── 基线区 ── */}
      <section aria-labelledby="rccl-baseline-heading" className="rounded border p-4">
        <h2 id="rccl-baseline-heading" className="text-sm font-semibold">
          基线快照（事实）
        </h2>
        {d.baseline ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                事实数据
              </span>{' '}
              就绪状态：
              {d.baseline.readyForSimulation ? '可模拟' : '来源缺失/过期——不可模拟（不会补零）'}
            </p>
            <table className="w-full text-sm" data-testid="rccl-fact-table">
              <caption className="sr-only">基线事实表（图表的表格替代）</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-1 pr-4">
                    基线摘要
                  </th>
                  <th scope="col" className="py-1">
                    值
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1 pr-4">快照 ID</td>
                  <td className="py-1 font-mono text-xs">{d.baseline.id}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4">内容指纹</td>
                  <td className="py-1 font-mono text-xs">{d.baseline.digest}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            尚未创建基线。缺失或受限的来源会显式标记，不会被补零。
          </p>
        )}
      </section>

      {/* ── 情景与建议区 ── */}
      <section aria-labelledby="rccl-scenario-heading" className="rounded border p-4">
        <h2 id="rccl-scenario-heading" className="text-sm font-semibold">
          What-if 情景（假设，未应用）
        </h2>
        <ul className="mt-2 space-y-1 text-sm" data-testid="rccl-scenario-list">
          {d.scenarios.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                假设
              </span>
              <span>{s.name}</span>
              {!s.active && <span className="text-xs text-muted-foreground">（已停用）</span>}
              <span className="text-xs text-muted-foreground">v{s.revision}</span>
            </li>
          ))}
          {d.scenarios.length === 0 && (
            <li className="text-muted-foreground">尚无情景。至少需要 2 个情景才能模拟。</li>
          )}
        </ul>
        {d.simulations.length > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="rccl-simulation-summary">
            已生成 {d.simulations.length} 份模拟快照；全部为假设性计算，未修改任何正式资源事实。
          </p>
        ) : null}
        <button
          type="button"
          disabled={simulate.isPending}
          onClick={() => simulate.mutate(d.loop.revision)}
          className="mt-3 rounded border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          data-testid="rccl-simulate-button"
        >
          {simulate.isPending ? '模拟中…' : `模拟全部情景（当前修订 v${d.loop.revision}）`}
        </button>
      </section>

      {/* ── 选择与 handoff 姿态区 ── */}
      <section aria-labelledby="rccl-selection-heading" className="rounded border p-4">
        <h2 id="rccl-selection-heading" className="text-sm font-semibold">
          人工选择与受控移交
        </h2>
        {d.currentSelection ? (
          <p className="mt-2 text-sm" data-testid="rccl-selection-info">
            当前选择：情景 #{d.currentSelection.scenarioId}
            （选择仅表达方向，不构成对任何正式资源记录的写入授权。下游仍须独立预览并再次显式确认。）
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            尚未人工选择情景。只有授权人员可以基于最新模拟进行选择。
          </p>
        )}
        {d.receipts.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {d.receipts.map((r) => (
              <li key={r.id}>
                移交目标 {r.target} · 状态 {r.status} ·{' '}
                <span className="text-xs text-muted-foreground">
                  正式写入须在下游完成预览并二次确认后发生
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ── 观察 / 复核时间线 ── */}
      <section aria-labelledby="rccl-observation-heading" className="rounded border p-4">
        <h2 id="rccl-observation-heading" className="text-sm font-semibold">
          观察与复核时间线
        </h2>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-sm" data-testid="rccl-timeline">
          {d.observations.map((o) => (
            <li key={o.id}>
              观察快照 #{o.id} · 下游状态 {o.status} ·{' '}
              {o.comparable ? '同口径可比' : '不可比（口径失配，不显示改善百分比）'}
            </li>
          ))}
          {d.reviews.map((r) => (
            <li key={`review-${r.id}`}>
              复核结论：{r.outcome}（人工结论；观察到的变化不能仅凭时间先后归因于该选择）
            </li>
          ))}
          {d.observations.length === 0 && d.reviews.length === 0 && (
            <li className="text-muted-foreground">下游到达可观察状态后，可捕获同口径观察快照。</li>
          )}
        </ol>
      </section>

      <p className="text-xs text-muted-foreground" data-testid="rccl-posture-note">
        本页面所有建议均为咨询性质且未被应用；正式资源写入始终由既有能力的预览与显式确认路径执行。
      </p>
    </div>
  )
}
