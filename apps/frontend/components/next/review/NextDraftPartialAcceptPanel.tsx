'use client'

import * as React from 'react'
import { AlertTriangle, ListChecks, RefreshCw, X } from 'lucide-react'
import type { DraftUnselectedStrategy, ProjectDraft, ProjectDraftDependency } from '@aiproj/types'
import { aiDraftApi } from '@/lib/api/ai-draft'
import {
  buildTaskLookup,
  buildWbsTree,
  extractMarkedValue,
  flattenWbsNodes,
} from '@/lib/next/draft-review-helpers'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'

/** 解绑透视抽屉的「横幅入口」哨兵：展开全部悬空依赖（区别于单任务行徽章入口）。 */
const DANGLING_BANNER_KEY = '__dangling_banner__'

/** 一条受未勾选影响的悬空依赖（仅一端仍在选择集中，导入时将被服务端自动过滤）。 */
export interface DanglingDependencyEntry {
  dependency: ProjectDraftDependency
  /** 被排除（未选中）的任务 ID。 */
  removedTaskId: string
  /** 保留（已选中）的一端任务 ID。 */
  keptTaskId: string
}

/**
 * 悬空依赖实时分析（与后端 `import_selection.ts:193-196` 语义对齐）：
 * 依赖两端均选中方可保留；仅一端选中即判定为悬空依赖。
 */
export function findDanglingDependencies(
  dependencies: ProjectDraftDependency[],
  selectedTaskIds: ReadonlySet<string>,
): DanglingDependencyEntry[] {
  const entries: DanglingDependencyEntry[] = []
  for (const dependency of dependencies) {
    const predSelected = selectedTaskIds.has(dependency.predecessorId)
    const succSelected = selectedTaskIds.has(dependency.successorId)
    if (predSelected === succSelected) continue
    entries.push({
      dependency,
      removedTaskId: predSelected ? dependency.successorId : dependency.predecessorId,
      keptTaskId: predSelected ? dependency.predecessorId : dependency.successorId,
    })
  }
  return entries
}

/** 未选内容处置策略单选定义（RL-14 静态映射 `DRAFT_UNSELECTED_STRATEGIES`，禁止运行时注入）。 */
const STRATEGY_OPTIONS: ReadonlyArray<{
  value: DraftUnselectedStrategy
  title: string
  description: string
}> = [
  {
    value: 'discard',
    title: '彻底丢弃未选项',
    description: '未勾选的 WBS 节点、任务与风险将被彻底放弃，不落入任何存储。',
  },
  {
    value: 'save_as_draft',
    title: '保留为后续草稿',
    description: '未勾选内容保留在当前草案会话中，转正后草案置为 saved，可稍后从草案箱继续导入。',
  },
  {
    value: 'ask_later',
    title: '稍后提醒我',
    description: '未勾选任务作为备选建议记录在项目备注中，转正后在项目看板生成待办提醒。',
  },
]

/** 重检失败信息提取：优先消费 ApiError 的 message，未知错误回退通用文案。 */
function describeRecheckError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return error instanceof Error ? error.message : '重新校验失败，请稍后重试。'
}

/**
 * 部分接受控制栏与依赖解绑警示（v3-ui-next-draft-confirm tasks 1.5 / 2.3 / 2.5）。
 *
 * - 「全部接受 / 局部选择」模式切换与实时选择统计（任务数 / WBS 分支数）；全选 / 清空快
 *   捷操作（清空时提示「至少需要选择 1 项任务方可转正」）；
 * - 局部模式下提供未选内容处置策略单选（discard / save_as_draft / ask_later），同步至
 *   确认 Store `setUnselectedStrategy`；
 * - 存在未选任务被依赖的悬空依赖时展开琥珀色警示横幅与影响透视抽屉（两端任务名、依赖
 *   类型与滞后天数），提供「确认排除（自动解绑）」与「撤销排除（保留依赖）」；
 * - 确认前服务端重检（`POST .../validations`，携带当前 selection）；产生自动修正时打开
 *   `NextDraftAutoFixModal`；Warning 项提供「我已复核并确认上述警告项」复选框
 *   （`setAcknowledgedWarnings`，未勾选时转正按钮保持禁用）；Blocking 绝对阻断提示（RL-02）。
 */
export interface NextDraftPartialAcceptPanelProps {
  /** 草案会话标识（重新校验端点路径参数）。 */
  draftId: string
  /** 当前审查草案（任务/WBS/依赖数据源）。 */
  draft: ProjectDraft
  /**
   * 是否在本面板显示警告复核条。审查页的操作栏（紧挨转正按钮）已有一条并列出告警内容，
   * 同页两条一模一样的提示只会让人困惑，审查页传 false。
   */
  showWarningStrip?: boolean
}

export function NextDraftPartialAcceptPanel({
  draftId,
  draft,
  showWarningStrip = true,
}: NextDraftPartialAcceptPanelProps) {
  // 空草案防御：装配层（NextDraftReviewPanel）已保证 draft 非空，此处兜底防止
  // 未来直挂渲染（深链接/测试）在 draft 未就绪时访问 draft.tasks 崩溃。
  if (draft === null || draft === undefined) return null

  const mode = useAiDraftConfirmStore((state) => state.mode)
  const selection = useAiDraftConfirmStore((state) => state.selection)
  const acknowledgedWarnings = useAiDraftConfirmStore((state) => state.acknowledgedWarnings)
  const unlinkedAlertTaskId = useAiDraftConfirmStore((state) => state.unlinkedAlertTaskId)
  const validation = useAiProjectDraftStore((state) => state.validation)

  const [rechecking, setRechecking] = React.useState(false)
  const [recheckError, setRecheckError] = React.useState<string | null>(null)

  const taskLookup = React.useMemo(() => buildTaskLookup(draft.tasks), [draft.tasks])
  const allTaskIds = React.useMemo(() => draft.tasks.map((task) => task.id), [draft.tasks])
  const allWbsIds = React.useMemo(
    () => flattenWbsNodes(buildWbsTree(draft.wbs)).map((node) => node.id),
    [draft.wbs],
  )

  const effectiveTaskIds = mode === 'all' ? allTaskIds : selection.taskIds
  const effectiveWbsIds = mode === 'all' ? allWbsIds : selection.wbsNodeIds
  const selectedTaskSet = React.useMemo(() => new Set(effectiveTaskIds), [effectiveTaskIds])
  const dangling = React.useMemo(
    () => findDanglingDependencies(draft.dependencies, selectedTaskSet),
    [draft.dependencies, selectedTaskSet],
  )

  const blockingCount = validation?.blocking?.length ?? 0
  const warningCount = validation?.warning?.length ?? 0
  const needAcknowledge = warningCount > 0 && blockingCount === 0

  const drawerOpen = unlinkedAlertTaskId !== null
  const drawerEntries =
    unlinkedAlertTaskId === DANGLING_BANNER_KEY
      ? dangling
      : dangling.filter((entry) => entry.removedTaskId === unlinkedAlertTaskId)

  function switchMode(next: 'all' | 'partial') {
    useAiDraftConfirmStore.getState().setMode(next, draft)
  }

  function handleSelectAll() {
    useAiDraftConfirmStore.getState().selectAll(draft)
  }

  function handleClearAll() {
    const confirm = useAiDraftConfirmStore.getState()
    if (confirm.mode === 'all') {
      confirm.setMode('partial', draft)
    }
    confirm.clearAll()
  }

  function describeDependency(entry: DanglingDependencyEntry): string {
    const predecessor = taskLookup.get(entry.dependency.predecessorId)
    const successor = taskLookup.get(entry.dependency.successorId)
    const predName = predecessor
      ? extractMarkedValue(predecessor.name)
      : entry.dependency.predecessorId
    const succName = successor ? extractMarkedValue(successor.name) : entry.dependency.successorId
    const lag = extractMarkedValue(entry.dependency.lagDays)
    return `「${predName}」[${entry.dependency.type} +${lag}d] → 「${succName}」`
  }

  function handleKeepDependencies() {
    const confirm = useAiDraftConfirmStore.getState()
    for (const entry of drawerEntries) {
      confirm.toggleTask(entry.removedTaskId, draft)
    }
    useAiDraftConfirmStore.setState({ unlinkedAlertTaskId: null })
  }

  function handleExcludeDependencies() {
    useAiDraftConfirmStore.setState({ unlinkedAlertTaskId: null })
  }

  async function handleRecheck() {
    if (rechecking) return
    setRechecking(true)
    setRecheckError(null)
    try {
      const confirm = useAiDraftConfirmStore.getState()
      const project = useAiProjectDraftStore.getState()
      // 携带就地编辑（pendingModifications），服务端先应用修改再重跑 VE/HL，
      // 重检报告反映编辑后内容而非服务端未修改的活动版本。
      const response = await aiDraftApi.validate(draftId, {
        selection: confirm.selection,
        phase: 'all',
        modifications: project.pendingModifications,
      })
      // 权威校验报告回填审查 Store（ActionBar 等消费方据此判定阻断/告警）。
      useAiProjectDraftStore.setState({ validation: response.report })
      if (response.autoFixDiffs.length > 0) {
        // 服务端产生了自动修正：升级草案版本并强制人工复核（RL-02），严禁静默转正。
        useAiDraftConfirmStore.setState({
          autoFixModalState: {
            open: true,
            diffs: response.autoFixDiffs,
            version: response.version,
          },
        })
      }
    } catch (error) {
      setRecheckError(describeRecheckError(error))
    } finally {
      setRechecking(false)
    }
  }

  const modeButtonClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)] ${
      active
        ? 'border border-[var(--nx-border-focus)]/60 bg-[var(--nx-accent)]/10 text-[var(--nx-accent)]'
        : 'border border-transparent text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
    }`

  return (
    <section
      data-draft-partial-accept-panel
      aria-label="接受与处置控制"
      className="space-y-2 text-left"
    >
      <div className="rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--nx-text-primary)]">
            <ListChecks className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
            接受与处置控制
          </span>

          <div
            role="group"
            aria-label="接受模式"
            className="flex items-center gap-0.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-0.5"
          >
            <button
              type="button"
              data-accept-mode-all
              onClick={() => switchMode('all')}
              className={modeButtonClass(mode === 'all')}
            >
              全部接受
            </button>
            <button
              type="button"
              data-accept-mode-partial
              onClick={() => switchMode('partial')}
              className={modeButtonClass(mode === 'partial')}
            >
              局部选择
            </button>
          </div>

          <span
            data-selected-stats
            className="font-mono text-[11px] text-[var(--nx-text-secondary)]"
          >
            已选 {effectiveTaskIds.length}/{allTaskIds.length} 项任务，
            {effectiveWbsIds.length}/{allWbsIds.length} 个 WBS 分支
          </span>

          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              data-select-all
              onClick={handleSelectAll}
              className="rounded-sm border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
            >
              全选
            </button>
            <button
              type="button"
              data-clear-all
              onClick={handleClearAll}
              className="rounded-sm border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
            >
              清空
            </button>
            <button
              type="button"
              data-recheck
              onClick={handleRecheck}
              disabled={rechecking}
              className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] px-2 py-1 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${rechecking ? 'nx-review-spin' : ''}`} aria-hidden />
              {rechecking ? '校验中…' : '重新校验'}
            </button>
          </span>
        </div>

        {recheckError !== null ? (
          <p
            data-recheck-error
            role="alert"
            className="mt-2 text-[11px] text-[var(--nx-status-danger)]"
          >
            重新校验失败：{recheckError}
          </p>
        ) : null}

        {effectiveTaskIds.length === 0 ? (
          <p data-clear-hint className="mt-2 text-[11px] text-[var(--nx-status-warning)]">
            至少需要选择 1 项任务方可转正
          </p>
        ) : null}

        {mode === 'partial' ? (
          <fieldset
            data-strategy-group
            className="mt-2.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
          >
            <legend className="px-1 text-[10px] uppercase tracking-wider text-[var(--nx-text-muted)]">
              未选内容处置策略
            </legend>
            <div className="grid gap-1.5 md:grid-cols-3">
              {STRATEGY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  data-strategy-option={option.value}
                  className="flex cursor-pointer items-start gap-1.5 rounded-sm border border-transparent px-1.5 py-1 transition-colors hover:border-[var(--nx-border-hairline)] hover:bg-[var(--nx-bg-1)]"
                >
                  <input
                    type="radio"
                    name="unselected-strategy"
                    data-strategy={option.value}
                    checked={selection.unselectedStrategy === option.value}
                    onChange={() =>
                      useAiDraftConfirmStore.getState().setUnselectedStrategy(option.value)
                    }
                    className="mt-0.5 h-3 w-3 accent-[var(--nx-accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium text-[var(--nx-text-primary)]">
                      {option.title}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>

      {dangling.length > 0 ? (
        <div
          data-dangling-banner
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--nx-status-warning)]/60 bg-[var(--nx-status-warning)]/10 px-3 py-2 text-xs text-[var(--nx-status-warning)]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>检测到 {dangling.length} 条依赖因任务未勾选而悬空，确认转正时将自动解绑移除</span>
          <button
            type="button"
            data-dangling-view
            onClick={() =>
              useAiDraftConfirmStore.setState({ unlinkedAlertTaskId: DANGLING_BANNER_KEY })
            }
            className="ml-auto rounded-sm border border-[var(--nx-status-warning)]/60 px-2 py-0.5 text-[11px] transition-colors hover:border-[var(--nx-status-warning)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
          >
            查看解绑影响
          </button>
        </div>
      ) : null}

      {drawerOpen ? (
        <div
          data-unlink-drawer
          className="rounded-lg border border-[var(--nx-status-warning)]/60 bg-[var(--nx-workspace-surface)] px-3 py-2.5"
        >
          <header className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-[var(--nx-text-primary)]">
              依赖解绑影响透视
            </h4>
            <button
              type="button"
              data-unlink-close
              aria-label="关闭解绑透视"
              onClick={handleExcludeDependencies}
              className="rounded-sm p-0.5 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </header>
          <ul className="mt-2 space-y-1.5">
            {drawerEntries.map((entry) => (
              <li
                key={entry.dependency.id}
                data-dangling-dep
                className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 font-mono text-[11px] text-[var(--nx-text-secondary)]"
              >
                {describeDependency(entry)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            若不包含上述任务，指向或来自该任务的依赖线将在确认转正时被自动解绑移除，并计入结果摘要中的丢弃计数。
          </p>
          <footer className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              data-unlink-keep
              onClick={handleKeepDependencies}
              className="rounded-sm border border-[var(--nx-border-hairline)] px-2.5 py-1 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
            >
              撤销排除（保留依赖）
            </button>
            <button
              type="button"
              data-unlink-confirm
              onClick={handleExcludeDependencies}
              className="rounded-sm border border-[var(--nx-status-warning)]/60 bg-[var(--nx-status-warning)]/10 px-2.5 py-1 text-[11px] text-[var(--nx-status-warning)] transition-colors hover:border-[var(--nx-status-warning)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
            >
              确认排除（自动解绑）
            </button>
          </footer>
        </div>
      ) : null}

      {blockingCount > 0 ? (
        <p
          data-blocking-notice
          role="alert"
          className="rounded-lg border border-[var(--nx-status-danger)]/60 bg-[var(--nx-status-danger)]/10 px-3 py-2 text-xs text-[var(--nx-status-danger)]"
        >
          存在 {blockingCount} 项阻断级违规，转正已被绝对阻断（RL-02），请修正后重新校验。
        </p>
      ) : null}

      {warningCount > 0 && showWarningStrip ? (
        <div
          data-warning-strip
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--nx-status-warning)]/60 bg-[var(--nx-status-warning)]/10 px-3 py-2 text-xs text-[var(--nx-status-warning)]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>当前草案存在需关注的风险或假设（{warningCount} 项告警），请核对确认</span>
          {needAcknowledge ? (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                data-ack-warnings-checkbox
                checked={acknowledgedWarnings}
                onChange={(event) =>
                  useAiDraftConfirmStore.getState().setAcknowledgedWarnings(event.target.checked)
                }
                className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
              />
              <span>我已复核并确认上述警告项</span>
            </label>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export default NextDraftPartialAcceptPanel
