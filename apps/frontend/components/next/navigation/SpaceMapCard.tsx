'use client'

import * as React from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  Calendar,
  CheckSquare,
  Database,
  FileText,
  Flame,
  FolderArchive,
  Gauge,
  Gavel,
  GitPullRequest,
  GraduationCap,
  Home,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  ListOrdered,
  Network,
  Package,
  Radar,
  RefreshCw,
  Scale,
  Search,
  Settings,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TrafficCone,
  TrendingUp,
  Users,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SpaceCoordinate } from '@/lib/next/space-coordinates'

/** iconName → lucide 图标映射（与 space-coordinates 的 `iconName` 联合类型契约同步）。 */
type CoordinateIcon = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

const COORDINATE_ICONS: Record<SpaceCoordinate['iconName'], CoordinateIcon> = {
  Home,
  Sparkles,
  BarChart3,
  FileText,
  // v3-ui-next-risk-change-domains W3 · tasks 3.5：两域坐标图标点亮
  Shield,
  GitPullRequest,
  // v3-ui-next-resource-team-domains W4 · tasks 4.5：协同三域坐标图标点亮
  Users,
  FolderArchive,
  // v3-ui-next-help-knowledge-domain W3 · tasks 3.1：帮助中心/知识底座全局坐标图标点亮
  BookOpen,
  Database,
  // v3-ui-next-org-portfolio-domains W10 · tasks 10.1：组织/全局坐标图标点亮
  Building2,
  LayoutDashboard,
  Flame,
  TrendingUp,
  Target,
  Gauge,
  Boxes,
  AlertTriangle,
  Scale,
  Activity,
  RefreshCw,
  ArrowLeftRight,
  Package,
  ShieldCheck,
  Layers,
  GraduationCap,
  ShieldAlert,
  // v3-ui-next-pmo-domain W9 · tasks 9.1：PMO 组合层坐标图标映射
  TrafficCone,
  LayoutGrid,
  ListOrdered,
  Wand2,
  Gavel,
  Network,
  Radar,
  // v3-ui-next-settings-admin-domains W9 · tasks 9.1：设置空间/管理后台/项目设置图标映射
  Settings,
  Settings2,
  // v3-ui-next-batch3-global-convergence W5 · tasks 5.3：全域汇聚坐标图标映射
  Search,
  Bell,
  Calendar,
  CheckSquare,
}

export interface SpaceMapCardProps {
  coordinate: SpaceCoordinate
  /** 可用坐标被点击时回调；coming-soon 的禁用卡片永远不会触发（design 风险表：阻止键盘与点击）。 */
  onSelect: (coordinate: SpaceCoordinate) => void
}

/**
 * 空间地图坐标卡片（v3-ui-next-shell-space-map D2 / spec「坐标检索、直达导航与占位项置灰」）。
 *
 * - 暗黑仪器感表面（--nx-workspace-surface）+ 1px 发丝线边框（--nx-border-hairline）；
 * - available：可点击 + 悬浮高亮 + 键盘可见 focus ring；
 * - coming-soon：disabled + tabIndex=-1 彻底阻断键盘与点击，置灰并加「即将上线」徽标。
 */
export function SpaceMapCard({ coordinate, onSelect }: SpaceMapCardProps) {
  const available = coordinate.status === 'available'
  const Icon = COORDINATE_ICONS[coordinate.iconName]

  return (
    <button
      type="button"
      disabled={!available}
      tabIndex={available ? 0 : -1}
      data-space-coordinate={coordinate.id}
      data-status={coordinate.status}
      onClick={() => onSelect(coordinate)}
      className={cn(
        'flex h-full flex-col gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-left',
        available
          ? 'cursor-pointer transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-space-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)]'
          : 'cursor-not-allowed opacity-50',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <Icon
          className={cn(
            'h-4 w-4 shrink-0',
            available ? 'text-[var(--nx-accent)]' : 'text-[var(--nx-text-muted)]',
          )}
          aria-hidden
        />
        {coordinate.badge ? (
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] leading-none',
              available
                ? 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)]'
                : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
            )}
          >
            {coordinate.badge}
          </span>
        ) : null}
      </span>
      <span className="text-sm font-semibold leading-snug text-[var(--nx-text-primary)]">
        {coordinate.title}
      </span>
      <span className="text-xs leading-relaxed text-[var(--nx-text-secondary)]">
        {coordinate.description}
      </span>
      <span className="mt-auto font-mono text-[11px] tracking-wide text-[var(--nx-text-muted)]">
        {coordinate.path}
      </span>
    </button>
  )
}
