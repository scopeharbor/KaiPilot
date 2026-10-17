'use client'

import * as React from 'react'
import { FileQuestion, Home, Sparkles } from 'lucide-react'

export interface NextDraftEmptyViewProps {
  /**
   * 空态变体：
   * - `notFound`（默认）：跨租户/非法 ID 触发的 404 中性空态（RL-05 防泄露），
   *   文案为「未找到该草案或链接已失效」——严禁出现组织/租户敏感词；
   * - `empty`：草案实体缺失（draft == null 且无在途加载）的数据缺失空态，
   *   提供「发起全新项目创建」引导回到意图输入流。
   */
  variant?: 'notFound' | 'empty'
  /** 点击「返回首页」。 */
  onBackHome?: () => void
  /** 仅 `empty` 变体：点击「发起全新项目创建」。 */
  onCreate?: () => void
}

/**
 * 中性空态卡（v3-ui-next-draft-review-panel tasks 3.4 / design D7、spec RL-05）。
 *
 * 404 场景严格使用中性文案——前端绝不区分「无权访问」「属于其他组织」「已被物理删除」，
 * 任何敏感词出现即视为泄露资源存在性违规。
 */
export function NextDraftEmptyView({
  variant = 'notFound',
  onBackHome,
  onCreate,
}: NextDraftEmptyViewProps) {
  const isNotFound = variant === 'notFound'

  return (
    <section
      data-next-draft-empty-view
      data-empty-variant={variant}
      role="status"
      aria-label={isNotFound ? '未找到该草案或链接已失效' : '暂无可供审查的草案数据'}
      className="mx-auto w-full max-w-md rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-8 text-center"
    >
      <FileQuestion className="mx-auto h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
      <h2 className="mt-4 text-base font-semibold text-[var(--nx-text-primary)]">
        {isNotFound ? '未找到该草案或链接已失效' : '暂无可供审查的草案数据'}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--nx-text-secondary)]">
        {isNotFound
          ? '草案不存在或已被移除，请核对链接后重试。'
          : '该草案尚未生成完整内容，可发起全新项目创建。'}
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        {onBackHome ? (
          <button
            type="button"
            data-empty-back-home
            onClick={onBackHome}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <Home className="h-4 w-4" aria-hidden />
            返回首页
          </button>
        ) : null}
        {!isNotFound && onCreate ? (
          <button
            type="button"
            data-empty-create
            onClick={onCreate}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            发起全新项目创建
          </button>
        ) : null}
      </div>
    </section>
  )
}

export default NextDraftEmptyView
