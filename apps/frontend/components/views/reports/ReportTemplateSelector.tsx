'use client'

import { REPORT_TEMPLATES, type ReportTemplate } from '@aiproj/types'

/**
 * 模板选择器 —— tasks 6.2。
 *
 * 白名单四模板：progress / delay / workload / milestone。
 * 使用 button chip，避免额外引入 shadcn RadioGroup（当前仅需展示 + 单选）。
 */

const TEMPLATE_LABELS: Record<ReportTemplate, { name: string; hint: string }> = {
  progress: { name: '进度', hint: '任务状态分布、完成率、WBS 汇总' },
  delay: { name: '延期', hint: '逾期任务、即将到期、依赖 warning' },
  workload: { name: '工作量', hint: '按负责人的计划/完成/进行中统计' },
  milestone: { name: '里程碑', hint: '目标日期、关联任务完成度、风险' },
}

export function ReportTemplateSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: ReportTemplate
  onChange: (template: ReportTemplate) => void
  disabled?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="报表模板"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {REPORT_TEMPLATES.map((tpl) => {
        const active = tpl === value
        const label = TEMPLATE_LABELS[tpl]
        return (
          <button
            key={tpl}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(tpl)}
            className={[
              'rounded-lg border px-4 py-3 text-left transition-colors',
              active
                ? 'border-primary-500 bg-primary-50'
                : 'border-border bg-white hover:border-primary-300',
              disabled && 'cursor-not-allowed opacity-50',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="font-medium text-gray-900">{label.name}</div>
            <div className="mt-1 text-xs text-gray-500">{label.hint}</div>
          </button>
        )
      })}
    </div>
  )
}
