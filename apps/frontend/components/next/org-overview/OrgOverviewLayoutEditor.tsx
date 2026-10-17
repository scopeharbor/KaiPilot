'use client'

import * as React from 'react'
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  GripVertical,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useCurrentLayout,
  useLayoutPreview,
  useResetLayout,
  useSavePersonalLayout,
  useSaveSharedLayout,
} from '@/hooks/use-organization-dashboard-layout'
import { organizationDashboardLayoutKeys } from '@/lib/api/organization-dashboard-layout'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES,
  ORGANIZATION_DASHBOARD_MODULE_REGISTRY,
  type OrganizationDashboardLayoutDensity,
  type OrganizationDashboardLayoutModuleInstance,
  type OrganizationDashboardLayoutModuleKey,
  type OrganizationDashboardLayoutPayload,
  type OrganizationDashboardLayoutScope,
} from '@aiproj/types'

/**
 * 组织概览布局编排编辑器（v3-ui-next-org-portfolio-domains W1 · tasks 1.5，
 * spec「组织概览布局编排（个人与共享双作用域）」）。
 *
 * - 抽屉形态：模块显隐（hideable 才可移除）/ 排序（行交换）/ 尺寸 / 密度编辑，
 *   数据源复用 `useCurrentLayout`（与工作台同 query key，缓存去重共享）；
 * - 预览走 `useLayoutPreview`（POST /dashboard/layouts/preview，服务端无副作用）；
 * - 「保存个人布局」组织成员可用；「保存为组织共享布局」仅 `org:member:manage`
 *   可见可点（RL-06：无权限按钮物理隐藏，写请求零发出）；
 * - 版本乐观锁：保存携带当前 layout.version（expectedVersion），409/版本冲突
 *   时展示冲突警示并引导重新载入，绝不静默覆盖他方修改；
 * - 重置走 `useResetLayout` 且需两步显式确认；
 * - OKR/BI 摘要模块由对应业务域工作台消费，编排器不开放管理（只读驻留、不
 *   随保存丢失），避免布局配置被静默改写。
 */

/** 组织概览编排器可管理的模块（与工作台渲染契约一致）。 */
const MANAGED_MODULE_KEYS = new Set<string>([
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.STATUS_DISTRIBUTION,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RESOURCE_OVERVIEW,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RISK_REMINDERS,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ACTIVITY,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY,
])

/** 超出本编排器数据契约的模块（okr/bi 摘要由对应业务域消费）。 */
const EXTERNAL_MODULE_KEYS = new Set<string>([
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.OKR_DASHBOARD_SUMMARY,
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.BI_DASHBOARD_SUMMARY,
])

const MAX_MODULES = 20

const DENSITY_OPTIONS: ReadonlyArray<{
  value: OrganizationDashboardLayoutDensity
  label: string
}> = [
  { value: ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE, label: '舒适' },
  { value: ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT, label: '紧凑' },
]

const SIZE_LABELS: Record<string, string> = {
  small: '小',
  medium: '中',
  large: '大',
  full: '全宽',
}

const SCOPE_LABELS: Record<OrganizationDashboardLayoutScope, string> = {
  system: '系统默认',
  personal: '个人布局',
  shared: '组织共享',
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return fallback
}

function isVersionConflict(error: unknown): boolean {
  const apiError = error as { status?: unknown; code?: unknown; message?: unknown } | null
  if (apiError?.status === 409) return true
  const code = typeof apiError?.code === 'string' ? apiError.code : ''
  const message = typeof apiError?.message === 'string' ? apiError.message : ''
  return code.includes('VERSION_CONFLICT') || message.includes('版本')
}

export interface OrgOverviewLayoutEditorProps {
  open: boolean
  onClose: () => void
}

export function OrgOverviewLayoutEditor({ open, onClose }: OrgOverviewLayoutEditorProps) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const canSaveShared = can('org:member:manage')

  const { data: layoutData } = useCurrentLayout()
  const savePersonal = useSavePersonalLayout()
  const saveShared = useSaveSharedLayout()
  const reset = useResetLayout()

  const layout = layoutData?.layout ?? null
  const layoutVersion = layout?.version ?? 0
  const lastSyncedVersion = React.useRef<number>(-1)

  const [modules, setModules] = React.useState<OrganizationDashboardLayoutModuleInstance[]>([])
  const [density, setDensity] = React.useState<OrganizationDashboardLayoutDensity>(
    ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE,
  )
  const [dirty, setDirty] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [versionConflict, setVersionConflict] = React.useState(false)
  const [saving, setSaving] = React.useState<'personal' | 'shared' | 'reset' | null>(null)
  const [resetArmed, setResetArmed] = React.useState(false)
  const [showPreview, setShowPreview] = React.useState(false)

  // 打开时重置本地交互态（Esc / 遮罩 / 关闭按钮）。
  React.useEffect(() => {
    if (open) {
      setResetArmed(false)
      setSaveError(null)
      setVersionConflict(false)
    }
  }, [open])

  // 与当前布局版本同步（乐观锁基线）：版本变化才重置编辑态，杜绝窗口聚焦
  // refetch 等无效刷新打断未保存编辑。
  React.useEffect(() => {
    if (!layoutData) return
    if (layoutVersion === lastSyncedVersion.current) return
    lastSyncedVersion.current = layoutVersion
    const instances = (layout?.modules ?? []).map((module) => ({ ...module }))
    setModules(instances)
    setDensity(layout?.density ?? ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE)
    setDirty(false)
    setSaveError(null)
    setVersionConflict(false)
  }, [layout, layoutData, layoutVersion])

  // Esc 关闭
  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const orderedModules = [...modules].sort((a, b) => a.row - b.row || a.col - b.col)
  const initialSignature = JSON.stringify(
    (layout?.modules ?? []).map((module) => ({
      moduleKey: module.moduleKey,
      size: module.size,
      row: module.row,
      col: module.col,
    })),
  )
  const editedSignature = JSON.stringify(
    orderedModules.map((module) => ({
      moduleKey: module.moduleKey,
      size: module.size,
      row: module.row,
      col: module.col,
    })),
  )
  const isDirty =
    dirty ||
    density !== (layout?.density ?? ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE) ||
    editedSignature !== initialSignature

  // 预览 payload：本地编辑态序列化（非 null 才启用预览 query）。
  const previewPayload: OrganizationDashboardLayoutPayload | null = showPreview
    ? {
        density,
        modules: orderedModules.map((module) => ({
          moduleKey: module.moduleKey,
          size: module.size,
          row: module.row,
          col: module.col,
        })),
        expectedVersion: layout?.version,
      }
    : null
  const preview = useLayoutPreview(previewPayload)

  const reloadLatest = React.useCallback(() => {
    setVersionConflict(false)
    setSaveError(null)
    void queryClient.invalidateQueries({
      queryKey: organizationDashboardLayoutKeys.all,
    })
  }, [queryClient])

  const addModule = React.useCallback((moduleKey: OrganizationDashboardLayoutModuleKey) => {
    setModules((prev) => {
      if (prev.length >= MAX_MODULES || prev.some((module) => module.moduleKey === moduleKey)) {
        return prev
      }
      const definition = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[moduleKey]
      if (!definition) return prev
      const maxRow = prev.reduce((max, module) => Math.max(max, module.row), 0)
      return [
        ...prev,
        {
          moduleKey,
          size: definition.defaultSize,
          row: maxRow + 1,
          col: 1,
        },
      ]
    })
    setDirty(true)
  }, [])

  const removeModule = React.useCallback((moduleKey: OrganizationDashboardLayoutModuleKey) => {
    setModules((prev) => {
      const definition = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[moduleKey]
      if (!definition || !definition.hideable) return prev
      return prev.filter((module) => module.moduleKey !== moduleKey)
    })
    setDirty(true)
  }, [])

  const moveModule = React.useCallback(
    (moduleKey: OrganizationDashboardLayoutModuleKey, direction: -1 | 1) => {
      setModules((prev) => {
        const sorted = [...prev].sort((a, b) => a.row - b.row || a.col - b.col)
        const index = sorted.findIndex((module) => module.moduleKey === moduleKey)
        const target = index + direction
        if (index < 0 || target < 0 || target >= sorted.length) return prev
        const current = sorted[index]
        const other = sorted[target]
        if (!current || !other) return prev
        sorted[index] = { ...current, row: other.row }
        sorted[target] = { ...other, row: current.row }
        return sorted
      })
      setDirty(true)
    },
    [],
  )

  const resizeModule = React.useCallback(
    (
      moduleKey: OrganizationDashboardLayoutModuleKey,
      size: OrganizationDashboardLayoutModuleInstance['size'],
    ) => {
      setModules((prev) =>
        prev.map((module) => {
          if (module.moduleKey !== moduleKey) return module
          const definition = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[moduleKey]
          if (definition && !definition.allowedSizes.includes(size)) return module
          return { ...module, size }
        }),
      )
      setDirty(true)
    },
    [],
  )

  const handleSave = React.useCallback(
    async (shared: boolean) => {
      setSaveError(null)
      setVersionConflict(false)
      setSaving(shared ? 'shared' : 'personal')
      const payload: OrganizationDashboardLayoutPayload = {
        density,
        modules: orderedModules.map((module) => ({
          moduleKey: module.moduleKey,
          size: module.size,
          row: module.row,
          col: module.col,
        })),
        expectedVersion: layout?.version,
      }
      try {
        if (shared) {
          await saveShared.mutateAsync(payload)
        } else {
          await savePersonal.mutateAsync(payload)
        }
        setDirty(false)
        setSaving(null)
        onClose()
      } catch (error: unknown) {
        if (isVersionConflict(error)) {
          setVersionConflict(true)
          setSaveError('保存失败：布局已在其他窗口被更新（版本冲突）')
        } else {
          setSaveError(
            resolveErrorMessage(
              error,
              shared ? '保存共享布局失败，请重试' : '保存个人布局失败，请重试',
            ),
          )
        }
        setSaving(null)
      }
    },
    [density, orderedModules, layout?.version, savePersonal, saveShared, onClose],
  )

  const handleReset = React.useCallback(async () => {
    setSaveError(null)
    setVersionConflict(false)
    setSaving('reset')
    try {
      await reset.mutateAsync()
      setDirty(false)
      setResetArmed(false)
      setSaving(null)
    } catch (error: unknown) {
      setSaveError(resolveErrorMessage(error, '重置布局失败'))
      setSaving(null)
    }
  }, [reset])

  // 关闭态不渲染任何 UI（hooks 已全部执行完毕，钩子顺序恒定）。
  if (!open) return null

  const availableModules = ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES.filter(
    (moduleKey) =>
      MANAGED_MODULE_KEYS.has(moduleKey) &&
      !modules.some((module) => module.moduleKey === moduleKey),
  )
  const externalModules = orderedModules.filter((module) =>
    EXTERNAL_MODULE_KEYS.has(module.moduleKey),
  )
  const busy = saving !== null
  const savePersonalBusy = saving === 'personal'
  const saveSharedBusy = saving === 'shared'

  return (
    <div data-org-layout-editor className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-org-layout-scrim
        aria-label="关闭布局编排"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="组织概览布局编排"
        data-org-layout-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <LayoutDashboard className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">布局编排</h3>
              <p
                data-org-layout-scope-info
                className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
              >
                {layout
                  ? `${SCOPE_LABELS[layout.scope]} · v${layout.version} · ${orderedModules.length} 模块`
                  : '正在载入当前布局…'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDirty ? (
              <span
                data-org-layout-dirty
                className="rounded-sm border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]"
              >
                未保存
              </span>
            ) : null}
            <button
              type="button"
              data-org-layout-close
              aria-label="关闭布局编排"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {saveError ? (
            <p
              role="alert"
              data-org-layout-error
              className={cn(
                'rounded-sm border px-2.5 py-1.5 text-[11px]',
                versionConflict
                  ? 'border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] text-[var(--nx-status-warning)]'
                  : 'border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] text-[var(--nx-status-danger)]',
              )}
            >
              {saveError}
            </p>
          ) : null}

          {versionConflict ? (
            <div
              data-org-layout-version-conflict
              className="flex flex-col gap-2 rounded-sm border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] px-3 py-2.5"
            >
              <p className="text-[11px] leading-relaxed text-[var(--nx-status-warning)]">
                布局已在其他窗口更新（版本冲突）。本次未保存的修改已被保留，
                请载入最新布局后再重新编排，避免覆盖他人修改。
              </p>
              <button
                type="button"
                data-org-layout-reload
                onClick={reloadLatest}
                className="flex h-7 w-fit items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                载入最新布局
              </button>
            </div>
          ) : null}

          {/* 密度 */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
              显示密度
            </div>
            <div className="flex w-fit items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1">
              {DENSITY_OPTIONS.map((option) => {
                const active = density === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    data-org-layout-density={option.value}
                    aria-pressed={active}
                    onClick={() => {
                      setDensity(option.value)
                      setDirty(true)
                    }}
                    className={cn(
                      'h-7 rounded-sm px-3 text-xs transition-colors',
                      active
                        ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                        : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 已编排模块（可见性与排序） */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
              模块顺序与尺寸
            </div>
            <div data-org-layout-module-list className="flex flex-col gap-1.5">
              {orderedModules
                .filter((module) => MANAGED_MODULE_KEYS.has(module.moduleKey))
                .map((module, index) => {
                  const definition =
                    ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
                      module.moduleKey as OrganizationDashboardLayoutModuleKey
                    ]
                  const name = definition?.displayName ?? module.moduleKey
                  const moveDisabledUp = index === 0
                  const moveDisabledDown = index === orderedModules.length - 1
                  return (
                    <div
                      key={module.moduleKey}
                      data-org-layout-module={module.moduleKey}
                      className="flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2"
                    >
                      <GripVertical
                        className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--nx-text-primary)]">
                        {name}
                        {definition && !definition.hideable ? (
                          <span className="ml-1.5 rounded-sm border border-[var(--nx-border-hairline)] px-1 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                            必需
                          </span>
                        ) : null}
                      </span>
                      {definition && definition.allowedSizes.length > 1 ? (
                        <select
                          value={module.size}
                          onChange={(event) =>
                            resizeModule(
                              module.moduleKey as OrganizationDashboardLayoutModuleKey,
                              event.target
                                .value as OrganizationDashboardLayoutModuleInstance['size'],
                            )
                          }
                          aria-label={`${name} 尺寸`}
                          className="h-6 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 text-[10px] text-[var(--nx-text-secondary)]"
                        >
                          {definition.allowedSizes.map((size) => (
                            <option key={size} value={size}>
                              {SIZE_LABELS[size] ?? size}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          data-org-layout-move-up={module.moduleKey}
                          aria-label={`上移 ${name}`}
                          disabled={moveDisabledUp}
                          onClick={() =>
                            moveModule(module.moduleKey as OrganizationDashboardLayoutModuleKey, -1)
                          }
                          className={cn(
                            'rounded-sm p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
                            moveDisabledUp && 'cursor-not-allowed opacity-30',
                          )}
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        </button>
                        <button
                          type="button"
                          data-org-layout-move-down={module.moduleKey}
                          aria-label={`下移 ${name}`}
                          disabled={moveDisabledDown}
                          onClick={() =>
                            moveModule(module.moduleKey as OrganizationDashboardLayoutModuleKey, 1)
                          }
                          className={cn(
                            'rounded-sm p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
                            moveDisabledDown && 'cursor-not-allowed opacity-30',
                          )}
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        </button>
                      </div>
                      {definition && definition.hideable ? (
                        <button
                          type="button"
                          data-org-layout-hide={module.moduleKey}
                          aria-label={`隐藏 ${name}`}
                          onClick={() =>
                            removeModule(module.moduleKey as OrganizationDashboardLayoutModuleKey)
                          }
                          className="flex h-6 w-6 items-center justify-center rounded-sm text-[var(--nx-text-muted)] transition-colors hover:bg-[rgba(239,68,68,0.1)] hover:text-[var(--nx-status-danger)]"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              {orderedModules.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-[var(--nx-text-muted)]">
                  暂无模块。请从下方模块库中添加。
                </p>
              ) : null}
            </div>
          </div>

          {/* 外部域模块（只读驻留，防止保存时静默丢配置） */}
          {externalModules.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {externalModules.map((module) => {
                const definition =
                  ORGANIZATION_DASHBOARD_MODULE_REGISTRY[
                    module.moduleKey as OrganizationDashboardLayoutModuleKey
                  ]
                return (
                  <div
                    key={module.moduleKey}
                    data-org-layout-external={module.moduleKey}
                    className="flex items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/50 px-2.5 py-2"
                  >
                    <Eye className="h-3 w-3 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--nx-text-secondary)]">
                      {definition?.displayName ?? module.moduleKey}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--nx-text-muted)]">
                      内容由对应业务域工作台消费，编排器不开放管理
                    </span>
                  </div>
                )
              })}
            </div>
          ) : null}

          {/* 模块库 */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-[var(--nx-text-secondary)]">
              可用模块（{availableModules.length}）
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableModules.map((moduleKey) => {
                const definition = ORGANIZATION_DASHBOARD_MODULE_REGISTRY[moduleKey]
                return (
                  <button
                    key={moduleKey}
                    type="button"
                    data-org-layout-add={moduleKey}
                    aria-label={`添加模块：${definition?.displayName ?? moduleKey}`}
                    disabled={modules.length >= MAX_MODULES}
                    onClick={() => addModule(moduleKey)}
                    className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-40"
                  >
                    <EyeOff className="h-3 w-3" aria-hidden />
                    {definition?.displayName ?? moduleKey}
                  </button>
                )
              })}
              {availableModules.length === 0 ? (
                <p className="text-[11px] text-[var(--nx-text-muted)]">
                  所有可管理模块均已加入布局
                </p>
              ) : null}
            </div>
          </div>

          {/* 预览（无副作用 POST /dashboard/layouts/preview） */}
          <div>
            <button
              type="button"
              data-org-layout-preview-toggle
              aria-pressed={showPreview}
              onClick={() => setShowPreview((prev) => !prev)}
              className="flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
            >
              {showPreview ? (
                <EyeOff className="h-3 w-3" aria-hidden />
              ) : (
                <Eye className="h-3 w-3" aria-hidden />
              )}
              预览布局
            </button>
            {showPreview ? (
              <div
                data-org-layout-preview-panel
                className="mt-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5"
              >
                {preview.isPending ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    正在校验布局…
                  </p>
                ) : preview.isError ? (
                  <p className="text-[11px] text-[var(--nx-status-danger)]">
                    {resolveErrorMessage(preview.error, '预览失败，请重试')}
                  </p>
                ) : preview.data ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[11px] text-[var(--nx-text-secondary)]">
                      {preview.data.valid
                        ? `预览通过 · ${orderedModules.length} 个模块 · ${
                            density === ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMPACT
                              ? '紧凑'
                              : '舒适'
                          }`
                        : '预览未通过，请检查下方提示'}
                    </p>
                    {preview.data.warnings.map((warning, index) => (
                      <p
                        key={`${warning.code}-${index}`}
                        data-org-layout-preview-warning
                        className="rounded-sm border border-[var(--nx-border-hairline)] px-2 py-1 text-[10px] text-[var(--nx-text-muted)]"
                      >
                        {warning.message}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          {resetArmed ? (
            <>
              <span className="mr-auto text-[11px] text-[var(--nx-text-muted)]">
                确认重置为系统默认布局？
              </span>
              <button
                type="button"
                data-org-layout-reset-cancel
                onClick={() => setResetArmed(false)}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)]"
              >
                取消
              </button>
              <button
                type="button"
                data-org-layout-reset-confirm
                disabled={busy}
                onClick={() => void handleReset()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-3 text-xs text-[var(--nx-status-danger)] hover:bg-[rgba(239,68,68,0.2)] disabled:opacity-50"
              >
                {saving === 'reset' ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="h-3 w-3" aria-hidden />
                )}
                确认重置
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-org-layout-reset
                aria-label="重置为系统默认"
                disabled={busy}
                onClick={() => setResetArmed(true)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                重置
              </button>
              <button
                type="button"
                data-org-layout-cancel
                onClick={onClose}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)]"
              >
                取消
              </button>
              <button
                type="button"
                data-org-layout-save-personal
                aria-label="保存个人布局"
                disabled={!isDirty || busy}
                onClick={() => void handleSave(false)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] hover:border-[var(--nx-accent)] disabled:opacity-40"
              >
                {savePersonalBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-3 w-3" aria-hidden />
                )}
                保存个人布局
              </button>
              {canSaveShared ? (
                <button
                  type="button"
                  data-org-layout-save-shared
                  aria-label="保存为组织共享布局"
                  disabled={!isDirty || busy}
                  onClick={() => void handleSave(true)}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] hover:border-[var(--nx-accent)] disabled:opacity-40"
                >
                  {saveSharedBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <LayoutDashboard className="h-3 w-3" aria-hidden />
                  )}
                  保存为组织共享布局
                </button>
              ) : null}
            </>
          )}
        </footer>
      </aside>
    </div>
  )
}

export default OrgOverviewLayoutEditor
