'use client'

/**
 * v3-copilot-mode-adaptation — 全屏专注态扩展面板（§3 任务 3.1–3.3）。
 *
 * 全屏态与抽屉态渲染同一数据源，全屏态展开更多表面：
 * - 证据抽屉（假设清单展开态，含来源与置信度）
 * - 澄清历史（过往回合的澄清轮次）
 * - 差异对比（回合响应的变更摘要并排展示）
 *
 * 抽屉态下这些区域被折叠或隐藏——数据来源完全一致（D1）。
 *
 * 无障碍：新增表面键盘可达（3.5），使用语义化标签。
 */
import * as React from 'react'
import { useCopilotStore } from '@/stores/copilot-store'
import type { CopilotAssumptionEntry, CopilotRouterDestination } from '@aiproj/types'
import { toAssumptionEntry } from './CopilotPanelSlots'
import { useIsFullscreen } from './CopilotPanelContext'

/**
 * 全屏态扩展区域容器。
 *
 * 仅在 fullscreen 形态下渲染；抽屉态返回 null。
 * 所有内容来自 store 的 turn/demoAssumptions，与插槽共享同一数据源。
 */
export function CopilotFullscreenPanels() {
  const isFullscreen = useIsFullscreen()
  const turn = useCopilotStore((s) => s.turn)
  const demoAssumptions = useCopilotStore((s) => s.demoAssumptions)

  if (!isFullscreen) return null

  const assumptions: readonly CopilotAssumptionEntry[] = turn
    ? turn.assumptionEntries.map(toAssumptionEntry)
    : demoAssumptions

  const hasClarification = turn?.clarificationItems && turn.clarificationItems.length > 0
  const hasAssumptions = assumptions.length > 0
  const hasDiffs = turn?.destinations && turn.destinations.length > 0

  if (!hasClarification && !hasAssumptions && !hasDiffs) return null

  return (
    <div
      data-copilot-fullscreen-panels
      className="flex shrink-0 flex-col gap-3 border-t border-border px-3 pt-3 pb-2"
      aria-label="全屏专注模式详细信息"
    >
      {/* 证据抽屉：假设清单展开态（3.1） */}
      {hasAssumptions && <FullscreenEvidenceDrawer assumptions={assumptions} />}

      {/* 澄清历史（3.2） */}
      {hasClarification && (
        <FullscreenClarificationHistory
          items={turn!.clarificationItems}
          destination={turn!.destinations[0]?.destination ?? 'unknown'}
        />
      )}

      {/* 差异对比（3.3） */}
      {hasDiffs && <FullscreenDiffComparison destinations={turn!.destinations} />}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// 证据抽屉（3.1）：展开态假设清单，含来源与置信度
// ──────────────────────────────────────────────────────────────────────

function FullscreenEvidenceDrawer({
  assumptions,
}: {
  assumptions: readonly CopilotAssumptionEntry[]
}) {
  const [expanded, setExpanded] = React.useState(true) // 全屏态默认展开

  return (
    <section data-copilot-fullscreen-evidence aria-label="证据详情">
      <button
        type="button"
        data-copilot-evidence-toggle
        onClick={() => setExpanded((p) => !p)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-border px-2 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>证据详情（{assumptions.length} 条假设）</span>
        <span className="text-[10px] text-gray-400">{expanded ? '收起' : '展开'}</span>
      </button>
      {expanded && (
        <ul className="mt-2 flex flex-col gap-1.5" role="list" data-copilot-evidence-list>
          {assumptions.map((entry) => (
            <li
              key={entry.assumptionId}
              className="rounded-[var(--radius-sm)] border border-border/50 bg-gray-50/50 px-2 py-1.5 text-[11px]"
            >
              <p className="text-gray-700">{entry.statement}</p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
                <span>来源：{entry.source === 'default' ? '默认推断' : '上下文推导'}</span>
                <span>置信度：{entry.confidence}%</span>
                {entry.needsConfirmation && <span className="text-amber-500">需确认</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────
// 澄清历史（3.2）：过往回合的澄清轮次
// ──────────────────────────────────────────────────────────────────────

function FullscreenClarificationHistory({
  items,
  destination,
}: {
  items: NonNullable<
    NonNullable<ReturnType<typeof useCopilotStore.getState>['turn']>['clarificationItems']
  >
  destination: string
}) {
  return (
    <section data-copilot-fullscreen-clarification aria-label="澄清历史">
      <h3 className="mb-1.5 text-[11px] font-medium text-gray-700">澄清历史 · {destination}</h3>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <div
            key={item.slotId}
            className="rounded-[var(--radius-sm)] border border-border/50 bg-gray-50/50 px-2 py-1.5 text-[11px]"
          >
            <p className="font-medium text-gray-700">{item.label}</p>
            <p className="mt-0.5 text-gray-500">{item.question}</p>
            {item.defaultValue && (
              <p className="mt-0.5 text-[10px] text-gray-400">默认值：{item.defaultValue.value}</p>
            )}
            {item.quickOptions && item.quickOptions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {item.quickOptions.map((opt) => (
                  <span
                    key={opt}
                    className="rounded border border-border/50 bg-white px-1.5 py-0.5 text-[10px] text-gray-500"
                  >
                    {opt}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────
// 差异对比（3.3）：回合响应的变更摘要并排展示
// ──────────────────────────────────────────────────────────────────────

function FullscreenDiffComparison({
  destinations,
}: {
  destinations: NonNullable<
    NonNullable<ReturnType<typeof useCopilotStore.getState>['turn']>['destinations']
  >
}) {
  // 部分后端版本在路由目的地附带低敏提示文案（契约外可选字段），此处兼容读取，缺失视为空。
  const destinationWarnings = (dest: CopilotRouterDestination): readonly string[] =>
    (dest as CopilotRouterDestination & { warnings?: readonly string[] }).warnings ?? []

  return (
    <section data-copilot-fullscreen-diff aria-label="变更对比">
      <h3 className="mb-1.5 text-[11px] font-medium text-gray-700">变更摘要</h3>
      <div className="flex flex-col gap-1.5">
        {destinations.map((dest, idx) => (
          <div
            key={`${dest.destination}-${idx}`}
            className="rounded-[var(--radius-sm)] border border-border/50 bg-gray-50/50 px-2 py-1.5 text-[11px]"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-700">{dest.destination}</span>
              {dest.confidence && (
                <span className="text-[10px] text-gray-400">置信度：{dest.confidence}</span>
              )}
            </div>
            {dest.reason && <p className="mt-0.5 text-gray-500">{dest.reason}</p>}
            {destinationWarnings(dest).length > 0 && (
              <div className="mt-1 flex flex-col gap-0.5">
                {destinationWarnings(dest).map((w: string, wi: number) => (
                  <p key={wi} className="text-[10px] text-amber-600">
                    ⚠ {w}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
