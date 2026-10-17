'use client'

/**
 * v3-template-compiler-plugin-integration —— CompilerTemplateSelector（tasks 4.1/4.2）。
 *
 * 支持：加载/错误/空态、详情预览、默认值与用户覆盖的差异预览。
 */

import * as React from 'react'
import { Loader2, AlertCircle, FileQuestion } from 'lucide-react'
import { useCompilerTemplates, useCompilerTemplateDetail } from '@/hooks/use-compiler-templates'
import { cn } from '@/lib/utils'

export interface CompilerTemplateSelectorProps {
  value?: string | null
  onChange?: (templateId: string | null, selectionDigest?: string) => void
  userInput?: Record<string, unknown>
  className?: string
}

export function CompilerTemplateSelector({
  value,
  onChange,
  userInput,
  className,
}: CompilerTemplateSelectorProps) {
  const [selected, setSelected] = React.useState<string | null>(value ?? null)
  const listQuery = useCompilerTemplates()
  const detailQuery = useCompilerTemplateDetail(selected)

  React.useEffect(() => {
    if (value !== undefined) setSelected(value)
  }, [value])

  const handleSelect = (templateId: string) => {
    setSelected(templateId)
    const detail = detailQuery.data?.data
    // 查找对应 digest
    const listItem = listQuery.data?.data.find((t) => t.templateId === templateId)
    const digest = listItem?.selectionDigest ?? detail?.selectionDigest
    onChange?.(templateId, digest)
  }

  const handleClear = () => {
    setSelected(null)
    onChange?.(null, undefined)
  }

  if (listQuery.isLoading) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground',
          className,
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>正在加载模板列表…</span>
      </div>
    )
  }

  if (listQuery.isError) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm',
          className,
        )}
        role="alert"
      >
        <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />
        <span>模板列表加载失败，请稍后重试。</span>
        <button
          type="button"
          onClick={() => listQuery.refetch()}
          className="ml-auto rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
        >
          重试
        </button>
      </div>
    )
  }

  const templates = listQuery.data?.data ?? []

  if (templates.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        <FileQuestion className="h-6 w-6" aria-hidden />
        <p>暂无可用模板</p>
        <p className="text-xs">请联系管理员安装并启用编译器模板插件包。</p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* 列表 */}
      <div className="space-y-2" role="radiogroup" aria-label="可用编译模板">
        {templates.map((tpl) => (
          <label
            key={tpl.templateId}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/50',
              selected === tpl.templateId && 'border-primary bg-primary/5',
            )}
          >
            <input
              type="radio"
              name="compiler-template"
              value={tpl.templateId}
              checked={selected === tpl.templateId}
              onChange={() => handleSelect(tpl.templateId)}
              className="mt-1"
              aria-label={tpl.name}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{tpl.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tpl.pluginId} v{tpl.pluginVersion}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{tpl.description}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {tpl.templateId} · {tpl.projectType} · 可覆盖:{' '}
                {tpl.overridableParams.join(', ') || '—'}
              </p>
            </div>
          </label>
        ))}
      </div>

      {selected && (
        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          清除选择（使用默认输入）
        </button>
      )}

      {/* 详情预览 */}
      {selected && (
        <div className="rounded-md border bg-card p-3">
          <h4 className="text-sm font-semibold">模板详情预览</h4>
          {detailQuery.isLoading ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 加载详情…
            </div>
          ) : detailQuery.isError ? (
            <div className="mt-2 text-xs text-destructive">详情加载失败</div>
          ) : detailQuery.data?.data ? (
            <div className="mt-2 space-y-2 text-xs">
              <div>
                <span className="font-medium">项目类型：</span>
                {detailQuery.data.data.projectType}
              </div>
              <div>
                <span className="font-medium">目标：</span>
                {detailQuery.data.data.objectives.join('、')}
              </div>
              <div>
                <span className="font-medium">WBS 约束：</span>
                {JSON.stringify(detailQuery.data.data.wbsConstraints ?? {})}
              </div>
              <div>
                <span className="font-medium">来源：</span>
                {detailQuery.data.data.pluginId} v{detailQuery.data.data.pluginVersion} ·{' '}
                {detailQuery.data.data.selectionDigest.slice(0, 8)}
              </div>
              {detailQuery.data.meta?.stale && (
                <div className="rounded bg-amber-50 p-2 text-amber-700" role="alert">
                  模板已更新，选择的版本已过期，请重新选择。
                </div>
              )}

              {/* 差异预览：模板默认值 vs 用户覆盖 */}
              {userInput && Object.keys(userInput).length > 0 && (
                <div className="mt-3 rounded bg-muted p-2">
                  <div className="font-medium">差异预览（模板默认值 → 用户输入优先）</div>
                  <ul className="mt-1 list-inside list-disc">
                    {Object.entries(detailQuery.data.data.seed as Record<string, unknown>).map(
                      ([k, v]) => {
                        const userVal = (userInput as Record<string, unknown>)[k]
                        const overridden =
                          userVal !== undefined && JSON.stringify(userVal) !== JSON.stringify(v)
                        return (
                          <li key={k} className={overridden ? 'text-amber-700' : ''}>
                            {k}: {JSON.stringify(v)}{' '}
                            {overridden ? `→ ${JSON.stringify(userVal)} (用户优先)` : ''}
                          </li>
                        )
                      },
                    )}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default CompilerTemplateSelector
