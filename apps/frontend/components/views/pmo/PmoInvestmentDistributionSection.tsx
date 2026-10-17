'use client'

// PMO 投入分布区块（v3-pmo-investment-distribution §5.4 / §5.6 / §5.8 / §5.10）。
//
// 该 change 的 types / 后端 / API client / hooks 均已落地，唯独此 UI 区块此前从未写出来，
// 导致 27 条页面测试里 25 条失败。本文件按已归档规范与既有契约补齐。
//
// 红线：
//   - 只读展示：不提供任何写入/应用动作。
//   - 脱敏桶不展示被隐藏的数量（projectCount 为 null 时只显示「不可用」）。
//   - 财务口径（预算/成本/ROI 等）返回 unsupported 时显示不可用，绝不画 0 值图表。
//   - 下钻二次授权失败时显示空态，不泄露受限项目。
//   - 区块内不渲染任何外部锚点链接。

import { useMemo, useState } from 'react'
import {
  useInvestmentDistributionCatalogue,
  useInvestmentDistributionDrillDown,
  useInvestmentDistributionSummary,
} from '@/hooks/use-pmo-investment-distribution'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/Sheet'
import { PieChart } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  PmoInvestmentBucket,
  PmoInvestmentDisplayMode,
  PmoInvestmentDistributionBasis,
  PmoInvestmentDistributionDimension,
  PmoInvestmentDistributionWarning,
} from '@aiproj/types'

// ─── 中文标签 ─────────────────────────────────────────────────────────────────

const BASIS_LABELS: Record<string, string> = {
  project_count: '项目数',
  planned_effort_hours: '计划工时',
  estimated_effort_hours: '预估工时',
  resource_allocation_percent: '资源投入比',
  budget_amount: '预算金额',
  actual_cost: '实际成本',
  forecast_cost: '预测成本',
  budget_execution_rate: '预算执行率',
  roi: 'ROI',
  revenue: '收入',
  npv: 'NPV',
  irr: 'IRR',
}

const DIMENSION_LABELS: Record<string, string> = {
  project_type: '项目类型',
  lifecycle_phase: '生命周期阶段',
  priority: '优先级',
  status: '状态',
  manager: '负责人',
  department: '部门',
  strategic_theme: '战略主题',
  traffic_light_status: '交通灯状态',
}

const DISPLAY_MODE_LABELS: Record<string, string> = {
  donut: '环形图',
  pie: '饼图',
  horizontal_bar: '水平条形图',
  stacked_bar: '堆叠条形图',
  flow: '流向图',
  matrix: '矩阵图',
}

/** 图例标签上限：超出截断并补省略号，避免撑破控件。 */
const LEGEND_LABEL_MAX = 11

/** 桶配色只用于图例色块，信息不靠颜色单通道传达（标签与占比始终是文本）。 */
const BUCKET_TONES = [
  'bg-primary-500',
  'bg-success',
  'bg-warning',
  'bg-info',
  'bg-danger',
  'bg-gray-400',
]

function truncateLabel(label: string): string {
  return label.length > LEGEND_LABEL_MAX ? `${label.slice(0, LEGEND_LABEL_MAX)}…` : label
}

function warningKey(warning: PmoInvestmentDistributionWarning, index: number): string {
  return `${warning.code}-${index}`
}

// ─── 图表（六种展示模式共用同一份 normalized 分布） ──────────────────────────

function DistributionChart({
  buckets,
  mode,
}: {
  buckets: PmoInvestmentBucket[]
  mode: PmoInvestmentDisplayMode
}) {
  const isRadial = mode === 'donut' || mode === 'pie'
  return (
    <div
      className="rounded-[var(--radius-md)] border border-border p-4"
      role="img"
      aria-label={`投入分布${DISPLAY_MODE_LABELS[mode] ?? ''}`}
    >
      {/* 形态条：环形/饼用同心块，其余用条带，均按 percent 归一 */}
      <div
        className={cn(
          'flex w-full overflow-hidden',
          isRadial ? 'h-24 rounded-full' : 'h-6 rounded-[var(--radius-md)]',
          mode === 'matrix' && 'flex-wrap gap-0.5',
          mode === 'flow' && 'gap-1',
        )}
      >
        {buckets.map((bucket, index) => (
          <div
            key={bucket.key}
            className={cn(BUCKET_TONES[index % BUCKET_TONES.length])}
            style={{ width: `${Math.max(bucket.percent, 1)}%` }}
            aria-hidden
          />
        ))}
      </div>

      {/* 图例：标签截断，占比以文本给出 */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {buckets.map((bucket, index) => (
          <li key={bucket.key} className="flex min-w-0 items-center gap-1.5 text-xs">
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                BUCKET_TONES[index % BUCKET_TONES.length],
              )}
              aria-hidden
            />
            <span className="truncate text-gray-700">{truncateLabel(bucket.label)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── 桶表格 ───────────────────────────────────────────────────────────────────

function BucketRows({
  buckets,
  onDrillDown,
}: {
  buckets: PmoInvestmentBucket[]
  onDrillDown: (bucket: PmoInvestmentBucket) => void
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {buckets.map((bucket) => {
        const redacted = bucket.status === 'redacted' || bucket.projectCount === null
        return (
          <li key={bucket.key}>
            <button
              type="button"
              onClick={() => onDrillDown(bucket)}
              className={cn(
                'flex min-h-12 w-full items-center justify-between gap-3 rounded-[var(--radius-md)]',
                'border border-border px-3 py-2 text-left transition-colors hover:bg-gray-50',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{bucket.label}</span>
              <span className="shrink-0 text-xs text-gray-600">
                {/* 脱敏桶只给占比与「不可用」，绝不回填被隐藏的项目数 */}
                {redacted ? '不可用' : `${bucket.percent}% · ${bucket.projectCount} 个项目`}
              </span>
              {redacted && (
                <Badge variant="neutral" className="shrink-0 text-[10px]">
                  已脱敏
                </Badge>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ─── 区块主体 ─────────────────────────────────────────────────────────────────

export function PmoInvestmentDistributionSection() {
  const { data: catalogue } = useInvestmentDistributionCatalogue()

  const [basis, setBasis] = useState<PmoInvestmentDistributionBasis>('project_count')
  const [dimension, setDimension] = useState<PmoInvestmentDistributionDimension>('project_type')
  const [displayMode, setDisplayMode] = useState<PmoInvestmentDisplayMode>('donut')
  const [topN, setTopN] = useState<number>(catalogue?.topN?.default ?? 10)
  const [drillDownBucket, setDrillDownBucket] = useState<PmoInvestmentBucket | null>(null)

  const query = useMemo(
    () => ({ basis, dimension, displayMode, topN }),
    [basis, dimension, displayMode, topN],
  )

  const { data: summary, isLoading, error } = useInvestmentDistributionSummary(query)
  const { data: drillDown, isLoading: drillDownLoading } = useInvestmentDistributionDrillDown(
    drillDownBucket ? { ...query, bucketKey: drillDownBucket.key } : undefined,
  )

  const warnings = summary?.warnings ?? []
  const buckets = summary?.buckets ?? []
  const meta = summary?.meta
  const isStale = meta?.sourceFreshness?.some((s) => s.isStale) ?? false
  const isRedacted = warnings.some((w) => w.code === 'PERMISSION_REDACTED')
  const financialUnsupported = warnings.find((w) => w.code === 'FINANCIAL_BASIS_UNSUPPORTED')

  const basisOptions = useMemo(
    () => [
      ...(catalogue?.nonFinancialBasis ?? []),
      ...(catalogue?.unsupportedFinancialBasis ?? []),
    ],
    [catalogue],
  )
  const topNOptions = useMemo(() => {
    const max = catalogue?.topN?.max ?? 20
    return [5, 10, 15, 20].filter((n) => n <= max)
  }, [catalogue])

  return (
    <Card className="rounded-[var(--radius-md)] border border-border">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <PieChart className="h-4 w-4 text-teal-600" />
          投入分布
          {isStale && (
            <Badge variant="warning" className="text-[10px]">
              来源过期
            </Badge>
          )}
        </CardTitle>
        {meta && (
          <p className="text-xs text-gray-500">
            {/* 结果被脱敏时不再并列可见项目数，避免与脱敏维度一起给出可推断的口径 */}
            {isRedacted
              ? `${BASIS_LABELS[meta.basis] ?? meta.basis} · ${DIMENSION_LABELS[meta.dimension] ?? meta.dimension}`
              : `${BASIS_LABELS[meta.basis] ?? meta.basis} · ${DIMENSION_LABELS[meta.dimension] ?? meta.dimension} · ${meta.visibleProjectCount} 个可见项目`}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── 控件区：全部由 catalogue 驱动 ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            value={basis}
            onValueChange={(v: string) => setBasis(v as PmoInvestmentDistributionBasis)}
          >
            <SelectTrigger aria-label="投入口径">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {basisOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {BASIS_LABELS[option] ?? option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={dimension}
            onValueChange={(v: string) => setDimension(v as PmoInvestmentDistributionDimension)}
          >
            <SelectTrigger aria-label="分布维度">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(catalogue?.dimensions ?? []).map((option) => (
                <SelectItem key={option} value={option}>
                  {DIMENSION_LABELS[option] ?? option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={displayMode}
            onValueChange={(v: string) => setDisplayMode(v as PmoInvestmentDisplayMode)}
          >
            <SelectTrigger aria-label="展示模式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(catalogue?.displayModes ?? []).map((option) => (
                <SelectItem key={option} value={option}>
                  {DISPLAY_MODE_LABELS[option] ?? option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(topN)} onValueChange={(v: string) => setTopN(Number(v))}>
            <SelectTrigger aria-label="Top-N">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {topNOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  Top {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── 告警条 ── */}
        {warnings.length > 0 && (
          <ul className="flex flex-wrap items-center gap-2">
            {warnings.map((warning, index) => (
              <li key={warningKey(warning, index)} className="flex items-center gap-1.5">
                <Badge variant="warning" className="text-[10px]">
                  {warning.code}
                </Badge>
                <span className="text-xs text-gray-600">{warning.message}</span>
              </li>
            ))}
          </ul>
        )}

        {/* ── 主体：加载 / 错误 / 财务不可用 / 空态 / 正常 ── */}
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <Alert variant="danger">
            <AlertDescription>加载投入分布失败，请稍后重试。</AlertDescription>
          </Alert>
        ) : financialUnsupported ? (
          // 财务口径无一等事实来源：明确置为不可用，不画 0 值图表
          <div className="rounded-[var(--radius-md)] border border-border p-6 text-center">
            <p className="text-sm font-medium text-gray-700">该财务口径当前不可用</p>
          </div>
        ) : buckets.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-border p-6 text-center">
            <p className="text-sm font-medium text-gray-700">暂无可展示的投入分布</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <DistributionChart buckets={buckets} mode={meta?.displayMode ?? displayMode} />
            <BucketRows buckets={buckets} onDrillDown={setDrillDownBucket} />
          </div>
        )}
      </CardContent>

      {/* ── 下钻抽屉：只读明细，二次授权失败时给空态 ── */}
      <Sheet
        open={!!drillDownBucket}
        onOpenChange={(open: boolean) => !open && setDrillDownBucket(null)}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{drillDownBucket?.label ?? ''} · 项目明细</SheetTitle>
            <SheetDescription>只读明细，不提供任何写入动作。</SheetDescription>
          </SheetHeader>
          {drillDownLoading ? (
            <Skeleton className="mt-4 h-24 w-full" />
          ) : (drillDown?.data?.length ?? 0) > 0 ? (
            <ul className="mt-4 flex flex-col gap-1.5">
              {drillDown!.data.map((item) => (
                <li
                  key={item.projectId}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                    {item.projectName}
                  </span>
                  <span className="shrink-0 text-xs text-gray-600">
                    {item.basisValue ?? '不可用'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 rounded-[var(--radius-md)] border border-border p-6 text-center">
              <p className="text-sm font-medium text-gray-700">没有可下钻的项目</p>
              <p className="mt-1 text-xs text-gray-500">
                该桶可能已脱敏，或当前用户没有项目明细权限。
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  )
}

export default PmoInvestmentDistributionSection
