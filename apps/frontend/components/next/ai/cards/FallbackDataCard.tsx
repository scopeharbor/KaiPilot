'use client'

import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * 未注册只读工具输出的通用兜底键值对卡片
 * （v3-ui-next-ai-colleague spec「结构化查询结果卡片渲染」5. 优雅兜底）。
 *
 * - 收到未预置专属卡片的只读工具成功输出时，以结构化键值对排版呈现，
 *   严禁裸露 JSON 字符串直出、严禁渲染未捕获异常；
 * - 顶层标量字段逐行呈现，嵌套对象/数组经 JSON 序列化兜底；字段过多时
 *   截断前 12 项并标注总量；任何序列化异常都被消化为「—」。
 */
export interface FallbackDataCardProps {
  /** 未知结构的只读工具输出（对象 / 数组 / 标量均可）。 */
  data: unknown
  /** 命中工具名；未提供时省略诚实微标（此时不宣称任何路由来源）。 */
  toolName?: string
}

const MAX_ROWS = 12

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value.trim() === '' ? '—' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const serialized = JSON.stringify(value)
    return serialized ?? '—'
  } catch {
    return '—'
  }
}

/** 结构化条目：仅保留顶层标量字段，嵌套值序列化为单行文本（永不抛错）。 */
function toRows(data: unknown): Array<[string, string]> {
  if (Array.isArray(data)) {
    const nested = data.slice(0, 5).map((entry) => toDisplayValue(entry))
    if (nested.length === 0) return [['条目数', '0']]
    return [
      ['条目数', String(data.length)],
      ...nested.map((value, index): [string, string] => [`#${index + 1}`, value]),
    ]
  }
  if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data as Record<string, unknown>)
    return entries.map(([key, value]) => [key, toDisplayValue(value)])
  }
  return [['数据', toDisplayValue(data)]]
}

export function FallbackDataCard({ data, toolName }: FallbackDataCardProps) {
  const rows = toRows(data)
  const shown = rows.slice(0, MAX_ROWS)
  const total = rows.length

  return (
    <article
      data-card="fallback-data"
      className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--nx-text-primary)]">结构化只读数据</span>
        {toolName ? <RuleMatchBadge toolName={toolName} /> : null}
      </div>

      <dl className="divide-y divide-[var(--nx-border-hairline)] px-3">
        {shown.length === 0 ? (
          <p data-fallback-empty className="py-3 text-xs text-[var(--nx-text-muted)]">
            该工具未返回可展示的数据
          </p>
        ) : (
          shown.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-3 py-1.5">
              <dt
                data-fallback-key
                className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]"
              >
                {key}
              </dt>
              <dd
                data-fallback-value
                className="min-w-0 break-all text-right text-[11px] leading-4 text-[var(--nx-text-secondary)]"
              >
                {value}
              </dd>
            </div>
          ))
        )}
      </dl>

      {total > MAX_ROWS ? (
        <p
          data-fallback-truncate
          className="border-t border-[var(--nx-border-hairline)] px-3 py-1.5 text-[10px] text-[var(--nx-text-muted)]"
        >
          共 {total} 个字段，展示前 {shown.length} 项
        </p>
      ) : null}
    </article>
  )
}

export default FallbackDataCard
