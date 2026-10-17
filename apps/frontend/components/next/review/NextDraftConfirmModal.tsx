'use client'

import * as React from 'react'
import { Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import type {
  ConfirmProjectDraftRequest,
  DraftAutoFixDiff,
  DraftUnselectedStrategy,
  DraftValidationIssue,
  ProjectDraft,
  ProjectDraftDependency,
  ProjectDraftSelection,
} from '@aiproj/types'
import type { ApiError } from '@/lib/api-client'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAuthStore } from '@/stores/auth-store'
import { isConfirmBlocked } from './NextDraftActionBar'

// ---------------------------------------------------------------------------
// 纯函数：确认汇总统计与失败分类（供组件与单测共享，零 DOM 零副作用）
// ---------------------------------------------------------------------------

/** 未选内容处置策略 → 人类可读中文名（与 spec「未选内容处置策略单选」一致）。 */
export const DRAFT_UNSELECTED_STRATEGY_LABELS: Readonly<Record<DraftUnselectedStrategy, string>> = {
  discard: '丢弃未选中项',
  save_as_draft: '保留为后续草稿',
  ask_later: '稍后提醒我',
}

export interface DraftConfirmCounts {
  wbsNodes: number
  tasks: number
  dependencies: number
  milestones: number
  risks: number
}

/**
 * 即将落库实体计数投影（对齐后端 `import_selection.filterDraftBySelection` 的悬空过滤语义）：
 * 依赖仅统计两端任务均在选中集内的边，其余计数直接来自选择集。
 */
export function computeDraftConfirmCounts(
  draft: ProjectDraft,
  selection: ProjectDraftSelection,
): DraftConfirmCounts {
  const selectedTasks = new Set(selection.taskIds)
  let dependencies = 0
  for (const dep of draft.dependencies as ProjectDraftDependency[]) {
    if (selectedTasks.has(dep.predecessorId) && selectedTasks.has(dep.successorId)) {
      dependencies += 1
    }
  }
  return {
    wbsNodes: selection.wbsNodeIds.length,
    tasks: selection.taskIds.length,
    dependencies,
    milestones: selection.milestoneIds.length,
    risks: selection.riskHintIds.length,
  }
}

/** Blocking / Stale / 致命错误分类结果（操作栏横幅消费）。 */
export type DraftConfirmFailure =
  | { kind: 'stale'; expected: number; received: number }
  | { kind: 'blocking'; issues: DraftValidationIssue[] }
  | { kind: 'fatal'; message: string }

/** 自动修正强制复核结果（直接呼出 NextDraftAutoFixModal，不落入操作栏横幅）。 */
export type DraftConfirmAutoFixResult = {
  kind: 'autoFix'
  diffs: DraftAutoFixDiff[]
  version: number
}

export type DraftConfirmErrorResult = DraftConfirmFailure | DraftConfirmAutoFixResult

/**
 * 转正失败分类（design D8 错误分类矩阵）：
 * - 422 + details.expected/received → 版本过期冲突（stale）；
 * - 422 + details.blocking 非空 → 服务端阻断（blocking）；
 * - 422 + details.autoFixDiffs 非空 → 自动修正复核（autoFix，RL-02 强制人工复核）；
 * - 其余（500 / 网关超时 / 断网 TypeError）→ 致命错误（fatal），保留现场可原地重试。
 */
export function classifyConfirmFailure(
  error: unknown,
  currentVersion: number,
): DraftConfirmErrorResult {
  const candidate = typeof error === 'object' && error !== null ? (error as Partial<ApiError>) : {}
  if (
    candidate.status === 422 &&
    candidate.details !== null &&
    typeof candidate.details === 'object'
  ) {
    const details = candidate.details as Record<string, unknown>
    if (typeof details.expected === 'number' && typeof details.received === 'number') {
      return { kind: 'stale', expected: details.expected, received: details.received }
    }
    if (Array.isArray(details.blocking) && details.blocking.length > 0) {
      return { kind: 'blocking', issues: details.blocking as DraftValidationIssue[] }
    }
    if (Array.isArray(details.autoFixDiffs) && details.autoFixDiffs.length > 0) {
      const parsedVersion = typeof details.version === 'number' ? details.version : currentVersion
      return {
        kind: 'autoFix',
        diffs: details.autoFixDiffs as DraftAutoFixDiff[],
        version: parsedVersion,
      }
    }
  }
  const message =
    typeof candidate.message === 'string' && candidate.message.length > 0
      ? candidate.message
      : '网络连接超时或服务繁忙'
  return { kind: 'fatal', message }
}

// ---------------------------------------------------------------------------
// 组件：转正二次确认汇总弹窗
// ---------------------------------------------------------------------------

export interface NextDraftConfirmModalProps {
  /** 草案会话标识（confirm 端点路径参数）。 */
  draftId: string
  /** 失败分类回传（stale/blocking/fatal 由操作栏横幅呈现；autoFix 弹窗内部直接接管，不会回传）。 */
  onError: (result: DraftConfirmFailure) => void
}

/** 转正模式 → 中文标签。 */
type DraftConfirmMode = 'all' | 'partial'
const CONFIRM_MODE_LABELS: Readonly<Record<DraftConfirmMode, string>> = {
  all: '全部接受',
  partial: '局部选择',
}

const COUNT_ITEMS: ReadonlyArray<{ key: keyof DraftConfirmCounts; label: string }> = [
  { key: 'wbsNodes', label: 'WBS 节点' },
  { key: 'tasks', label: '任务' },
  { key: 'dependencies', label: '依赖关系' },
  { key: 'milestones', label: '里程碑' },
  { key: 'risks', label: '风险条目' },
]

/**
 * 转正二次确认汇总弹窗（design D6.2 / tasks 3.2-3.3 / spec「人工显式确认与单事务转正对接」）。
 *
 * - 汇总展示拟创建正式项目名称、即将落库实体计数（WBS/任务/依赖/里程碑/风险）与未选策略；
 * - 「确认落库」为唯一正式转正触发器：置 `isConfirming = true` 后 Spinner + 防重复点击，
 *   组装 `ConfirmProjectDraftRequest`（version/mode/selection/modifications/acknowledgedWarnings）
 *   调用成熟端点 `POST .../confirm`（RL-06 零客户端绕过）；
 * - 成功 → `store.enterConfirmed(response)`，成功视窗由主容器按终态渲染；
 * - 失败 → `classifyConfirmFailure` 分类：422 stale/blocking/fatal 回传操作栏横幅，
 *   422 autoFix 直接呼出自动修正复核门禁（RL-02，严禁静默转正）；
 * - 无 `ai:confirm` 权限时整体不渲染（RL-06 零触发器防御）。
 */
export function NextDraftConfirmModal({ draftId, onError }: NextDraftConfirmModalProps) {
  const hasConfirmPermission = useAuthStore((state) => state.hasPermission('ai:confirm'))
  const draft = useAiProjectDraftStore((state) => state.draft)
  const draftVersion = useAiProjectDraftStore((state) => state.draftVersion)
  const pendingModifications = useAiProjectDraftStore((state) => state.pendingModifications)
  const validation = useAiProjectDraftStore((state) => state.validation)
  const mode = useAiDraftConfirmStore((state) => state.mode)
  const selection = useAiDraftConfirmStore((state) => state.selection)
  const acknowledgedWarnings = useAiDraftConfirmStore((state) => state.acknowledgedWarnings)
  const isConfirming = useAiDraftConfirmStore((state) => state.isConfirming)

  // 关闭语义原样保留（在途提交不关）；hook 的 canClose 与之同判据，
  // 使 Escape 与「关闭 / 取消」按钮走同一条路径（焦点落容器、关闭后归还触发元素）。
  const close = () => {
    if (isConfirming) return
    useAiDraftConfirmStore.setState({ confirmModalOpen: false })
  }
  const confirmDialogRef = React.useRef<HTMLDivElement | null>(null)
  // 本弹层由父层按 confirmModalOpen 条件挂载（挂载即打开），故 open 跟随权限门禁。
  useDialogA11y({
    ref: confirmDialogRef,
    open: hasConfirmPermission,
    onClose: close,
    canClose: () => !isConfirming,
  })

  if (!hasConfirmPermission) return null

  const projectName = draft?.charter.title.value ?? '—'

  const counts = draft !== null ? computeDraftConfirmCounts(draft, selection) : null

  async function handleConfirm() {
    // 纵深防御（RL-02 / design D6 守卫矩阵镜像）：即使二次确认弹窗被 devtools 强开，
    // 任一硬性前置条件不满足也绝不发出 confirm 请求——Blocking 未清零 / 未选中任何任务 /
    // 存在 Warning 且未显式勾选复核，一律零请求直接返回（服务端 confirm 仍独立重算兜底）。
    const guardBlocked =
      isConfirmBlocked(validation) ||
      selection.taskIds.length === 0 ||
      ((validation?.warning.length ?? 0) > 0 && !acknowledgedWarnings)
    if (isConfirming || draft === null || guardBlocked) return
    useAiDraftConfirmStore.setState({ isConfirming: true })
    const payload: ConfirmProjectDraftRequest = {
      version: draftVersion,
      mode,
      selection,
      modifications: pendingModifications,
      acknowledgedWarnings,
    }
    // 人员分配：只有真的分配了成员才随载荷提交。
    const roleAssignments = Object.entries(useAiDraftConfirmStore.getState().roleAssignments)
      .filter(([, userIds]) => userIds.length > 0)
      .map(([role, userIds]) => ({ role, userIds }))
    if (roleAssignments.length > 0) payload.roleAssignments = roleAssignments
    try {
      const response = await aiDraftApi.confirm(draftId, payload)
      useAiProjectDraftStore.getState().enterConfirmed(response)
      useAiDraftConfirmStore.setState({ isConfirming: false, confirmModalOpen: false })
    } catch (error) {
      const result = classifyConfirmFailure(error, draftVersion)
      useAiDraftConfirmStore.setState({ isConfirming: false, confirmModalOpen: false })
      if (result.kind === 'autoFix') {
        useAiDraftConfirmStore.setState({
          autoFixModalState: {
            open: true,
            diffs: result.diffs,
            version: result.version,
          },
        })
        return
      }
      onError(result)
    }
  }

  return (
    <div
      data-confirm-modal-backdrop
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="确认转正最终确认"
        data-confirm-modal
        ref={confirmDialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] shadow-none"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-primary)]">
            <ShieldCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            确认转正最终确认
          </h3>
          <button
            type="button"
            data-confirm-close
            aria-label="关闭确认弹窗"
            onClick={close}
            disabled={isConfirming}
            className="rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-[var(--nx-text-muted)]">拟创建项目</span>
            <span
              data-confirm-project-name
              className="text-sm font-medium text-[var(--nx-text-primary)]"
            >
              {projectName}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {COUNT_ITEMS.map((item) => (
              <div
                key={item.key}
                data-count-entry
                data-count-key={item.key}
                className="flex items-center justify-between rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
              >
                <span className="text-[11px] text-[var(--nx-text-secondary)]">{item.label}</span>
                <span
                  data-count-value
                  className="font-mono text-sm font-semibold text-[var(--nx-text-primary)]"
                >
                  {counts ? counts[item.key] : '—'}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-baseline justify-between gap-3 border-t border-[var(--nx-border-hairline)] pt-2.5">
            <span className="text-xs text-[var(--nx-text-muted)]">转正模式</span>
            <span data-confirm-mode className="text-xs text-[var(--nx-text-secondary)]">
              {CONFIRM_MODE_LABELS[mode]}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-[var(--nx-text-muted)]">未选内容处置策略</span>
            <span data-confirm-strategy className="text-xs text-[var(--nx-text-secondary)]">
              {DRAFT_UNSELECTED_STRATEGY_LABELS[selection.unselectedStrategy]}
            </span>
          </div>
          {mode === 'partial' &&
          selection.unselectedStrategy === 'save_as_draft' &&
          draft !== null ? (
            <p
              data-save-as-draft-hint
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
            >
              转正后未选的 {Math.max(0, draft.tasks.length - selection.taskIds.length)}{' '}
              项任务将保留在草稿箱
            </p>
          ) : null}

          {acknowledgedWarnings ? (
            <p data-warning-ack-flag className="text-[11px] text-[var(--nx-status-warning)]">
              你已复核并确认上述告警；告警情况会随这次转正记入审计日志。
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2.5 border-t border-[var(--nx-border-hairline)] px-4 py-3">
          <button
            type="button"
            data-confirm-cancel
            onClick={close}
            disabled={isConfirming}
            className="inline-flex h-9 items-center rounded-md border border-[var(--nx-border-hairline)] px-3.5 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            data-confirm-commit
            onClick={handleConfirm}
            disabled={isConfirming}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isConfirming ? (
              <>
                <Loader2 className="nx-review-spin h-4 w-4" aria-hidden />
                正在写入正式项目库…
              </>
            ) : (
              <>
                <ShieldAlert className="h-4 w-4" aria-hidden />
                确认落库
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default NextDraftConfirmModal
