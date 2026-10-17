'use client'

import { useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ClipboardList, FileText, ShieldAlert, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import {
  useTrizDecisionCenterSummary,
  useTrizDecisionCenterItems,
  useTrizDecisionCenterDetail,
  useTrizDecisionCenterReadiness,
  useInvalidateDecisionCenter,
} from '@/hooks/use-triz-decision-center'
import { trizDecisionCenterApi } from '@/lib/api/triz-decision-center'
import { trizDecisionLogApi } from '@/lib/api/triz-decision-log'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import {
  DeliveryLoopPanel,
  VerificationDialog,
  ReopenDialog,
} from '@/components/delivery-loop/delivery-loop-panel'
import {
  useTrizDeliveryLoopSummary,
  useVerifyMutation,
  useReopenMutation,
} from '@/hooks/use-triz-delivery-loop'
import { trizDeliveryLoopApi } from '@/lib/api/triz-delivery-loop'
import { TRIZ_DL_TABS } from '@aiproj/types'
import type { TrizDlTab, TrizDlClosedLoopItem } from '@aiproj/types'
import type {
  TrizDecisionCenterItem,
  TrizDecisionCenterQueueStatus,
  TrizDecisionCenterSourceKind,
  TrizDecisionCenterWarning,
  TrizDecisionCenterReadinessState,
  TrizDecisionCenterAllowedAction,
  TrizDecisionCenterDetail,
  TrizDecisionCenterAiDraftResponse,
} from '@aiproj/types'
import type {
  TrizDecisionSourceRef,
  TrizDecisionArtifactHash,
  TrizDecisionType,
} from '@aiproj/types'

// AI 成本摘要在 types 里是 AiDraftResponse 的内联匿名类型，没有具名导出，按索引取。
type TrizDecisionCenterAiCostSummary = TrizDecisionCenterAiDraftResponse['data']['costSummary']

/**
 * 决策中心动作 → 决策日志类型。
 * 只列可落库的动作；generate_reason_draft / start_draft_review / view_detail /
 * supplement 在决策日志侧没有对应枚举，映射缺省即表示不写日志。
 */
const DECISION_LOG_TYPE_BY_ACTION: Partial<
  Record<TrizDecisionCenterAllowedAction, TrizDecisionType>
> = {
  adopt: 'adopt',
  reject: 'reject',
  partial_accept: 'partial_accept',
  modified_accept: 'modified_accept',
  supersede: 'supersede',
  request_clarification: 'clarification_requested',
}

const queueStatusLabel: Record<TrizDecisionCenterQueueStatus, string> = {
  pending_decision: '待决策',
  missing_reason: '缺少理由',
  stale_source: '来源过期',
  ready_for_draft: '可进入草案',
  blocked: '已阻塞',
  recently_decided: '近期决策',
}

const sourceKindLabel: Record<TrizDecisionCenterSourceKind, string> = {
  contradiction: '矛盾',
  compiler_triz_analysis: 'Compiler 分析',
  recommendation_rationale: '推荐理由',
  innovation_workbench: '创新工作台',
  draft_blocker: 'Draft 阻断',
  decision_log: '决策日志',
}

const readinessLabel: Record<TrizDecisionCenterReadinessState, string> = {
  ready: '就绪',
  not_ready: '未就绪',
  blocked: '已阻塞',
  stale: '已过期',
  unknown: '未知',
}

const QUEUE_TABS: TrizDecisionCenterQueueStatus[] = [
  'pending_decision',
  'missing_reason',
  'stale_source',
  'ready_for_draft',
  'blocked',
  'recently_decided',
]

export default function TrizDecisionCenterPage() {
  const projectId = Number(useParams().id)
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canView = hasPermission('triz_decision:view')
  const canManage = hasPermission('triz_decision:manage')

  // 6.4: URL query filter 同步（status / search），不持久化敏感数据。
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('status') as TrizDecisionCenterQueueStatus | null) ?? 'all'
  const initialSearch = searchParams.get('search') ?? ''
  const [activeTab, setActiveTab] = useState<TrizDecisionCenterQueueStatus | 'all'>(initialTab)
  const [search, setSearch] = useState(initialSearch)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    searchParams.get('item') ?? null,
  )
  const [detailOpen, setDetailOpen] = useState(false)
  // 写动作 dialog / 理由草稿状态（7.5 / Requirement 6）
  const [actionDialog, setActionDialog] = useState<{
    item: TrizDecisionCenterItem
    action: TrizDecisionCenterAllowedAction
  } | null>(null)
  const [reasonText, setReasonText] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [warningAck, setWarningAck] = useState(false)
  const [draftResult, setDraftResult] = useState<{
    draftReason: string
    isFallback: boolean
    costSummary: TrizDecisionCenterAiCostSummary
    warnings: TrizDecisionCenterWarning[]
  } | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const invalidate = useInvalidateDecisionCenter(projectId)

  // URL 同步 helper
  const syncUrl = (next: { status?: string; search?: string; item?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next.status !== undefined) {
      if (next.status === 'all' || !next.status) params.delete('status')
      else params.set('status', next.status)
    }
    if (next.search !== undefined) {
      if (!next.search) params.delete('search')
      else params.set('search', next.search)
    }
    if (next.item !== undefined) {
      if (!next.item) params.delete('item')
      else params.set('item', next.item)
    }
    router.replace(`/projects/${projectId}/triz-decision-center?${params.toString()}`, {
      scroll: false,
    })
  }

  const onTabChange = (tab: TrizDecisionCenterQueueStatus | 'all') => {
    setActiveTab(tab)
    syncUrl({ status: tab })
  }

  const onSearchChange = (value: string) => {
    setSearch(value)
    syncUrl({ search: value })
  }

  const summaryQuery = useTrizDecisionCenterSummary(projectId)
  const itemsQuery = useTrizDecisionCenterItems(projectId, {
    status: activeTab === 'all' ? undefined : activeTab,
    search: search || undefined,
  })
  const readinessQuery = useTrizDecisionCenterReadiness(projectId)

  // 交付闭环（v3-triz-to-delivery-closed-loop task 10.2）：
  // 选中 tab 持久化到 URL；未知值安全回退到面板默认分组；flag 关闭/无权限时只显示低敏提示。
  const dlTabParam = searchParams.get('dlTab')
  const [dlTab, setDlTab] = useState<TrizDlTab | undefined>(
    TRIZ_DL_TABS.includes(dlTabParam as TrizDlTab) ? (dlTabParam as TrizDlTab) : undefined,
  )
  const onDlTabChange = (tab: TrizDlTab) => {
    setDlTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('dlTab', tab)
    router.replace(`/projects/${projectId}/triz-decision-center?${params.toString()}`, {
      scroll: false,
    })
  }
  const dlSummaryQuery = useTrizDeliveryLoopSummary(projectId)

  // 交付闭环写动作（task 10.8/10.10）：人工验证 / 请求重审对话框。
  // 打开前先取只读就绪状态与当前 fingerprint（CAS 前提），未就绪则不弹确认框。
  const verifyMutation = useVerifyMutation(projectId)
  const reopenMutation = useReopenMutation(projectId)
  const [verifyItem, setVerifyItem] = useState<TrizDlClosedLoopItem | null>(null)
  const [reopenItem, setReopenItem] = useState<TrizDlClosedLoopItem | null>(null)
  const [readyState, setReadyState] = useState<{
    ready: boolean
    blockingReasons: string[]
    fingerprint: string | null
  } | null>(null)
  const [readyError, setReadyError] = useState(false)
  const [dlSubmitting, setDlSubmitting] = useState(false)

  const openEffectDialog = async (item: TrizDlClosedLoopItem, mode: 'verify' | 'reopen') => {
    setReadyState(null)
    setReadyError(false)
    if (mode === 'verify') setVerifyItem(item)
    else setReopenItem(item)
    try {
      const r = await trizDeliveryLoopApi.ready(projectId, item.itemId)
      setReadyState({
        ready: r.ready,
        blockingReasons: r.blockingReasons,
        fingerprint: r.verificationFingerprint,
      })
    } catch {
      setReadyError(true)
    }
  }

  const closeEffectDialog = () => {
    setVerifyItem(null)
    setReopenItem(null)
    setReadyState(null)
    setReadyError(false)
  }

  const handleVerifySubmit = async (payload: {
    conclusion: 'effective' | 'ineffective' | 'inconclusive'
    observationWindow: { from: string; to: string }
    reason: string
    evidenceRefs: string[]
    verificationFingerprint: string
  }) => {
    if (!verifyItem) return
    setDlSubmitting(true)
    try {
      await verifyMutation.mutateAsync({
        itemId: verifyItem.itemId,
        body: {
          conclusion: payload.conclusion,
          observationWindow: payload.observationWindow,
          reason: payload.reason || undefined,
          evidenceRefs: payload.evidenceRefs,
          verificationFingerprint: payload.verificationFingerprint,
        },
      })
      closeEffectDialog()
    } finally {
      setDlSubmitting(false)
    }
  }

  const handleReopenSubmit = async (payload: { reason: string }) => {
    if (!reopenItem) return
    setDlSubmitting(true)
    try {
      await reopenMutation.mutateAsync({
        itemId: reopenItem.itemId,
        body: { reason: payload.reason, currentFingerprint: readyState?.fingerprint ?? '' },
      })
      closeEffectDialog()
    } finally {
      setDlSubmitting(false)
    }
  }

  const detailQuery = useTrizDecisionCenterDetail(projectId, selectedItemId)

  // trizDecisionCenterApi.* 内部已 .then(res => res.data) 解掉响应信封，
  // 这里再取一次 .data 会拿到 undefined（后端 summary 返回体就是 { data: Summary }）。
  const items = itemsQuery.data ?? []
  const summary = summaryQuery.data
  const readiness = readinessQuery.data

  const filteredItems = useMemo(() => items, [items])

  if (!canView) {
    return (
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 lg:px-10">
        <section className="rounded-lg border border-border bg-background p-8">
          <div className="flex items-center gap-2 text-sm text-muted">
            <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
            <span>无权限查看 TRIZ 决策中心</span>
          </div>
        </section>
      </main>
    )
  }

  if (summaryQuery.isError || itemsQuery.isError) {
    return (
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 lg:px-10">
        <section className="rounded-lg border border-border bg-background p-8">
          <div className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>决策中心加载失败</span>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-5 md:px-8 lg:px-10">
      <header className="flex flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <ClipboardList className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>TRIZ Decision Center</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-heading">决策中心</h1>
          <p className="mt-1 text-sm text-muted">
            聚合 TRIZ 矛盾、分析、理由、方案与决策日志，集中审查与人工决策。
          </p>
        </div>
        {summary ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            <SummaryTile label="总计" value={summary.totalItems} />
            <SummaryTile label="待决策" value={summary.queueCounts.pending_decision} />
            <SummaryTile label="可进入草案" value={summary.readyForDraftCount} />
            <SummaryTile label="阻塞" value={summary.blockedCount} variant="warning" />
            <SummaryTile
              label="来源过期"
              value={summary.queueCounts.stale_source}
              variant="warning"
            />
          </div>
        ) : null}
      </header>

      <section className="grid min-h-[620px] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <QueueTabs active={activeTab} onChange={onTabChange} counts={summary?.queueCounts} />

          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="按主题搜索..."
              className="h-9"
              aria-label="搜索决策项"
            />
          </div>

          <ItemsList
            items={filteredItems}
            isLoading={itemsQuery.isLoading}
            onSelect={(id) => {
              setSelectedItemId(id)
              setDetailOpen(true)
              syncUrl({ item: id })
            }}
            canManage={canManage}
          />
        </div>

        <ReadinessPanel readiness={readiness} isLoading={readinessQuery.isLoading} />
      </section>

      {/* 交付闭环（task 10.2/10.4）：决策 → 交付 → 人工验证只读投影，挂载于决策中心主入口 */}
      <section
        aria-label="TRIZ 交付闭环（决策 → 交付 → 人工验证）"
        className="mt-5 border-t border-border pt-5"
      >
        {dlSummaryQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : dlSummaryQuery.isError ? (
          <p className="text-xs text-muted" data-testid="dl-disabled-note">
            交付闭环暂不可用（功能未启用或无权限查看）。
          </p>
        ) : (
          <DeliveryLoopPanel
            projectId={projectId}
            activeTab={dlTab}
            onTabChange={onDlTabChange}
            onVerifyRequest={(item) => void openEffectDialog(item, 'verify')}
            onReopenRequest={(item) => void openEffectDialog(item, 'reopen')}
          />
        )}
      </section>

      {/* 人工验证 / 重审对话框（未就绪不弹确认框，只展示阻断原因） */}
      {verifyItem && readyState?.ready && readyState.fingerprint ? (
        <VerificationDialog
          fingerprint={readyState.fingerprint}
          onCancel={closeEffectDialog}
          onSubmit={handleVerifySubmit}
          submitting={dlSubmitting}
        />
      ) : null}
      {reopenItem && readyState?.ready ? (
        <ReopenDialog
          onCancel={closeEffectDialog}
          onSubmit={handleReopenSubmit}
          submitting={dlSubmitting}
        />
      ) : null}
      {(verifyItem || reopenItem) && readyState && !readyState.ready ? (
        <div
          role="alert"
          data-testid="dl-ready-blocked"
          className="rounded-md border border-border bg-surface p-3 text-xs text-amber-600"
        >
          该闭环项尚未就绪：{readyState.blockingReasons.join('、')}
          <button type="button" onClick={closeEffectDialog} className="ml-2 underline">
            关闭
          </button>
        </div>
      ) : null}
      {(verifyItem || reopenItem) && readyError ? (
        <div
          role="alert"
          data-testid="dl-ready-error"
          className="rounded-md border border-border bg-surface p-3 text-xs text-red-600"
        >
          无法获取就绪状态，请重试。
          <button type="button" onClick={closeEffectDialog} className="ml-2 underline">
            关闭
          </button>
        </div>
      ) : null}

      <DetailDrawer
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open)
          if (!open) syncUrl({ item: null })
        }}
        item={detailQuery.data?.item ?? null}
        detail={detailQuery.data ?? null}
        isLoading={detailQuery.isLoading}
        canManage={canManage}
        onAction={(item, action) => {
          setActionDialog({ item, action })
          setReasonText('')
          setConfirmed(false)
          setWarningAck(false)
          setDraftResult(null)
        }}
      />

      <ActionDialog
        state={actionDialog}
        reasonText={reasonText}
        confirmed={confirmed}
        warningAck={warningAck}
        draftResult={draftResult}
        draftLoading={draftLoading}
        canManage={canManage}
        onClose={() => setActionDialog(null)}
        onReasonChange={setReasonText}
        onConfirmedChange={setConfirmed}
        onWarningAckChange={setWarningAck}
        onGenerateDraft={async () => {
          if (!actionDialog) return
          setDraftLoading(true)
          try {
            const res = await trizDecisionCenterApi.draftReason(projectId, {
              itemId: actionDialog.item.id,
              sourceRefs: [
                {
                  kind: actionDialog.item.source.sourceKind,
                  id: actionDialog.item.source.sourceId,
                  hash: actionDialog.item.source.sourceHash,
                },
              ],
            })
            setDraftResult({
              // draftReason() 同样已解过一层信封，此处直接取字段
              draftReason: res.draftReason,
              isFallback: res.isFallback,
              costSummary: res.costSummary,
              warnings: res.warnings,
            })
            if (!reasonText) setReasonText(res.draftReason)
          } finally {
            setDraftLoading(false)
          }
        }}
        onSubmit={async () => {
          if (!actionDialog) return
          const { item, action } = actionDialog
          // 5.1/5.2: 写动作复用既有决策日志追加式语义（create/supersede），
          // 不绕过 Policy/Validator/显式确认。此处为审查确认编排层。
          const sourceRefs: TrizDecisionSourceRef[] = [
            {
              kind: item.source.sourceKind,
              id: item.source.sourceId,
              hash: item.source.sourceHash,
            },
          ]
          // 后端 Validator 要求 artifactHashes 为 { label, hash } 对象数组，
          // 原先传裸字符串数组靠 as any 蒙混过编译，运行时会被打回 422。
          const artifactHashes: TrizDecisionArtifactHash[] = [
            { label: 'source', hash: item.source.sourceHash },
          ]
          if (action === 'supersede' && item.relatedDecisionLogIds[0]) {
            await trizDecisionLogApi.supersede(projectId, item.relatedDecisionLogIds[0], {
              decisionType: 'supersede',
              subjectRefs: [],
              sourceRefs,
              artifactHashes,
              reasonSummary: reasonText,
            })
          } else {
            // 决策中心的 allowedAction 集合 ⊅ 决策日志的 TRIZ_DECISION_TYPES：
            // 只有能落日志的动作才写库，其余（草稿/评审/查看/补充）在本层结束。
            // 注意 request_clarification 对应的日志类型是 clarification_requested，
            // 原先写成 'request_info' 并不在枚举内，会被后端 Validator 打回 422。
            const decisionType = DECISION_LOG_TYPE_BY_ACTION[action]
            if (decisionType) {
              await trizDecisionLogApi.create(projectId, {
                decisionType,
                subjectRefs: [],
                sourceRefs,
                artifactHashes,
                reasonSummary: reasonText,
              })
            }
          }
          invalidate.invalidateAfterDecisionWrite()
          setActionDialog(null)
        }}
      />
    </main>
  )
}

// ---------------------------------------------------------------------------
// Queue Tabs
// ---------------------------------------------------------------------------

function QueueTabs({
  active,
  onChange,
  counts,
}: {
  active: TrizDecisionCenterQueueStatus | 'all'
  onChange: (tab: TrizDecisionCenterQueueStatus | 'all') => void
  counts?: Record<TrizDecisionCenterQueueStatus, number>
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="队列状态筛选">
      <button
        type="button"
        role="tab"
        aria-selected={active === 'all'}
        onClick={() => onChange('all')}
        className={cn(
          'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
          active === 'all'
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background text-muted hover:bg-surface',
        )}
      >
        全部
      </button>
      {QUEUE_TABS.map((status) => (
        <button
          key={status}
          type="button"
          role="tab"
          aria-selected={active === status}
          onClick={() => onChange(status)}
          className={cn(
            'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
            active === status
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-muted hover:bg-surface',
          )}
        >
          {queueStatusLabel[status]}
          {counts ? <span className="ml-1.5 opacity-70">({counts[status]})</span> : null}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Items List
// ---------------------------------------------------------------------------

function ItemsList({
  items,
  isLoading,
  onSelect,
  canManage,
}: {
  items: TrizDecisionCenterItem[]
  isLoading: boolean
  onSelect: (id: string) => void
  canManage: boolean
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-background p-10">
        <ClipboardList className="h-8 w-8 text-muted" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted">暂无决策项</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-background">
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          onSelect={() => onSelect(item.id)}
          canManage={canManage}
        />
      ))}
    </div>
  )
}

function ItemRow({
  item,
  onSelect,
  canManage,
}: {
  item: TrizDecisionCenterItem
  onSelect: () => void
  canManage: boolean
}) {
  const isStale = item.warnings.some((w) => w.code === 'TRIZ_DC_STALE_SOURCE_HASH')
  const isBlocked = item.readiness === 'blocked'

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface"
      aria-label={`查看决策项 ${item.source.title}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-heading">
            {item.source.title || item.subjectSummary}
          </span>
          {isStale ? <Badge variant="warning">过期</Badge> : null}
          {isBlocked ? <Badge variant="danger">阻塞</Badge> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
          <span>{sourceKindLabel[item.source.sourceKind]}</span>
          <span>·</span>
          <span>{queueStatusLabel[item.queueStatus]}</span>
          <span>·</span>
          <span>优先级 {item.priority}</span>
          {item.relatedDecisionLogIds.length > 0 ? (
            <>
              <span>·</span>
              <span>{item.relatedDecisionLogIds.length} 条决策</span>
            </>
          ) : null}
        </div>
        {item.source.summary ? (
          <p className="mt-1 truncate text-xs text-muted">{item.source.summary}</p>
        ) : null}
        {item.warnings.length > 0 ? <WarningsInline warnings={item.warnings} /> : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <Badge variant="outline">{readinessLabel[item.readiness]}</Badge>
        {canManage && item.allowedActions.includes('adopt') ? (
          <span className="text-xs text-primary">可决策</span>
        ) : null}
      </div>
    </button>
  )
}

function WarningsInline({ warnings }: { warnings: TrizDecisionCenterWarning[] }) {
  if (warnings.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {warnings.slice(0, 3).map((w, i) => (
        <span
          key={`${w.code}-${i}`}
          className="rounded bg-warning-bg px-1.5 py-0.5 text-xs text-warning"
        >
          {w.message}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Readiness Panel
// ---------------------------------------------------------------------------

function ReadinessPanel({
  readiness,
  isLoading,
}: {
  readiness?: {
    summary: {
      totalReady: number
      totalBlocked: number
      totalStale: number
      recommendations: string[]
    }
  }
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <aside className="rounded-lg border border-border bg-background p-4">
        <Skeleton className="h-40 w-full" />
      </aside>
    )
  }

  if (!readiness) {
    return (
      <aside className="rounded-lg border border-border bg-background p-4">
        <p className="text-sm text-muted">Readiness 暂不可用</p>
      </aside>
    )
  }

  const { summary } = readiness

  return (
    <aside className="rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-heading">Draft Readiness</h2>
        <p className="mt-1 text-xs text-muted">advisory — Apply 仍需重新校验</p>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-3">
          <ReadinessTile label="就绪" value={summary.totalReady} variant="success" />
          <ReadinessTile label="阻塞" value={summary.totalBlocked} variant="danger" />
          <ReadinessTile label="过期" value={summary.totalStale} variant="warning" />
        </div>

        {summary.recommendations.length > 0 ? (
          <div className="space-y-2 rounded-md border border-border bg-surface p-3">
            <h3 className="text-xs font-semibold text-heading">建议</h3>
            <ul className="space-y-1 text-xs text-muted">
              {summary.recommendations.map((rec, i) => (
                <li key={i}>• {rec}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-md border border-border bg-surface p-3 text-xs text-muted">
          <p className="font-medium text-heading">边界提示</p>
          <p className="mt-1">
            从中心进入 Draft 审查仅创建候选输入；正式项目数据仍需 Draft Preview/Diff/dry-run 与人工
            Apply 确认。
          </p>
        </div>
      </div>
    </aside>
  )
}

function ReadinessTile({
  label,
  value,
  variant,
}: {
  label: string
  value: number
  variant?: 'success' | 'warning' | 'danger'
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3 text-center">
      <div
        className={cn(
          'text-2xl font-semibold',
          variant === 'success' && 'text-success',
          variant === 'warning' && 'text-warning',
          variant === 'danger' && 'text-danger',
          !variant && 'text-heading',
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail Drawer
// ---------------------------------------------------------------------------

function DetailDrawer({
  open,
  onOpenChange,
  item,
  detail,
  isLoading,
  canManage,
  onAction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: TrizDecisionCenterItem | null
  detail: TrizDecisionCenterDetail | null
  isLoading: boolean
  canManage: boolean
  onAction: (item: TrizDecisionCenterItem, action: TrizDecisionCenterAllowedAction) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex max-w-[680px] flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{item?.source.title ?? '决策项详情'}</SheetTitle>
          <SheetDescription>来源、证据链、决策时间线与可执行动作</SheetDescription>
        </SheetHeader>
        {isLoading ? (
          <div className="p-6">
            <Skeleton className="h-60 w-full" />
          </div>
        ) : !item ? (
          <div className="flex flex-col items-center justify-center p-10">
            <FileText className="h-8 w-8 text-muted" aria-hidden="true" />
            <p className="mt-2 text-sm text-muted">请选择决策项</p>
          </div>
        ) : (
          <div className="space-y-5 p-6">
            <section>
              <h3 className="text-sm font-semibold text-heading">来源摘要</h3>
              <div className="mt-3 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-heading">
                    {sourceKindLabel[item.source.sourceKind]}
                  </span>
                  <Badge variant="outline">{readinessLabel[item.readiness]}</Badge>
                </div>
                <p className="mt-2 text-sm text-foreground">
                  {item.source.summary ?? '（无摘要）'}
                </p>
                <div className="mt-2 text-xs text-muted">
                  hash: {item.source.sourceHash.slice(0, 16)}
                </div>
              </div>
            </section>

            {item.warnings.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-heading">警告</h3>
                <div className="mt-3 space-y-2">
                  {item.warnings.map((w, i) => (
                    <div
                      key={`${w.code}-${i}`}
                      className="rounded-md border border-border bg-warning-bg p-3"
                    >
                      <span className="text-xs font-medium text-warning">{w.code}</span>
                      <p className="mt-1 text-sm text-foreground">{w.message}</p>
                      {w.details?.length ? (
                        <ul className="mt-1 text-xs text-muted">
                          {w.details.map((d, j) => (
                            <li key={j}>• {d}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {detail && detail.evidenceChain.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-heading">证据链</h3>
                <div className="mt-3 space-y-2">
                  {detail.evidenceChain.map((src, i) => (
                    <div
                      key={`${src.sourceKind}-${src.sourceId}-${i}`}
                      className="rounded-md border border-border bg-surface p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-heading">
                          {sourceKindLabel[src.sourceKind as TrizDecisionCenterSourceKind] ??
                            src.sourceKind}
                        </span>
                        {src.accessible === false ? (
                          <Badge variant="outline">不可访问</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {src.summary ?? '（无摘要 / 不可访问）'}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        hash:{' '}
                        {typeof src.sourceHash === 'string' ? src.sourceHash.slice(0, 16) : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {detail && detail.decisionTimeline.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-heading">决策时间线</h3>
                <div className="mt-3 divide-y divide-border rounded-md border border-border">
                  {detail.decisionTimeline.map((event) => (
                    <div key={event.id} className="px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-heading">
                          {event.decisionType}
                        </span>
                        <span className="text-xs text-muted">{event.createdAt}</span>
                      </div>
                      <p className="mt-1 text-sm text-foreground">{event.reasonSummary}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {detail?.draftBlockerInfo ? (
              <section className="rounded-md border border-border bg-surface p-3">
                <h3 className="text-sm font-semibold text-heading">Draft 阻断</h3>
                <p className="mt-2 text-sm text-warning">
                  {detail.draftBlockerInfo.reason ?? '此项被阻断'}
                </p>
                {detail.draftBlockerInfo.requiredDecisionTypes.length > 0 ? (
                  <p className="mt-1 text-xs text-muted">
                    需要决策类型：{detail.draftBlockerInfo.requiredDecisionTypes.join('、')}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section>
              <h3 className="text-sm font-semibold text-heading">可执行动作</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.allowedActions.map((action) => (
                  <ActionBadge
                    key={action}
                    action={action}
                    canManage={canManage}
                    onActivate={() => onAction(item, action)}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">
                所有写动作均需显式确认，复用既有决策日志追加式语义。AI 仅生成草稿理由，不自动落库。
              </p>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ActionBadge({
  action,
  canManage,
  onActivate,
}: {
  action: TrizDecisionCenterAllowedAction
  canManage: boolean
  onActivate: () => void
}) {
  const labelMap: Record<TrizDecisionCenterAllowedAction, string> = {
    adopt: '记录采纳',
    reject: '记录驳回',
    partial_accept: '记录部分采纳',
    modified_accept: '记录修改后采纳',
    supplement: '补充理由',
    supersede: '废止旧决策',
    request_clarification: '请求补充说明',
    generate_reason_draft: '生成理由草稿',
    start_draft_review: '进入草案审查',
    view_detail: '查看详情',
  }

  const isWriteAction: boolean = [
    'adopt',
    'reject',
    'partial_accept',
    'modified_accept',
    'supplement',
    'supersede',
    'start_draft_review',
  ].includes(action)

  const disabled = isWriteAction && !canManage

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onActivate}
      aria-label={labelMap[action]}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs transition-colors',
        disabled
          ? 'cursor-not-allowed border-border bg-surface text-muted opacity-60'
          : 'border-primary bg-primary-50 text-primary hover:bg-primary-100',
      )}
    >
      {labelMap[action]}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Action Dialog（7.5：写动作显式确认 + Requirement 6：理由草稿）
// ---------------------------------------------------------------------------

interface ActionDialogProps {
  state: { item: TrizDecisionCenterItem; action: TrizDecisionCenterAllowedAction } | null
  reasonText: string
  confirmed: boolean
  warningAck: boolean
  draftResult: {
    draftReason: string
    isFallback: boolean
    costSummary: TrizDecisionCenterAiCostSummary
    warnings: TrizDecisionCenterWarning[]
  } | null
  draftLoading: boolean
  canManage: boolean
  onClose: () => void
  onReasonChange: (v: string) => void
  onConfirmedChange: (v: boolean) => void
  onWarningAckChange: (v: boolean) => void
  onGenerateDraft: () => void
  onSubmit: () => void
}

const actionLabel: Record<TrizDecisionCenterAllowedAction, string> = {
  adopt: '记录采纳',
  reject: '记录驳回',
  partial_accept: '记录部分采纳',
  modified_accept: '记录修改后采纳',
  supplement: '补充理由',
  supersede: '废止旧决策',
  request_clarification: '请求补充说明',
  generate_reason_draft: '生成理由草稿',
  start_draft_review: '进入草案审查',
  view_detail: '查看详情',
}

function ActionDialog({
  state,
  reasonText,
  confirmed,
  warningAck,
  draftResult,
  draftLoading,
  canManage,
  onClose,
  onReasonChange,
  onConfirmedChange,
  onWarningAckChange,
  onGenerateDraft,
  onSubmit,
}: ActionDialogProps) {
  const isReasonDraft = state?.action === 'generate_reason_draft'
  const isDraftReview = state?.action === 'start_draft_review'
  const isWriteAction: boolean = !!(
    state &&
    [
      'adopt',
      'reject',
      'partial_accept',
      'modified_accept',
      'supplement',
      'supersede',
      'request_clarification',
    ].includes(state.action)
  )

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{state ? actionLabel[state.action] : ''}</DialogTitle>
          <DialogDescription>
            审查确认 —— 复用既有决策日志追加式语义，不自动落库。
          </DialogDescription>
        </DialogHeader>

        {state ? (
          <div className="space-y-4 py-2">
            {/* 来源 refs / hash / warnings（7.5） */}
            <section className="rounded-md border border-border bg-surface p-3">
              <p className="text-xs font-medium text-heading">来源引用</p>
              <div className="mt-2 space-y-1 text-xs text-muted">
                <p>种类：{sourceKindLabel[state.item.source.sourceKind]}</p>
                <p>标题：{state.item.source.title}</p>
                <p>hash：{state.item.source.sourceHash.slice(0, 16)}</p>
              </div>
              {state.item.warnings.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {state.item.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-warning">
                      ⚠ {w.code}：{w.message}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>

            {/* 理由 / 草稿编辑（Requirement 6） */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-heading" htmlFor="dc-reason">
                  理由摘要
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onGenerateDraft}
                  disabled={draftLoading}
                  className="h-7 text-xs"
                >
                  <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
                  {draftLoading ? '生成中…' : '生成理由草稿'}
                </Button>
              </div>
              <textarea
                id="dc-reason"
                className="min-h-[80px] w-full rounded-md border border-border bg-background p-2 text-sm"
                value={reasonText}
                onChange={(e) => onReasonChange(e.target.value)}
                aria-label="决策理由摘要"
              />
              {draftResult ? (
                <div className="rounded-md border border-border bg-surface p-2 text-xs text-muted">
                  <p>
                    {draftResult.isFallback
                      ? '已返回确定性 fallback 草稿（未调用真实模型）'
                      : '草稿已生成'}
                  </p>
                  {draftResult.warnings.length > 0 ? (
                    <p className="mt-1 text-warning">
                      警告：{draftResult.warnings.map((w) => w.code).join('、')}
                    </p>
                  ) : null}
                  {draftResult.costSummary ? (
                    <p className="mt-1">
                      成本：provider={draftResult.costSummary.provider ?? '—'}，tokens=
                      {draftResult.costSummary.tokens}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            {/* Draft 审查边界提示（Requirement 5） */}
            {isDraftReview ? (
              <section className="rounded-md border border-border bg-surface p-3 text-xs text-muted">
                <p className="font-medium text-heading">Draft 审查边界</p>
                <p className="mt-1">
                  进入草案审查仅创建 Draft 候选输入；正式项目数据仍需 Draft Layer
                  Preview/Diff/dry-run 与人工 Apply 确认，且 Apply 时会重新校验决策 refs 与 hashes。
                </p>
              </section>
            ) : null}

            {/* 显式确认（5.2） */}
            {isWriteAction ? (
              <section className="space-y-2 rounded-md border border-border p-3">
                <label className="flex items-center gap-2 text-xs text-heading">
                  <input
                    type="checkbox"
                    checked={warningAck}
                    onChange={(e) => onWarningAckChange(e.target.checked)}
                    aria-label="知悉来源引用与警告"
                  />
                  我已确认来源引用、hash 与警告
                </label>
                <label className="flex items-center gap-2 text-xs text-heading">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => onConfirmedChange(e.target.checked)}
                    aria-label="显式确认提交"
                  />
                  我明确确认提交此决策记录（不自动落库，复用追加式决策日志）
                </label>
              </section>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          {isReasonDraft ? (
            <Button
              type="button"
              onClick={() => {
                onReasonChange(draftResult?.draftReason ?? reasonText)
                onClose()
              }}
              disabled={draftLoading || !draftResult}
            >
              采纳草稿
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onSubmit}
              disabled={!canManage || (isWriteAction && (!confirmed || !warningAck || !reasonText))}
            >
              {state ? actionLabel[state.action] : '提交'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function SummaryTile({
  label,
  value,
  variant,
}: {
  label: string
  value: number
  variant?: 'warning'
}) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-center">
      <div
        className={cn(
          'text-xl font-semibold',
          variant === 'warning' && value > 0 ? 'text-warning' : 'text-heading',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  )
}
