'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { QueryClientContext } from '@tanstack/react-query'
import {
  BarChart3,
  ChevronDown,
  FileText,
  FolderArchive,
  GitPullRequest,
  Layers,
  Shield,
  Settings2,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRiskSummary } from '@/hooks/use-risks-v2'
import { useChangeRequests } from '@/hooks/use-change-requests'

/**
 * 项目空间头部「功能域」下拉菜单（v3-ui-next-risk-change-domains W3 · tasks 3.1，
 * v3-ui-next-resource-team-domains W4 · tasks 4.1 重组为协同/治理两分组扩展版，
 * v3-ui-next-settings-admin-domains W8 · tasks 8.5 治理分组追加「项目设置」）。
 *
 * 职责：在主工作面 LensSwitcher（6 项排程镜头）之外，收录正交的功能域入口，
 * 分两组（各选项带说明微标）：
 * - 「协同管理」（v3-ui-next-resource-team-domains 交付）：
 *   - 「资源工作台」：直达 `/next/projects/:id/resources`；
 *   - 「成员与团队」：直达 `/next/projects/:id/members`；
 *   - 「项目文件库」：直达 `/next/projects/:id/files`；
 * - 「治理与分析」（B6c / Charts 批次对齐 + W8 项目设置）：
 *   - 「风险管理」：直达 `/next/projects/:id/risks`，随项目实时风险摘要呈现高危
 *     严重合并计数徽标（`highRiskCount + criticalRiskCount`，> 0 时以
 *     --nx-status-danger 红标呈现「N 项高危」，0 时中性徽标）；
 *   - 「变更请求」：直达 `/next/projects/:id/change-requests`，实时呈现待审批
 *     （submitted / under_review）变更计数徽标（> 0 时 --nx-status-warning 琥珀标
 *     「N 项待审」）；
 *   - 「报表中心」：直达 `/next/projects/:id/reports`，待审核版本计数仍由宿主以
 *     `pendingReviewCount` prop 注入（B6e 契约，保持既有行为）；
 *   - 「图表馆」：直达 `/next/projects/:id/charts`；
 *   - 「项目设置」：直达 `/next/projects/:id/settings`（工作日历配置，
 *     v3-ui-next-settings-admin-domains tasks 8.5；与 LensSwitcher 六镜头保持解耦）。
 *
 * 动态计数拉取方式（design Decision 2 裁决，覆盖 B6e 极简版「纯本地导航零网络」
 * 注释）：本组件在 QueryClient 上下文中运行时，自行以 useRiskSummary +
 * useChangeRequests 拉取摘要并计算徽标（与 W1/W2 页面共享同一 QueryKey，写操作
 * 后的缓存失效自动联动刷新，RL-04）；报表中心计数因宿主另有数据源，维持 prop
 * 注入。无 QueryClient 的环境（纯静态用例）自动降级为零计数渲染，绝不抛错。
 * 条目与图标保持静态确定性（RL-14）。
 */

export interface ProjectDomainMenuProps {
  projectId: number
  /** 报表中心待审核版本计数；>0 时在报表中心条目旁展示琥珀色徽标。 */
  pendingReviewCount?: number
}

export type ProjectDomainEntryId =
  | 'resources'
  | 'members'
  | 'files'
  | 'risks'
  | 'change-requests'
  | 'reports'
  | 'charts'
  | 'project-settings'

export interface ProjectDomainMenuEntry {
  id: ProjectDomainEntryId
  label: string
  /** lucide 图标名（菜单内静态映射）。 */
  icon:
    'Users' | 'FolderArchive' | 'Shield' | 'GitPullRequest' | 'FileText' | 'BarChart3' | 'Settings2'
  description: string
}

export type ProjectDomainGroupId = 'collaboration' | 'governance'

export interface ProjectDomainMenuGroup {
  id: ProjectDomainGroupId
  label: string
  entries: readonly ProjectDomainMenuEntry[]
}

/** 功能域条目白名单分组（静态确定性；v3-ui-next-resource-team-domains W4 · tasks 4.1
 *  重组：协同管理（资源/成员/文件）与治理与分析（风险/变更/报表/图表）正交组织，
 *  与 LensSwitcher 六镜头彻底解耦）。 */
export const PROJECT_DOMAIN_MENU_GROUPS: readonly ProjectDomainMenuGroup[] = [
  {
    id: 'collaboration',
    label: '协同管理',
    entries: [
      {
        id: 'resources',
        label: '资源工作台',
        icon: 'Users',
        description: '资源底册 / 分配明细 / 团队负荷排查',
      },
      {
        id: 'members',
        label: '成员与团队',
        icon: 'Users',
        description: '成员底册 / 角色调整 / 邀请与转让',
      },
      {
        id: 'files',
        label: '项目文件库',
        icon: 'FolderArchive',
        description: '交付物归档 / 附件上传与安全下载',
      },
    ],
  },
  {
    id: 'governance',
    label: '治理与分析',
    entries: [
      {
        id: 'risks',
        label: '风险管理',
        icon: 'Shield',
        description: '风险辨识、态势评估与受控应对流转',
      },
      {
        id: 'change-requests',
        label: '变更请求',
        icon: 'GitPullRequest',
        description: '基线变更申请、六维影响分析与审批决策',
      },
      {
        id: 'reports',
        label: '报表中心',
        icon: 'FileText',
        description: '预设报表 / 周期周报月报 / 版本审阅',
      },
      { id: 'charts', label: '图表馆', icon: 'BarChart3', description: '20 项经典项目管理图表' },
      {
        id: 'project-settings',
        label: '项目设置',
        icon: 'Settings2',
        description: '工作日历 / 节假日 / 调休日排程基线',
      },
    ],
  },
]

/** 扁平化功能域条目（兼容既有消费方遍历语义；分组顺序即展示顺序）。 */
export const PROJECT_DOMAIN_MENU_ENTRIES: readonly ProjectDomainMenuEntry[] =
  PROJECT_DOMAIN_MENU_GROUPS.flatMap((group) => group.entries)

const ENTRY_PATHS: Record<ProjectDomainEntryId, string> = {
  resources: '/resources',
  members: '/members',
  files: '/files',
  risks: '/risks',
  'change-requests': '/change-requests',
  reports: '/reports',
  charts: '/charts',
  'project-settings': '/settings',
}

const ENTRY_ICONS = {
  Users,
  FolderArchive,
  Shield,
  GitPullRequest,
  FileText,
  BarChart3,
  Settings2,
} as const

export interface ProjectDomainMenuViewProps extends ProjectDomainMenuProps {
  /** 高危严重风险合并数；null 表示摘要未解析（加载中/失败）→ 不渲染徽标。 */
  riskAlertCount?: number | null
  /** 待审批变更数；null 表示计数未解析 → 不渲染徽标。 */
  pendingChangeRequestCount?: number | null
}

/** 菜单主体（纯展示与本地导航；计数由宿主/活体包装传入）。 */
export function ProjectDomainMenuView({
  projectId,
  pendingReviewCount = 0,
  riskAlertCount = null,
  pendingChangeRequestCount = null,
}: ProjectDomainMenuViewProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const hasAlarm = (riskAlertCount ?? 0) > 0 || (pendingChangeRequestCount ?? 0) > 0

  function navigateTo(entry: (typeof PROJECT_DOMAIN_MENU_ENTRIES)[number]) {
    setOpen(false)
    router.push(`/next/projects/${projectId}${ENTRY_PATHS[entry.id]}`)
  }

  return (
    <div ref={rootRef} data-project-domain-menu className="relative">
      <button
        type="button"
        data-project-domain-trigger
        aria-label="功能域菜单"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
      >
        <Layers className="h-3.5 w-3.5" aria-hidden />
        功能域
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
        {hasAlarm ? (
          <span
            data-domain-alert-dot
            aria-hidden
            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--nx-status-danger)] shadow-[0_0_6px_var(--nx-status-danger)]"
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="功能域入口"
          data-project-domain-panel
          className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        >
          {PROJECT_DOMAIN_MENU_GROUPS.map((group, groupIndex) => (
            <section
              key={group.id}
              data-domain-group={group.id}
              className={cn(
                groupIndex > 0 && 'mt-1 border-t border-[var(--nx-border-hairline)]/70 pt-1',
              )}
            >
              <p
                data-domain-group-label
                className="px-3 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]"
              >
                {group.label}
              </p>
              {group.entries.map((entry) => {
                const Icon = ENTRY_ICONS[entry.icon]
                const alertBadge =
                  entry.id === 'risks' && riskAlertCount !== null
                    ? {
                        tone: riskAlertCount > 0 ? ('danger' as const) : ('neutral' as const),
                        text: `${riskAlertCount} 项高危`,
                      }
                    : null
                const crBadge =
                  entry.id === 'change-requests' && pendingChangeRequestCount !== null
                    ? {
                        tone:
                          pendingChangeRequestCount > 0
                            ? ('warning' as const)
                            : ('neutral' as const),
                        text: `${pendingChangeRequestCount} 项待审`,
                      }
                    : null
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    data-project-domain-item
                    data-domain-id={entry.id}
                    onClick={() => navigateTo(entry)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-0)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nx-border-focus)]"
                  >
                    <Icon
                      className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-[var(--nx-text-primary)]">
                        {entry.label}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--nx-text-muted)]">
                        {entry.description}
                      </span>
                    </span>
                    {alertBadge ? (
                      <span
                        data-domain-alert-badge
                        data-domain-badge-tone={alertBadge.tone}
                        className={cn(
                          'shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none',
                          alertBadge.tone === 'danger'
                            ? 'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] text-[var(--nx-status-danger)]'
                            : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
                        )}
                      >
                        {alertBadge.text}
                      </span>
                    ) : null}
                    {crBadge ? (
                      <span
                        data-domain-cr-badge
                        data-domain-badge-tone={crBadge.tone}
                        className={cn(
                          'shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none',
                          crBadge.tone === 'warning'
                            ? 'border-[var(--nx-status-warning)] bg-[var(--nx-bg-1)] text-[var(--nx-status-warning)]'
                            : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
                        )}
                      >
                        {crBadge.text}
                      </span>
                    ) : null}
                    {entry.id === 'reports' && pendingReviewCount > 0 ? (
                      <span
                        data-domain-pending-badge
                        className="shrink-0 rounded border border-[var(--nx-status-warning)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-status-warning)]"
                      >
                        待审核 {pendingReviewCount}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 活体包装：QueryClient 上下文中以 hooks 自取风险摘要与待审批变更计数（design D2）。 */
function ProjectDomainMenuLive({ projectId, pendingReviewCount = 0 }: ProjectDomainMenuProps) {
  const summaryQuery = useRiskSummary(projectId)
  const submittedQuery = useChangeRequests(projectId, { status: 'submitted', perPage: 1 })
  const underReviewQuery = useChangeRequests(projectId, { status: 'under_review', perPage: 1 })

  const summary = summaryQuery.data?.data
  const riskAlertCount =
    summary !== undefined ? (summary.highRiskCount ?? 0) + (summary.criticalRiskCount ?? 0) : null
  const pendingChangeRequestCount =
    submittedQuery.data !== undefined && underReviewQuery.data !== undefined
      ? (submittedQuery.data?.meta?.total ?? 0) + (underReviewQuery.data?.meta?.total ?? 0)
      : null

  return (
    <ProjectDomainMenuView
      projectId={projectId}
      pendingReviewCount={pendingReviewCount}
      riskAlertCount={riskAlertCount}
      pendingChangeRequestCount={pendingChangeRequestCount}
    />
  )
}

export function ProjectDomainMenu({ projectId, pendingReviewCount = 0 }: ProjectDomainMenuProps) {
  // 无 QueryClient（如纯静态用例/极简环境）时降级为零计数渲染，绝不抛错。
  const hasQueryClient = React.useContext(QueryClientContext) !== undefined
  if (!hasQueryClient) {
    return (
      <ProjectDomainMenuView
        projectId={projectId}
        pendingReviewCount={pendingReviewCount}
        riskAlertCount={null}
        pendingChangeRequestCount={null}
      />
    )
  }
  return <ProjectDomainMenuLive projectId={projectId} pendingReviewCount={pendingReviewCount} />
}

export default ProjectDomainMenu
