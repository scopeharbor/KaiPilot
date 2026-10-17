'use client'

/**
 * 3D 星系 / 2D 地图显式视角分段切换器
 *
 * 规范遵循：v3-next-layer1-spacemap-3d-m2
 * - proposal.md §3 (一等公民双重视角切换器)
 * - design.md §3 (UI 可见交互一等公民), Decision 5
 * - tasks.md 5.1
 */

import * as React from 'react'
import { Sparkles, Map } from 'lucide-react'
import type { SpaceMapViewMode } from './useSpaceMapViewSync'

export interface SpaceMapViewToggleProps {
  viewMode: SpaceMapViewMode
  onViewModeChange: (mode: SpaceMapViewMode) => void
  className?: string
  disabled?: boolean
}

export function SpaceMapViewToggle({
  viewMode,
  onViewModeChange,
  className = '',
  disabled = false,
}: SpaceMapViewToggleProps) {
  return (
    <div
      role="group"
      aria-label="空间地图视角切换"
      data-testid="space-map-view-toggle"
      className={`inline-flex items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-0.5 text-xs ${className}`}
    >
      <button
        type="button"
        data-view-mode="3d"
        aria-pressed={viewMode === '3d'}
        disabled={disabled}
        onClick={() => onViewModeChange('3d')}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
          viewMode === '3d'
            ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)] shadow-sm'
            : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-secondary)]'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        title="3D 星系拓扑沙盘 (Ctrl+M / Ctrl+G)"
      >
        <Sparkles className="h-3.5 w-3.5 text-[#00f0ff]" aria-hidden />
        <span>3D 星系</span>
      </button>

      <button
        type="button"
        data-view-mode="2d"
        aria-pressed={viewMode === '2d'}
        disabled={disabled}
        onClick={() => onViewModeChange('2d')}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
          viewMode === '2d'
            ? 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-primary)] shadow-sm'
            : 'text-[var(--nx-text-muted)] hover:text-[var(--nx-text-secondary)]'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        title="2D 空间地图 (Ctrl+M)"
      >
        <Map className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
        <span>2D 地图</span>
      </button>
    </div>
  )
}
