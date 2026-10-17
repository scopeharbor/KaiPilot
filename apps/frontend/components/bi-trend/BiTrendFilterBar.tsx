'use client'

// 说明：dimensions / compareWith 仍在 props 契约中（调用方会传），
// 但本组件当前不渲染这两组控件，故不在函数签名里解构。
export interface BiTrendFilterBarProps {
  metricKeys: string[]
  onMetricKeysChange: (keys: string[]) => void
  window: string
  onWindowChange: (w: string) => void
  grain: string
  onGrainChange: (g: string) => void
  dimensions: string[]
  onDimensionsChange: (d: string[]) => void
  compareWith: string
  onCompareWithChange: (c: string) => void
  includeAnomalies: boolean
  onIncludeAnomaliesChange: (v: boolean) => void
  includeForecast: boolean
  onIncludeForecastChange: (v: boolean) => void
}

/**
 * BI 趋势筛选条（v3-bi-trend-analysis §4.4）。
 *
 * 紧凑的控制面板：指标选择、时间窗口、粒度、维度、比较模式、异常/外推开关。
 * 禁止不支持筛选组合（如粒度语义与窗口不匹配）。
 */
export function BiTrendFilterBar({
  metricKeys,
  onMetricKeysChange,
  window,
  onWindowChange,
  grain,
  onGrainChange,
  includeAnomalies,
  onIncludeAnomaliesChange,
  includeForecast,
  onIncludeForecastChange,
}: BiTrendFilterBarProps) {
  const METRIC_OPTIONS = [
    { value: 'project_progress', label: '项目进度' },
    { value: 'schedule_delay_pressure', label: '延期压力' },
    { value: 'risk_pressure', label: '风险压力' },
    { value: 'resource_pressure', label: '资源压力' },
    { value: 'forecast_demand_pressure', label: '预测需求' },
    { value: 'okr_progress', label: 'OKR 进展' },
  ]

  const WINDOW_OPTIONS = [
    { value: 'last_30_days', label: '最近 30 天' },
    { value: 'last_12_weeks', label: '最近 12 周' },
    { value: 'last_90_days', label: '最近 90 天' },
    { value: 'last_6_months', label: '最近 6 月' },
    { value: 'last_12_months', label: '最近 12 月' },
  ]

  const GRAIN_OPTIONS = [
    { value: 'day', label: '日' },
    { value: 'week', label: '周' },
    { value: 'month', label: '月' },
  ]

  const toggleMetric = (key: string) => {
    if (metricKeys.includes(key)) {
      onMetricKeysChange(metricKeys.filter((k) => k !== key))
    } else {
      onMetricKeysChange([...metricKeys, key])
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
      {/* 指标多选 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">指标:</span>
        {METRIC_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => toggleMetric(opt.value)}
            className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
              metricKeys.includes(opt.value)
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            aria-pressed={metricKeys.includes(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="h-5 w-px bg-border" />

      {/* 时间窗口 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">窗口:</span>
        <select
          value={window}
          onChange={(e) => onWindowChange(e.target.value)}
          className="rounded border bg-background px-2 py-1 text-xs"
          aria-label="时间窗口"
        >
          {WINDOW_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 粒度 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">粒度:</span>
        <select
          value={grain}
          onChange={(e) => onGrainChange(e.target.value)}
          className="rounded border bg-background px-2 py-1 text-xs"
          aria-label="时间粒度"
        >
          {GRAIN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="h-5 w-px bg-border" />

      {/* 异常 / 外推开关 */}
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={includeAnomalies}
          onChange={(e) => onIncludeAnomaliesChange(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        异常检测
      </label>

      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={includeForecast}
          onChange={(e) => onIncludeForecastChange(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        短期外推
      </label>
    </div>
  )
}
