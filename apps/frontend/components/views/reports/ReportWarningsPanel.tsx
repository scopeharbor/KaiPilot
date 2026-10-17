'use client'

import type { ReportWarning } from '@aiproj/types'
import { AlertTriangle, AlertOctagon, Info } from 'lucide-react'

/**
 * Warnings 列表 —— tasks 6.3。
 *
 * 快照 warnings 分三档：info / warning / critical，配相应语义色与图标。
 * 不做交互，仅以静态列表展示；快照可追溯（生成时刻的判断）不覆盖当前数据。
 */

const LEVEL_STYLE: Record<
  ReportWarning['level'],
  { color: string; bg: string; label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  info: { color: 'text-info', bg: 'bg-info-bg', label: '信息', Icon: Info },
  warning: {
    color: 'text-warning',
    bg: 'bg-warning-bg',
    label: '提示',
    Icon: AlertTriangle,
  },
  critical: {
    color: 'text-danger',
    bg: 'bg-danger-bg',
    label: '严重',
    Icon: AlertOctagon,
  },
}

export function ReportWarningsPanel({ warnings }: { warnings: ReportWarning[] }) {
  if (!warnings.length) return null

  return (
    <section aria-label="报表 warnings">
      <h3 className="mb-2 text-sm font-semibold text-gray-800">警告与提示</h3>
      <ul className="space-y-2">
        {warnings.map((w, idx) => {
          const style = LEVEL_STYLE[w.level]
          const { Icon } = style
          return (
            <li
              key={idx}
              className={['flex items-start gap-2 rounded-md px-3 py-2 text-sm', style.bg].join(
                ' ',
              )}
            >
              <Icon className={['mt-0.5 h-4 w-4 shrink-0', style.color].join(' ')} />
              <div className="min-w-0">
                <div className={['font-medium', style.color].join(' ')}>{style.label}</div>
                <p className="text-gray-700">{w.message}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
