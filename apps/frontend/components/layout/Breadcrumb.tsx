'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { allNavItems } from '@/lib/navigation'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'
import { getGreetingLabel, selectDailyGreeting } from '@/lib/daily-greetings'

/** 项目内路由段 → 中文（视图 + 常见子页），面包屑去英文 slug。 */
const PROJECT_SEGMENT_LABELS: Record<string, string> = {
  kanban: '看板',
  list: '列表',
  gantt: '甘特图',
  calendar: '日历',
  timeline: '时间线',
  wbs: 'WBS',
  tasks: '任务批量管理',
  members: '成员管理',
  settings: '项目设置',
  'change-requests': '变更请求',
  reports: '报表与甘特',
  risks: '风险管理',
  resources: '资源管理',
  files: '文件',
  diagrams: '图表',
}

/**
 * 顶栏面包屑（build-app-shell-layout / spec app-shell-navigation）。
 *
 * - Dashboard（`/dashboard` 与其子路径）替换为「你好，X」+ 中文长日期。
 * - 其他页面：根据 URL 段构造面包屑，第一段用导航配置里的中文 label（找不到时兜底为原段）。
 * - 面包屑纯展示，不承担导航状态；点击段跳转到该段路径。
 */
export function Breadcrumb() {
  const pathname = usePathname()
  const userName = useAuthStore((state) => state.user?.fullName ?? state.user?.email)

  const isDashboard = pathname === '/dashboard' || pathname.startsWith('/dashboard/')

  // 识别 /projects/[id]/... 形态：[id] 段显示项目真实名（而非数字）。
  const parts = useMemo(() => pathname.split('/').filter(Boolean), [pathname])
  const projectId =
    parts[0] === 'projects' && /^\d+$/.test(parts[1] ?? '') ? Number(parts[1]) : null

  const projectQuery = useQuery({
    queryKey: projectKeys.detail(projectId ?? 0),
    queryFn: () => projectsApi.get(projectId!),
    enabled: projectId !== null,
    staleTime: 60_000,
  })
  const projectName = projectQuery.data?.name

  const segments = useMemo(() => {
    if (isDashboard) return []
    return parts.map((segment, index) => {
      const href = '/' + parts.slice(0, index + 1).join('/')
      // 第一段优先匹配 navigation 配置里的 label。
      const navMatch = allNavItems.find((item) => item.href === href)
      let label = navMatch?.label ?? decodeURIComponent(segment)
      // 项目详情路径：[id] 段用项目名（加载中回退原段）、后续段用中文视图/子页名。
      if (projectId !== null && index === 1) {
        label = projectName ?? segment
      } else if (projectId !== null && index >= 2 && PROJECT_SEGMENT_LABELS[segment]) {
        label = PROJECT_SEGMENT_LABELS[segment]
      }
      return { href, label, isLast: index === parts.length - 1 }
    })
  }, [isDashboard, parts, projectId, projectName])

  if (isDashboard) {
    const now = new Date()
    const greeting = getGreetingLabel(now)
    const dailyGreeting = selectDailyGreeting({ date: now, userKey: userName })
    const today = formatCompactChineseDate(now)
    return (
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="min-w-0 max-w-[18rem] shrink-0 truncate text-md font-medium text-gray-800">
          {greeting}
          {userName ? `，${userName}` : ''}
        </h1>
        <span aria-hidden className="hidden shrink-0 text-sm text-gray-300 md:inline">
          ·
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-sm leading-5 text-gray-600 md:inline">
          {dailyGreeting.text}
        </span>
        <span aria-hidden className="hidden shrink-0 text-sm text-gray-300 xl:inline">
          ·
        </span>
        <span className="hidden shrink-0 text-xs leading-5 text-gray-500 xl:inline">{today}</span>
      </div>
    )
  }

  if (segments.length === 0) return null

  return (
    <nav aria-label="面包屑" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm text-gray-500">
        {segments.map((segment) => (
          <Fragment key={segment.href}>
            {segment.isLast ? (
              <li aria-current="page" className="truncate text-gray-800">
                {segment.label}
              </li>
            ) : (
              <li className="truncate">
                <Link
                  href={segment.href}
                  className={cn('rounded-[var(--radius-sm)] px-1 hover:text-gray-800', focusRing)}
                >
                  {segment.label}
                </Link>
              </li>
            )}
            {!segment.isLast ? (
              <li aria-hidden className="text-gray-300">
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
            ) : null}
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}

function formatCompactChineseDate(date: Date): string {
  const m = date.getMonth() + 1
  const d = date.getDate()
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${m}月${d}日 ${weekdays[date.getDay()]}`
}
