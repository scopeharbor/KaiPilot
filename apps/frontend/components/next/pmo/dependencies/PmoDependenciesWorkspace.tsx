'use client'

import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, GitGraph, List, Plus, ShieldCheck, X } from 'lucide-react'
import {
  useMpdArchivePreview,
  useMpdConfirmArchive,
  useMpdConfirmCreate,
  useMpdConfirmDelete,
  useMpdConfirmRestore,
  useMpdConfirmUpdate,
  useMpdCreatePreview,
  useMpdDeletePreview,
  useMpdRestorePreview,
  useMpdUpdatePreview,
} from '@/hooks/use-multi-project-dependencies'
import type { DepCreatePreviewInput, DepUpdatePreviewInput } from '@aiproj/types'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { cn } from '@/lib/utils'
import {
  createIdempotencyKey,
  normalizeMpdConfirmPayload,
  normalizeMpdPreviewPayload,
  type MpdRowView,
} from './mpd-adapter'
import {
  PmoDependencyTable,
  type MpdListFilters,
  type MpdRowAction,
  type MpdToolbarFilterValues,
} from './PmoDependencyTable'
import { PmoDependencyDetailDrawer } from './PmoDependencyDetailDrawer'
import { MpdWriteDialogs, type MpdWriteFlow, type MpdWriteKind } from './PmoDependencyWriteDialogs'
import { PmoDependencyGraphPanel, type MpdGraphSharedFilters } from './PmoDependencyGraphPanel'

/**
 * 跨项目依赖双模式工作台容器（v3-ui-next-pmo-domain W7 · tasks 7.1）。
 *
 * - 路由薄壳不做权限硬断：组织成员即读（Design D5，服务端按项目可见性脱敏），
 *   orgId 未水合引导态由路由层负责（本组件仅接收有效 orgId）；
 * - list / graph 双模式与 URL 视图态（?view=）持久化（list 为缺省，非法值回退）；
 * - 写门禁：管理动作以 `portfolio:manage` 代理 org-admin 显隐（服务端 isOrgAdmin
 *   终裁）；写闭环 preview → confirm 双步（RL-06/Decision 4）；
 * - 三态（骨架/空态/错误重试）与精确档降级与同批页面一致（Decision 7）；
 * - 顶部信息条明示「仅显示你有权查看的项目数据」脱敏语义（Decision 5）。
 */

const LIST_PER_PAGE = 20

const DEFAULT_SORT = '-createdAt'

function readToolbarFromSearchParams(params: URLSearchParams): MpdToolbarFilterValues {
  const get = (key: string): string => {
    const value = params.get(key)
    return typeof value === 'string' && value !== '' ? value : ''
  }
  return {
    search: get('search'),
    endpointType: get('endpointType'),
    category: get('category'),
    type: get('type'),
    status: get('status'),
    riskLevel: get('riskLevel'),
    sourceMode: get('sourceMode'),
    freshness: get('freshness'),
    dateFrom: get('dateFrom'),
    dateTo: get('dateTo'),
  }
}

function pushQuery(router: ReturnType<typeof useRouter>, params: URLSearchParams) {
  const next = params.toString()
  router.push(next ? `?${next}` : '')
}

export interface PmoDependenciesWorkspaceProps {
  organizationId: number
}

export function PmoDependenciesWorkspace({ organizationId }: PmoDependenciesWorkspaceProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tier = useImmersionTier()
  const { canAny } = usePermissions()
  const canManage = canAny(['portfolio:manage'])

  // ── 视图模式（URL ?view= 持久化；非法/缺失回退 list） ──
  const viewMode = useMemo(() => {
    const raw = searchParams.get('view')
    return raw === 'graph' ? 'graph' : 'list'
  }, [searchParams])

  // ── 过滤状态（URL 为权威来源；交互写入后同步回 URL） ──
  const [toolbar, setToolbar] = useState<MpdToolbarFilterValues>(() =>
    readToolbarFromSearchParams(searchParams),
  )
  const [page, setPage] = useState(() => {
    const raw = Number(searchParams.get('page'))
    return Number.isFinite(raw) && raw >= 1 ? raw : 1
  })
  const [sort, setSort] = useState(() => {
    const raw = searchParams.get('sort')
    return typeof raw === 'string' && raw !== '' ? raw : DEFAULT_SORT
  })

  const filters: MpdListFilters = { ...toolbar, page, perPage: LIST_PER_PAGE, sort }

  const syncQuery = useCallback(
    (nextToolbar: MpdToolbarFilterValues, nextPage: number, nextSort: string) => {
      const params = new URLSearchParams()
      if (viewMode === 'graph') params.set('view', 'graph')
      if (nextPage !== 1) params.set('page', String(nextPage))
      if (nextSort !== DEFAULT_SORT) params.set('sort', nextSort)
      const entries = Object.entries(nextToolbar) as Array<[keyof MpdToolbarFilterValues, string]>
      for (const [key, value] of entries) {
        if (value !== '') params.set(key, value)
      }
      pushQuery(router, params)
    },
    [router, viewMode],
  )

  const handlePatchToolbar = useCallback(
    (patch: Partial<MpdToolbarFilterValues>) => {
      const nextToolbar = { ...toolbar, ...patch }
      setToolbar(nextToolbar)
      setPage(1)
      syncQuery(nextToolbar, 1, sort)
    },
    [toolbar, sort, syncQuery],
  )

  const handlePageChange = useCallback(
    (nextPage: number) => {
      setPage(nextPage)
      syncQuery(toolbar, nextPage, sort)
    },
    [toolbar, sort, syncQuery],
  )

  const handleSortFieldChange = useCallback(
    (field: string) => {
      const desc = sort.startsWith('-')
      const nextSort = `${desc ? '-' : ''}${field}`
      setSort(nextSort)
      syncQuery(toolbar, 1, nextSort)
    },
    [sort, toolbar, syncQuery],
  )

  const handleSortOrderToggle = useCallback(() => {
    const nextSort = sort.startsWith('-') ? sort.slice(1) : `-${sort}`
    setSort(nextSort)
    syncQuery(toolbar, 1, nextSort)
  }, [sort, toolbar, syncQuery])

  const handleViewChange = useCallback(
    (nextView: 'list' | 'graph') => {
      if (nextView === viewMode) return
      const params = new URLSearchParams()
      if (nextView === 'graph') params.set('view', 'graph')
      const toolbarEntries = Object.entries(toolbar) as Array<
        [keyof MpdToolbarFilterValues, string]
      >
      for (const [key, value] of toolbarEntries) {
        if (value !== '') params.set(key, value)
      }
      pushQuery(router, params)
    },
    [router, toolbar, viewMode],
  )

  // ── 详情抽屉 ──
  const [selectedDepId, setSelectedDepId] = useState<string | null>(null)
  const handleRowOpen = useCallback((row: MpdRowView) => setSelectedDepId(row.id), [])

  // ── 写流程（预览 → 确认） ──
  const [flow, setFlow] = useState<MpdWriteFlow>({ step: 'idle' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)

  const previewCreate = useMpdCreatePreview(organizationId)
  const confirmCreate = useMpdConfirmCreate(organizationId)
  const previewUpdate = useMpdUpdatePreview(organizationId)
  const confirmUpdate = useMpdConfirmUpdate(organizationId)
  const previewArchive = useMpdArchivePreview(organizationId)
  const confirmArchive = useMpdConfirmArchive(organizationId)
  const previewRestore = useMpdRestorePreview(organizationId)
  const confirmRestore = useMpdConfirmRestore(organizationId)
  const previewDelete = useMpdDeletePreview(organizationId)
  const confirmDelete = useMpdConfirmDelete(organizationId)

  const toPreviewView = (payload: unknown) => {
    const preview = normalizeMpdPreviewPayload(payload)
    if (!preview) throw new Error('预览快照缺失或不可解析，请重试')
    return preview
  }

  const handleSubmitForm = useCallback(
    async (kind: 'create' | 'update', body: unknown) => {
      setActionError(null)
      let payload: unknown
      if (kind === 'create') {
        payload = await previewCreate.mutateAsync(body as unknown as DepCreatePreviewInput)
      } else {
        payload = await previewUpdate.mutateAsync(body as unknown as DepUpdatePreviewInput)
      }
      setFlow({ step: 'confirm', kind, preview: toPreviewView(payload) })
    },
    [previewCreate, previewUpdate],
  )

  const handleRunConfirm = useCallback(
    async (kind: MpdWriteKind, previewView: ReturnType<typeof toPreviewView>) => {
      setActionError(null)
      const request = {
        previewId: previewView.previewId,
        confirmationHash: previewView.confirmationHash,
        idempotencyKey: createIdempotencyKey(kind),
      }
      let payload: unknown
      switch (kind) {
        case 'create':
          payload = await confirmCreate.mutateAsync(request)
          break
        case 'update':
          payload = await confirmUpdate.mutateAsync(request)
          break
        case 'archive':
          payload = await confirmArchive.mutateAsync(request)
          break
        case 'restore':
          payload = await confirmRestore.mutateAsync(request)
          break
        case 'delete':
          payload = await confirmDelete.mutateAsync(request)
          break
      }
      const result = normalizeMpdConfirmPayload(payload)
      if (result) {
        setActionResult(
          result.isReplay
            ? `操作已执行（幂等重放）${result.dependencyId ? ` · #${result.dependencyId}` : ''}`
            : `${OPERATION_RESULT_LABELS[kind]}成功${result.dependencyId ? ` · #${result.dependencyId}` : ''}${
                result.auditEventId ? ` · 审计事件 ${result.auditEventId}` : ''
              }`,
        )
      } else {
        setActionResult(`${OPERATION_RESULT_LABELS[kind]}已提交`)
      }
      setFlow({ step: 'idle' })
    },
    [confirmCreate, confirmUpdate, confirmArchive, confirmRestore, confirmDelete],
  )

  const handleLifecycleAction = useCallback(
    async (action: MpdRowAction, row: MpdRowView) => {
      setActionError(null)
      try {
        let payload: unknown
        if (action === 'archive') payload = await previewArchive.mutateAsync(row.id)
        else if (action === 'restore') payload = await previewRestore.mutateAsync(row.id)
        else payload = await previewDelete.mutateAsync(row.id)
        setFlow({ step: 'confirm', kind: action, preview: toPreviewView(payload) })
      } catch (error) {
        setActionError(error instanceof Error ? error.message : `${action} 预览生成失败，请重试`)
      }
    },
    [previewArchive, previewRestore, previewDelete],
  )

  const handleEditRow = useCallback((row: MpdRowView) => {
    setActionError(null)
    setFlow({ step: 'form', kind: 'update', row })
  }, [])

  const handleCloseFlow = useCallback(() => {
    setFlow({ step: 'idle' })
  }, [])

  const graphFilters: MpdGraphSharedFilters = {
    category: toolbar.category,
    type: toolbar.type,
    status: toolbar.status,
    riskLevel: toolbar.riskLevel,
    freshness: toolbar.freshness,
  }

  return (
    <div
      data-pmo-deps-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头：返回角色首页 + 标题 + 视图切换/新建 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-pmo-deps-back-home
            aria-label="返回角色首页"
            onClick={() => router.push('/next')}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
          <span aria-hidden className="h-6 w-px bg-[var(--nx-border-hairline)]" />
          <div className="min-w-0">
            <h2
              data-pmo-deps-title
              className="truncate text-lg font-semibold text-[var(--nx-text-primary)]"
            >
              跨项目依赖
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nx-text-muted)]">
              组织级依赖底册与图谱 · 写操作预览后人工确认
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 双模式切换 */}
          <div
            role="tablist"
            aria-label="依赖视图模式"
            data-pmo-deps-view-tabs
            className="flex items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'list'}
              data-pmo-deps-view-list
              onClick={() => handleViewChange('list')}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[11px] transition-colors',
                viewMode === 'list'
                  ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                  : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              <List className="h-3.5 w-3.5" aria-hidden />
              底册
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'graph'}
              data-pmo-deps-view-graph
              onClick={() => handleViewChange('graph')}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[11px] transition-colors',
                viewMode === 'graph'
                  ? 'bg-[var(--nx-space-surface)] font-medium text-[var(--nx-accent)]'
                  : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]',
              )}
            >
              <GitGraph className="h-3.5 w-3.5" aria-hidden />
              图谱
            </button>
          </div>
          {canManage && viewMode === 'list' ? (
            <button
              type="button"
              data-pmo-deps-create
              onClick={() => setFlow({ step: 'form', kind: 'create' })}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建依赖
            </button>
          ) : null}
        </div>
      </header>

      {/* 脱敏提示（Decision 5：组织成员可读、服务端按项目可见性脱敏） */}
      <p
        data-mpd-redaction-note
        className="flex items-start gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--nx-text-muted)]"
      >
        <ShieldCheck
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
          aria-hidden
        />
        查看范围为组织内你有权可见的项目依赖，其余数据由服务端脱敏；
        {canManage
          ? '管理写操作以组合管理权限（portfolio:manage）代理，服务端 org 管理员终裁。'
          : '当前为只读视图，管理写操作不对你开放。'}
      </p>

      {/* 操作反馈 */}
      {actionError ? (
        <div
          data-mpd-action-error
          role="alert"
          className="flex items-start justify-between gap-2 rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
        >
          <span className="flex items-start gap-1.5">
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-danger)]" aria-hidden />
            {actionError}
          </span>
          <button
            type="button"
            data-mpd-action-error-dismiss
            aria-label="关闭错误提示"
            onClick={() => setActionError(null)}
            className="text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
      {actionResult ? (
        <div
          data-mpd-action-result
          role="status"
          className="flex items-center justify-between gap-2 rounded-md border border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.08)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
        >
          <span>{actionResult}</span>
          <button
            type="button"
            data-mpd-action-result-dismiss
            aria-label="关闭提示"
            onClick={() => setActionResult(null)}
            className="text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      {viewMode === 'graph' ? (
        <PmoDependencyGraphPanel organizationId={organizationId} filters={graphFilters} />
      ) : (
        <PmoDependencyTable
          organizationId={organizationId}
          filters={filters}
          onPatchFilters={handlePatchToolbar}
          onPageChange={handlePageChange}
          onSortFieldChange={handleSortFieldChange}
          onSortOrderToggle={handleSortOrderToggle}
          canManage={canManage}
          onRowOpen={handleRowOpen}
          onEditRow={handleEditRow}
          onLifecycleAction={(action, row) => void handleLifecycleAction(action, row)}
        />
      )}

      {/* 详情抽屉（list 行 / graph 节点共享语义的只读详情） */}
      <PmoDependencyDetailDrawer
        organizationId={organizationId}
        depId={selectedDepId}
        onClose={() => setSelectedDepId(null)}
      />

      {/* 写流程对话框（表单 → 预览 → 确认） */}
      <MpdWriteDialogs
        flow={flow}
        onClose={handleCloseFlow}
        onSubmitForm={(kind, body) => handleSubmitForm(kind, body)}
        onRunConfirm={(kind, preview) => handleRunConfirm(kind, preview)}
      />

      <footer className="border-t border-[var(--nx-border-hairline)] pt-2 text-center font-mono text-[9px] text-[var(--nx-text-muted)]">
        数据新鲜度按端点检查时间判定 · 图谱仅展示当前筛选范围（深度 3 / 200 节点 / 500 边）
      </footer>
    </div>
  )
}

const OPERATION_RESULT_LABELS: Record<MpdWriteKind, string> = {
  create: '依赖已创建',
  update: '依赖已更新',
  archive: '依赖已归档',
  restore: '依赖已恢复',
  delete: '依赖已删除',
}

export default PmoDependenciesWorkspace
