'use client'

import * as React from 'react'
import { AlertTriangle, CheckCheck, Minus, Plus, Undo2 } from 'lucide-react'
import type {
  DraftTaskStatus,
  ProjectDraft,
  ProjectDraftTask,
  ProjectDraftWbsNode,
} from '@aiproj/types'
import {
  buildWbsNodeCodeMap,
  buildWbsTree,
  extractMarkedConfidence,
  extractMarkedValue,
  formatConfidence,
  formatDateSpan,
  formatDurationDays,
} from '@/lib/next/draft-review-helpers'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { NextDraftTaskExecution } from './NextDraftTaskExecution'
import { unmaskMembers } from '@/lib/member-mask'
import { findDanglingDependencies } from './NextDraftPartialAcceptPanel'
import { VariantInput } from '@/components/locale/variant-field'

/** 草案任务状态中文标签（与后端 Task 6 状态一致；RL-14 静态映射，禁止运行时注入）。 */
export const DRAFT_TASK_STATUS_LABELS: Readonly<Record<DraftTaskStatus, string>> = {
  not_started: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '阻塞',
  on_hold: '暂停',
  cancelled: '已取消',
}

/**
 * Marked 推断值展示：显式人工事实（explicit）→ 绿色「已人工修正」徽章（假设警报解除）；
 * 推断值 → 原值 + 微型置信度标签。
 */
function InferredValue({
  value,
  confidence,
  explicit,
}: {
  value: string
  confidence: number
  explicit?: boolean
}) {
  if (explicit) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span>{value}</span>
        <span
          data-field-explicit
          className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-status-success)]/40 bg-[var(--nx-status-success)]/10 px-1.5 py-0.5 text-[10px] text-[var(--nx-status-success)]"
        >
          <CheckCheck className="h-3 w-3" aria-hidden />
          已人工修正
        </span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{value}</span>
      <span
        data-marked-confidence
        title={`AI 推断置信度 ${formatConfidence(confidence)}`}
        className="rounded-sm border border-[var(--nx-border-hairline)] px-1 py-px font-mono text-[9px] text-[var(--nx-text-muted)]"
      >
        {formatConfidence(confidence)}
      </span>
    </span>
  )
}

/**
 * 通用单字段内联编辑单元（点击展示值进入编辑；失焦/回车提交，Esc 取消）。
 * `commit(raw)` 返回 null 表示提交成功，返回中文错误文案则保持编辑态并在单元格内提示。
 */
function InlineEditCell({
  label,
  initial,
  commit,
  display,
  inputType = 'text',
  maxLength,
  dataTrigger,
  dataInput,
}: {
  label: string
  initial: string
  commit: (raw: string) => string | null
  /** 非编辑态的展示节点（缺省渲染初始值文本；通常为 InferredValue）。 */
  display?: React.ReactNode
  inputType?: 'text' | 'number'
  maxLength?: number
  dataTrigger: string
  dataInput: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [draftValue, setDraftValue] = React.useState(initial)
  const [error, setError] = React.useState<string | null>(null)

  function startEdit() {
    setDraftValue(initial)
    setError(null)
    setEditing(true)
  }

  function submit() {
    const err = commit(draftValue)
    if (err !== null) {
      setError(err)
      return
    }
    setError(null)
    setEditing(false)
  }

  function cancel() {
    setError(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-edit-trigger={dataTrigger}
        aria-label={`编辑${label}`}
        onClick={startEdit}
        className="inline-flex items-center gap-1.5 rounded-sm text-left transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
      >
        {display ?? <span>{initial}</span>}
      </button>
    )
  }

  return (
    <span className="inline-flex flex-col gap-1">
      {/* AI 写的名称 / 负责人建议：按简繁切换显示，改完转回简体存储 */}
      <VariantInput
        data-edit-input={dataInput}
        type={inputType}
        value={draftValue}
        maxLength={maxLength}
        aria-label={label}
        aria-invalid={error !== null}
        autoFocus
        onValueChange={setDraftValue}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          else if (event.key === 'Escape') cancel()
        }}
        className="w-full min-w-24 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
      />
      {error !== null ? (
        <span data-edit-error role="alert" className="text-[10px] text-[var(--nx-status-danger)]">
          {error}
        </span>
      ) : null}
    </span>
  )
}

/**
 * 工期受控编辑：0.5~365 天、步长 0.5 的数值输入 + 步进微调按钮。
 * 步进按钮按 0.5 步长钳制在 [0.5, 365]；输入失焦/回车提交，越界或步长不符即时提示。
 */
function DurationEditCell({
  label,
  initial,
  commit,
  display,
}: {
  label: string
  initial: string
  commit: (raw: string) => string | null
  /** 非编辑态的展示节点（通常为 InferredValue，携带置信度或「已人工修正」徽章）。 */
  display?: React.ReactNode
}) {
  const [editing, setEditing] = React.useState(false)
  const [draftValue, setDraftValue] = React.useState(initial)
  const [error, setError] = React.useState<string | null>(null)

  function startEdit() {
    setDraftValue(initial)
    setError(null)
    setEditing(true)
  }

  function submit() {
    const err = commit(draftValue)
    if (err !== null) {
      setError(err)
      return
    }
    setError(null)
    setEditing(false)
  }

  function cancel() {
    setError(null)
    setEditing(false)
  }

  function step(delta: number) {
    const current = Number(draftValue)
    const next = Math.round((current + delta) * 2) / 2
    const clamped = Math.min(365, Math.max(0.5, next))
    setDraftValue(String(clamped))
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-edit-trigger="duration"
        aria-label={`编辑${label}`}
        onClick={startEdit}
        className="rounded-sm text-left font-mono text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
      >
        {display ?? initial}
      </button>
    )
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          data-duration-step-down
          aria-label="工期减 0.5 天"
          onClick={() => step(-0.5)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <Minus className="h-3 w-3" aria-hidden />
        </button>
        <input
          data-edit-input="duration"
          type="number"
          min={0.5}
          max={365}
          step={0.5}
          value={draftValue}
          aria-label={label}
          aria-invalid={error !== null}
          autoFocus
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={submit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            else if (event.key === 'Escape') cancel()
          }}
          className="w-20 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
        />
        <button
          type="button"
          data-duration-step-up
          aria-label="工期加 0.5 天"
          onClick={() => step(0.5)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <Plus className="h-3 w-3" aria-hidden />
        </button>
      </span>
      {error !== null ? (
        <span data-edit-error role="alert" className="text-[10px] text-[var(--nx-status-danger)]">
          {error}
        </span>
      ) : null}
    </span>
  )
}

/**
 * 计划起止日编辑单元：两个 ISO 日期输入（YYYY-MM-DD），容器失焦或回车时成对提交；
 * 校验 `endDate >= startDate`，仅提交与草案现值不同的字段。
 */
function DateSpanEditCell({
  label,
  initialStart,
  initialEnd,
  commit,
  display,
}: {
  label: string
  initialStart: string
  initialEnd: string
  commit: (startRaw: string, endRaw: string) => string | null
  /** 非编辑态的展示节点（通常为 InferredValue，携带置信度或「已人工修正」徽章）。 */
  display?: React.ReactNode
}) {
  const [editing, setEditing] = React.useState(false)
  const [startLocal, setStartLocal] = React.useState(initialStart)
  const [endLocal, setEndLocal] = React.useState(initialEnd)
  const [error, setError] = React.useState<string | null>(null)

  function startEdit() {
    setStartLocal(initialStart)
    setEndLocal(initialEnd)
    setError(null)
    setEditing(true)
  }

  function submit() {
    const err = commit(startLocal, endLocal)
    if (err !== null) {
      setError(err)
      return
    }
    setError(null)
    setEditing(false)
  }

  function cancel() {
    setError(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-edit-trigger="dates"
        aria-label={`编辑${label}`}
        onClick={startEdit}
        className="rounded-sm text-left font-mono text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
      >
        {display ?? formatDateSpan(initialStart, initialEnd)}
      </button>
    )
  }

  return (
    <span
      data-date-edit
      className="inline-flex flex-col gap-1"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) submit()
      }}
    >
      <span className="inline-flex items-center gap-1">
        <input
          data-edit-input="start"
          type="date"
          value={startLocal}
          aria-label={`${label}开始日期`}
          aria-invalid={error !== null}
          autoFocus
          onChange={(event) => setStartLocal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            else if (event.key === 'Escape') cancel()
          }}
          className="rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
        />
        <span className="text-[10px] text-[var(--nx-text-muted)]">至</span>
        <input
          data-edit-input="end"
          type="date"
          value={endLocal}
          aria-label={`${label}结束日期`}
          aria-invalid={error !== null}
          onChange={(event) => setEndLocal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
            else if (event.key === 'Escape') cancel()
          }}
          className="rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-xs text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
        />
      </span>
      {error !== null ? (
        <span data-edit-error role="alert" className="text-[10px] text-[var(--nx-status-danger)]">
          {error}
        </span>
      ) : null}
    </span>
  )
}

/**
 * 任务清单高密度仪器表（v3-ui-next-draft-confirm tasks 1.4 / 2.2）。
 *
 * - 表头与行级 Checkbox：勾选联动 `useAiDraftConfirmStore`（父链 WBS 级联由确认 Store
 *   `toggleTask` 负责）；表头全选/反选与半选（indeterminate）态；
 * - 就地编辑：任务名称 / 工期（0.5~365 天步长 0.5）/ 计划起止日（ISO，endDate >= startDate）/
 *   负责人建议；失焦或回车提交到 `applyDraftFieldEdit`，仅本地草案副本 + pendingModifications，
 *   零网络写请求（RL-01、RL-06）；编辑字段的 AIMarker 升级为 explicit（「已人工修正」徽章）；
 * - 行末「撤销修改」还原该任务全部字段为草案初始 AI 生成值；
 * - 未选且存在被依赖的任务行挂琥珀色解绑警告徽章（详情透视在 PartialAcceptPanel 抽屉）。
 */
export interface NextDraftTasksSectionProps {
  tasks: ProjectDraftTask[]
  /** WBS 节点列表（用于反查所属大纲编码）；仅消费，不改写。 */
  wbs: ProjectDraftWbsNode[]
  /** 当前草案（可注入便于测试；缺省读取审查主 Store 快照）。 */
  draft?: ProjectDraft
}

export function NextDraftTasksSection({
  tasks,
  wbs,
  draft: draftProp,
}: NextDraftTasksSectionProps) {
  const storeDraft = useAiProjectDraftStore((state) => state.draft)
  const pendingModifications = useAiProjectDraftStore((state) => state.pendingModifications)
  const mentionedMembers = useAiProjectDraftStore((state) => state.mentionedMembers)
  // 模型只见过成员代号「成员#id」，界面上换回真实姓名。
  const memberName = React.useCallback(
    (userId: number) => mentionedMembers.find((member) => member.userId === userId)?.name,
    [mentionedMembers],
  )
  const mode = useAiDraftConfirmStore((state) => state.mode)
  const selection = useAiDraftConfirmStore((state) => state.selection)

  const draft = draftProp ?? storeDraft
  const codeMap = React.useMemo(() => buildWbsNodeCodeMap(buildWbsTree(wbs)), [wbs])

  const allTaskIds = React.useMemo(() => tasks.map((task) => task.id), [tasks])
  const selectedTaskIds = React.useMemo(() => {
    const ids = mode === 'all' ? allTaskIds : selection.taskIds
    return new Set(ids)
  }, [mode, selection.taskIds, allTaskIds])

  const allSelected = allTaskIds.length > 0 && allTaskIds.every((id) => selectedTaskIds.has(id))
  const someSelected = allTaskIds.some((id) => selectedTaskIds.has(id))

  const dependencies = draft?.dependencies ?? []
  const danglingEntries = React.useMemo(
    () => findDanglingDependencies(dependencies, selectedTaskIds),
    [dependencies, selectedTaskIds],
  )

  const selectAllRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected
    }
  }, [someSelected, allSelected])

  function handleRowToggle(taskId: string) {
    if (!draft) return
    const confirm = useAiDraftConfirmStore.getState()
    if (confirm.mode === 'all') {
      confirm.setMode('partial', draft)
    }
    useAiDraftConfirmStore.getState().toggleTask(taskId, draft)
  }

  function handleSelectAllToggle() {
    if (!draft) return
    const confirm = useAiDraftConfirmStore.getState()
    if (confirm.mode === 'all' || allSelected) {
      if (confirm.mode === 'all') confirm.setMode('partial', draft)
      confirm.clearAll()
      return
    }
    confirm.selectAll(draft)
  }

  function openUnlinkDrawer(taskId: string) {
    useAiDraftConfirmStore.setState({ unlinkedAlertTaskId: taskId })
  }

  if (tasks.length === 0) {
    return (
      <section aria-label="任务清单" className="text-left">
        <p className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 py-3 text-xs text-[var(--nx-text-muted)]">
          暂无任务清单
        </p>
      </section>
    )
  }

  return (
    <section data-tasks-section aria-label="任务清单" className="text-left">
      <div className="overflow-x-auto rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--nx-border-hairline)]">
              <th
                scope="col"
                className="whitespace-nowrap px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]"
              >
                <span className="inline-flex items-center gap-1">
                  选择
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    data-task-select-all
                    aria-label="全选任务"
                    checked={allSelected}
                    onChange={handleSelectAllToggle}
                    className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
                  />
                </span>
              </th>
              {[
                '任务名称',
                'WBS 编码',
                '工期',
                '计划起止',
                '状态',
                '负责人建议',
                '角色',
                '操作',
              ].map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const name = extractMarkedValue(task.name)
              const description = extractMarkedValue(task.description)
              const startDate = extractMarkedValue(task.startDate)
              const endDate = extractMarkedValue(task.endDate)
              const assigneeHint = extractMarkedValue(task.assigneeHint)
              const roleIds = task.assigneeRoleIds ? extractMarkedValue(task.assigneeRoleIds) : []
              const taskModCount = pendingModifications.filter((m) =>
                m.path.startsWith(`tasks[${task.id}]`),
              ).length
              const taskDangling = danglingEntries.filter((d) => d.removedTaskId === task.id)

              const commitName = (raw: string): string | null => {
                const trimmed = raw.trim()
                if (trimmed.length === 0) return '任务名称不能为空'
                if (trimmed.length > 100) return '任务名称最长 100 字'
                useAiProjectDraftStore
                  .getState()
                  .applyDraftFieldEdit(`tasks[${task.id}].name`, trimmed)
                return null
              }
              const commitDuration = (raw: string): string | null => {
                const num = Number(raw)
                if (raw.trim() === '' || !Number.isFinite(num))
                  return '工期需为 0.5~365 天之间的数值'
                if (num < 0.5 || num > 365) return '工期需在 0.5~365 天之间'
                if (Math.round(num * 2) !== num * 2) return '工期步长为 0.5 天'
                useAiProjectDraftStore
                  .getState()
                  .applyDraftFieldEdit(`tasks[${task.id}].durationDays`, num)
                return null
              }
              const commitDates = (startRaw: string, endRaw: string): string | null => {
                const nextStart = startRaw !== startDate ? startRaw : startDate
                const nextEnd = endRaw !== endDate ? endRaw : endDate
                if (
                  !/^\d{4}-\d{2}-\d{2}$/.test(nextStart) ||
                  !/^\d{4}-\d{2}-\d{2}$/.test(nextEnd)
                ) {
                  return '日期需为 YYYY-MM-DD 格式'
                }
                if (nextStart > nextEnd) return '结束日期不能早于开始日期'
                const draftStore = useAiProjectDraftStore.getState()
                if (nextStart !== startDate) {
                  draftStore.applyDraftFieldEdit(`tasks[${task.id}].startDate`, nextStart)
                }
                if (nextEnd !== endDate) {
                  draftStore.applyDraftFieldEdit(`tasks[${task.id}].endDate`, nextEnd)
                }
                return null
              }
              const commitAssignee = (raw: string): string | null => {
                if (raw.length > 50) return '负责人建议最长 50 字'
                useAiProjectDraftStore
                  .getState()
                  .applyDraftFieldEdit(`tasks[${task.id}].assigneeHint`, raw)
                return null
              }

              return (
                <tr
                  key={task.id}
                  data-task-row
                  data-task-id={task.id}
                  className="border-b border-[var(--nx-border-hairline)] last:border-b-0"
                >
                  <td className="px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      data-task-checkbox
                      aria-label={`选择任务 ${name}`}
                      checked={selectedTaskIds.has(task.id)}
                      onChange={() => handleRowToggle(task.id)}
                      className="h-3.5 w-3.5 accent-[var(--nx-accent)]"
                    />
                  </td>
                  <td className="max-w-[210px] px-3 py-2 align-top">
                    <div className="text-xs font-medium text-[var(--nx-text-primary)]">
                      <InlineEditCell
                        label={`任务名称（${name}）`}
                        initial={name}
                        commit={commitName}
                        display={
                          <InferredValue
                            value={name}
                            confidence={extractMarkedConfidence(task.name)}
                            explicit={task.name.marker.source === 'explicit'}
                          />
                        }
                        dataTrigger="name"
                        dataInput="name"
                        maxLength={100}
                      />
                    </div>
                    {description !== '' ? (
                      <p className="mt-0.5 truncate text-[10px] text-[var(--nx-text-muted)]">
                        {description}
                      </p>
                    ) : null}
                    {task.trace ? (
                      <p
                        data-task-trace
                        className="mt-0.5 truncate text-[10px] text-[var(--nx-text-muted)]"
                      >
                        来源：{task.trace.capabilityName} › {task.trace.workPackageName}
                      </p>
                    ) : null}
                    {task.execution ? <NextDraftTaskExecution execution={task.execution} /> : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-[11px] text-[var(--nx-text-muted)]">
                    <span data-task-wbs-code>{codeMap.get(task.wbsNodeId) ?? task.wbsNodeId}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-[11px] text-[var(--nx-text-secondary)]">
                    <DurationEditCell
                      label="工期"
                      initial={String(extractMarkedValue(task.durationDays))}
                      commit={commitDuration}
                      display={
                        <InferredValue
                          value={formatDurationDays(extractMarkedValue(task.durationDays))}
                          confidence={extractMarkedConfidence(task.durationDays)}
                          explicit={task.durationDays.marker.source === 'explicit'}
                        />
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-[11px] text-[var(--nx-text-secondary)]">
                    <DateSpanEditCell
                      label="计划起止"
                      initialStart={startDate}
                      initialEnd={endDate}
                      commit={commitDates}
                      display={
                        <InferredValue
                          value={formatDateSpan(startDate, endDate)}
                          confidence={extractMarkedConfidence(task.startDate)}
                          explicit={
                            task.startDate.marker.source === 'explicit' ||
                            task.endDate.marker.source === 'explicit'
                          }
                        />
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <span
                      data-task-status
                      className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
                    >
                      {DRAFT_TASK_STATUS_LABELS[task.status]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top text-[11px] text-[var(--nx-text-secondary)]">
                    <InlineEditCell
                      label={`负责人建议（${assigneeHint}）`}
                      initial={assigneeHint}
                      commit={commitAssignee}
                      display={
                        <InferredValue
                          value={unmaskMembers(assigneeHint, memberName)}
                          confidence={extractMarkedConfidence(task.assigneeHint)}
                          explicit={task.assigneeHint.marker.source === 'explicit'}
                        />
                      }
                      dataTrigger="assignee"
                      dataInput="assignee"
                      maxLength={50}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    {roleIds.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {roleIds.map((roleId) => (
                          <span
                            key={roleId}
                            data-task-role
                            className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
                          >
                            {roleId}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[10px] text-[var(--nx-text-muted)]">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">
                    <div className="flex flex-col items-start gap-1">
                      {taskModCount > 0 ? (
                        <button
                          type="button"
                          data-task-reset
                          aria-label={`撤销 ${name} 的修改`}
                          title="撤销修改（还原 AI 生成值）"
                          onClick={() => useAiProjectDraftStore.getState().resetTaskEdits(task.id)}
                          className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
                        >
                          <Undo2 className="h-3 w-3" aria-hidden />
                          撤销修改
                        </button>
                      ) : null}
                      {taskDangling.length > 0 ? (
                        <button
                          type="button"
                          data-dangling-badge
                          aria-label={`${name} 存在被依赖关系，查看解绑影响`}
                          onClick={() => openUnlinkDrawer(task.id)}
                          className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-status-warning)]/60 bg-[var(--nx-status-warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)] transition-colors hover:border-[var(--nx-status-warning)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          被依赖
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default NextDraftTasksSection
