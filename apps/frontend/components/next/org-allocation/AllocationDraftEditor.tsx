'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ListPlus, Loader2, PencilLine, Plus, Trash2 } from 'lucide-react'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import {
  crossProjectAllocationApi,
  crossProjectAllocationKeys,
} from '@/lib/api/cross-project-resource-allocation'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import type { CrossProjectAllocationDraftItem } from '@aiproj/types'
import {
  allocationItemTypeLabel,
  asSinglePayload,
  conflictSeverityTone,
  conflictSeverityLabel,
  type AllocationDateWindow,
  type AllocationTone,
} from '@/lib/next/org-allocation/org-allocation-adapter'

/**
 * 跨项目调配草案逐项编辑器（v3-ui-next-org-portfolio-domains W7 · tasks 7.2）。
 *
 * - 仅在可编排状态（draft / previewed）且具备写权限（resource:manage 或
 *   portfolio:view——镜像后端 CrossProjectAllocationPolicy 不对称口径）时提供
 *   编辑区；其余状态只读行展示；
 * - 「逐项调整」：每行可改调配比例（0-100%）与起止窗口、移除行；保存调用
 *   PUT /drafts/:draftId/items（全量替换语义，直连 lib/api 的 updateItems + 复用
 *   query key 工厂；不复用既有 hooks 的 `.then(r => r.data)` 二次解包封装）；
 * - 「添加调配项」：按后端 item 契约新增行（目标项目 ID / 类型 / 比例 / 窗口），
 *   保存后草案回到 draft 态并清除过期预览（后端行为）；
 * - 诚实标注：目标项目 ID 必须真实可见，后端逐项校验（不可见项静默跳过 /
 *   预览期以 TARGET_PROJECT_HIDDEN 冲突回显）；缺少任务/资源引用的调配项
 *   在应用阶段会被后端拒绝并回显部分失败——不制造虚假成功承诺（RL-06）；
 * - 行编辑为本地暂存 + 显式「保存调整」落库（RL-06 显式确认），保存中防抖；
 * - 加载/空态/错误反馈闭环；精确档关闭氛围光晕。
 */

interface EditorRow {
  key: string
  /** 后端 item id（新建行缺省——服务端新建不沿用 id）。 */
  itemId: string | null
  itemType: string
  /** 可回写目标项目 ID；null 表示源 item 缺失映射无法回写（只读锁定行）。 */
  targetProjectId: number | null
  targetProjectLabel: string
  demandLabel: string | null
  candidateLabel: string | null
  allocationPercent: string
  startDate: string
  endDate: string
  conflicts: Array<{ severity: string; message: string }>
  status: string | null
  locked: boolean
}

export interface AllocationDraftEditorProps {
  draftId: number
  draftName: string
  /** 草案状态（draft/previewed/confirmed/applied/cancelled/expired/failed）。 */
  status: string
  items: CrossProjectAllocationDraftItem[]
  canWrite: boolean
  /** 添加行的默认窗口（通常取草案 queryShape.dateWindow 或默认 90 天）。 */
  window: AllocationDateWindow
}

/** 错误提取（ApiError 非 Error 实例与 Error 统一）。 */
export function resolveEditorError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}

function itemToRow(item: CrossProjectAllocationDraftItem): EditorRow {
  const demandTarget = item.demand?.targetProjectId ?? null
  const demandName = item.demand?.targetProjectName ?? null
  const taskName = item.demand?.targetTaskName ?? null
  const candidate = item.candidate
  const displayName = demandName && demandName !== '' ? demandName : null
  return {
    key: item.id,
    itemId: item.id,
    itemType: item.itemType,
    targetProjectId: demandTarget,
    targetProjectLabel: displayName ?? (demandTarget !== null ? `项目 #${demandTarget}` : '—'),
    demandLabel: taskName && taskName !== '' ? taskName : null,
    candidateLabel:
      candidate !== null && candidate.resourceName !== ''
        ? candidate.resourceName
        : candidate !== null
          ? `资源 #${candidate.resourceId}`
          : null,
    allocationPercent: String(item.allocationPercent),
    startDate: item.startDate,
    endDate: item.endDate,
    conflicts: (item.conflicts ?? []).map((conflict) => ({
      severity: conflict.severity,
      message: conflict.message,
    })),
    status: item.status,
    // 源 item 缺少目标项目引用（如手工创建的空白快照）无法回写，锁定只读。
    locked: demandTarget === null,
  }
}

export function AllocationDraftEditor({
  draftId,
  draftName,
  status,
  items,
  canWrite,
  window,
}: AllocationDraftEditorProps) {
  const tier = useImmersionTier()
  const organizationId = useCurrentOrganizationId()
  const queryClient = useQueryClient()

  const editable = (status === 'draft' || status === 'previewed') && canWrite

  // ── 本地行暂存（打开 / items 刷新后按服务端行重建）──
  const [rows, setRows] = React.useState<EditorRow[]>([])
  const [savedMessage, setSavedMessage] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setRows(items.map(itemToRow))
    setSavedMessage(null)
    setSaveError(null)
  }, [items, status])

  // 保存 mutation（直连 lib/api；返回体以 asSinglePayload 收敛，成功按 draft key
  // 失效，保存后另按 all key 整体失效以拾取状态回退）。
  const updateItems = useMutation({
    mutationFn: ({
      draftId: draftIdValue,
      body,
    }: {
      draftId: number
      body: Record<string, unknown>
    }) =>
      crossProjectAllocationApi
        .updateItems(organizationId as number, draftIdValue, body)
        .then((result) => asSinglePayload<CrossProjectAllocationDraftItem[]>(result)),
    onSuccess: (_data, { draftId: draftIdValue }) => {
      if (organizationId !== null) {
        queryClient.invalidateQueries({
          queryKey: crossProjectAllocationKeys.draft(organizationId, draftIdValue),
        })
      }
    },
  })

  function patchRow(key: string, patch: Partial<EditorRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key))
    setSaveError(null)
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        key: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        itemId: null,
        itemType: 'allocate',
        targetProjectId: null,
        targetProjectLabel: '',
        demandLabel: null,
        candidateLabel: null,
        allocationPercent: '100',
        startDate: window.from,
        endDate: window.to,
        conflicts: [],
        status: null,
        locked: false,
      },
    ])
    setSavedMessage(null)
    setSaveError(null)
  }

  function setNewRowTargetProject(key: string, raw: string) {
    const parsed = /^[1-9]\d*$/.test(raw.trim()) ? Number(raw.trim()) : null
    patchRow(key, {
      targetProjectId: parsed,
      targetProjectLabel: raw.trim(),
    })
  }

  // 可回写行（目标项目 ID 齐备）→ PUT 载荷（全量替换，含本地新增行）。
  const writableRows = rows.filter((row) => row.targetProjectId !== null)
  const lockedRowCount = rows.length - writableRows.length

  async function handleSave() {
    if (!editable || writableRows.length === 0 || updateItems.isPending) return
    setSaveError(null)
    setSavedMessage(null)
    try {
      const payload = writableRows.map((row) => ({
        id: row.itemId ?? undefined,
        itemType: row.itemType,
        targetProjectId: row.targetProjectId as number,
        allocationPercent: Number(row.allocationPercent),
        startDate: row.startDate,
        endDate: row.endDate,
      }))
      await updateItems.mutateAsync({ draftId, body: { items: payload } })
      if (organizationId !== null) {
        // 状态可能被后端重置回 draft 并清除预览——列表与详情缓存一并失效。
        await queryClient.invalidateQueries({
          queryKey: crossProjectAllocationKeys.all(organizationId),
        })
      }
      setSavedMessage(`已保存 ${payload.length} 项调配调整，草案回到「草案」状态等待重新预览`)
    } catch (error) {
      setSaveError(resolveEditorError(error, '保存调配项失败，请重试'))
    }
  }

  const percentIssue = (row: EditorRow): string | null => {
    if (row.targetProjectId === null) return '请填写目标项目 ID'
    const value = Number(row.allocationPercent)
    if (!Number.isFinite(value)) return '比例需为数字'
    if (value < 0 || value > 100) return '比例需在 0-100'
    return null
  }

  return (
    <section
      data-allocation-draft-editor
      aria-label="调配草案逐项编排"
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-[var(--nx-border-hairline)] p-3',
        tier === 'precise' ? 'bg-[var(--nx-workspace-bg)]' : 'bg-[var(--nx-workspace-surface)]',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]">
            <PencilLine className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <h4 className="text-[13px] font-medium text-[var(--nx-text-primary)]">
            调配项编排{' '}
            <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">#{draftId}</span>
          </h4>
          <span
            data-allocation-editor-mode
            className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-px text-[10px] text-[var(--nx-text-muted)]"
          >
            {editable ? '可编辑' : '只读'}
          </span>
        </div>
        {editable ? (
          <button
            type="button"
            data-allocation-item-add
            onClick={addRow}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <Plus className="h-3 w-3" aria-hidden />
            添加调配项
          </button>
        ) : null}
      </header>

      {savedMessage ? (
        <p
          data-allocation-editor-saved
          role="status"
          className="rounded-sm border border-[var(--nx-status-success)]/40 bg-[rgba(16,185,129,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-success)]"
        >
          {savedMessage}
        </p>
      ) : null}
      {saveError ? (
        <p
          data-allocation-editor-error
          role="alert"
          className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
        >
          {saveError}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div
          data-allocation-editor-empty
          className="flex flex-col items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] px-4 py-8 text-center"
        >
          <ListPlus className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">草案暂无调配项</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            {editable
              ? '点击「添加调配项」按需求行手工编排（目标项目 / 类型 / 比例 / 窗口），保存后生成影响预览核对。'
              : '该草案无可编排调配项，请先在具备写权限的会话中添加。'}
          </p>
        </div>
      ) : (
        <div data-allocation-editor-rows className="flex flex-col gap-1.5">
          {rows.map((row) => {
            const issue = percentIssue(row)
            const topConflict = [...row.conflicts].sort(
              (a, b) => severityRank(b.severity) - severityRank(a.severity),
            )[0]
            return (
              <div
                key={row.key}
                data-allocation-item-row={row.key}
                data-allocation-item-locked={row.locked ? 'true' : 'false'}
                className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-px text-[10px] text-[var(--nx-text-secondary)]">
                      {allocationItemTypeLabel(row.itemType)}
                    </span>
                    <span
                      data-allocation-item-target
                      className={cn(
                        'truncate text-xs',
                        row.locked
                          ? 'text-[var(--nx-text-muted)]'
                          : 'text-[var(--nx-text-primary)]',
                      )}
                    >
                      {row.targetProjectLabel}
                    </span>
                    {row.demandLabel ? (
                      <span className="truncate text-[11px] text-[var(--nx-text-muted)]">
                        任务：{row.demandLabel}
                      </span>
                    ) : null}
                    {row.candidateLabel ? (
                      <span className="truncate text-[11px] text-[var(--nx-text-muted)]">
                        资源：{row.candidateLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {topConflict ? (
                      <span
                        data-allocation-item-conflict
                        data-conflict-severity={topConflict.severity}
                        className={cn(
                          'inline-flex items-center rounded-sm border px-1.5 py-px text-[10px]',
                          conflictToneClass(conflictSeverityTone(topConflict.severity)),
                        )}
                      >
                        {conflictSeverityLabel(topConflict.severity)}
                        {topConflict.message ? ` · ${topConflict.message}` : ''}
                      </span>
                    ) : null}
                    {row.locked ? (
                      <span className="text-[10px] text-[var(--nx-text-muted)]">
                        缺目标项目引用，只读
                      </span>
                    ) : null}
                    {editable && !row.locked ? (
                      <button
                        type="button"
                        data-allocation-item-remove={row.key}
                        aria-label="移除该调配项"
                        onClick={() => removeRow(row.key)}
                        className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-status-danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </div>
                {editable && !row.locked ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {row.itemId === null ? (
                      <div className="flex flex-col gap-1">
                        <label
                          className="text-[10px] text-[var(--nx-text-muted)]"
                          htmlFor={`${row.key}-project`}
                        >
                          目标项目 ID（必填）
                        </label>
                        <input
                          id={`${row.key}-project`}
                          type="text"
                          inputMode="numeric"
                          data-allocation-item-project={row.key}
                          value={row.targetProjectLabel}
                          onChange={(event) => setNewRowTargetProject(row.key, event.target.value)}
                          placeholder="例如 12"
                          className="h-7 w-28 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 font-mono text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                        />
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-1">
                      <label
                        className="text-[10px] text-[var(--nx-text-muted)]"
                        htmlFor={`${row.key}-percent`}
                      >
                        调配比例 %
                      </label>
                      <input
                        id={`${row.key}-percent`}
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        data-allocation-item-percent={row.key}
                        value={row.allocationPercent}
                        onChange={(event) =>
                          patchRow(row.key, { allocationPercent: event.target.value })
                        }
                        className="h-7 w-20 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 font-mono text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        className="text-[10px] text-[var(--nx-text-muted)]"
                        htmlFor={`${row.key}-from`}
                      >
                        起始
                      </label>
                      <input
                        id={`${row.key}-from`}
                        type="date"
                        data-allocation-item-from={row.key}
                        value={row.startDate}
                        onChange={(event) => patchRow(row.key, { startDate: event.target.value })}
                        className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 font-mono text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        className="text-[10px] text-[var(--nx-text-muted)]"
                        htmlFor={`${row.key}-to`}
                      >
                        结束
                      </label>
                      <input
                        id={`${row.key}-to`}
                        type="date"
                        data-allocation-item-to={row.key}
                        value={row.endDate}
                        onChange={(event) => patchRow(row.key, { endDate: event.target.value })}
                        className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 font-mono text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                      />
                    </div>
                    {row.itemId !== null ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-[var(--nx-text-muted)]">窗口类型</span>
                        <select
                          aria-label="调配项类型"
                          data-allocation-item-type={row.key}
                          value={row.itemType}
                          onChange={(event) => patchRow(row.key, { itemType: event.target.value })}
                          className="h-7 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-[11px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
                        >
                          {ITEM_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {editable && !row.locked && issue && row.itemId === null ? (
                  <p className="mt-1 text-[10px] text-[var(--nx-status-danger)]">{issue}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {editable ? (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] pt-2">
          <p className="text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
            保存将整体替换草案调配项（PUT items），草案回到「草案」状态并清除过期预览；
            保存前请核对目标项目 ID——后端仅保留可见项目的调配项，不可见项将被跳过。
            {lockedRowCount > 0
              ? ` ${lockedRowCount} 行缺少目标项目引用，仅只读展示且不参与保存。`
              : ''}
          </p>
          <button
            type="button"
            data-allocation-editor-save
            disabled={updateItems.isPending || writableRows.length === 0}
            onClick={() => void handleSave()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateItems.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : null}
            保存调整
          </button>
        </footer>
      ) : null}

      {!editable && rows.length > 0 ? (
        <p className="text-[10px] text-[var(--nx-text-muted)]">
          草案名称：{draftName} —— 当前状态仅可读，逐项编排需 resource:manage 或 portfolio:view
          且草案处于「草案/已预览」状态。
        </p>
      ) : null}
    </section>
  )
}

export default AllocationDraftEditor

const ITEM_TYPE_OPTIONS = [
  { value: 'allocate', label: '分配' },
  { value: 'reallocate', label: '重新分配' },
  { value: 'remove', label: '移除' },
  { value: 'map_resource', label: '资源映射' },
]

function severityRank(severity: string): number {
  if (severity === 'critical') return 3
  if (severity === 'error') return 2
  if (severity === 'warning') return 1
  return 0
}

function conflictToneClass(tone: AllocationTone): string {
  if (tone === 'danger') {
    return 'border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.08)] text-[var(--nx-status-danger)]'
  }
  if (tone === 'warning') {
    return 'border-[var(--nx-status-warning)]/50 bg-[rgba(245,158,11,0.08)] text-[var(--nx-status-warning)]'
  }
  return 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]'
}
