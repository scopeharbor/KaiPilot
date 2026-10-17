'use client'

/**
 * ai-structured-output-poc / M0 —— DraftReviewPanel 骨架（红线 1 硬保）。
 *
 * 用途：把 AI 生成的 `AiProjectDraft` 逐字段展开,让**人工确认后才能落库**。
 * 本骨架是 T037「AI 反幻觉草案审查」的**种子**——POC 期只做展示 + 「确认/拒绝」按钮 stub,
 * 不接任何入库 API；红线 1 = AI 只建议不自动执行。
 *
 * 组织：
 *   - Charter 段：6 字段逐条展示（title/vision/scope/successCriteria/startDate/endDate）；
 *   - WBS 段：树形缩进,每个 name 挂 marker chip；
 *   - Tasks 段：表格,高风险字段（durationDays/startDate/endDate）行内高亮 `needsConfirmation`；
 *   - AcceptanceCriteria 段：编号列表。
 *
 * 交互：点击「确认草案」→ onConfirm(draft)；点击「拒绝重生成」→ onReject()。
 * POC 阶段 handler 只 console.log,正式接入放 T037。
 */

import { useMemo } from 'react'
import type { AiMarker, AiProjectDraft, DraftWbsNode, Marked } from '@aiproj/types'

interface Props {
  draft: AiProjectDraft
  onConfirm?: (draft: AiProjectDraft) => void
  onReject?: () => void
}

export function DraftReviewPanel({ draft, onConfirm, onReject }: Props) {
  const highRiskCount = useMemo(() => {
    let n = 0
    const scan = (m: AiMarker | undefined) => {
      if (m?.needsConfirmation) n += 1
    }
    scan(draft.charter.startDate.marker)
    scan(draft.charter.endDate.marker)
    for (const t of draft.tasks) {
      scan(t.durationDays.marker)
      scan(t.startDate.marker)
      scan(t.endDate.marker)
    }
    return n
  }, [draft])

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-4 flex items-center justify-between border-b pb-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">草案审查</h2>
          <p className="text-xs text-slate-500">
            AI 生成 · 待人工确认（红线 1：草案未确认前**绝不入库**）
          </p>
        </div>
        <div className="text-sm">
          <span className="mr-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 ring-1 ring-inset ring-amber-200">
            高风险字段 {highRiskCount}
          </span>
        </div>
      </header>

      <CharterSection charter={draft.charter} />
      <WbsSection nodes={draft.wbs} />
      <TasksSection tasks={draft.tasks} />
      <AcceptanceSection criteria={draft.acceptanceCriteria} />

      <footer className="mt-4 flex justify-end gap-2 border-t pt-3">
        <button
          type="button"
          onClick={() => onReject?.()}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          拒绝重生成
        </button>
        <button
          type="button"
          onClick={() => onConfirm?.(draft)}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-900"
        >
          确认草案（POC 阶段仅本地回显）
        </button>
      </footer>
    </section>
  )
}

function CharterSection({ charter }: { charter: AiProjectDraft['charter'] }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-medium text-slate-700">项目章程</h3>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <MarkedRow label="标题" field={charter.title} />
        <MarkedRow label="愿景" field={charter.vision} />
        <MarkedRow label="范围" field={charter.scope} />
        <MarkedRow
          label="成功标准"
          field={{
            value: charter.successCriteria.value.join(' / '),
            marker: charter.successCriteria.marker,
          }}
        />
        <MarkedRow label="起始日期" field={charter.startDate} />
        <MarkedRow label="结束日期" field={charter.endDate} />
      </dl>
    </div>
  )
}

function WbsSection({ nodes }: { nodes: DraftWbsNode[] }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-medium text-slate-700">工作分解结构（WBS）</h3>
      <ul className="space-y-1 text-sm">
        {nodes.map((n) => (
          <WbsRow key={n.id} node={n} depth={0} />
        ))}
      </ul>
    </div>
  )
}

function WbsRow({ node, depth }: { node: DraftWbsNode; depth: number }) {
  return (
    <li>
      <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
        <span className="min-w-[3rem] text-xs text-slate-400">{node.outlineCode}</span>
        <span className="text-slate-800">{node.name.value}</span>
        <MarkerChip marker={node.name.marker} />
      </div>
      {node.children.length > 0 && (
        <ul className="space-y-1">
          {node.children.map((c) => (
            <WbsRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function TasksSection({ tasks }: { tasks: AiProjectDraft['tasks'] }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-medium text-slate-700">任务</h3>
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left">名称</th>
              <th className="px-2 py-1 text-left">状态</th>
              <th className="px-2 py-1 text-left">工期(天)</th>
              <th className="px-2 py-1 text-left">起</th>
              <th className="px-2 py-1 text-left">止</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const risky =
                t.durationDays.marker.needsConfirmation ||
                t.startDate.marker.needsConfirmation ||
                t.endDate.marker.needsConfirmation
              return (
                <tr key={t.id} className={risky ? 'bg-amber-50' : ''}>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-1">
                      <span>{t.name.value}</span>
                      <MarkerChip marker={t.name.marker} compact />
                    </div>
                  </td>
                  <td className="px-2 py-1 text-slate-600">{t.status}</td>
                  <td className="px-2 py-1">
                    {t.durationDays.value}
                    <MarkerChip marker={t.durationDays.marker} compact />
                  </td>
                  <td className="px-2 py-1">
                    {t.startDate.value}
                    <MarkerChip marker={t.startDate.marker} compact />
                  </td>
                  <td className="px-2 py-1">
                    {t.endDate.value}
                    <MarkerChip marker={t.endDate.marker} compact />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AcceptanceSection({ criteria }: { criteria: AiProjectDraft['acceptanceCriteria'] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-slate-700">验收标准</h3>
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {criteria.map((c) => (
          <li key={c.id}>
            <div className="flex items-center gap-2">
              <span>{c.statement.value}</span>
              <MarkerChip marker={c.statement.marker} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function MarkedRow({ label, field }: { label: string; field: Marked<string> }) {
  return (
    <div className="flex items-start gap-2 rounded bg-slate-50 p-2">
      <dt className="min-w-[5rem] text-slate-500">{label}</dt>
      <dd className="flex-1">
        <div className="text-slate-800">{field.value}</div>
        <MarkerChip marker={field.marker} />
      </dd>
    </div>
  )
}

/**
 * MarkerChip —— AIMarker 视觉徽章。
 * confidence 阶梯：<0.6 红 / <0.85 琥珀 / ≥0.85 绿色；needsConfirmation 加感叹号。
 * `compact` 版只显示图标不显示文本，供表格行使用。
 */
function MarkerChip({ marker, compact }: { marker: AiMarker; compact?: boolean }) {
  const tone =
    marker.confidence < 0.6
      ? 'bg-rose-50 text-rose-700 ring-rose-200'
      : marker.confidence < 0.85
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  const label = compact
    ? `${Math.round(marker.confidence * 100)}%`
    : `${marker.source} · ${Math.round(marker.confidence * 100)}% · ${marker.reason}`
  return (
    <span
      title={`${marker.source} | conf=${marker.confidence.toFixed(2)} | ${marker.reason}`}
      className={`ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${tone}`}
    >
      {marker.needsConfirmation && <span aria-label="需人工确认">!</span>}
      <span className="ml-0.5">{label}</span>
    </span>
  )
}
