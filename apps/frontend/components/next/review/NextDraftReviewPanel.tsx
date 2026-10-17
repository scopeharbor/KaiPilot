'use client'

import * as React from 'react'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { NX_REVIEW_CSS } from './NextDraftSkeleton'
import { NextDraftHeader } from './NextDraftHeader'
import { NextDraftActionBar } from './NextDraftActionBar'
// W1 模块检视四区 / W2 自检报告·修正 Diff·假设清单（并行 worker 契约见 design file structure）。
import { NextDraftModuleInspector } from './NextDraftModuleInspector'
import { NextDraftValidationReport } from './NextDraftValidationReport'
import { NextDraftAutoFixDiff } from './NextDraftAutoFixDiff'
import { NextDraftAssumptionList } from './NextDraftAssumptionList'
import { NextDraftReviewItems } from './NextDraftReviewItems'
import { NextDraftMemberAssignment } from './NextDraftMemberAssignment'
import { NextDraftReplanPanel } from './NextDraftReplanPanel'
// B2c-2 转正工作面（W1 部分接受控制栏 / W2 自动修正复核门禁 / W3 确认·成功弹窗）。
import { NextDraftPartialAcceptPanel } from './NextDraftPartialAcceptPanel'
import { NextDraftAutoFixModal } from './NextDraftAutoFixModal'
import { NextDraftConfirmModal } from './NextDraftConfirmModal'
import { NextDraftConfirmSuccessModal } from './NextDraftConfirmSuccessModal'
import type { DraftConfirmFailure } from './NextDraftConfirmModal'

export interface NextDraftReviewPanelProps {
  /** 返回重试生成（resetToContext 之后回调，透传 ActionBar）。 */
  onRetry?: () => void
  /** 保存为草稿成功（enterSaved 之后回调，透传 ActionBar）。 */
  onSaved?: () => void
  /** 放弃草案成功（会话清理之后回调，透传 ActionBar）。 */
  onDiscarded?: () => void
}

/**
 * 暗黑仪器感审查主容器（v3-ui-next-draft-review-panel tasks 3.5 + v3-ui-next-draft-confirm
 * tasks 3.7 / design D1·D2·D6·D7，D18 工作面 A「HUD Surface A」）。
 *
 * - 双入口共享 100% 相同组件树：剧场内就地展开与独立深链接路由都由本容器呈现，
 *   数据单源来自 `useAiProjectDraftStore`（decision D1）；
 * - 顶栏 NextDraftHeader；左侧模块检视四区（W1）+ 右侧自检报告/自动修正 Diff/假设清单（W2）；
 * - B2c-2 转正工作面总装：模块检视区下方挂载 NextDraftPartialAcceptPanel（W1 控制栏），
 *   底部 NextDraftActionBar 安全操作栏（W3）；弹窗按状态机挂载——
 *   NextDraftConfirmModal（二次确认）、NextDraftAutoFixModal（自动修正复核门禁，RL-02）、
 *   NextDraftConfirmSuccessModal（成功视窗，`draftStatus === 'confirmed'` 时呈现）；
 * - 全局键盘 ESC：仅取消可撤销的二次确认弹窗（提交中绝对拦截；复核门禁与成功视窗
 *   走显式按钮行动，ESC 不绕过 RL-02 人工复核）；
 * - 视觉规范：`--nx-workspace-surface` 基底、战术冷蓝 `--nx-accent`、1px 发丝线
 *   边框、4–6px 紧凑圆角，严禁装饰性大投影与渐变彩条（RL-15）；
 * - 审查态恪守零正式业务表写操作（RL-01）：落库唯一入口为 ConfirmModal「确认落库」
 *   显式点击后的 `POST .../confirm` 单事务调用；
 * - 数据不齐（draft/validation/draftId 任一缺失）时渲染为空，由装配层兜底空态。
 */
export function NextDraftReviewPanel({ onRetry, onSaved, onDiscarded }: NextDraftReviewPanelProps) {
  const draftId = useAiProjectDraftStore((state) => state.draftId)
  const draftVersion = useAiProjectDraftStore((state) => state.draftVersion)
  const draft = useAiProjectDraftStore((state) => state.draft)
  const validation = useAiProjectDraftStore((state) => state.validation)
  const draftMeta = useAiProjectDraftStore((state) => state.draftMeta)
  const draftStatus = useAiProjectDraftStore((state) => state.draftStatus)
  const confirmResponse = useAiProjectDraftStore((state) => state.confirmResponse)
  const confirmModalOpen = useAiDraftConfirmStore((state) => state.confirmModalOpen)
  // 生成耗时仅展示真实测得值（heartbeat 驱动）；0/未知 → 顶栏显示「—」。
  const elapsedMs = useAiProjectDraftStore((state) =>
    state.progressProjection.elapsedMs > 0 ? state.progressProjection.elapsedMs : null,
  )

  const [confirmFailure, setConfirmFailure] = React.useState<DraftConfirmFailure | null>(null)

  // 转正工作面选择集初始化（B2c-2 集成接线）：审查面板载入草案时，若确认 Store 的选择集
  // 仍为空且处于默认「全部接受」模式（首次进入 / 切换草案），按草案重建完整全选集。
  // 局部选择已进行中（选择集非空）时不覆盖用户现场；转正成功/刷新路径由各组件自行复位。
  React.useEffect(() => {
    if (!draft) return
    const confirmState = useAiDraftConfirmStore.getState()
    if (confirmState.mode === 'all' && confirmState.selection.taskIds.length === 0) {
      confirmState.initSelection(draft)
    }
  }, [draftId, draft])

  // 全局 ESC：提交中绝对拦截；仅关闭可撤销的二次确认弹窗。
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      const confirmState = useAiDraftConfirmStore.getState()
      if (confirmState.isConfirming) return
      if (confirmState.confirmModalOpen) {
        useAiDraftConfirmStore.setState({ confirmModalOpen: false })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (!draftId || !draft || !validation) return null

  const showSuccess = draftStatus === 'confirmed' && confirmResponse !== null

  return (
    <section
      data-next-draft-review-panel
      aria-label="草案审查面板"
      className="mx-auto w-full max-w-5xl"
    >
      <style data-nx-review-css>{NX_REVIEW_CSS}</style>

      <NextDraftHeader
        draftId={draftId}
        version={draftVersion}
        projectType={draft.projectType}
        elapsedMs={elapsedMs}
      />

      <NextDraftReplanPanel draftId={draftId} version={draftVersion} />

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <NextDraftModuleInspector draft={draft} />
        <aside className="flex flex-col gap-3">
          <NextDraftReviewItems meta={draftMeta} />
          <NextDraftValidationReport validation={validation} draftId={draftId} />
          <NextDraftAutoFixDiff diffs={validation.autoFixDiffs ?? []} />
          <NextDraftAssumptionList draft={draft} />
          <NextDraftMemberAssignment draft={draft} />
        </aside>
      </div>

      <NextDraftPartialAcceptPanel draftId={draftId} draft={draft} showWarningStrip={false} />

      <NextDraftActionBar
        draftId={draftId}
        validation={validation}
        onRetry={onRetry}
        onSaved={onSaved}
        onDiscarded={onDiscarded}
        confirmFailure={confirmFailure}
        onClearConfirmFailure={() => setConfirmFailure(null)}
      />

      {confirmModalOpen ? (
        <NextDraftConfirmModal draftId={draftId} onError={setConfirmFailure} />
      ) : null}
      <NextDraftAutoFixModal />
      {showSuccess ? <NextDraftConfirmSuccessModal /> : null}
    </section>
  )
}

export default NextDraftReviewPanel
