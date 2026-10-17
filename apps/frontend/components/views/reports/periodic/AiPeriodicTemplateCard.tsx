'use client'

import { Sparkles } from 'lucide-react'
import { AiChip } from '@/components/ui/AiChip'
import { cn } from '@/lib/utils'
import type { AiPeriodicTemplateId, V2ReportExportFormat } from '@aiproj/types'

/**
 * AiPeriodicTemplateCard —— AI 周报/月报模板选择卡片。
 *
 * 显示模板名称、描述、周期类型徽章、支持格式。
 * 使用按钮 chip 风格，与 ReportTemplateSelector 样式对齐。
 */

const PERIODIC_TEMPLATE_META: Partial<
  Record<AiPeriodicTemplateId, { name: string; description: string; periodLabel: string }>
> = {
  'weekly-ai-summary': {
    name: 'AI 周报',
    description: 'AI 自动生成本周项目进度摘要、风险与建议行动',
    periodLabel: '每周',
  },
  'monthly-ai-summary': {
    name: 'AI 月报',
    description: 'AI 自动生成本月项目综合报告，含趋势分析与下期建议',
    periodLabel: '每月',
  },
}

const FORMAT_LABEL: Record<V2ReportExportFormat, string> = {
  markdown: 'MD',
  csv: 'CSV',
  pdf: 'PDF',
  xlsx: 'XLSX',
}

export interface AiPeriodicTemplateCardProps {
  templateId: AiPeriodicTemplateId
  supportedFormats: V2ReportExportFormat[]
  selected: boolean
  onClick: () => void
  disabled?: boolean
}

export function AiPeriodicTemplateCard({
  templateId,
  supportedFormats,
  selected,
  onClick,
  disabled = false,
}: AiPeriodicTemplateCardProps) {
  const meta = PERIODIC_TEMPLATE_META[templateId]
  if (!meta) return null

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative rounded-lg border px-4 py-3 text-left transition-colors',
        selected
          ? 'border-ai bg-ai-bg'
          : 'border-border bg-white hover:border-ai/40 hover:bg-ai-bg/30',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {/* AI 标识芯片 */}
      <div className="mb-2">
        <AiChip label={meta.periodLabel} />
      </div>

      {/* 名称与图标 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 shrink-0 text-ai" aria-hidden />
            <span className="font-medium text-gray-900">{meta.name}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500 line-clamp-2">{meta.description}</p>
        </div>
      </div>

      {/* 支持格式 */}
      {supportedFormats.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {supportedFormats.map((fmt) => (
            <span
              key={fmt}
              className="inline-flex items-center rounded-[var(--radius-sm)] border border-border bg-gray-0 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-500"
            >
              {FORMAT_LABEL[fmt] ?? fmt}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
