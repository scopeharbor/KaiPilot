/**
 * 图表镜头通用三态组件（v3-ui-next-chart-gallery W2 · 加载/空态/错误 复用件）。
 *
 * - 加载骨架：与图表容器同高的暗黑脉冲占位（aria-busy，禁止空态误报）；
 * - 语义空态：暗黑控制台风格卡片，图标 + 原因说明 + 可选引导入口；
 * - 错误回退：说明失败原因并提供「重新加载」重试（点击重触发查询）。
 *
 * 只消费 --nx-* 令牌；纯展示组件零网络。
 */
import Link from 'next/link'
import { CircleAlert, RotateCw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** 图表容器骨架（模拟坐标轴/图例占位，防 CLS）。 */
export function ChartLensSkeleton({
  label,
  chartHeight = 320,
}: {
  label: string
  chartHeight?: number
}) {
  return (
    <div
      data-lens-loading
      role="status"
      aria-label={label}
      aria-busy="true"
      className="animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-4"
      style={{ height: chartHeight + 40 }}
    >
      <div className="flex items-center gap-2">
        <div className="h-3 w-16 rounded bg-[var(--nx-bg-1)]" />
        <div className="h-3 w-10 rounded bg-[var(--nx-bg-1)]" />
      </div>
      <div className="mt-4 flex h-full gap-3 pb-2" aria-hidden>
        <div className="w-8 rounded bg-[var(--nx-bg-1)]" />
        <div className="flex flex-1 items-end gap-2">
          {[52, 74, 46, 88, 62, 96, 58].map((height, index) => (
            <div
              key={index}
              className="flex-1 rounded-t bg-[var(--nx-bg-1)]"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-auto h-3 w-1/3 rounded bg-[var(--nx-bg-1)]" />
    </div>
  )
}

/** 语义空态卡片（暗黑控制台风格）。 */
export function ChartLensEmptyState({
  icon: Icon,
  title,
  description,
  guideHref,
  guideLabel,
  ariaLabel,
}: {
  icon: LucideIcon
  title: string
  description: string
  /** 可选引导操作（同轨路由链接；缺省只展示说明）。 */
  guideHref?: string
  guideLabel?: string
  ariaLabel?: string
}) {
  return (
    <div
      data-lens-empty
      role="status"
      aria-label={ariaLabel ?? title}
      className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
    >
      <Icon className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
      <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">{title}</h3>
      <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">{description}</p>
      {guideHref && guideLabel ? (
        <Link
          href={guideHref}
          data-lens-empty-guide
          className="mt-1 inline-flex h-8 items-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          {guideLabel}
        </Link>
      ) : null}
    </div>
  )
}

/** 错误回退卡片（含重试按钮）。 */
export function ChartLensErrorState({
  ariaLabel,
  title,
  description,
  retryLabel = '重新加载',
  onRetry,
}: {
  ariaLabel: string
  title?: string
  description?: string
  retryLabel?: string
  onRetry: () => void
}) {
  return (
    <div
      data-lens-error
      role="alert"
      aria-label={ariaLabel}
      className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-8 text-center"
    >
      <CircleAlert className="h-8 w-8 text-[var(--nx-status-danger)]" aria-hidden />
      <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">
        {title ?? '图表数据加载失败'}
      </h3>
      <p className="max-w-md text-xs leading-relaxed text-[var(--nx-text-muted)]">
        {description ?? '图表数据拉取失败，请检查网络连接后重试。'}
      </p>
      <button
        type="button"
        data-lens-retry
        onClick={onRetry}
        className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
      >
        <RotateCw className="h-3.5 w-3.5" aria-hidden />
        {retryLabel}
      </button>
    </div>
  )
}
