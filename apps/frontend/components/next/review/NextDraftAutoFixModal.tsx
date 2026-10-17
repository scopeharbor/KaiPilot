'use client'

import * as React from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { NextDraftAutoFixDiff } from './NextDraftAutoFixDiff'

/** 关闭确认 Store 中的自动修正模态状态（兼容 W-A 契约的 open 开关形态）。 */
function closeAutoFixModal() {
  useAiDraftConfirmStore.setState((state) => ({
    autoFixModalState: {
      open: false,
      diffs: state.autoFixModalState?.diffs ?? [],
      version: state.autoFixModalState?.version ?? 0,
    },
  }))
}

/**
 * 自动修正 Diff 复核门禁模态框（v3-ui-next-draft-confirm tasks 2.4，RL-02）。
 *
 * - 消费确认 Store 的 `autoFixModalState`（{ open, diffs, version }）；打开时呈现逐条
 *   修正对比（路径 / 修正前红色删除线 / 修正后绿色高亮 / 修正原因）与草案新版本号；
 * - 强制要求用户显式点击「已复核并载入新版本草案」：调用 `GET .../project-drafts/:id`
 *   拉取服务端升级后的最新草案载入审查工作面（setDraftCompleted + enterReview），
 *   重新初始化选择集（initSelection）后关闭模态框；未复核前严禁静默转正；
 * - 载入失败保留模态框与错误提示，允许原地重试；「暂不载入」仅收起当前模态，确认流
 *   仍保持阻断；Esc 同「暂不载入」。
 */
export function NextDraftAutoFixModal() {
  const modalState = useAiDraftConfirmStore((state) => state.autoFixModalState)
  const draftId = useAiProjectDraftStore((state) => state.draftId)

  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const open = Boolean(modalState && modalState.open)

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAutoFixModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  async function handleReload() {
    if (loading) return
    setLoading(true)
    setLoadError(null)
    try {
      if (!draftId) throw new Error('缺少草案会话标识，无法载入新版本')
      const detail = await aiDraftApi.get(draftId)
      if (!detail.draft || !detail.meta || !detail.validation) {
        throw new Error('新版本草案尚未沉淀完整，请稍后重试')
      }
      const store = useAiProjectDraftStore.getState()
      store.setDraftCompleted(detail.draft, detail.meta, detail.validation)
      useAiProjectDraftStore.setState({
        draftId: detail.draftId,
        draftVersion: detail.version,
      })
      store.enterReview()
      // 重置瞬态交互状态后按新草案重建全选选择集。
      const confirm = useAiDraftConfirmStore.getState()
      confirm.resetConfirmState()
      confirm.initSelection(detail.draft)
      closeAutoFixModal()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '新版本载入失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div
      data-autofix-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="自动修正复核"
        className="w-full max-w-2xl rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] shadow-none"
      >
        <header className="flex items-center gap-2 border-b border-[var(--nx-border-hairline)] px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--nx-status-warning)]" aria-hidden />
          <h2 className="text-sm font-semibold text-[var(--nx-text-primary)]">
            系统规则自动修正复核
          </h2>
          <span
            data-autofix-version
            className="ml-auto rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            v{modalState.version}
          </span>
        </header>

        <div className="space-y-3 px-4 py-3">
          <p className="text-xs leading-relaxed text-[var(--nx-text-muted)]">
            服务端校验检测到 {modalState.diffs.length} 处自动修正，系统已按规则微调草案并升级版本。
            请逐条复核修正内容后载入新版本草案；未经人工核对，严禁直接继续转正（RL-02）。
          </p>
          <NextDraftAutoFixDiff diffs={modalState.diffs} />
          {loadError !== null ? (
            <p data-autofix-error role="alert" className="text-xs text-[var(--nx-status-danger)]">
              新版本载入失败：{loadError}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-4 py-3">
          <button
            type="button"
            data-autofix-dismiss
            onClick={closeAutoFixModal}
            disabled={loading}
            className="rounded-sm border border-[var(--nx-border-hairline)] px-3 py-1.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            暂不载入
          </button>
          <button
            type="button"
            data-autofix-reload
            onClick={handleReload}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-3 py-1.5 text-xs font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="nx-review-spin h-3.5 w-3.5" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            {loading ? '正在载入新版本…' : '已复核并载入新版本草案'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default NextDraftAutoFixModal
