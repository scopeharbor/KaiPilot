'use client'

import Link from 'next/link'
import { toNextTrackPath } from '@/lib/next/next-track-path'
import { CalendarDays, Compass, MapPin } from 'lucide-react'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * 空间导航结果反馈卡片（v3-ui-next-ai-colleague spec「导航结果直达跳转与反馈」）。
 *
 * - 后端 `navigate_to_space` 返回 `{ path, lens, projectId, depth, targetId }` 后，
 *   主工作面已由上层执行 `router.push(data.path)` 跳转，本卡在对话时间线内
 *   呈现导航目标信息（项目 ID / 目标镜头 / 景深等级）与「已跳转」状态；
 * - 提供「再次前往 · 直达该路径」显式回跳链接（`href={data.path}`，Next Link
 *   客户端路由内部即 router.push），并预留 `onNavigate` 回调供上层接线；
 * - 纯展示 + 链接跳转，零网络请求（RL-01）。
 */

/** `navigate_to_space` 声明的镜头白名单（与后端 NAVIGATE_TO_SPACE_LENSES 对齐）。 */
export const NAVIGATION_LENS_LABELS: Record<string, string> = {
  kanban: '看板',
  gantt: '甘特图',
  wbs: 'WBS 分解结构',
  list: '列表',
  calendar: '日历',
  charts: '图表馆',
  // v3-ui-next-reports-domain：报表中心为独立治理工作空间（非 LensSwitcher 镜头）
  reports: '报表中心',
  // v3-ui-next-risk-change-domains：风险管理与变更请求为项目治理功能域空间（新轨深层路由）
  risks: '风险管理',
  change_requests: '变更请求',
  // v3-ui-next-resource-team-domains：资源工作台/成员与团队/项目文件库为协同管理
  // 功能域空间（新轨深层路由，非 LensSwitcher 排程镜头）
  resources: '资源工作台',
  members: '成员与团队',
  files: '项目文件库',
  // v3-ui-next-help-knowledge-domain：帮助中心/知识底座为全局视窗（/next/help 与
  // /next/knowledge，无项目载体，lensLabel 回显直达语义）
  help: '帮助中心',
  knowledge: '知识底座',
  // v3-ui-next-org-portfolio-domains W10：组织组合层/全局视窗 17 镜头（无项目载体）
  org_overview: '组织概览',
  org_bi_dashboards: 'BI 仪表盘',
  org_bi_risk_heatmap: '组织风险热力图',
  org_bi_trends: '趋势分析',
  org_okrs: 'OKR 层级管理',
  org_okr_dashboard: 'OKR 仪表盘',
  org_resource_pool: '组织资源池',
  org_resource_gaps: '资源缺口分析',
  org_resource_contentions: '资源争用检测',
  org_resource_demand: '资源需求预测',
  org_capacity_loops: '容量闭环',
  org_cross_project_allocation: '跨项目调配',
  org_plugin_directory: '插件目录',
  org_plugin_policies: '插件策略',
  global_resources: '全局资源',
  global_skill_matrix: '技能矩阵',
  global_risks: '问题与风险',
  // v3-ui-next-pmo-domain W9：PMO 组合层镜头（lens='pmo' + target 定位 /next/pmo 功能页）
  pmo: 'PMO 组合层',
  // v3-ui-next-settings-admin-domains W9：设置空间、管理后台与项目设置镜头
  settings: '设置空间',
  admin: '管理后台',
  project_settings: '项目设置',
  // v3-ui-next-batch1-strategy-launch-tasks W5：战略执行驾驶舱镜头
  strategy_cockpit: '战略执行驾驶舱',
  strategy_execution_cockpit: '战略执行驾驶舱',
}

/** 景深等级中文回显（未知等级不臆造，回退为原始值）。 */
const NAVIGATION_DEPTH_LABELS: Record<string, string> = {
  workbench: '工作台景深',
  normal: '标准景深',
  precise: '精确景深',
}

export interface NavigationResultData {
  /** 无项目载体镜头（help/knowledge 与 org/global 全域镜头）恒为 null。 */
  projectId: number | null
  lens: string
  depth: string
  targetId: number | null
  path: string
}

export interface NavigationResultCardProps {
  data: NavigationResultData
  /** 命中工具名（v1 恒为规则直连，默认诚实标注 navigate_to_space）。 */
  toolName?: string
  /** 显式回跳点击回调（上层可接线 router.push / 埋点）。 */
  onNavigate?: (path: string) => void
}

export function NavigationResultCard({
  data,
  toolName = 'navigate_to_space',
  onNavigate,
}: NavigationResultCardProps) {
  const { projectId, lens, depth, targetId } = data
  const path = toNextTrackPath(data.path)
  const lensLabel = NAVIGATION_LENS_LABELS[lens] ?? lens
  const depthLabel = NAVIGATION_DEPTH_LABELS[depth] ?? depth
  const hasProject = projectId !== null && projectId !== undefined

  return (
    <article
      data-card="navigate"
      className="overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-primary)]">
          <Compass className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
          空间导航已执行
        </div>
        <RuleMatchBadge toolName={toolName} />
      </div>

      <div className="space-y-2 px-3 py-3">
        <p data-navigate-summary className="text-sm leading-5 text-[var(--nx-text-primary)]">
          {hasProject
            ? `已为你导航至项目 ${projectId} 的${lensLabel}${targetId !== null && targetId !== undefined ? `（目标实体 #${targetId}）` : ''}镜头`
            : `已为你导航至${lensLabel}`}
        </p>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] leading-4">
          {hasProject ? (
            <div className="min-w-0">
              <dt className="text-[var(--nx-text-muted)]">目标项目</dt>
              <dd data-navigate-project className="truncate text-[var(--nx-text-secondary)]">
                项目 #{projectId}
              </dd>
            </div>
          ) : null}
          <div className="min-w-0">
            <dt className="text-[var(--nx-text-muted)]">目标镜头</dt>
            <dd data-navigate-lens className="truncate text-[var(--nx-text-secondary)]">
              {lensLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-[var(--nx-text-muted)]">
              <CalendarDays className="h-3 w-3" aria-hidden />
              景深等级
            </dt>
            <dd data-navigate-depth className="truncate text-[var(--nx-text-secondary)]">
              {depthLabel}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-[var(--nx-text-muted)]">
              <MapPin className="h-3 w-3" aria-hidden />
              坐标路径
            </dt>
            <dd data-navigate-path className="truncate font-mono text-[var(--nx-text-secondary)]">
              {path}
            </dd>
          </div>
        </dl>
      </div>

      <div className="border-t border-[var(--nx-border-hairline)] px-3 py-2">
        <Link
          href={path}
          data-navigate-again
          onClick={onNavigate ? () => onNavigate(path) : undefined}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] hover:text-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          再次前往 · 直达该路径
        </Link>
      </div>
    </article>
  )
}

export default NavigationResultCard
