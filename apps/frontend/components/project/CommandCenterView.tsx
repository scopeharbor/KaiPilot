'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  COMMAND_CENTER_SOURCES,
  type CommandCenterAttentionItem,
  type CommandCenterResponse,
  type CommandCenterSeverity,
  type CommandCenterSourceKey,
} from '@aiproj/types'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { HealthEvidenceDrawer } from '@/components/project/HealthEvidenceDrawer'
import { resolveCommandCenterTarget } from '@/lib/command-center-target-resolver'

/**
 * 项目健康风险指挥中心页面主体（§6，design D9）。
 *
 * 三层结构：态势头部 → 来源摘要（非等权） → 注意力队列与证据。
 * 只读：无生成/刷新领域事实的控件；「前往处理」仅经 safe-target resolver 导航，
 * 目标页面二次授权。加载使用同形骨架（内容中央禁止 spinner）。
 */

/** 视图所需的最小查询面（结构化类型，兼容任意 TError 形态的 hook 结果）。 */
export interface CommandCenterQueryResult {
  data: CommandCenterResponse | undefined
  error: unknown
  isError: boolean
  isPending: boolean
  refetch: () => Promise<unknown>
}

interface CommandCenterViewProps {
  projectId: number
  query: CommandCenterQueryResult
}

export function CommandCenterView({ projectId, query }: CommandCenterViewProps) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <Heading />
      <div className="mt-6 space-y-10">
        <HeadlineStrip query={query} onRetry={() => void query.refetch()} />
        <SourcesSection query={query} />
        <AttentionSection projectId={projectId} query={query} />
      </div>
    </div>
  )
}

const SEVERITY_LABEL: Record<CommandCenterSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '提示',
}

const AVAILABILITY_LABEL: Record<string, string> = {
  available: '可用',
  empty: '暂无数据',
  stale: '已过期',
  forbidden: '无权限',
  unavailable: '不可用',
  unsupported: '未接入',
}

const SOURCE_LABEL: Record<CommandCenterSourceKey, string> = {
  [COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD]: '基础 Dashboard',
  [COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS]: '健康诊断',
  [COMMAND_CENTER_SOURCES.RISK_WORKBENCH]: '风险焦点',
  [COMMAND_CENTER_SOURCES.PREDICTION]: '预测压力',
  [COMMAND_CENTER_SOURCES.TASK_MILESTONE]: '任务 / 里程碑',
  [COMMAND_CENTER_SOURCES.RESOURCE_LOAD]: '资源负载',
  [COMMAND_CENTER_SOURCES.CHANGE_IMPACT]: '变更影响',
}

const HEALTH_LABEL: Record<string, string> = {
  green: '良好',
  yellow: '注意',
  red: '风险',
  unknown: '未知',
}

function Heading() {
  return (
    <header>
      <h1 className="text-xl font-semibold text-gray-800">健康与风险</h1>
      <p className="mt-1 text-sm text-gray-500">
        汇集基础指标、已确认诊断、风险、预测与资源信号；所有处理动作均返回既有工作台。
      </p>
    </header>
  )
}

// ─── 加载骨架（与最终结构同形）─────────────────────────────────────────────────

export function CommandCenterSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6"
      aria-label="正在加载健康与风险"
    >
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-72" />
      <Skeleton className="mt-6 h-28 w-full" />
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
      <Skeleton className="mt-10 h-64 w-full" />
    </div>
  )
}

// ─── 态势头部 ──────────────────────────────────────────────────────────────────

function HeadlineStrip({
  query,
  onRetry,
}: {
  query: CommandCenterViewProps['query']
  onRetry: () => void
}) {
  if (query.isPending) {
    return (
      <section
        aria-label="整体态势加载中"
        className="rounded-[var(--radius-md)] border border-border p-6"
      >
        <Skeleton className="h-6 w-56" />
        <Skeleton className="mt-3 h-4 w-96" />
      </section>
    )
  }

  if (query.isError) {
    return (
      <Alert variant="danger" title="健康与风险暂时无法读取">
        <p>基础项目信息读取失败，无法展示任何来源。请稍后重试。</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
          重试
        </Button>
      </Alert>
    )
  }

  const response = query.data as CommandCenterResponse | undefined
  if (!response) return null

  const { headline, sources } = response.data
  const meta = response.meta

  return (
    <section aria-label="整体态势" className="rounded-[var(--radius-md)] border border-border p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex items-center gap-3">
          <span
            data-health={headline.healthStatus}
            className="inline-flex items-center gap-2 text-lg font-semibold text-gray-800"
          >
            {HEALTH_LABEL[headline.healthStatus] ?? headline.healthStatus}
          </span>
          <Badge
            variant={
              headline.sourceKey === COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS ? 'primary' : 'neutral'
            }
          >
            来源：
            {headline.sourceKey === COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS
              ? '已确认诊断'
              : '基础 Dashboard'}
          </Badge>
          {headline.overallScore !== null && (
            <span className="text-sm text-gray-500">评分 {headline.overallScore}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
          <time dateTime={meta.calculatedAt}>更新于 {formatTime(meta.calculatedAt)}</time>
          <span>契约 {meta.contractVersion}</span>
          <span>签名 {meta.projectionSignature}</span>
        </div>
      </div>

      {headline.degraded && headline.degradationWarning && (
        <Alert className="mt-4" variant="warning" title={headline.degradationWarning.message}>
          头部状态回退为基础项目健康；不隐式生成或刷新诊断。
        </Alert>
      )}

      {/* 来源新鲜度条带 */}
      <ul
        className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500"
        aria-label="来源状态"
      >
        {sources.map((s) => (
          <li key={s.sourceKey} className="flex items-center gap-1.5">
            <span
              role="img"
              aria-label={`来源 ${SOURCE_LABEL[s.sourceKey]} ${AVAILABILITY_LABEL[s.meta.availability]}`}
              className={
                s.meta.availability === 'available'
                  ? 'inline-block h-2 w-2 rounded-full bg-success'
                  : s.meta.availability === 'stale' || s.meta.availability === 'empty'
                    ? 'inline-block h-2 w-2 rounded-full bg-warning'
                    : 'inline-block h-2 w-2 rounded-full bg-gray-300'
              }
            />
            <span>{SOURCE_LABEL[s.sourceKey]}</span>
            <span aria-hidden>·</span>
            <span>{AVAILABILITY_LABEL[s.meta.availability]}</span>
          </li>
        ))}
      </ul>

      {/* 冲突警告：保留双方来源值，不合成新总分 */}
      <ConflictWarnings sources={sources} />
    </section>
  )
}

function ConflictWarnings({ sources }: { sources: CommandCenterResponse['data']['sources'] }) {
  const conflicts = sources.flatMap((s) =>
    s.warnings
      .filter((w) => w.code === 'SOURCE_POSTURE_CONFLICT')
      .map((w) => ({ sourceKey: s.sourceKey, warning: w })),
  )
  if (conflicts.length === 0) return null
  return (
    <Alert className="mt-4" variant="warning" title="来源态势存在分歧">
      头部健康状态与风险工作台结论并列展示，系统未合成新的总体评分。
    </Alert>
  )
}

// ─── 来源摘要区（非等权栅格）───────────────────────────────────────────────────

function SourcesSection({ query }: { query: CommandCenterQueryResult }) {
  if (query.isPending) {
    return (
      <section aria-label="来源摘要加载中">
        <Skeleton className="h-36 w-full" />
      </section>
    )
  }
  if (query.isError || !query.data) return null
  const sources = (query.data as CommandCenterResponse).data.sources

  // 非等权：风险与健康占主列，其余并列次列。
  const primaryKeys: CommandCenterSourceKey[] = [
    COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
    COMMAND_CENTER_SOURCES.RISK_WORKBENCH,
  ]
  const primary = sources.filter((s) => primaryKeys.includes(s.sourceKey))
  const secondary = sources.filter((s) => !primaryKeys.includes(s.sourceKey))

  return (
    <section aria-label="来源摘要">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {primary.map((s) => (
          <SourceCard key={s.sourceKey} source={s} emphasized />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {secondary.map((s) => (
          <SourceCard key={s.sourceKey} source={s} />
        ))}
      </div>
    </section>
  )
}

type SourceSummary = CommandCenterResponse['data']['sources'][number]

function SourceCard({
  source,
  emphasized = false,
}: {
  source: SourceSummary
  emphasized?: boolean
}) {
  const facts = source.facts
  return (
    <article
      aria-label={`${SOURCE_LABEL[source.sourceKey]}来源`}
      className={
        emphasized
          ? 'rounded-[var(--radius-md)] border border-border p-5'
          : 'rounded-[var(--radius-md)] border border-border p-4'
      }
    >
      <header className="flex items-center justify-between gap-2">
        <h3
          className={
            emphasized ? 'text-sm font-semibold text-gray-800' : 'text-xs font-medium text-gray-600'
          }
        >
          {SOURCE_LABEL[source.sourceKey]}
        </h3>
        <Badge
          variant={
            source.meta.availability === 'available'
              ? 'success'
              : source.meta.availability === 'stale'
                ? 'warning'
                : source.meta.availability === 'unavailable'
                  ? 'danger'
                  : 'neutral'
          }
        >
          {AVAILABILITY_LABEL[source.meta.availability]}
        </Badge>
      </header>

      {facts?.sourceKey === COMMAND_CENTER_SOURCES.RISK_WORKBENCH && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-label="风险计数">
          <dt className="text-gray-500">开放风险</dt>
          <dd className="font-medium">{facts.openRisks}</dd>
          <dt className="text-gray-500">高 / 严重</dt>
          <dd className="font-medium">
            {facts.highRiskCount} / {facts.criticalRiskCount}
          </dd>
          <dt className="text-gray-500">复查逾期</dt>
          <dd className="font-medium">{facts.overdueReviewCount}</dd>
          <dt className="text-gray-500">健康分</dt>
          <dd className="font-medium">{facts.healthScore ?? '—'}</dd>
        </dl>
      )}

      {facts?.sourceKey === COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS && (
        <div className="mt-3 text-sm">
          <span className="font-medium">{facts.overallScore ?? '—'}</span>
          <span className="ml-2 text-gray-500">{facts.overallLabel}</span>
          {facts.stale && (
            <Badge className="ml-2" variant="warning">
              已过期
            </Badge>
          )}
        </div>
      )}

      {facts?.sourceKey === COMMAND_CENTER_SOURCES.TASK_MILESTONE && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-label="任务里程碑计数">
          <dt className="text-gray-500">逾期 / 受阻</dt>
          <dd className="font-medium">
            {facts.overdueTaskCount} / {facts.blockedTaskCount}
          </dd>
          <dt className="text-gray-500">里程碑总数</dt>
          <dd className="font-medium">{facts.milestoneTotal}</dd>
        </dl>
      )}

      {facts?.sourceKey === COMMAND_CENTER_SOURCES.PROJECT_DASHBOARD && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-label="基础指标">
          <dt className="text-gray-500">进度</dt>
          <dd className="font-medium">{Math.round(facts.progressPercent)}%</dd>
          <dt className="text-gray-500">成员</dt>
          <dd className="font-medium">{facts.memberCount}</dd>
        </dl>
      )}

      {source.meta.availability === 'forbidden' && (
        <p className="mt-3 text-xs text-gray-400">当前账号无该维度查看权限</p>
      )}
      {source.meta.availability === 'unavailable' && (
        <p className="mt-3 text-xs text-gray-400">该来源暂时不可用</p>
      )}
      {source.meta.availability === 'unsupported' && (
        <p className="mt-3 text-xs text-gray-400">该能力暂无安全只读出口</p>
      )}
    </article>
  )
}

// ─── 注意力队列 ────────────────────────────────────────────────────────────────

type AttentionFilter = 'all' | 'stale' | CommandCenterSeverity

function AttentionSection({ projectId, query }: CommandCenterViewProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<AttentionFilter>('all')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [boundedWarning, setBoundedWarning] = useState<string | null>(null)

  const isLoading = query.isPending
  const response = query.isError ? undefined : (query.data as CommandCenterResponse | undefined)
  const items = useMemo(() => response?.data.attention ?? [], [response])

  const visible = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'stale') return items.filter((i) => i.stale)
    return items.filter((i) => i.severity === filter)
  }, [items, filter])

  function followTarget(item: CommandCenterAttentionItem) {
    const target = item.targets[0]
    if (!target) {
      setBoundedWarning('该注意力项暂无安全处理入口，可展开证据查看详情')
      return
    }
    const resolved = resolveCommandCenterTarget(target, { projectId })
    if (resolved.action === 'navigate') {
      router.push(resolved.path)
      return
    }
    if (resolved.action === 'in-page') {
      setEvidenceOpen(true)
      return
    }
    setBoundedWarning('该处理目标当前不可用，请前往对应工作台')
  }

  function openEvidenceFor(item: CommandCenterAttentionItem) {
    if (item.sourceKey !== COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS || !item.entityRef) {
      setBoundedWarning('该项暂无页内证据，可尝试「前往处理」')
      return
    }
    setEvidenceOpen(true)
  }

  if (isLoading) {
    return (
      <section aria-label="注意力队列加载中">
        <Skeleton className="h-64 w-full" />
      </section>
    )
  }

  const truncation = response?.meta.attentionTruncation
  const diagnosisSource = response?.data.sources.find(
    (s) => s.sourceKey === COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS,
  )
  const drawerDiagnosis =
    diagnosisSource?.facts &&
    diagnosisSource.facts.sourceKey === COMMAND_CENTER_SOURCES.HEALTH_DIAGNOSIS
      ? diagnosisSource.facts
      : null

  return (
    <section aria-label="注意力队列">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-800">需要关注的事项</h2>
        <nav aria-label="筛选注意力项" className="flex gap-1">
          {(
            [
              ['all', '全部'],
              ['critical', '严重'],
              ['high', '高'],
              ['medium', '中'],
              ['stale', '待复核'],
            ] as Array<[AttentionFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-state={filter === value ? 'active' : 'inactive'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 aria-[pressed=true]:bg-primary-50 aria-[pressed=true]:text-primary-700"
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {boundedWarning && (
        <Alert className="mt-3" variant="warning" title={boundedWarning}>
          <button type="button" className="underline" onClick={() => setBoundedWarning(null)}>
            知道了
          </button>
        </Alert>
      )}

      {visible.length === 0 ? (
        <EmptyAttention hasItems={items.length > 0} />
      ) : (
        <ol className="mt-4 divide-y divide-border rounded-[var(--radius-md)] border border-border">
          {visible.map((item) => (
            <li
              key={item.attentionId}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(item.severity)}>
                    {SEVERITY_LABEL[item.severity]}
                  </Badge>
                  <span className="truncate text-sm font-medium text-gray-800">{item.label}</span>
                  {item.stale && <Badge variant="warning">需复核</Badge>}
                  <span className="text-xs text-gray-400">{SOURCE_LABEL[item.sourceKey]}</span>
                </div>
                {item.dueAt && (
                  <p className="mt-1 text-xs text-gray-400">到期 {formatTime(item.dueAt)}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openEvidenceFor(item)}>
                  查看证据
                </Button>
                {item.targets.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => followTarget(item)}>
                    前往处理
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {truncation?.truncated && (
        <p className="mt-3 text-xs text-gray-400" role="status">
          已按稳定规则截断：显示 {truncation.returned} 条，另有 {truncation.omitted} 条未展示。
        </p>
      )}

      {/* 页内只读证据抽屉 */}
      <HealthEvidenceDrawer
        open={evidenceOpen}
        onOpenChange={(open) => {
          setEvidenceOpen(open)
          if (!open) setBoundedWarning(null)
        }}
        projectId={projectId}
        diagnosis={drawerDiagnosis}
        freshness={drawerDiagnosis ? (drawerDiagnosis.stale ? 'stale' : 'current') : null}
      />
    </section>
  )
}

function EmptyAttention({ hasItems }: { hasItems: boolean }) {
  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-border p-8 text-center">
      <p className="text-sm font-medium text-gray-700">
        {hasItems ? '当前筛选下没有匹配的注意力项' : '当前没有需要立即关注的事项'}
      </p>
      <p className="mt-1 text-xs text-gray-400">
        {hasItems
          ? '可切换筛选条件查看其他事项。'
          : '这不代表零风险证明；各来源状态见上方条带，处理动作请前往对应工作台。'}
      </p>
    </div>
  )
}

// ─── utils ─────────────────────────────────────────────────────────────────────

function severityVariant(severity: CommandCenterSeverity) {
  switch (severity) {
    case 'critical':
      return 'danger'
    case 'high':
      return 'warning'
    default:
      return 'neutral'
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
