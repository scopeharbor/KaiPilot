'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, FileText, GitCompare, Loader2, Plus, Send, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table'
import {
  useAddTrizInnovationOption,
  useCompareTrizInnovationScheme,
  useCreateTrizInnovationScheme,
  useGenerateTrizInnovationNarrative,
  useTrizInnovationDraftHandoff,
  useTrizInnovationSchemes,
  useTrizInnovationSources,
} from '@/hooks/use-triz-innovation-workbench'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import type {
  ImpactDirection,
  InnovationSchemeDTO,
  InnovationSourceRef,
  InnovationWorkbenchSourcesResponse,
} from '@aiproj/types'

const severityLabel: Record<string, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
}

const impactLabel: Record<ImpactDirection, string> = {
  improves: '改善',
  worsens: '加重',
  neutral: '中性',
  uncertain: '不确定',
}

const dimensionLabel = {
  schedule: '工期',
  resource_load: '资源负载',
  risk: '风险',
  scope_flexibility: '范围弹性',
  quality_maintainability: '质量维护',
  change_complexity: '变更复杂度',
} as const

export default function TrizInnovationWorkbenchPage() {
  const projectId = Number(useParams().id)
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const canView = hasPermission('triz_innovation:view') && hasPermission('contradiction:view')
  const canManage = hasPermission('triz_innovation:manage')
  const canHandoff = hasPermission('triz_innovation:handoff')
  const canAi = hasPermission('ai:trigger')

  const [schemeName, setSchemeName] = useState('TRIZ 创新方案')
  const [selectedSchemeId, setSelectedSchemeId] = useState<string | null>(null)
  const [includeDraft, setIncludeDraft] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  const sourcesQuery = useTrizInnovationSources(projectId, { includeDraft, enabled: canView })
  const schemesQuery = useTrizInnovationSchemes(projectId, { perPage: 50 })
  const createScheme = useCreateTrizInnovationScheme(projectId)
  const compareScheme = useCompareTrizInnovationScheme(projectId)
  const generateNarrative = useGenerateTrizInnovationNarrative(projectId)

  const schemes = schemesQuery.data?.data ?? []
  const selectedScheme = useMemo(
    () => schemes.find((scheme) => scheme.schemeId === selectedSchemeId) ?? schemes[0] ?? null,
    [schemes, selectedSchemeId],
  )
  const addOption = useAddTrizInnovationOption(projectId, selectedScheme?.schemeId ?? '')
  const draftHandoff = useTrizInnovationDraftHandoff(projectId, selectedScheme?.schemeId ?? '')

  if (!canView) {
    return (
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 lg:px-10">
        <section className="rounded-lg border border-border bg-background p-8">
          <div className="flex items-center gap-2 text-sm text-muted">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
            <span>无权限查看 TRIZ 创新工作台</span>
          </div>
        </section>
      </main>
    )
  }

  const busy =
    createScheme.isPending ||
    addOption.isPending ||
    compareScheme.isPending ||
    generateNarrative.isPending ||
    draftHandoff.isPending

  if (sourcesQuery.isError || schemesQuery.isError) {
    return (
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-8 lg:px-10">
        <section className="rounded-lg border border-border bg-background p-8">
          <div className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>工作台加载失败</span>
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
            <Sparkles className="h-4 w-4 text-ai" aria-hidden="true" />
            <span>TRIZ Innovation Workbench</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-heading">创新工作台</h1>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={schemeName}
            onChange={(event) => setSchemeName(event.target.value)}
            className="h-9 min-w-[220px]"
            disabled={!canManage || createScheme.isPending}
            aria-label="方案名称"
          />
          <Button
            type="button"
            variant="primary"
            disabled={!canManage || createScheme.isPending || !schemeName.trim()}
            onClick={() =>
              createScheme.mutate(
                { name: schemeName.trim() },
                { onSuccess: (scheme) => setSelectedSchemeId(scheme.schemeId) },
              )
            }
          >
            {createScheme.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            新建方案
          </Button>
        </div>
      </header>

      <section className="grid min-h-[620px] gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
        <SourceColumn
          sources={sourcesQuery.data}
          isLoading={sourcesQuery.isLoading}
          includeDraft={includeDraft}
          onIncludeDraftChange={setIncludeDraft}
          canManage={canManage}
          disabled={!selectedScheme || addOption.isPending}
          onAdd={(source) => {
            if (!selectedScheme) return
            addOption.mutate({
              origin: 'deterministic_mapping',
              sourceRefs: [{ sourceType: source.sourceType, ref: source.ref, hash: source.hash }],
              principleIds: [],
              name: source.title || `${source.sourceType}:${source.ref}`,
              description: '待人工审查的 TRIZ 创新候选路径',
            })
          }}
        />

        <SchemeColumn
          schemes={schemes}
          selectedScheme={selectedScheme}
          selectedSchemeId={selectedScheme?.schemeId ?? null}
          onSelect={setSelectedSchemeId}
          isLoading={schemesQuery.isLoading}
          busy={busy}
          canManage={canManage}
          canAi={canAi}
          onCompare={() => selectedScheme && compareScheme.mutate(selectedScheme.schemeId)}
          onNarrative={() => selectedScheme && generateNarrative.mutate(selectedScheme.schemeId)}
        />

        <ReviewColumn
          scheme={selectedScheme}
          canHandoff={canHandoff}
          isPending={draftHandoff.isPending}
          onHandoff={() => selectedScheme && draftHandoff.mutate({})}
          onOpenDetail={() => setDetailOpen(true)}
        />
      </section>
      <SchemeDetailDrawer open={detailOpen} onOpenChange={setDetailOpen} scheme={selectedScheme} />
    </main>
  )
}

function SourceColumn({
  sources,
  isLoading,
  includeDraft,
  onIncludeDraftChange,
  canManage,
  disabled,
  onAdd,
}: {
  sources?: InnovationWorkbenchSourcesResponse['data']
  isLoading: boolean
  includeDraft: boolean
  onIncludeDraftChange: (value: boolean) => void
  canManage: boolean
  disabled: boolean
  onAdd: (source: InnovationSourceRef) => void
}) {
  const sourceRefs = [
    ...(sources?.contradictions ?? []),
    ...(sources?.analysisArtifacts ?? []).map((artifact) => ({
      sourceType: 'triz_analysis' as const,
      ref: artifact.artifactId,
      hash: artifact.contentHash,
      severity: null,
      stale: artifact.stale,
      title: `TRIZ 分析 ${artifact.artifactId}`,
    })),
  ]

  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-heading">来源</h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={includeDraft}
            onChange={(event) => onIncludeDraftChange(event.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          draft
        </label>
      </div>
      <div className="max-h-[560px] overflow-auto">
        {isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : sourceRefs.length === 0 ? (
          <EmptyBlock icon={FileText} title="暂无来源" />
        ) : (
          <div className="divide-y divide-border">
            {sourceRefs.map((source) => (
              <div key={`${source.sourceType}:${source.ref}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-heading">{source.title}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                      <span>{source.sourceType === 'contradiction' ? '矛盾' : '分析'}</span>
                      {source.severity ? <SeverityBadge severity={source.severity} /> : null}
                      {source.stale ? <span className="text-warning">已过期</span> : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!canManage || disabled}
                    onClick={() => onAdd(source)}
                  >
                    <Plus className="h-4 w-4" />
                    加入方案
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function SchemeColumn({
  schemes,
  selectedScheme,
  selectedSchemeId,
  onSelect,
  isLoading,
  busy,
  canManage,
  canAi,
  onCompare,
  onNarrative,
}: {
  schemes: InnovationSchemeDTO[]
  selectedScheme: InnovationSchemeDTO | null
  selectedSchemeId: string | null
  onSelect: (schemeId: string) => void
  isLoading: boolean
  busy: boolean
  canManage: boolean
  canAi: boolean
  onCompare: () => void
  onNarrative: () => void
}) {
  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-heading">方案篮子</h2>
          <p className="mt-1 text-xs text-muted">确定性评分与静态影响摘要</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!selectedScheme || !canManage || busy}
            onClick={onCompare}
          >
            <GitCompare className="h-4 w-4" />
            生成对比
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!selectedScheme || !canAi || busy}
            onClick={onNarrative}
          >
            <Sparkles className="h-4 w-4 text-ai" />
            生成说明
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-4">
          <Skeleton className="h-[420px] w-full" />
        </div>
      ) : schemes.length === 0 ? (
        <EmptyBlock icon={FileText} title="暂无方案" />
      ) : (
        <div className="grid gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b border-border lg:border-b-0 lg:border-r">
            {schemes.map((scheme) => (
              <button
                key={scheme.schemeId}
                type="button"
                onClick={() => onSelect(scheme.schemeId)}
                className={cn(
                  'flex w-full flex-col gap-2 border-b border-border px-4 py-3 text-left hover:bg-surface',
                  selectedSchemeId === scheme.schemeId && 'bg-primary-50',
                )}
              >
                <span className="truncate text-sm font-medium text-heading">{scheme.name}</span>
                <span className="text-xs text-muted">{scheme.options.length} 个候选</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 p-4">
            {selectedScheme ? <ComparisonTable scheme={selectedScheme} /> : null}
          </div>
        </div>
      )}
    </section>
  )
}

function ComparisonTable({ scheme }: { scheme: InnovationSchemeDTO }) {
  if (scheme.options.length === 0) {
    return <EmptyBlock icon={GitCompare} title="尚未加入候选路径" compact />
  }

  return (
    <div className="overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px]">候选路径</TableHead>
            <TableHead>分数</TableHead>
            {Object.values(dimensionLabel).map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
            <TableHead>Warning</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {scheme.options.map((option) => {
            const score = scheme.scores[option.optionId]
            return (
              <TableRow key={option.optionId}>
                <TableCell>
                  <div className="max-w-[220px]">
                    <div className="truncate font-medium text-heading">{option.name}</div>
                    <div className="truncate text-xs text-muted">{option.description}</div>
                  </div>
                </TableCell>
                <TableCell>{score ? score.total : '-'}</TableCell>
                {Object.keys(dimensionLabel).map((dimension) => (
                  <TableCell key={dimension}>
                    <ImpactBadge value={option.impact[dimension as keyof typeof dimensionLabel]} />
                  </TableCell>
                ))}
                <TableCell>{option.warnings.length}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function ReviewColumn({
  scheme,
  canHandoff,
  isPending,
  onHandoff,
  onOpenDetail,
}: {
  scheme: InnovationSchemeDTO | null
  canHandoff: boolean
  isPending: boolean
  onHandoff: () => void
  onOpenDetail: () => void
}) {
  return (
    <aside className="rounded-lg border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-heading">审查状态</h2>
      </div>
      {!scheme ? (
        <EmptyBlock icon={FileText} title="请选择方案" compact />
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <StatusTile label="状态" value={scheme.status} />
            <StatusTile label="Handoff" value={scheme.handoff.status} />
            <StatusTile
              label="Warning"
              value={String(scheme.options.flatMap((o) => o.warnings).length)}
            />
            <StatusTile label="Hash" value={scheme.schemeHash.slice(0, 12)} />
          </div>

          <Button type="button" variant="secondary" className="w-full" onClick={onOpenDetail}>
            <FileText className="h-4 w-4" />
            查看详情
          </Button>

          {scheme.narrative ? (
            <section className="rounded-md border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-heading">AI 说明</span>
                {scheme.narrative.isFallback ? (
                  <Badge variant="warning">Fallback</Badge>
                ) : (
                  <Badge variant="success">已校验</Badge>
                )}
              </div>
              <p className="mt-2 text-sm text-foreground">{scheme.narrative.narrative}</p>
              {scheme.narrative.cost ? (
                <div className="mt-2 text-xs text-muted">
                  tokens {scheme.narrative.cost.totalTokens ?? 0} · cost{' '}
                  {scheme.narrative.cost.estimatedCost ?? 0}
                </div>
              ) : null}
            </section>
          ) : null}

          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={
              !canHandoff ||
              isPending ||
              scheme.options.length === 0 ||
              scheme.handoff.status === 'stale'
            }
            onClick={onHandoff}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            创建待审核草案
          </Button>
          {scheme.handoff.blockedReason ? (
            <p className="text-sm text-warning">{scheme.handoff.blockedReason}</p>
          ) : null}
        </div>
      )}
    </aside>
  )
}

function SchemeDetailDrawer({
  open,
  onOpenChange,
  scheme,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scheme: InnovationSchemeDTO | null
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex max-w-[680px] flex-col overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{scheme?.name ?? '方案详情'}</SheetTitle>
          <SheetDescription>来源、评分、说明、审查和 Draft Layer 状态</SheetDescription>
        </SheetHeader>
        {!scheme ? (
          <EmptyBlock icon={FileText} title="请选择方案" compact />
        ) : (
          <div className="space-y-5 p-6">
            <section>
              <h3 className="text-sm font-semibold text-heading">来源 refs</h3>
              <div className="mt-3 divide-y divide-border rounded-md border border-border">
                {scheme.options.flatMap((option) => option.sourceRefs).length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted">暂无来源。</p>
                ) : (
                  scheme.options.flatMap((option) =>
                    option.sourceRefs.map((source) => (
                      <div
                        key={`${option.optionId}:${source.sourceType}:${source.ref}`}
                        className="px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-medium text-heading">
                            {source.title}
                          </span>
                          {source.stale ? (
                            <Badge variant="warning">已过期</Badge>
                          ) : (
                            <Badge variant="outline">有效</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {source.sourceType}:{source.ref} ·{' '}
                          {source.hash?.slice(0, 16) ?? 'no-hash'}
                        </div>
                      </div>
                    )),
                  )
                )}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-heading">评分明细</h3>
              <div className="mt-3 space-y-3">
                {scheme.options.map((option) => {
                  const score = scheme.scores[option.optionId]
                  return (
                    <div key={option.optionId} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium text-heading">
                          {option.name}
                        </span>
                        <Badge variant={score ? 'primary' : 'outline'}>
                          {score ? score.total : '未评分'}
                        </Badge>
                      </div>
                      {score ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
                          <span>严重度 {score.severity}</span>
                          <span>置信度 {score.confidence}</span>
                          <span>warning {score.warningPenalty}</span>
                          <span>hash {score.hashCompleteness}</span>
                          <span>适用性 {score.applicability}</span>
                          <span>评审 {score.reviewState}</span>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="rounded-md border border-border bg-surface p-3">
              <h3 className="text-sm font-semibold text-heading">AI 说明状态</h3>
              {scheme.narrative ? (
                <div className="mt-2 text-sm text-foreground">
                  <div className="mb-2 flex items-center gap-2">
                    {scheme.narrative.isFallback ? (
                      <Badge variant="warning">Fallback</Badge>
                    ) : (
                      <Badge variant="success">通过校验</Badge>
                    )}
                    <span className="text-xs text-muted">
                      {scheme.narrative.provider ?? 'n/a'} / {scheme.narrative.model ?? 'n/a'}
                    </span>
                  </div>
                  <p>{scheme.narrative.narrative}</p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted">暂无 AI 说明。</p>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold text-heading">审计摘要</h3>
              <dl className="mt-3 grid gap-2 text-sm">
                <DetailRow label="创建人" value={String(scheme.createdBy)} />
                <DetailRow label="创建时间" value={scheme.createdAt} />
                <DetailRow label="更新时间" value={scheme.updatedAt ?? '-'} />
                <DetailRow label="复核时间" value={scheme.reviewedAt ?? '-'} />
                <DetailRow label="对比 ref" value={scheme.comparisonRef ?? '-'} />
              </dl>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-heading">Draft Layer</h3>
              <div className="mt-3 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted">{scheme.handoff.status}</span>
                  {scheme.handoff.draftSessionRef ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/draft-layer/${scheme.handoff.draftSessionRef}`}>打开草案</Link>
                    </Button>
                  ) : null}
                </div>
                {scheme.handoff.blockedReason ? (
                  <p className="mt-2 text-sm text-warning">{scheme.handoff.blockedReason}</p>
                ) : null}
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate text-heading">{value}</dd>
    </div>
  )
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-heading">{value}</div>
    </div>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        severity === 'critical' && 'bg-danger-bg text-danger',
        severity === 'high' && 'bg-warning-bg text-warning',
        severity === 'medium' && 'bg-info-bg text-info',
        severity === 'low' && 'bg-success-bg text-success',
      )}
    >
      {severityLabel[severity] ?? severity}
    </span>
  )
}

function ImpactBadge({ value }: { value: ImpactDirection }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs',
        value === 'improves' && 'bg-success-bg text-success',
        value === 'worsens' && 'bg-warning-bg text-warning',
        value === 'neutral' && 'bg-surface text-muted',
        value === 'uncertain' && 'bg-info-bg text-info',
      )}
    >
      {impactLabel[value]}
    </span>
  )
}

function EmptyBlock({
  icon: Icon,
  title,
  compact = false,
}: {
  icon: typeof FileText
  title: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'p-6' : 'p-10',
      )}
    >
      <Icon className="h-8 w-8 text-muted" aria-hidden="true" />
      <p className="mt-2 text-sm text-muted">{title}</p>
    </div>
  )
}
