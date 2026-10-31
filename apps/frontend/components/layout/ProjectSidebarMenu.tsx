'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  CalendarDays,
  ChartGantt,
  Columns3,
  FileEdit,
  FolderOpen,
  HeartPulse,
  LayoutDashboard,
  List,
  ListChecks,
  Milestone,
  Network,
  Settings,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { navItemClassName } from './NavItem'

/** 从路径取项目 id：`/projects/7`、`/projects/7/gantt` → 7；其他路径 → null。 */
export function projectIdFromPath(pathname: string): number | null {
  const match = /^\/projects\/(\d+)(?:\/|$)/.exec(pathname)
  return match ? Number(match[1]) : null
}

interface ProjectModule {
  /** 相对项目根的路径段。 */
  segment: string
  label: string
  icon: LucideIcon
}

/** 项目模块菜单（OpenProject 式：进入项目后左侧导航变为该项目的模块）。 */
export const PROJECT_MODULES: readonly ProjectModule[] = [
  { segment: 'overview', label: '概览', icon: LayoutDashboard },
  { segment: 'kanban', label: '看板', icon: Columns3 },
  { segment: 'list', label: '列表', icon: List },
  { segment: 'gantt', label: '甘特图', icon: ChartGantt },
  { segment: 'calendar', label: '日历', icon: CalendarDays },
  { segment: 'timeline', label: '时间线', icon: Milestone },
  { segment: 'wbs', label: 'WBS', icon: Network },
  { segment: 'health-risk-command-center', label: '健康与风险', icon: HeartPulse },
  { segment: 'tasks', label: '任务', icon: ListChecks },
  { segment: 'risks', label: '风险', icon: ShieldAlert },
  { segment: 'change-requests', label: '变更请求', icon: FileEdit },
  { segment: 'files', label: '文件', icon: FolderOpen },
  { segment: 'reports', label: '报表', icon: BarChart3 },
  { segment: 'resources', label: '资源', icon: Boxes },
  { segment: 'members', label: '成员', icon: Users },
  { segment: 'settings', label: '设置', icon: Settings },
]

function moduleHref(projectId: number, segment: string) {
  return `/projects/${projectId}/${segment}`
}

/** 当前模块：按路径段前缀命中；项目根（重定向到默认视图前）视为概览。 */
export function activeProjectModule(pathname: string, projectId: number): string | null {
  const root = `/projects/${projectId}`
  if (pathname === root || pathname === `${root}/`) return 'overview'
  const segment = pathname.slice(root.length + 1).split('/')[0] ?? ''
  return PROJECT_MODULES.some((item) => item.segment === segment) ? segment : null
}

export interface ProjectSidebarMenuProps {
  projectId: number
  collapsed?: boolean
  onNavigate?: () => void
}

export function ProjectSidebarMenu({
  projectId,
  collapsed = false,
  onNavigate,
}: ProjectSidebarMenuProps) {
  const pathname = usePathname()
  // 与项目头共用同一个查询键，不额外发请求。
  const project = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  })
  const active = activeProjectModule(pathname, projectId)
  const projectName = project.data?.name ?? `项目 #${projectId}`

  const backLink = (
    <Link
      href="/projects"
      onClick={onNavigate}
      className={cn(
        navItemClassName({ active: false, collapsed }),
        'text-[var(--shell-sidebar-muted)]',
      )}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      {collapsed ? <span className="sr-only">返回全部项目</span> : <span>返回全部项目</span>}
    </Link>
  )

  return (
    <div data-project-sidebar-menu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{backLink}</TooltipTrigger>
          <TooltipContent side="right">返回全部项目</TooltipContent>
        </Tooltip>
      ) : (
        backLink
      )}
      {collapsed ? null : (
        <div
          className="truncate px-3 pb-2 pt-3 text-sm font-semibold text-[var(--shell-sidebar-fg)]"
          title={projectName}
        >
          {projectName}
        </div>
      )}
      <ul aria-label="项目模块" className="space-y-0.5">
        {PROJECT_MODULES.map((item) => {
          const href = moduleHref(projectId, item.segment)
          const isActive = active === item.segment
          const Icon = item.icon
          const link = (
            <Link
              href={href}
              onClick={onNavigate}
              data-active={isActive || undefined}
              aria-current={isActive ? 'page' : undefined}
              className={cn(navItemClassName({ active: isActive, collapsed }), focusRing)}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {collapsed ? null : <span className="truncate">{item.label}</span>}
            </Link>
          )
          return (
            <li key={item.segment}>
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                link
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
