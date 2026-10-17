'use client'

import { Label } from '@/components/ui/Label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import {
  BI_RISK_HEATMAP_METRIC_KEY_VALUES,
  BI_RISK_HEATMAP_WINDOW_VALUES,
  BI_RISK_HEATMAP_DIMENSION_KEY_VALUES,
  BI_RISK_HEATMAP_COMPARE_MODE_VALUES,
  BI_RISK_HEATMAP_METRIC_KEYS,
  type BiRiskHeatmapMetricKey,
  type BiRiskHeatmapWindow,
  type BiRiskHeatmapDimensionKey,
  type BiRiskHeatmapCompareMode,
} from '@aiproj/types'
import { isBiRiskHeatmapDimensionPairUnsafe } from '@aiproj/types'

const METRIC_LABELS: Record<string, string> = {
  [BI_RISK_HEATMAP_METRIC_KEYS.RISK_EXPOSURE_SCORE]: '风险暴露评分',
  [BI_RISK_HEATMAP_METRIC_KEYS.RISK_COUNT]: '风险数量',
  [BI_RISK_HEATMAP_METRIC_KEYS.HIGH_RISK_RATIO]: '高风险占比',
  [BI_RISK_HEATMAP_METRIC_KEYS.OVERDUE_RISK_RATIO]: '逾期风险占比',
  [BI_RISK_HEATMAP_METRIC_KEYS.RISK_DELTA]: '风险变化量',
  [BI_RISK_HEATMAP_METRIC_KEYS.TRAFFIC_LIGHT_RISK_RATIO]: '交通灯风险比',
}

const WINDOW_LABELS: Record<string, string> = {
  last_7_days: '最近 7 天',
  last_30_days: '最近 30 天',
  last_90_days: '最近 90 天',
  last_180_days: '最近 180 天',
  last_365_days: '最近 365 天',
  current_month: '本月',
  current_quarter: '本季度',
  current_year: '本年度',
}

const DIMENSION_LABELS: Record<string, string> = {
  project: '项目',
  portfolio_group: '组合分组',
  risk_category: '风险类别',
  risk_level: '风险等级',
  risk_status: '风险状态',
  assignee: '负责人',
  time_bucket: '时间桶',
  department: '部门',
}

const COMPARE_LABELS: Record<string, string> = {
  previous_period: '与上期对比',
  same_period_last_year: '与去年同期对比',
  none: '无对比',
}

interface BiRiskHeatmapFilterBarProps {
  metricKey: BiRiskHeatmapMetricKey
  onMetricKeyChange: (key: BiRiskHeatmapMetricKey) => void
  window: BiRiskHeatmapWindow
  onWindowChange: (w: BiRiskHeatmapWindow) => void
  rowDimension: BiRiskHeatmapDimensionKey
  onRowDimensionChange: (d: BiRiskHeatmapDimensionKey) => void
  columnDimension: BiRiskHeatmapDimensionKey
  onColumnDimensionChange: (d: BiRiskHeatmapDimensionKey) => void
  compareWith: BiRiskHeatmapCompareMode
  onCompareWithChange: (m: BiRiskHeatmapCompareMode) => void
}

export function BiRiskHeatmapFilterBar({
  metricKey,
  onMetricKeyChange,
  window,
  onWindowChange,
  rowDimension,
  onRowDimensionChange,
  columnDimension,
  onColumnDimensionChange,
  compareWith,
  onCompareWithChange,
}: BiRiskHeatmapFilterBarProps) {
  const unsafeDimPair = isBiRiskHeatmapDimensionPairUnsafe(rowDimension, columnDimension)

  return (
    <div className="flex flex-wrap gap-3 rounded-lg border bg-card p-4">
      {/* 指标 */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">指标</Label>
        <Select
          value={metricKey}
          onValueChange={(v) => onMetricKeyChange(v as BiRiskHeatmapMetricKey)}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BI_RISK_HEATMAP_METRIC_KEY_VALUES.map((k) => (
              <SelectItem key={k} value={k}>
                {METRIC_LABELS[k] ?? k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 时间窗口 */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">时间窗口</Label>
        <Select value={window} onValueChange={(v) => onWindowChange(v as BiRiskHeatmapWindow)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BI_RISK_HEATMAP_WINDOW_VALUES.map((w) => (
              <SelectItem key={w} value={w}>
                {WINDOW_LABELS[w] ?? w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 行维度 */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">行维度</Label>
        <Select
          value={rowDimension}
          onValueChange={(v) => onRowDimensionChange(v as BiRiskHeatmapDimensionKey)}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BI_RISK_HEATMAP_DIMENSION_KEY_VALUES.map((d) => (
              <SelectItem key={d} value={d}>
                {DIMENSION_LABELS[d] ?? d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 列维度 */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">列维度</Label>
        <Select
          value={columnDimension}
          onValueChange={(v) => onColumnDimensionChange(v as BiRiskHeatmapDimensionKey)}
        >
          <SelectTrigger className={cn('w-32', unsafeDimPair && 'border-destructive')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BI_RISK_HEATMAP_DIMENSION_KEY_VALUES.map((d) => (
              <SelectItem key={d} value={d} disabled={d === rowDimension}>
                {DIMENSION_LABELS[d] ?? d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {unsafeDimPair && <p className="text-[10px] text-destructive">行列维度不能相同</p>}
      </div>

      {/* 对比模式 */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">对比</Label>
        <Select
          value={compareWith}
          onValueChange={(v) => onCompareWithChange(v as BiRiskHeatmapCompareMode)}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BI_RISK_HEATMAP_COMPARE_MODE_VALUES.map((m) => (
              <SelectItem key={m} value={m}>
                {COMPARE_LABELS[m] ?? m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}
