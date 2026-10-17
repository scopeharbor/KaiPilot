'use client'

import * as React from 'react'

/**
 * 审查工作面共享纯 CSS 动效与精确档降级（v3-ui-next-draft-review-panel design D8）。
 *
 * - `nx-review-breathe`：1.5 秒微弱发丝呼吸（骨架占位）；
 * - `nx-review-spin`：微型旋转指示器（操作在途）；
 * - `[data-immersion='precise']` 与 `prefers-reduced-motion: reduce` 下
 *   animation / transition 全部 `!important` 归零，降级为纯静态高对比度仪器面板。
 * 由 NextDraftReviewPanel 与 NextDraftSkeleton 按需注入 `<style data-nx-review-css>`。
 */
export const NX_REVIEW_CSS = `
.nx-review-breathe {
  animation: nx-review-breathe 1.5s ease-in-out infinite;
}
.nx-review-spin {
  animation: nx-review-spin 0.9s linear infinite;
}
@keyframes nx-review-breathe {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
}
@keyframes nx-review-spin {
  to { transform: rotate(360deg); }
}
[data-immersion='precise'] .nx-review-breathe,
[data-immersion='precise'] .nx-review-spin {
  animation: none !important;
  transition: none !important;
}
@media (prefers-reduced-motion: reduce) {
  .nx-review-breathe,
  .nx-review-spin {
    animation: none !important;
    transition: none !important;
  }
}
`

/**
 * 暗黑发丝线高保真骨架屏（v3-ui-next-draft-review-panel tasks 3.4 / design D8）。
 *
 * 布局与真实审查面板同构：顶栏短码/版本/完备绿标占位、左侧模块检视双列占位、
 * 右侧自检能量条与假设清单占位；1.5s 微弱发丝呼吸脉冲（精确档/减弱动效归零）；
 * 禁止整屏白旋转加载圈。
 */
export function NextDraftSkeleton() {
  return (
    <section
      data-next-draft-skeleton
      role="status"
      aria-label="正在加载草案数据"
      aria-busy="true"
      className="mx-auto w-full max-w-5xl"
    >
      <style data-nx-review-css>{NX_REVIEW_CSS}</style>

      {/* 顶栏占位：短码 / 版本 / 完备绿标 / 耗时 */}
      <header
        data-skeleton-header
        className="flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3"
      >
        <span className="nx-review-breathe h-5 w-28 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
        <span className="nx-review-breathe h-5 w-10 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
        <span className="nx-review-breathe ml-auto h-5 w-36 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
        <span className="nx-review-breathe h-5 w-16 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
      </header>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* 左侧模块检视区占位：双列卡片 */}
        <div
          data-skeleton-inspector
          className="grid gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
        >
          <div className="flex gap-2">
            <span className="nx-review-breathe h-7 w-20 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
            <span className="nx-review-breathe h-7 w-24 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
            <span className="nx-review-breathe h-7 w-20 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
            <span className="nx-review-breathe h-7 w-24 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]" />
          </div>
          {[0, 1].map((column) => (
            <div key={column} className="grid gap-2 sm:grid-cols-2">
              {[0, 1, 2, 3].map((card) => (
                <div
                  key={card}
                  className="nx-review-breathe h-16 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
                />
              ))}
            </div>
          ))}
        </div>

        {/* 右侧自检与假设清单占位 */}
        <aside data-skeleton-aside className="flex flex-col gap-3">
          <div className="nx-review-breathe h-40 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3">
            <div className="h-3 w-24 rounded bg-[var(--nx-bg-1)]" />
            <div className="mt-3 flex gap-2">
              <div className="h-16 flex-1 rounded bg-[var(--nx-bg-1)]" />
              <div className="h-16 flex-1 rounded bg-[var(--nx-bg-1)]" />
            </div>
          </div>
          <div className="nx-review-breathe h-32 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3">
            <div className="h-3 w-20 rounded bg-[var(--nx-bg-1)]" />
            <div className="mt-3 space-y-2">
              <div className="h-4 rounded bg-[var(--nx-bg-1)]" />
              <div className="h-4 rounded bg-[var(--nx-bg-1)]" />
              <div className="h-4 w-2/3 rounded bg-[var(--nx-bg-1)]" />
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}

export default NextDraftSkeleton
