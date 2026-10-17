'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import type { CreateReportRequest, ReportGenerateFilters, ReportTemplate } from '@aiproj/types'

/**
 * 报表生成表单 —— tasks 6.2。
 *
 * 面向 V1 白名单四模板的最小可用筛选：标题、时间范围、包含明细/warnings。
 * 集合类筛选（assigneeIds/wbsNodeIds/milestoneIds）留到后续版本，避免为
 * MVP 引入选择器组件。
 */

export interface ReportGenerateFormProps {
  template: ReportTemplate
  onSubmit: (payload: CreateReportRequest) => void
  submitting?: boolean
  /** 无权限时禁用整个表单；由外层 PermissionGuard 决定是否渲染 */
  disabled?: boolean
}

export function ReportGenerateForm({
  template,
  onSubmit,
  submitting = false,
  disabled = false,
}: ReportGenerateFormProps) {
  const [title, setTitle] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [includeDetails, setIncludeDetails] = useState(true)
  const [includeWarnings, setIncludeWarnings] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // 时间范围前端校验：fromDate <= toDate，避免无效请求打到后端
    if (fromDate && toDate && fromDate > toDate) {
      setError('起始日期不能晚于结束日期')
      return
    }

    const filters: ReportGenerateFilters = {}
    if (fromDate) filters.fromDate = fromDate
    if (toDate) filters.toDate = toDate

    const payload: CreateReportRequest = {
      template,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(Object.keys(filters).length ? { filters } : {}),
      formatConfig: {
        includeDetails,
        includeWarnings,
        locale: 'zh-CN',
      },
    }
    onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="report-title">报表标题（可选）</Label>
          <Input
            id="report-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="留空将使用「模板 + 生成时间」自动命名"
            maxLength={255}
            disabled={disabled || submitting}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="report-from-date">起始日期</Label>
          <Input
            id="report-from-date"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            disabled={disabled || submitting}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-to-date">结束日期</Label>
          <Input
            id="report-to-date"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            disabled={disabled || submitting}
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-700">输出选项</legend>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeDetails}
            onChange={(e) => setIncludeDetails(e.target.checked)}
            disabled={disabled || submitting}
            className="h-4 w-4 rounded border-gray-300"
          />
          包含明细分节（默认开启）
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeWarnings}
            onChange={(e) => setIncludeWarnings(e.target.checked)}
            disabled={disabled || submitting}
            className="h-4 w-4 rounded border-gray-300"
          />
          包含 warnings 提示（默认开启）
        </label>
      </fieldset>

      {error && (
        <div role="alert" className="text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || submitting}>
          {submitting ? '生成中…' : '生成报表'}
        </Button>
      </div>
    </form>
  )
}
