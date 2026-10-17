'use client'

import {
  Activity,
  Book,
  Building,
  ChartColumn,
  ChartLine,
  ChartScatter,
  ChartSpline,
  CircleAlert,
  Columns,
  Fish,
  Flag,
  Flame,
  Kanban,
  LayoutGrid,
  ListChecks,
  Network,
  Percent,
  Share2,
  Shield,
  Trees,
  Users,
} from 'lucide-react'
import type { ChartIconName } from '@/lib/next/charts/chart-catalog-metadata'

/**
 * chart-catalog-metadata 的 `iconName` → lucide 图标确定性映射
 * （v3-ui-next-chart-gallery design §2.2，RL-14：映射静态收敛于组件侧）。
 */
export const CHART_ICONS: Record<ChartIconName, typeof ChartColumn> = {
  'chart-column': ChartColumn,
  shield: Shield,
  network: Network,
  flag: Flag,
  fish: Fish,
  trees: Trees,
  'chart-scatter': ChartScatter,
  kanban: Kanban,
  book: Book,
  'list-checks': ListChecks,
  columns: Columns,
  'circle-alert': CircleAlert,
  users: Users,
  'share-2': Share2,
  'chart-line': ChartLine,
  activity: Activity,
  flame: Flame,
  percent: Percent,
  building: Building,
  'chart-spline': ChartSpline,
  'layout-grid': LayoutGrid,
}
