'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  Clock,
  Milestone,
  GitBranch,
  AlertOctagon,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWhatIfSessionStore } from '@/stores/what-if-store'
import type { GanttModel } from '@/lib/gantt/types'
import type { WhatIfBaseSnapshot } from '@/lib/gantt/what-if-types'

interface GanttWhatIfImpactPanelProps {
  baseSnapshot: WhatIfBaseSnapshot | null
  previewModel: GanttModel | null
  directCommandTaskIds: number[]
  backendPreviewToken: string | null
  serverRevision: string | null
  onScrollToTask?: (taskId: number) => void
}

const SEVERITY_STYLES = {
  blocker: 'text-red-600 bg-red-50 border-red-200',
  warning: 'text-amber-600 bg-amber-50 border-amber-200',
  info: 'text-blue-600 bg-blue-50 border-blue-200',
}

const REASON_CODE_LABELS: Record<string, string> = {
  DIRECT_DATE_MOVE: '直接移动日期',
  DIRECT_RESIZE: '直接调整工期',
  DEPENDENCY_PROPAGATION: '依赖传播',
  WORKING_CALENDAR_SNAP: '工作日历对齐',
  CRITICAL_PATH_ENTERED: '进入关键路径',
  CRITICAL_PATH_EXITED: '离开关键路径',
  MILESTONE_DELAYED: '里程碑延迟',
  MILESTONE_ADVANCED: '里程碑提前',
  MILESTONE_UNCHANGED: '里程碑不变',
  BASELINE_VARIANCE_INCREASED: '基线偏差增大',
  BASELINE_VARIANCE_DECREASED: '基线偏差减小',
  BASELINE_UNKNOWN: '基线未知',
  CYCLE_DETECTED: '检测到依赖环',
  VALIDATION_ERROR: '验证错误',
  STALE_SESSION: '会话已过期',
  MISSING_DATE: '缺少日期',
  MISSING_BASELINE: '缺少基线',
}

export function GanttWhatIfImpactPanel({
  baseSnapshot: _baseSnapshot,
  previewModel: _previewModel,
  directCommandTaskIds: _directCommandTaskIds,
  backendPreviewToken: _backendPreviewToken,
  serverRevision: _serverRevision,
  onScrollToTask,
}: GanttWhatIfImpactPanelProps) {
  const impactSummary = useWhatIfSessionStore((s) => s.impactSummary)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  const summary = impactSummary

  if (!summary) return null

  const toggleSection = (id: string) => setExpandedSection(expandedSection === id ? null : id)

  return (
    <div className="flex flex-col gap-3 text-xs" role="region" aria-label="影响摘要">
      {/* Provisional 标记 */}
      {!summary.isAuthoritative && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700">
          <Info className="mr-1 inline h-3 w-3" aria-hidden />
          预览数据——获取后端验证后将更新
        </div>
      )}

      {/* Blocker 警告 */}
      {summary.gate.hasBlocker && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">
          <AlertOctagon className="mr-1 inline h-3 w-3" aria-hidden />
          {summary.gate.blockerCount} 个阻塞项：无法应用
        </div>
      )}

      {/* 顶层指标 */}
      <MetricCard title="项目工期" icon={<Clock className="h-3.5 w-3.5" aria-hidden />}>
        <MetricRow label="起止" value={summary.timeline.before ?? '—'} />
        {summary.timeline.workingDelta !== null && (
          <DeltaRow label="工期变化" value={summary.timeline.workingDelta} suffix="d" />
        )}
      </MetricCard>

      <MetricCard title="任务" icon={<Layers className="h-3.5 w-3.5" aria-hidden />}>
        <MetricRow label="直接变更" value={`${summary.tasks.direct}`} />
        <MetricRow label="传播影响" value={`${summary.tasks.propagated}`} />
        <MetricRow label="未变化" value={`${summary.tasks.unchanged}`} />
      </MetricCard>

      <MetricCard title="关键路径" icon={<GitBranch className="h-3.5 w-3.5" aria-hidden />}>
        <MetricRow label="Base" value={`${summary.criticalPath.baseCriticalTaskCount} 任务`} />
        <MetricRow
          label="Preview"
          value={`${summary.criticalPath.previewCriticalTaskCount} 任务`}
        />
        {summary.criticalPath.addedCriticalTaskIds.length > 0 && (
          <DeltaRow
            label="新增关键"
            value={summary.criticalPath.addedCriticalTaskIds.length}
            prefix="+"
            severity="warning"
          />
        )}
        {summary.criticalPath.removedCriticalTaskIds.length > 0 && (
          <DeltaRow
            label="移除关键"
            value={summary.criticalPath.removedCriticalTaskIds.length}
            prefix="-"
            severity="info"
          />
        )}
      </MetricCard>

      <MetricCard title="里程碑" icon={<Milestone className="h-3.5 w-3.5" aria-hidden />}>
        <MetricRow label="延迟" value={`${summary.milestones.delayed}`} />
        <MetricRow label="提前" value={`${summary.milestones.advanced}`} />
        <MetricRow label="不变" value={`${summary.milestones.unchanged}`} />
      </MetricCard>

      <MetricCard title="冲突" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}>
        {summary.conflicts.total > 0 ? (
          <>
            <MetricRow label="依赖环" value={`${summary.conflicts.cycleCount}`} />
            <MetricRow label="约束冲突" value={`${summary.conflicts.constraintViolationCount}`} />
          </>
        ) : (
          <MetricRow label="无冲突" value="✓" />
        )}
      </MetricCard>

      <MetricCard title="基线" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}>
        {summary.baseline.hasBaseline ? (
          <>
            {summary.baseline.startVariance !== null && (
              <DeltaRow label="开始偏差" value={summary.baseline.startVariance} suffix="d" />
            )}
            {summary.baseline.finishVariance !== null && (
              <DeltaRow label="完成偏差" value={summary.baseline.finishVariance} suffix="d" />
            )}
            {summary.baseline.durationVariance !== null && (
              <DeltaRow label="工期偏差" value={summary.baseline.durationVariance} suffix="d" />
            )}
          </>
        ) : (
          <MetricRow label="无基线数据" value="—" />
        )}
      </MetricCard>

      {/* Evidence 下钻 */}
      <button
        type="button"
        className="text-left text-xs font-medium text-foreground hover:text-blue-600"
        onClick={() => toggleSection('evidence')}
        aria-expanded={expandedSection === 'evidence'}
      >
        <Info className="mr-1 inline h-3 w-3" aria-hidden />
        变更详情 ({summary.evidence.length})
      </button>
      {expandedSection === 'evidence' && (
        <div className="space-y-1">
          {summary.evidence.map((ev, i) => (
            <button
              key={i}
              type="button"
              className={cn(
                'flex w-full items-start gap-1.5 rounded-md border p-1.5 text-left text-xs transition-colors hover:opacity-80',
                SEVERITY_STYLES[ev.severity],
              )}
              onClick={() => ev.entityType === 'task' && onScrollToTask?.(ev.entityId)}
            >
              {ev.severity === 'blocker' && <XCircle className="mt-0.5 h-3 w-3 shrink-0" />}
              {ev.severity === 'warning' && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
              {ev.severity === 'info' && <Info className="mt-0.5 h-3 w-3 shrink-0" />}
              <div className="min-w-0">
                <div className="truncate font-medium">{ev.entityName}</div>
                <div className="text-gray-500">
                  {REASON_CODE_LABELS[ev.reasonCode] ?? ev.reasonCode}
                </div>
                {ev.propagation === 'propagated' && <span className="text-gray-400">传播影响</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 子组件 ─────────────────────────────────────────────────────

function MetricCard({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-2">
      <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
        {icon}
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-gray-600">
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

function DeltaRow({
  label,
  value,
  suffix,
  prefix,
  severity,
}: {
  label: string
  value: number
  suffix?: string
  prefix?: string
  severity?: 'info' | 'warning'
}) {
  const isNegative = value < 0
  const color =
    severity === 'warning' ? 'text-amber-600' : isNegative ? 'text-green-600' : 'text-red-600'
  return (
    <div className="flex justify-between text-gray-600">
      <span>{label}</span>
      <span className={cn('font-medium', color)}>
        {prefix ?? (value > 0 ? '+' : '')}
        {value}
        {suffix ?? ''}
      </span>
    </div>
  )
}
