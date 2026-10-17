'use client'

/**
 * 星体悬浮 Hover Tooltip 构件
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §3, §4
 * - tasks.md 5.2
 */

import * as React from 'react'
import type { StarVisualState } from './spacemap-state-mapper'

const PRIORITY_LABELS: Record<string, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
  critical: '紧急',
  urgent: '紧急',
}

const HEALTH_LABELS: Record<string, { text: string; color: string }> = {
  healthy: { text: '健康', color: '#38bdf8' },
  on_track: { text: '健康', color: '#38bdf8' },
  green: { text: '健康', color: '#38bdf8' },
  at_risk: { text: '有风险', color: '#f59e0b' },
  warning: { text: '有风险', color: '#f59e0b' },
  yellow: { text: '有风险', color: '#f59e0b' },
  critical: { text: '严重', color: '#ef4444' },
  delayed: { text: '严重', color: '#ef4444' },
  red: { text: '严重', color: '#ef4444' },
}

export interface SpaceMapStarTooltipProps {
  star: StarVisualState | null
  clientX?: number
  clientY?: number
}

export function SpaceMapStarTooltip({ star, clientX = 0, clientY = 0 }: SpaceMapStarTooltipProps) {
  if (!star) return null
  const health = HEALTH_LABELS[(star.healthStatus || '').toLowerCase()]

  return (
    <div
      data-testid="star-tooltip"
      role="tooltip"
      aria-hidden="true"
      style={{
        left: `${clientX + 16}px`,
        top: `${clientY + 16}px`,
      }}
      // 始终浮在深色星空上：用实色深底 + 浅色字。原先的动态 CSS 变量背景无法生成有效样式，
      // 深灰字压在星空和星体标签上，加上 backdrop-blur 把后面的内容糊在字下面，完全看不清（实测）。
      className="pointer-events-none fixed z-30 flex max-w-sm flex-col gap-1 rounded-md border border-white/15 bg-slate-950/95 px-3 py-2 text-xs shadow-lg shadow-black/40"
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-slate-50">{star.name}</span>
        {star.code && (
          <span className="shrink-0 font-mono text-[10px] text-slate-400">{star.code}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-slate-300">
        {health ? <span style={{ color: health.color }}>{health.text}</span> : <span>未评估</span>}
        <span>进度 {star.progressPercent}%</span>
        <span>优先级 {PRIORITY_LABELS[star.priority] ?? star.priority}</span>
        {star.signals.length > 0 && (
          <span className="text-[#f59e0b]">{star.signals.length} 信号</span>
        )}
      </div>
    </div>
  )
}
