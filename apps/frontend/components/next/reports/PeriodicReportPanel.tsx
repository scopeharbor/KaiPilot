'use client'

/**
 * PeriodicReportPanel —— 新轨「AI 周期报表」主面板（v3-ui-next-reports-domain W2）。
 *
 * 覆盖 tasks 2.1/2.2：周报/月报模板选择、自然周/自然月跨度自动推算与上一周期
 * 回溯窗口、干跑预览（dry-run）、数据覆盖度指标卡、blocking 阻断禁用与异步生成
 * 作业触发（激活 ReportJobStatusIndicator）。
 *
 * 契约事实（与后端 `periodic_report_controller` 对齐）：
 * - preview：`POST .../periodic/preview`，返回 `{ data: { templateId, title, dateRange,
 *   prevDateRange, dataSources(Record), warnings, blocking, sourceHash, ... } }`；
 * - generate：`POST .../periodic/generate` 需要 `previewSnapshotHash`（取自预览 sourceHash），
 *   返回 `{ data: { version, job, ... } }`；job 落库即回 versionId；
 * - 请求体字段为 `fromDate/toDate`（非 periodStart/periodEnd）。
 * 权限：`report:create`（缺失时表单只读且生成按钮禁用）。
 * RL-01：AI 意图仅预填参数，绝不自动发起生成；RL-07：数据覆盖如实呈现，缺失数据源
 * 显式置灰标注，不虚报指标。
 */
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, RotateCw, Sparkles } from 'lucide-react'
import type { AiPeriodicTemplateId, AiPeriodicPreviewRequest } from '@aiproj/types'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import { reportV2Keys, useV2PeriodicGenerate, useV2PeriodicPreview } from '@/hooks/use-reports-v2'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { ReportJobStatusIndicator } from './ReportJobStatusIndicator'

// ---------------------------------------------------------------------------
// 周期推算（纯函数，供测试直接断言）
// ---------------------------------------------------------------------------

export interface PeriodRangeSelection {
  fromDate: string
  toDate: string
  prevFromDate: string
  prevToDate: string
}

/** 本地自然日格式化 YYYY-MM-DD。 */
export function formatDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 上一周期回溯窗口 —— 与后端 `periodic_report_controller.derivePrevPeriod` 同口径：
 * 等时长窗口，紧邻当前周期（prevTo = from - 1ms，prevFrom = prevTo - span）。
 * 全部以 UTC 日历运算，规避夏令时偏移，输出与后端 toISOString 切片口径一致。
 */
export function derivePreviousRange(
  fromDate: string,
  toDate: string,
): { prevFromDate: string; prevToDate: string } {
  const [fromY = 1970, fromM = 1, fromD = 1] = fromDate.split('-').map(Number)
  const [toY = 1970, toM = 1, toD = 1] = toDate.split('-').map(Number)
  const fromMs = Date.UTC(fromY, (fromM ?? 1) - 1, fromD ?? 1)
  const toMs = Date.UTC(toY, (toM ?? 1) - 1, toD ?? 1)
  const spanMs = toMs - fromMs
  const prevToMs = fromMs - 1
  const prevFromMs = prevToMs - spanMs
  return {
    prevFromDate: new Date(prevFromMs).toISOString().slice(0, 10),
    prevToDate: new Date(prevToMs).toISOString().slice(0, 10),
  }
}

/**
 * 按模板类型推算默认周期：
 * - weekly-ai-summary：锚点所在自然周（周一 ～ 周日）；
 * - monthly-ai-summary：锚点所在自然月（1 日 ～ 月末）。
 * 上一对比周期随当前窗口回溯。
 */
export function computePeriodRange(
  templateId: AiPeriodicTemplateId,
  anchor: Date = new Date(),
): PeriodRangeSelection {
  const isMonthly = templateId === 'monthly-ai-summary'
  let from: Date
  let to: Date
  if (isMonthly) {
    from = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  } else {
    const day = anchor.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + diffToMonday)
    to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6)
  }
  const fromDate = formatDateOnly(from)
  const toDate = formatDateOnly(to)
  const prev = derivePreviousRange(fromDate, toDate)
  return { fromDate, toDate, ...prev }
}

export type PeriodPreset = 'this-week' | 'last-week' | 'this-month' | 'last-month'

/** 快捷周期选项（本周/上周/本月/上月），供面板按钮组使用。 */
export function computePresetRange(
  preset: PeriodPreset,
  anchor: Date = new Date(),
): PeriodRangeSelection {
  const isMonth = preset === 'this-month' || preset === 'last-month'
  const offset = preset === 'last-week' || preset === 'last-month' ? -1 : 0
  if (isMonth) {
    const from = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1)
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 0)
    const fromDate = formatDateOnly(from)
    const toDate = formatDateOnly(to)
    const prev = derivePreviousRange(fromDate, toDate)
    return { fromDate, toDate, ...prev }
  }
  const shifted = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + offset * 7)
  const day = shifted.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(
    shifted.getFullYear(),
    shifted.getMonth(),
    shifted.getDate() + diffToMonday,
  )
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  const fromDate = formatDateOnly(monday)
  const toDate = formatDateOnly(sunday)
  const prev = derivePreviousRange(fromDate, toDate)
  return { fromDate, toDate, ...prev }
}

// ---------------------------------------------------------------------------
// 预览载荷本地类型（与后端响应结构对齐；v2PeriodicPreview 返回 unknown）
// ---------------------------------------------------------------------------

export interface PeriodicPreviewWarning {
  level: 'info' | 'warning' | 'critical'
  message: string
  code?: string
  /** 兼容设计文档描述的逐条阻断标记（后端以响应级 blocking 为准）。 */
  blocking?: boolean
}

export interface PeriodicPreviewSourceResult {
  sourceKey?: string
  status?: string
  data?: Record<string, unknown> | null
}

export interface PeriodicPreviewPayload {
  templateId?: string
  title?: string
  dateRange?: { fromDate?: string; toDate?: string }
  prevDateRange?: { fromDate?: string; toDate?: string }
  periodType?: 'weekly' | 'monthly'
  dataSources?: Record<string, PeriodicPreviewSourceResult> | PeriodicPreviewSourceResult[]
  warnings?: PeriodicPreviewWarning[]
  blocking?: boolean
  sourceHash?: string
}

export interface PeriodicPreviewEnvelope {
  data?: PeriodicPreviewPayload
}

export interface PeriodicJobRef {
  id?: number
  status?: string
  versionId?: number | null
}

export interface PeriodicGenerateEnvelope {
  data?: {
    version?: { id?: number } | null
    job?: PeriodicJobRef | null
  } | null
}

/** 是否存在阻断（响应级 blocking 或逐条 blocking:true）。 */
export function hasBlockingPreview(payload: PeriodicPreviewPayload | null | undefined): boolean {
  if (!payload) return false
  if (payload.blocking === true) return true
  return (payload.warnings ?? []).some((w) => w.blocking === true)
}

export interface PeriodicCoverageStat {
  key: string
  label: string
  /** 主数值；null = 该数据源未就绪（诚实置灰，RL-07）。 */
  value: number | null
  sub: string
}

function toSourceMap(
  dataSources: PeriodicPreviewPayload['dataSources'],
): Record<string, PeriodicPreviewSourceResult> {
  if (!dataSources) return {}
  if (Array.isArray(dataSources)) {
    const map: Record<string, PeriodicPreviewSourceResult> = {}
    for (const item of dataSources) {
      if (item?.sourceKey) map[item.sourceKey] = item
    }
    return map
  }
  return dataSources
}

function pickNumber(source: PeriodicPreviewSourceResult | undefined, field: string): number | null {
  if (!source || source.status !== 'available' || !source.data) return null
  const value = source.data[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 数据覆盖度指标派生：任务更新/工时投入/活跃风险/里程碑/关键路径。
 * 工时取自任务域既有 estimated_hours / actual_hours 的只读合计；项目内无任何工时
 * 登记时诚实置灰（RL-07），绝不伪造数值。
 */
export function derivePeriodicCoverage(
  payload: PeriodicPreviewPayload | null,
): PeriodicCoverageStat[] {
  if (!payload) return []
  const sources = toSourceMap(payload.dataSources)
  const taskSource = sources['task_summary']
  const dashboard = sources['dashboard_metrics']
  const riskSource = sources['risk_summary']
  const scheduleSource = sources['schedule_summary']

  const taskTotal = pickNumber(taskSource, 'totalTasks') ?? pickNumber(dashboard, 'taskTotal')
  const completed =
    pickNumber(taskSource, 'completedTasks') ?? pickNumber(dashboard, 'completedTasks')
  const overdue =
    pickNumber(taskSource, 'overdueTasks') ?? pickNumber(dashboard, 'overdueTaskCount')
  const taskAvailable = taskTotal !== null

  const riskTotal = pickNumber(riskSource, 'totalRisks')
  const openRisks = pickNumber(riskSource, 'openRisks')
  const criticalRisks = pickNumber(riskSource, 'criticalRisks')

  const milestoneTotal =
    pickNumber(dashboard, 'milestoneTotal') ?? pickNumber(taskSource, 'milestoneCount')
  const completedMilestones =
    pickNumber(dashboard, 'completedMilestones') ?? pickNumber(taskSource, 'completedMilestones')
  const milestoneAvailable = milestoneTotal !== null

  const criticalPathTasks = pickNumber(scheduleSource, 'tasksOnCriticalPath')
  const hasCircular =
    scheduleSource?.status === 'available' && scheduleSource.data?.hasCircularDependency === true

  const estimatedHours = pickNumber(taskSource, 'estimatedHoursTotal')
  const actualHours = pickNumber(taskSource, 'actualHoursTotal')
  const hoursRecordedTasks = pickNumber(taskSource, 'hoursRecordedTasks') ?? 0
  const hoursAvailable = hoursRecordedTasks > 0 && (estimatedHours !== null || actualHours !== null)

  return [
    {
      key: 'task-update',
      label: '任务更新',
      value: taskTotal,
      sub: taskAvailable ? `${completed ?? 0} 已完成 · ${overdue ?? 0} 逾期` : '任务数据源未就绪',
    },
    {
      key: 'hours-logged',
      label: '工时投入',
      value: hoursAvailable ? (actualHours ?? estimatedHours) : null,
      sub: hoursAvailable
        ? `实际 ${actualHours ?? 0}h · 估算 ${estimatedHours ?? 0}h（${hoursRecordedTasks} 任务登记）`
        : '暂无工时登记（任务未填写估算/实际工时）',
    },
    {
      key: 'risk-open',
      label: '风险敞口',
      value: riskTotal ?? openRisks,
      sub:
        riskTotal !== null || openRisks !== null
          ? `${openRisks ?? 0} 活跃 · ${criticalRisks ?? 0} 高危`
          : '风险数据源未就绪',
    },
    {
      key: 'milestone',
      label: '里程碑',
      value: milestoneTotal,
      sub: milestoneAvailable ? `${completedMilestones ?? 0} 已完成` : '里程碑数据源未就绪',
    },
    {
      key: 'critical-path',
      label: '关键路径任务',
      value: criticalPathTasks,
      sub:
        scheduleSource?.status === 'available'
          ? hasCircular
            ? '检测到依赖环路'
            : '排程分析可用'
          : '排程数据源未就绪',
    },
  ]
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export interface PeriodicReportPanelProps {
  projectId: number
  /** AI 同事/深链预填模板（`weekly-ai-summary` | `monthly-ai-summary`）。 */
  initialTemplateId?: AiPeriodicTemplateId | null
  /** 生成作业成功（服务端版本已落库）回调 —— 容器切换到版本审阅并定位该版本。 */
  onJobSucceeded?: (versionId: number | null) => void
}

const PERIODIC_TEMPLATE_OPTIONS: Array<{
  templateId: AiPeriodicTemplateId
  label: string
  caption: string
}> = [
  { templateId: 'weekly-ai-summary', label: '项目周报', caption: '本周进展与风险摘要' },
  { templateId: 'monthly-ai-summary', label: '项目月报', caption: '本月里程碑与资源趋势' },
]

const PRESET_OPTIONS: Array<{ preset: PeriodPreset; label: string }> = [
  { preset: 'this-week', label: '本周' },
  { preset: 'last-week', label: '上周' },
  { preset: 'this-month', label: '本月' },
  { preset: 'last-month', label: '上月' },
]

/** 从 URL 查询参数解析意图预填模板（仅初始化读取一次）。 */
function resolveInitialTemplate(
  propValue: AiPeriodicTemplateId | null | undefined,
): AiPeriodicTemplateId {
  if (propValue === 'weekly-ai-summary' || propValue === 'monthly-ai-summary') return propValue
  if (typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('template')
    if (param === 'weekly-ai-summary' || param === 'monthly-ai-summary') return param
  }
  return 'weekly-ai-summary'
}

export function PeriodicReportPanel({
  projectId,
  initialTemplateId,
  onJobSucceeded,
}: PeriodicReportPanelProps) {
  const tier = useImmersionTier()
  const canGenerate = usePermissions().can('report:create')
  const queryClient = useQueryClient()

  const [templateId, setTemplateId] = useState<AiPeriodicTemplateId>(() =>
    resolveInitialTemplate(initialTemplateId),
  )
  const [range, setRange] = useState<PeriodRangeSelection>(() =>
    computePeriodRange(resolveInitialTemplate(initialTemplateId)),
  )
  /** 已提交预检的请求（null = 尚未预检或参数已变更需重新预检）。 */
  const [previewReq, setPreviewReq] = useState<AiPeriodicPreviewRequest | null>(null)
  const [activeJobId, setActiveJobId] = useState<number | null>(null)
  const [rangeError, setRangeError] = useState<string | null>(null)

  const previewQuery = useV2PeriodicPreview(projectId, previewReq)
  const generateMutation = useV2PeriodicGenerate(projectId)

  // 预检数据（queryKey 仅按项目维度缓存，需与当前参数比对防止回显陈旧结果）
  const rawPayload = (previewQuery.data as PeriodicPreviewEnvelope | undefined)?.data ?? null
  const previewMatchesForm =
    rawPayload !== null &&
    rawPayload.templateId === templateId &&
    rawPayload.dateRange?.fromDate === range.fromDate &&
    rawPayload.dateRange?.toDate === range.toDate
  const previewPayload = previewMatchesForm ? rawPayload : null
  const blockingWarnings = (previewPayload?.warnings ?? []).filter(
    (w) => w.level === 'critical' || w.blocking === true,
  )
  const isBlocking = hasBlockingPreview(previewPayload)
  const coverage = derivePeriodicCoverage(previewPayload)
  const canStart = Boolean(
    canGenerate && previewPayload && !isBlocking && previewPayload.sourceHash,
  )

  function handleTemplateChange(next: AiPeriodicTemplateId) {
    if (next === templateId) return
    setTemplateId(next)
    setRange(computePeriodRange(next))
    setPreviewReq(null)
    setRangeError(null)
  }

  function applyPreset(preset: PeriodPreset) {
    setRange(computePresetRange(preset))
    setPreviewReq(null)
    setRangeError(null)
  }

  function handleDateChange(field: 'fromDate' | 'toDate', value: string) {
    setRange((prev) => {
      const next = { ...prev, [field]: value }
      if (!next.fromDate || !next.toDate) return next
      const derived = derivePreviousRange(next.fromDate, next.toDate)
      return { ...next, ...derived }
    })
    setPreviewReq(null)
    setRangeError(null)
  }

  function handlePreview() {
    if (!range.fromDate || !range.toDate) {
      setRangeError('请先选择完整的周期范围')
      return
    }
    if (range.fromDate > range.toDate) {
      setRangeError('开始日期不能晚于结束日期')
      return
    }
    setRangeError(null)
    setPreviewReq({ templateId, fromDate: range.fromDate, toDate: range.toDate })
  }

  async function handleGenerate() {
    if (!previewPayload || isBlocking || !canGenerate) return
    try {
      const result = (await generateMutation.mutateAsync({
        templateId,
        fromDate: range.fromDate,
        toDate: range.toDate,
        previewSnapshotHash: previewPayload.sourceHash ?? '',
      })) as PeriodicGenerateEnvelope | undefined
      const jobId = result?.data?.job?.id
      if (typeof jobId === 'number') {
        setActiveJobId(jobId)
      }
      // 新版本已落库：刷新版本时间轴缓存（容器切换 versions 后即可见）
      await queryClient.invalidateQueries({ queryKey: reportV2Keys.versions(projectId) })
    } catch {
      // 错误在下方 mutation error 卡中呈现
    }
  }

  const generateError = generateMutation.error
  const generateErrorText =
    typeof generateError === 'object' && generateError !== null && 'message' in generateError
      ? String((generateError as { message: unknown }).message)
      : String(generateError ?? '生成请求失败，请稍后重试')

  const previewSkeleton = previewQuery.isFetching && !previewQuery.data

  return (
    <div
      data-periodic-panel
      data-immersion={tier}
      className="flex flex-col gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-4 text-[var(--nx-text-primary)]"
    >
      {/* 模板选择 */}
      <div className="flex flex-wrap items-center gap-3">
        {PERIODIC_TEMPLATE_OPTIONS.map((option) => {
          const active = option.templateId === templateId
          return (
            <button
              key={option.templateId}
              type="button"
              data-periodic-template={option.templateId}
              aria-pressed={active}
              onClick={() => handleTemplateChange(option.templateId)}
              className={cn(
                'inline-flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
                active
                  ? 'border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)]'
                  : 'border-[var(--nx-border-hairline)] bg-transparent hover:border-[var(--nx-border-focus)]',
              )}
            >
              <span
                className={cn(
                  'text-sm font-medium',
                  active ? 'text-[var(--nx-text-primary)]' : 'text-[var(--nx-text-secondary)]',
                )}
              >
                {option.label}
              </span>
              <span className="text-[11px] text-[var(--nx-text-muted)]">{option.caption}</span>
            </button>
          )
        })}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
          <Sparkles className="h-3.5 w-3.5 text-[var(--nx-ai)]" aria-hidden />
          AI 生成草案需人工签署后生效（RL-01）
        </span>
      </div>

      {/* 周期范围 */}
      <section
        className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
        aria-label="周期范围配置"
      >
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_OPTIONS.map((option) => (
            <button
              key={option.preset}
              type="button"
              data-periodic-preset={option.preset}
              onClick={() => applyPreset(option.preset)}
              className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <input
            type="date"
            data-periodic-from
            aria-label="周期开始日期"
            value={range.fromDate}
            onChange={(event) => handleDateChange('fromDate', event.target.value)}
            className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] outline-none focus:border-[var(--nx-border-focus)] [color-scheme:dark]"
          />
          <span className="text-[var(--nx-text-muted)]">至</span>
          <input
            type="date"
            data-periodic-to
            aria-label="周期结束日期"
            value={range.toDate}
            onChange={(event) => handleDateChange('toDate', event.target.value)}
            className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] outline-none focus:border-[var(--nx-border-focus)] [color-scheme:dark]"
          />
          <span className="ml-2 text-xs text-[var(--nx-text-muted)]" data-periodic-prev-range>
            对比周期：{range.prevFromDate} ~ {range.prevToDate}
          </span>
        </div>
        {rangeError ? (
          <p role="alert" className="mt-2 text-xs text-[var(--nx-status-danger)]">
            {rangeError}
          </p>
        ) : null}
      </section>

      {/* 预检预览入口 */}
      <section
        className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3"
        aria-label="周期数据预检"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium text-[var(--nx-text-primary)]">数据源预检</h4>
            <p className="mt-0.5 text-xs text-[var(--nx-text-muted)]">
              正式生成前先干跑校验数据覆盖度与阻断项，通过后方可生成
            </p>
          </div>
          <button
            type="button"
            data-periodic-preview-btn
            onClick={handlePreview}
            disabled={previewQuery.isFetching}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {previewQuery.isFetching ? (
              <RotateCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
            )}
            预检预览
          </button>
        </div>

        {/* 预检结果区 */}
        <div className="mt-3" aria-live="polite">
          {previewSkeleton ? (
            <div
              data-periodic-preview-loading
              role="status"
              aria-label="正在预检项目数据源"
              className="space-y-2"
            >
              <div className="h-4 w-2/5 animate-pulse rounded bg-[var(--nx-bg-1)]" />
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                {[0, 1, 2, 3, 4].map((index) => (
                  <div
                    key={index}
                    className="h-16 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
                  />
                ))}
              </div>
            </div>
          ) : previewQuery.isError ? (
            <div
              role="alert"
              className="rounded-md border border-[var(--nx-status-danger)] p-3 text-xs"
              style={{
                borderColor: 'color-mix(in srgb, var(--nx-status-danger) 45%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--nx-status-danger) 8%, transparent)',
              }}
            >
              <p className="text-[var(--nx-status-danger)]">
                预检失败：{previewQuery.error?.message ?? '请稍后重试'}
              </p>
            </div>
          ) : previewPayload ? (
            <div className="space-y-3">
              {/* 覆盖度指标卡 */}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
                {coverage.map((stat) => (
                  <div
                    key={stat.key}
                    data-coverage-key={stat.key}
                    className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2"
                  >
                    <div className="text-[11px] text-[var(--nx-text-muted)]">{stat.label}</div>
                    <div
                      data-coverage-value
                      className={cn(
                        'font-mono text-lg font-semibold tabular-nums',
                        stat.value === null
                          ? 'text-[var(--nx-text-muted)]'
                          : 'text-[var(--nx-text-primary)]',
                      )}
                    >
                      {stat.value === null ? '—' : stat.value.toLocaleString('zh-CN')}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-[var(--nx-text-muted)]">
                      {stat.sub}
                    </div>
                  </div>
                ))}
              </div>

              {/* 警告清单 */}
              {(previewPayload.warnings ?? []).length > 0 ? (
                <ul className="space-y-1.5">
                  {(previewPayload.warnings ?? []).map((warning, index) => {
                    const danger = warning.level === 'critical' || warning.blocking === true
                    const warningTone = warning.level === 'warning'
                    return (
                      <li
                        key={`${warning.code ?? 'warn'}-${index}`}
                        data-periodic-warning-level={warning.level}
                        className="flex items-start gap-2 rounded-sm border px-2.5 py-1.5 text-xs"
                        style={{
                          borderColor: danger
                            ? 'color-mix(in srgb, var(--nx-status-danger) 45%, transparent)'
                            : warningTone
                              ? 'color-mix(in srgb, var(--nx-status-warning) 45%, transparent)'
                              : 'color-mix(in srgb, var(--nx-text-secondary) 30%, transparent)',
                          backgroundColor: danger
                            ? 'color-mix(in srgb, var(--nx-status-danger) 8%, transparent)'
                            : warningTone
                              ? 'color-mix(in srgb, var(--nx-status-warning) 7%, transparent)'
                              : 'transparent',
                        }}
                      >
                        <span
                          className="mt-0.5 shrink-0 font-mono text-[10px]"
                          style={{
                            color: danger
                              ? 'var(--nx-status-danger)'
                              : warningTone
                                ? 'var(--nx-status-warning)'
                                : 'var(--nx-text-muted)',
                          }}
                        >
                          {warning.level === 'critical'
                            ? '阻断'
                            : warning.level === 'warning'
                              ? '警告'
                              : '提示'}
                        </span>
                        <span className="text-[var(--nx-text-secondary)]">{warning.message}</span>
                      </li>
                    )
                  })}
                </ul>
              ) : null}

              {isBlocking ? (
                <div
                  data-periodic-blocking
                  role="alert"
                  className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
                  style={{
                    borderColor: 'color-mix(in srgb, var(--nx-status-danger) 55%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--nx-status-danger) 10%, transparent)',
                  }}
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-status-danger)]"
                    aria-hidden
                  />
                  <div>
                    <p className="font-medium text-[var(--nx-status-danger)]">
                      存在阻断问题，请先补充项目数据后再生成
                    </p>
                    {blockingWarnings.length > 0 ? (
                      <p className="mt-1 text-[var(--nx-text-secondary)]">
                        {blockingWarnings.map((w) => w.message).join('；')}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p
                  className="flex items-center gap-1.5 text-xs text-[var(--nx-status-success)]"
                  data-periodic-preview-passed
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  预检通过：数据源可用，可开始生成
                </p>
              )}
            </div>
          ) : previewReq === null ? (
            <p className="text-xs text-[var(--nx-text-muted)]">
              尚未预检。选择周期范围后点击「预检预览」检查数据覆盖度与阻断项。
            </p>
          ) : (
            <p data-periodic-stale-hint className="text-xs text-[var(--nx-status-warning)]">
              周期参数已变更，请重新执行预检以刷新数据覆盖度。
            </p>
          )}
        </div>

        {generateError ? (
          <div
            role="alert"
            data-periodic-generate-error
            className="mt-3 rounded-md border border-[var(--nx-status-danger)] px-3 py-2 text-xs text-[var(--nx-status-danger)]"
            style={{
              borderColor: 'color-mix(in srgb, var(--nx-status-danger) 45%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--nx-status-danger) 8%, transparent)',
            }}
          >
            生成失败:{generateErrorText}
          </div>
        ) : null}

        {/* 生成入口 */}
        {activeJobId === null ? (
          <div className="mt-3 flex items-center justify-end gap-3 border-t border-[var(--nx-border-hairline)] pt-3">
            {!canGenerate ? (
              <span className="text-xs text-[var(--nx-text-muted)]" title="缺少 report:create 权限">
                缺少 report:create 权限，仅可查看配置与预检
              </span>
            ) : !previewPayload ? (
              <span className="text-xs text-[var(--nx-text-muted)]">
                {previewReq === null ? '需先通过预检后方可生成' : '请等待预检完成'}
              </span>
            ) : isBlocking ? (
              <span className="text-xs text-[var(--nx-status-danger)]">存在阻断问题，无法生成</span>
            ) : !previewPayload.sourceHash ? (
              <span className="text-xs text-[var(--nx-status-warning)]">
                预检数据缺少数据源指纹，请重新预检后再生成
              </span>
            ) : null}
            <button
              type="button"
              data-periodic-generate-btn
              onClick={() => void handleGenerate()}
              disabled={!canStart || generateMutation.isPending}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)] px-4 text-sm font-medium text-[var(--nx-space-bg)] transition-colors hover:bg-[var(--nx-ai)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generateMutation.isPending ? (
                <RotateCw className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              开始生成
            </button>
          </div>
        ) : null}
      </section>

      {/* 异步作业监视器 */}
      {activeJobId !== null ? (
        <ReportJobStatusIndicator
          projectId={projectId}
          jobId={activeJobId}
          onSucceeded={(versionId) => {
            setActiveJobId(null)
            onJobSucceeded?.(versionId)
          }}
          onClose={() => setActiveJobId(null)}
        />
      ) : null}
    </div>
  )
}
