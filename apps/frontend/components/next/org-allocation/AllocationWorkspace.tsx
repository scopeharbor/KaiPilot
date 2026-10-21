'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePermissions } from '@/hooks/use-permissions'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  EyeOff,
  FileWarning,
  List,
  Plus,
  RefreshCw,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import {
  crossProjectAllocationApi,
  crossProjectAllocationKeys,
} from '@/lib/api/cross-project-resource-allocation'
import type {
  CrossProjectAllocationApplyResult,
  CrossProjectAllocationConfirmation,
  CrossProjectAllocationDraft,
  CrossProjectAllocationDraftDetail,
  CrossProjectAllocationPreview,
} from '@aiproj/types'
import {
  allocationDraftStatusLabel,
  allocationDraftStatusTone,
  applyResultLabel,
  applyResultTone,
  asSinglePayload,
  conflictSeverityLabel,
  createDefaultAllocationDateWindow,
  formatShortDate,
  isAllocationDraftCancellable,
  normalizeDraftListPayload,
  parseAllocationDraftIdParam,
  serializeAllocationUrlState,
  toAllocationDraftRowModel,
  type AllocationDateWindow,
  type AllocationTone,
} from '@/lib/next/org-allocation/org-allocation-adapter'
import { AllocationCandidatePanel } from './AllocationCandidatePanel'
import { AllocationConfirmDialog } from './AllocationConfirmDialog'
import { AllocationDraftEditor } from './AllocationDraftEditor'

/**
 * 跨项目资源调配草案工作台（v3-ui-next-org-portfolio-domains W7 · tasks 7.2，
 * spec「跨项目资源调配草案工作台」）。
 *
 * - 草案列表 + 新建（POST /drafts）+ URL `?draft=` 为选中草案唯一事实来源
 *   （restorable filters；本地镜像仅服务过渡渲染，回退/分享可恢复）；
 * - 写路径闭环（RL-06）：生成影响预览（POST preview）→ 确认 → 应用 → 取消，全部
 *   经 AllocationConfirmDialog 显式二次确认 + 提交防抖；成功/失败均有明确反馈并
 *   刷新草案列表/详情缓存；
 * - 按钮口径镜像后端 CrossProjectAllocationPolicy 不对称语义：查看=resource:view 或
 *   portfolio:view；写=resource:manage 或 portfolio:view（页面文案不承诺「仅资源
 *   管理员可写」，design Decision 6 核对点）；
 * - 影响预览摘要只读回显（受影响可见项目、冲突严重度徽标、预览哈希与过期时间）；
 * - 非法 draft 参数 / 草案不存在（跨租户视同不存在）→ 中性「未找到」提示（RL-05），
 *   零存在性泄露；列表 5xx 可重试、详情 5xx 重试与中性态分离；
 * - 加载骨架屏（aria-busy）、语义化空态、精确档（precise）关闭氛围光晕。
 */

export type AllocationActionKind = 'preview' | 'confirm' | 'apply' | 'cancel'

interface ActionDialogState {
  kind: AllocationActionKind
  draftId: number
  draftName: string
}

function toneTextClass(tone: AllocationTone): string {
  if (tone === 'success')
    return 'border-[var(--nx-status-success)]/50 bg-[rgba(16,185,129,0.08)] text-[var(--nx-status-success)]'
  if (tone === 'danger')
    return 'border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.08)] text-[var(--nx-status-danger)]'
  if (tone === 'warning')
    return 'border-[var(--nx-status-warning)]/50 bg-[rgba(245,158,11,0.08)] text-[var(--nx-status-warning)]'
  if (tone === 'info')
    return 'border-[var(--nx-accent)]/40 bg-[rgba(56,189,248,0.08)] text-[var(--nx-accent)]'
  if (tone === 'muted') return 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]'
  return 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]'
}

export function AllocationWorkspace() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tier = useImmersionTier()
  const { canAny } = usePermissions()

  const canWrite = canAny(['resource:manage', 'portfolio:view'])

  // ── URL 状态（唯一事实来源）+ 本地镜像 ──
  const [mirrorDraftId, setMirrorDraftId] = React.useState<number | null>(() =>
    parseAllocationDraftIdParam(searchParams.get('draft')),
  )
  React.useEffect(() => {
    setMirrorDraftId(parseAllocationDraftIdParam(searchParams.get('draft')))
  }, [searchParams])
  const draftId = mirrorDraftId

  const [dialog, setDialog] = React.useState<ActionDialogState | null>(null)
  const [notice, setNotice] = React.useState<{
    tone: 'success' | 'warning' | 'danger'
    text: string
  } | null>(null)
  const [previewResult, setPreviewResult] = React.useState<{
    draftId: number
    data: CrossProjectAllocationPreview
  } | null>(null)

  // ── 数据层（直连 lib/api + 复用 query key 工厂；单对象端点以域内适配器
  //     asSinglePayload 收敛 apiFetch 已解包后的裸载荷与历史信封两态——不复用
  //     `hooks/use-cross-project-resource-allocation.ts` 的 `.then(r => r.data)`
  //     二次解包封装，hooks 共享文件不动，口径与 org-contentions 工作台一致）──
  const organizationId = useCurrentOrganizationId()
  const queryClient = useQueryClient()

  const draftsQuery = useQuery({
    queryKey: crossProjectAllocationKeys.drafts(organizationId ?? 0),
    queryFn: () => crossProjectAllocationApi.listDrafts(organizationId as number),
    enabled: organizationId !== null,
    staleTime: 30_000,
  })
  const normalizedDrafts = React.useMemo(
    () => normalizeDraftListPayload(draftsQuery.data),
    [draftsQuery.data],
  )
  const draftRows = React.useMemo(
    () => normalizedDrafts.rows.map(toAllocationDraftRowModel),
    [normalizedDrafts.rows],
  )
  const draftsTotal = normalizedDrafts.total
  const draftQuery = useQuery({
    queryKey: crossProjectAllocationKeys.draft(organizationId ?? 0, draftId!),
    queryFn: () =>
      crossProjectAllocationApi
        .getDraft(organizationId as number, draftId!)
        .then((result) => asSinglePayload<CrossProjectAllocationDraftDetail>(result)),
    enabled: organizationId !== null && draftId !== null,
    staleTime: 15_000,
  })
  const draft = draftQuery.data ?? null

  const createDraft = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      crossProjectAllocationApi
        .createDraft(organizationId as number, body)
        .then((result) => asSinglePayload<CrossProjectAllocationDraft>(result)),
    onSuccess: () => {
      if (organizationId !== null) {
        queryClient.invalidateQueries({
          queryKey: crossProjectAllocationKeys.all(organizationId),
        })
      }
    },
  })
  const previewDraft = useMutation({
    mutationFn: (draftIdValue: number) =>
      crossProjectAllocationApi
        .previewDraft(organizationId as number, draftIdValue)
        .then((result) => asSinglePayload<CrossProjectAllocationPreview>(result)),
    onSuccess: (_data, draftIdValue) => {
      if (organizationId !== null) {
        queryClient.invalidateQueries({
          queryKey: crossProjectAllocationKeys.draft(organizationId, draftIdValue),
        })
      }
    },
  })
  const confirmDraft = useMutation({
    mutationFn: ({
      draftId: draftIdValue,
      body,
    }: {
      draftId: number
      body: Record<string, unknown>
    }) =>
      crossProjectAllocationApi
        .confirmDraft(organizationId as number, draftIdValue, body)
        .then((result) => asSinglePayload<CrossProjectAllocationConfirmation>(result)),
    onSuccess: (_data, { draftId: draftIdValue }) => {
      if (organizationId !== null) {
        queryClient.invalidateQueries({
          queryKey: crossProjectAllocationKeys.draft(organizationId, draftIdValue),
        })
      }
    },
  })
  const applyDraft = useMutation({
    mutationFn: ({
      draftId: draftIdValue,
      body,
    }: {
      draftId: number
      body: Record<string, unknown>
    }) =>
      crossProjectAllocationApi
        .applyDraft(organizationId as number, draftIdValue, body)
        .then((result) => asSinglePayload<CrossProjectAllocationApplyResult>(result)),
    onSuccess: (_data, { draftId: draftIdValue }) => {
      if (organizationId !== null) {
        queryClient.invalidateQueries({
          queryKey: crossProjectAllocationKeys.draft(organizationId, draftIdValue),
        })
        queryClient.invalidateQueries({
          queryKey: crossProjectAllocationKeys.drafts(organizationId),
        })
      }
    },
  })
  const cancelDraft = useMutation({
    mutationFn: (draftIdValue: number) =>
      crossProjectAllocationApi
        .cancelDraft(organizationId as number, draftIdValue)
        .then((result) => asSinglePayload<CrossProjectAllocationDraft>(result)),
    onSuccess: (_data, draftIdValue) => {
      if (organizationId !== null) {
        queryClient.invalidateQueries({
          queryKey: crossProjectAllocationKeys.draft(organizationId, draftIdValue),
        })
      }
    },
  })

  // 新建草案后会切到该草案；这条「已创建」通知属于新草案，切换时不能被下面的清理抹掉。
  const keepNoticeForDraftRef = React.useRef<number | null>(null)

  // 切换草案时清理预览摘要与通知（防跨草案串场）。
  React.useEffect(() => {
    setPreviewResult((current) => (current && current.draftId === draftId ? current : null))
    if (keepNoticeForDraftRef.current !== null && keepNoticeForDraftRef.current === draftId) {
      keepNoticeForDraftRef.current = null
      return
    }
    setNotice(null)
  }, [draftId])

  function selectDraft(id: number) {
    setMirrorDraftId(id)
    router.push(serializeAllocationUrlState(id))
  }

  async function handleCreateDraft() {
    if (createDraft.isPending) return
    setNotice(null)
    try {
      const window = createDefaultAllocationDateWindow()
      const result = await createDraft.mutateAsync({
        name: `调配方案 ${new Date().toLocaleDateString('zh-CN')}`,
        projectIds: [],
        dateWindow: window,
      })
      const createdId = Number(result.id)
      keepNoticeForDraftRef.current = createdId
      selectDraft(createdId)
      setNotice({
        tone: 'success',
        text: `已创建草案 #${createdId}，可在下方逐项编排后生成影响预览。`,
      })
    } catch {
      setNotice({ tone: 'danger', text: '创建草案失败，请重试。' })
    }
  }

  async function runAction(kind: AllocationActionKind): Promise<boolean> {
    if (!dialog) return true
    // 失败时异常上抛给 AllocationConfirmDialog 行内回显（含 ApiError message），
    // 弹窗保持打开可重试；成功后由调用方返回 true 关闭。
    if (kind === 'preview') {
      const result = await previewDraft.mutateAsync(dialog.draftId)
      // mutationFn 已按裸载荷收敛（asSinglePayload），摘要仅在载荷含预览哈希时回显
      // （服务端状态推进仍以详情查询失效后自动刷新为准）。
      if (result && typeof result === 'object' && 'previewHash' in result) {
        setPreviewResult({ draftId: dialog.draftId, data: result })
      } else {
        setPreviewResult(null)
      }
      setNotice({ tone: 'success', text: '影响预览已生成——请核对受影响项目与冲突项后再确认。' })
      return true
    }
    if (kind === 'confirm') {
      await confirmDraft.mutateAsync({
        draftId: dialog.draftId,
        body: { idempotencyKey: `confirm-${Date.now()}` },
      })
      setPreviewResult((current) =>
        current && current.draftId === dialog.draftId ? null : current,
      )
      setNotice({ tone: 'success', text: '草案已确认。可继续「应用调配」写入正式资源记录。' })
      return true
    }
    if (kind === 'apply') {
      const result = await applyDraft.mutateAsync({
        draftId: dialog.draftId,
        body: { idempotencyKey: `apply-${Date.now()}` },
      })
      setNotice({
        tone: result.status === 'success' ? 'success' : 'warning',
        text:
          result.status === 'success'
            ? '草案已应用，正式资源记录写入完成。'
            : `应用结果为「${applyResultLabel(result.status)}」——部分调配项被拒绝，详情见草案应用结果区。`,
      })
      return true
    }
    await cancelDraft.mutateAsync(dialog.draftId)
    setNotice({ tone: 'warning', text: `草案 #${dialog.draftId} 已取消。` })
    return true
  }

  // ── 列表三态 ──
  const listLoading = draftsQuery.isPending
  const listError = draftsQuery.isError
  const listEmpty = !listLoading && !listError && draftRows.length === 0

  // ── 详情错误分类：中性「未找到」（HTTP 404 = 跨租户/不存在，RL-05）
  //     vs 可重试（5xx / 网络异常均进入错误态带重试按钮）。
  const detailErrorStatus = (draftQuery.error as { status?: number } | null)?.status ?? 0
  const detailNotFound = draftId !== null && draftQuery.isError && detailErrorStatus === 404

  const editorWindow: AllocationDateWindow | null = draft?.queryShape?.dateWindow
    ? { from: draft.queryShape.dateWindow.from, to: draft.queryShape.dateWindow.to }
    : null

  return (
    <div
      data-allocation-workspace
      aria-busy={listLoading || draftQuery.isPending}
      data-immersion={tier}
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <ArrowLeftRight className="h-5 w-5 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">跨项目资源调配</h1>
            <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
              组织级调配草案工作台：候选池检索 → 草案编排 → 影响预览 → 二次确认应用
              （所有建议均需人工确认后才写入正式资源记录）
            </p>
          </div>
        </div>
        {canWrite ? (
          <button
            type="button"
            data-allocation-create
            disabled={createDraft.isPending}
            onClick={() => void handleCreateDraft()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-60"
          >
            {createDraft.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden />
            )}
            新建调配草案
          </button>
        ) : null}
      </header>

      {notice ? (
        <div
          data-allocation-notice
          role={notice.tone === 'danger' ? 'alert' : 'status'}
          className={cn(
            'rounded-sm border px-3 py-2 text-[11px]',
            toneTextClass(
              notice.tone === 'success'
                ? 'success'
                : notice.tone === 'warning'
                  ? 'warning'
                  : 'danger',
            ),
          )}
        >
          {notice.text}
        </div>
      ) : null}

      {canWrite ? (
        <p
          data-allocation-write-scope
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-1.5 text-[10px] leading-relaxed text-[var(--nx-text-muted)]"
        >
          写权限口径与后端一致：resource:manage 或 portfolio:view 均可编排/确认/应用（组合视野
          持有者按后端政策被放行，本页不承诺「仅资源管理员可写」）。
        </p>
      ) : null}

      {/* 草案列表 */}
      <section data-allocation-draft-list className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-[var(--nx-text-secondary)]">调配草案</h2>
          {draftsTotal !== null ? (
            <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
              共 {draftsTotal} 份
            </span>
          ) : null}
        </div>

        {listLoading ? (
          <div data-allocation-list-skeleton aria-busy="true" className="flex flex-col gap-2">
            {[0, 1, 2].map((line) => (
              <div
                key={line}
                className="flex h-16 items-center gap-3 rounded-md border border-[var(--nx-border-hairline)]/60 px-3"
              >
                <div className="h-8 w-8 animate-pulse rounded bg-[var(--nx-bg-1)]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-40 animate-pulse rounded bg-[var(--nx-bg-1)]" />
                  <div className="h-2 w-64 animate-pulse rounded bg-[var(--nx-bg-1)]" />
                </div>
              </div>
            ))}
          </div>
        ) : listError ? (
          <div
            data-allocation-list-error
            role="alert"
            className="flex items-center justify-between gap-3 rounded-md border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-3 py-3"
          >
            <p className="text-xs text-[var(--nx-text-secondary)]">
              草案列表加载失败，请检查网络后重试。
            </p>
            <button
              type="button"
              data-allocation-list-retry
              onClick={() => void draftsQuery.refetch()}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              重试
            </button>
          </div>
        ) : listEmpty ? (
          <div
            data-allocation-list-empty
            className="flex flex-col items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 py-10 text-center"
          >
            <List className="h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
            <p className="text-sm text-[var(--nx-text-primary)]">暂无调配草案</p>
            <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              {canWrite
                ? '点击「新建调配草案」，再经候选池与逐项编排构建跨项目调配方案。'
                : '创建调配草案需要 resource:manage 或 portfolio:view 权限。'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {draftRows.map((row) => (
              <button
                key={row.id}
                type="button"
                data-allocation-draft-row={row.id}
                aria-pressed={draftId === row.id}
                onClick={() => selectDraft(row.id)}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left transition-colors',
                  draftId === row.id
                    ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]'
                    : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] hover:border-[var(--nx-border-focus)]',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-[var(--nx-text-primary)]">
                    {row.name}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--nx-text-muted)]">
                    <span>#{row.id}</span>
                    <span>创建于 {row.createdAtLabel}</span>
                    <span>范围 {row.scopeProjectCount} 项目</span>
                    {row.warningCount > 0 ? (
                      <span className="flex items-center gap-0.5 text-[var(--nx-status-warning)]">
                        <FileWarning className="h-3 w-3" aria-hidden />
                        {row.warningCount} 警告
                      </span>
                    ) : null}
                  </span>
                </span>
                <span
                  data-allocation-status-badge
                  data-status={row.draft.status}
                  className={cn(
                    'inline-flex shrink-0 items-center rounded-sm border px-2 py-0.5 text-[10px] font-medium',
                    toneTextClass(row.statusTone),
                  )}
                >
                  {row.statusLabel}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 详情区 */}
      {draftId === null ? (
        <section
          data-allocation-detail-idle
          className="flex flex-col items-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] px-4 py-12 text-center"
        >
          <ArrowLeftRight className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-primary)]">未选中草案</p>
          <p className="max-w-md text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
            从上方草案列表选择一份进行逐项编排、影响预览与确认应用；URL 中的
            <span className="font-mono"> ?draft= </span>
            参数会记住当前选择。
          </p>
        </section>
      ) : draftQuery.isPending ? (
        <section data-allocation-detail-skeleton aria-busy="true" className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((line) => (
            <div key={line} className="h-12 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
          ))}
        </section>
      ) : detailNotFound ? (
        <section
          data-allocation-detail-notfound
          role="status"
          aria-label="草案不存在或已被移除"
          className="flex flex-col items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] px-4 py-12 text-center"
        >
          <EyeOff className="h-7 w-7 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-primary)]">草案不存在或已被移除</p>
          <p className="max-w-md text-[11px] text-[var(--nx-text-muted)]">
            该草案可能已被取消，或不在当前组织可见范围内。
          </p>
        </section>
      ) : draftQuery.isError || draft === null ? (
        <section
          data-allocation-detail-error
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-[var(--nx-status-danger)]/40 bg-[rgba(239,68,68,0.06)] px-3 py-3"
        >
          <p className="text-xs text-[var(--nx-text-secondary)]">草案详情加载失败。</p>
          <button
            type="button"
            data-allocation-detail-retry
            onClick={() => void draftQuery.refetch()}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            重试
          </button>
        </section>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 草案事实条 */}
          <section
            data-allocation-detail-facts
            className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{draft.name}</h3>
              <span
                data-allocation-detail-status
                data-status={draft.status}
                className={cn(
                  'inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-medium',
                  toneTextClass(allocationDraftStatusTone(draft.status)),
                )}
              >
                {allocationDraftStatusLabel(draft.status)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--nx-text-muted)]">
              <span>#{draft.id}</span>
              <span>创建 {formatShortDate(draft.createdAt)}</span>
              <span>范围 {draft.queryShape?.projectIds?.length ?? 0} 项目</span>
              <span>{draft.items.length} 项</span>
              {draft.previewExpiresAt ? (
                <span className="flex items-center gap-1 text-[var(--nx-status-warning)]">
                  <Clock className="h-3 w-3" aria-hidden />
                  预览于 {formatShortDate(draft.previewExpiresAt)} 过期
                </span>
              ) : null}
              {draft.previewHash ? (
                <span className="truncate" title={draft.previewHash}>
                  预览哈希 {draft.previewHash.slice(0, 12)}…
                </span>
              ) : null}
            </div>
            {draft.warnings.length > 0 ? (
              <ul data-allocation-detail-warnings className="mt-2 flex flex-col gap-1">
                {draft.warnings.map((warning, index) => (
                  <li
                    key={`${warning.code}-${index}`}
                    data-warning-code={warning.code}
                    className="flex items-start gap-1.5 text-[11px] text-[var(--nx-status-warning)]"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    <span>
                      {warning.message || warning.code}
                      {warning.redactedCount ? `（另有 ${warning.redactedCount} 项已隐藏）` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* 影响预览摘要（只读，preview 成功后回显） */}
          {previewResult &&
          previewResult.draftId === draftId &&
          previewResult.data &&
          previewResult.data.previewHash ? (
            <section
              data-allocation-preview-summary
              className="flex flex-col gap-2 rounded-md border border-[var(--nx-border-focus)]/40 bg-[var(--nx-bg-0)] px-3 py-3"
            >
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
                <h4 className="text-[13px] font-medium text-[var(--nx-text-primary)]">
                  影响预览摘要
                </h4>
                <span className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-px font-mono text-[10px] text-[var(--nx-text-muted)]">
                  预览哈希 {previewResult.data.previewHash.slice(0, 12)}… · 过期{' '}
                  {formatShortDate(previewResult.data.previewExpiresAt)}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                {previewResult.data.items.length} 个调配项 ·{' '}
                {previewResult.data.affectedVisibleProjects.length} 个可见受影响项目 ·{' '}
                {previewResult.data.conflicts.length} 项冲突。建议均未应用——核对后再确认。
              </p>
              {previewResult.data.conflicts.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {previewResult.data.conflicts.map((conflict, index) => (
                    <li
                      key={`${conflict.code}-${index}`}
                      data-preview-conflict
                      data-conflict-severity={conflict.severity}
                      className="flex items-start gap-1.5 text-[11px] text-[var(--nx-text-secondary)]"
                    >
                      <span
                        className={cn(
                          'mt-0.5 inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px text-[10px] font-medium',
                          toneTextClass(
                            conflict.severity === 'critical' || conflict.severity === 'error'
                              ? 'danger'
                              : conflict.severity === 'warning'
                                ? 'warning'
                                : 'neutral',
                          ),
                        )}
                      >
                        {conflictSeverityLabel(conflict.severity)}
                      </span>
                      <span>{conflict.message || conflict.code}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/* 逐项编排 */}
          <AllocationDraftEditor
            draftId={draftId}
            draftName={draft.name}
            status={draft.status}
            items={draft.items}
            canWrite={canWrite}
            window={editorWindow ?? createDefaultAllocationDateWindow()}
          />

          {/* 动作条（写权限镜像后端口径） */}
          {canWrite ? (
            <section
              data-allocation-action-bar
              className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
            >
              {(draft.status === 'draft' || draft.status === 'previewed') &&
              draft.items.length > 0 ? (
                <button
                  type="button"
                  data-allocation-action-preview
                  onClick={() => setDialog({ kind: 'preview', draftId, draftName: draft.name })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
                >
                  <Zap className="h-3.5 w-3.5" aria-hidden />
                  生成影响预览
                </button>
              ) : null}
              {draft.status === 'previewed' ? (
                <button
                  type="button"
                  data-allocation-action-confirm
                  onClick={() => setDialog({ kind: 'confirm', draftId, draftName: draft.name })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  确认草案
                </button>
              ) : null}
              {draft.status === 'confirmed' ? (
                <button
                  type="button"
                  data-allocation-action-apply
                  onClick={() => setDialog({ kind: 'apply', draftId, draftName: draft.name })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-success)]/60 bg-[rgba(16,185,129,0.1)] px-3 text-xs font-medium text-[var(--nx-status-success)] transition-colors hover:border-[var(--nx-status-success)]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  应用调配
                </button>
              ) : null}
              {isAllocationDraftCancellable(draft.status) ? (
                <button
                  type="button"
                  data-allocation-action-cancel
                  onClick={() => setDialog({ kind: 'cancel', draftId, draftName: draft.name })}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.08)] px-3 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:border-[var(--nx-status-danger)]"
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden />
                  取消草案
                </button>
              ) : null}
              {draft.status === 'previewed' || draft.status === 'draft' ? (
                <span className="text-[10px] text-[var(--nx-text-muted)]">
                  编辑调配项后需重新生成影响预览，确认前请核对冲突与过期时间。
                </span>
              ) : null}
            </section>
          ) : null}

          {/* 确认/应用结果（只读事实回显） */}
          {draft.confirmation ? (
            <section
              data-allocation-confirmation-facts
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
            >
              <p className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                确认记录 · {formatShortDate(draft.confirmation.confirmedAt)} · 预览哈希{' '}
                {draft.confirmation.previewHash.slice(0, 12)}… · {draft.confirmation.itemIds.length}{' '}
                项
              </p>
            </section>
          ) : null}
          {draft.applyResult ? (
            <section
              data-allocation-apply-result
              data-apply-status={draft.applyResult.status}
              className={cn(
                'rounded-md border px-3 py-2.5',
                toneTextClass(applyResultTone(draft.applyResult.status)),
              )}
            >
              <p className="text-[11px] font-medium">
                应用结果：{applyResultLabel(draft.applyResult.status)}（
                {formatShortDate(draft.applyResult.appliedAt)}）
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {draft.applyResult.itemResults.map((item) => (
                  <li
                    key={item.itemId}
                    className="font-mono text-[10px] text-[var(--nx-text-muted)]"
                  >
                    项 {item.itemId} → {item.status}
                    {item.errorCode ? `（${item.errorCode}）` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* 候选池（只读咨询） */}
          <AllocationCandidatePanel window={editorWindow} />
        </div>
      )}

      {/* 写动作二次确认弹窗 */}
      {dialog ? (
        <AllocationConfirmDialog
          key={`${dialog.kind}-${dialog.draftId}`}
          open
          title={dialogTitle(dialog.kind)}
          description={dialogDescription(dialog.kind, dialog.draftName, draft?.status)}
          confirmLabel={dialogConfirmLabel(dialog.kind)}
          pendingLabel={dialogPendingLabel(dialog.kind)}
          danger={dialog.kind === 'cancel'}
          onConfirm={() => runAction(dialog.kind)}
          onClose={() => setDialog(null)}
        >
          {dialog.kind === 'preview' ? (
            <p
              data-allocation-dialog-preview-hint
              className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
            >
              预览将生成影响快照并推进草案状态为「已预览」；本操作只创建预览证据，不写入任何正式资源记录。
            </p>
          ) : null}
          {dialog.kind === 'confirm' ? (
            <p
              data-allocation-dialog-confirm-hint
              className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
            >
              确认以当前影响预览快照为准，随后方可「应用」；确认后若再次编辑调配项，草案将退回「草案」状态。
            </p>
          ) : null}
          {dialog.kind === 'apply' ? (
            <p
              data-allocation-dialog-apply-hint
              className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
            >
              应用将按确认快照逐项目写入正式资源分配记录（后端逐项目二次授权）；缺失任务/资源引用的调配项会在此阶段被拒绝并回显失败原因。
            </p>
          ) : null}
          {dialog.kind === 'cancel' ? (
            <p
              data-allocation-dialog-cancel-hint
              className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
            >
              取消后草案进入「已取消」终态，其调配项与预览快照不再可应用；该动作不可撤销。
            </p>
          ) : null}
        </AllocationConfirmDialog>
      ) : null}
    </div>
  )
}

export default AllocationWorkspace

function dialogTitle(kind: AllocationActionKind): string {
  if (kind === 'preview') return '生成影响预览'
  if (kind === 'confirm') return '确认调配草案'
  if (kind === 'apply') return '应用调配草案'
  return '取消调配草案'
}

function dialogDescription(kind: AllocationActionKind, draftName: string, status?: string): string {
  const base = `草案「${draftName}」${status ? `（${allocationDraftStatusLabel(status)}）` : ''}`
  if (kind === 'preview') return `${base} —— 二次确认后生成影响预览`
  if (kind === 'confirm') return `${base} —— 二次确认后推进为已确认`
  if (kind === 'apply') return `${base} —— 二次确认后写入正式资源记录`
  return `${base} —— 二次确认后进入已取消终态`
}

function dialogConfirmLabel(kind: AllocationActionKind): string {
  if (kind === 'preview') return '生成预览'
  if (kind === 'confirm') return '确认草案'
  if (kind === 'apply') return '确认并应用'
  return '确认取消'
}

function dialogPendingLabel(kind: AllocationActionKind): string {
  if (kind === 'preview') return '正在生成预览…'
  if (kind === 'confirm') return '正在确认…'
  if (kind === 'apply') return '正在应用…'
  return '正在取消…'
}
