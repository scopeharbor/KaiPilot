'use client'

/**
 * 星体详情展开 DOM 面板（无障碍等价面板）
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §4 (DOM + WebGL 分层模型与无障碍等价面板)
 * - design.md Decision 6 (Layer 1 z-10 原生 DOM, 键盘可达, 读屏器友好)
 * - tasks.md 5.2
 * - RL-01: 只读导航交互，点击直达项目空间
 * - RL-15: 中性色纪律与仪表盘仪器感质感
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { X, ExternalLink, Users, CheckSquare, Flag } from 'lucide-react'
import type { StarVisualState } from './spacemap-state-mapper'

export interface SpaceMapStarDetailPanelProps {
  star: StarVisualState | null
  onClose: () => void
  onNavigate?: (projectId: number) => void
  className?: string
}

const HEALTH_NAMES: Record<string, { label: string; colorClass: string }> = {
  healthy: { label: '健康稳定', colorClass: 'text-[#38bdf8] bg-[#38bdf8]/10 border-[#38bdf8]/30' },
  on_track: { label: '正常推进', colorClass: 'text-[#38bdf8] bg-[#38bdf8]/10 border-[#38bdf8]/30' },
  warning: { label: '存在风险', colorClass: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30' },
  at_risk: { label: '重点关注', colorClass: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30' },
  critical: { label: '进度异常', colorClass: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/30' },
  delayed: { label: '明显延期', colorClass: 'text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/30' },
}

export function SpaceMapStarDetailPanel({
  star,
  onClose,
  onNavigate,
  className = '',
}: SpaceMapStarDetailPanelProps) {
  const router = useRouter()

  if (!star) return null

  const healthInfo = HEALTH_NAMES[star.healthStatus] || {
    label: '未评定',
    colorClass:
      'text-[var(--nx-text-muted)] bg-[var(--nx-bg-1)] border-[var(--nx-border-hairline)]',
  }

  const handleEnterProject = () => {
    if (onNavigate) {
      onNavigate(star.projectId)
    } else {
      router.push(`/next/projects/${star.projectId}`)
    }
  }

  return (
    <aside
      role="region"
      aria-label={`${star.name} 项目详情`}
      data-testid="star-detail-panel"
      data-project-id={star.projectId}
      className={`pointer-events-auto w-80 max-w-[calc(100vw-2rem)] flex flex-col rounded-[var(--radius-lg)] border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]/95 backdrop-blur-md p-4 shadow-[var(--shadow-lg)] transition-all z-20 ${className}`}
    >
      {/* 顶部标题与关闭按钮 */}
      <div className="flex items-start justify-between gap-3 border-b border-[var(--nx-border-hairline)] pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono border ${healthInfo.colorClass}`}
            >
              {healthInfo.label}
            </span>
            {star.code && (
              <span className="text-xs font-mono text-[var(--nx-text-muted)] truncate">
                {star.code}
              </span>
            )}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-[var(--nx-text-primary)] truncate">
            {star.name}
          </h3>
          {star.departmentName && (
            <p className="text-xs text-[var(--nx-text-secondary)] mt-0.5 truncate">
              {star.departmentName}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情面板"
          className="rounded p-1 text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] transition-colors"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* 进度与关键指标 */}
      <div className="py-3 border-b border-[var(--nx-border-hairline)] space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--nx-text-secondary)]">交付进度</span>
          <span className="font-mono font-medium text-[var(--nx-text-primary)]">
            {star.progressPercent}%
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-[var(--nx-bg-1)] overflow-hidden">
          <div
            className="h-full bg-[#38bdf8] transition-all duration-300"
            style={{ width: `${star.progressPercent}%` }}
          />
        </div>

        {/* 三项伴生指标统计 */}
        <div className="grid grid-cols-3 gap-2 pt-1 text-center">
          <div className="p-1.5 rounded bg-[var(--nx-bg-1)] border border-[var(--nx-border-hairline)]">
            <div className="text-[10px] text-[var(--nx-text-muted)] flex items-center justify-center gap-1">
              <Users className="h-3 w-3" />
              <span>成员</span>
            </div>
            <div className="text-xs font-mono font-semibold text-[var(--nx-text-primary)] mt-0.5">
              {star.stats?.memberCount ?? 0}
            </div>
          </div>
          <div className="p-1.5 rounded bg-[var(--nx-bg-1)] border border-[var(--nx-border-hairline)]">
            <div className="text-[10px] text-[var(--nx-text-muted)] flex items-center justify-center gap-1">
              <CheckSquare className="h-3 w-3" />
              <span>任务</span>
            </div>
            <div className="text-xs font-mono font-semibold text-[var(--nx-text-primary)] mt-0.5">
              {star.stats?.taskCount ?? 0}
            </div>
          </div>
          <div className="p-1.5 rounded bg-[var(--nx-bg-1)] border border-[var(--nx-border-hairline)]">
            <div className="text-[10px] text-[var(--nx-text-muted)] flex items-center justify-center gap-1">
              <Flag className="h-3 w-3" />
              <span>里程碑</span>
            </div>
            <div className="text-xs font-mono font-semibold text-[var(--nx-text-primary)] mt-0.5">
              {star.stats?.milestoneCount ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* 雷达信号证据摘要 */}
      <div className="py-3 flex-1 min-h-0 overflow-y-auto space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--nx-text-secondary)] font-medium">被动雷达信号</span>
          <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
            {star.signals.length} 项活跃
          </span>
        </div>

        {star.signals.length > 0 ? (
          <div className="space-y-1.5">
            {star.signals.map((sig) => (
              <div
                key={sig.id}
                className="p-2 rounded bg-[var(--nx-bg-1)] border border-[var(--nx-border-hairline)] text-xs space-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[var(--nx-text-primary)]">
                    {sig.signalType === 'progress_deviation' && '进度偏差'}
                    {sig.signalType === 'risk_surge' && '风险突变'}
                    {sig.signalType === 'resource_overload' && '资源过载'}
                    {sig.signalType === 'milestone_slip' && '里程碑滑移'}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-1 rounded ${
                      sig.severity === 'critical'
                        ? 'text-[#ef4444] bg-[#ef4444]/10'
                        : sig.severity === 'warning'
                          ? 'text-[#f59e0b] bg-[#f59e0b]/10'
                          : 'text-[#38bdf8] bg-[#38bdf8]/10'
                    }`}
                  >
                    {sig.severity}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--nx-text-muted)]">
                  公转周期 {sig.orbitPeriod}s · 轨道半长轴 {sig.orbitRadius}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-2 text-center text-xs text-[var(--nx-text-muted)]">
            当前无活跃异常雷达信号
          </div>
        )}
      </div>

      {/* 底部直达跳转按钮 */}
      <div className="pt-3 border-t border-[var(--nx-border-hairline)]">
        <button
          type="button"
          onClick={handleEnterProject}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-[#38bdf8] px-3 py-2 text-xs font-semibold text-slate-900 transition-colors hover:bg-[#00f0ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38bdf8]"
        >
          <span>切入项目工作面</span>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </aside>
  )
}
