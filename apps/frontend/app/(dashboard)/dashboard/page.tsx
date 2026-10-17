'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { CopilotOperatingEntry } from '@/components/copilot/CopilotOperatingEntry'
import { buttonVariants } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useOrganizationDashboard } from '@/hooks/use-organization-dashboard'
import { projectKeys, projectsApi } from '@/lib/api/projects'
import {
  ORGANIZATION_METRIC_LABELS,
  ORGANIZATION_PROJECT_STATUS_LABELS,
  formatOrganizationMetricValue,
  formatRelativeTime,
  selectKpiStrip,
} from '@/lib/organization-dashboard-ui'
import { useAuthStore } from '@/stores/auth-store'

const RECENT_PROJECT_LIMIT = 6
const ACTIVITY_LIMIT = 8

/**
 * `/dashboard`（v3-copilot-productized-operating-entry 任务 5.2 + 概览补齐）：
 *
 * 顶部保留 Copilot 工作区块与三条导航；下方为真实数据概览：
 * 组织 KPI 条、最近项目与团队动态流（均来自既有只读接口，无数据时如实显示空态/不可用）。
 * 保持单列流式布局，不摆等权 icon grid。
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-4xl py-8" data-dashboard-page>
      <CopilotOperatingEntry />

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-gray-500">也可以直接前往：</span>
        <Link
          href="/projects"
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          data-dashboard-projects-link
        >
          查看项目列表
        </Link>
        <Link
          href="/ai-create"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          data-dashboard-ai-create-link
        >
          AI 快速创建项目
        </Link>
        <Link
          href="/strategy-execution-cockpit"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          data-dashboard-cockpit-link
        >
          战略执行驾驶舱
        </Link>
      </div>

      <DashboardOverview />
    </div>
  )
}

function SectionTitle({ children, href }: { children: string; href?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="text-sm font-semibold text-gray-900">{children}</h2>
      {href && (
        <Link href={href} className="text-xs text-primary hover:underline">
          查看全部
        </Link>
      )}
    </div>
  )
}

function DashboardOverview() {
  const organizationId = useAuthStore((state) => state.currentOrganizationId)
  const summary = useOrganizationDashboard({
    sections: ['kpi', 'activity'],
    activityLimit: ACTIVITY_LIMIT,
  })
  const projects = useQuery({
    queryKey: projectKeys.list(organizationId ?? 0, { perPage: RECENT_PROJECT_LIMIT }),
    queryFn: () => projectsApi.list({ perPage: RECENT_PROJECT_LIMIT }),
    enabled: organizationId !== null,
  })

  if (organizationId === null) {
    return (
      <p className="mt-8 text-sm text-gray-500" data-dashboard-overview>
        选择组织后，这里会显示项目概览、最近项目与团队动态。
      </p>
    )
  }

  const kpis = selectKpiStrip(summary.data)
  const activity = summary.data?.recentActivity ?? []
  const projectList = projects.data?.data ?? []
  const projectNameById = new Map(projectList.map((p) => [p.id, p.name]))

  return (
    <div className="mt-8 space-y-8" data-dashboard-overview>
      <section data-dashboard-kpis>
        <SectionTitle href="/organization">项目概览</SectionTitle>
        {summary.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : summary.isError ? (
          <p className="text-sm text-gray-500">项目概览暂不可用，请稍后重试。</p>
        ) : kpis.length === 0 ? (
          <p className="text-sm text-gray-500">暂无可展示的组织指标。</p>
        ) : (
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            {kpis.map((metric) => (
              <div key={metric.key} className="min-w-[5rem]">
                <dt className="text-xs text-gray-500">
                  {ORGANIZATION_METRIC_LABELS[metric.key] ?? metric.key}
                </dt>
                <dd className="text-xl font-semibold text-gray-900">
                  {formatOrganizationMetricValue(metric)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section data-dashboard-recent-projects>
        <SectionTitle href="/projects">最近项目</SectionTitle>
        {projects.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : projects.isError ? (
          <p className="text-sm text-gray-500">项目列表暂不可用，请稍后重试。</p>
        ) : projectList.length === 0 ? (
          <p className="text-sm text-gray-500">
            还没有项目。
            <Link href="/ai-create" className="ml-1 text-primary hover:underline">
              用一句话创建第一个项目
            </Link>
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {projectList.map((project) => (
              <li key={project.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <Link
                  href={`/projects/${project.id}`}
                  className="min-w-0 truncate text-sm font-medium text-gray-900 hover:underline"
                >
                  {project.name}
                </Link>
                <span className="shrink-0 text-xs text-gray-500">
                  {ORGANIZATION_PROJECT_STATUS_LABELS[project.status] ?? project.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-dashboard-activity>
        <SectionTitle>团队动态</SectionTitle>
        {summary.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : summary.isError ? (
          <p className="text-sm text-gray-500">团队动态暂不可用，请稍后重试。</p>
        ) : activity.length === 0 ? (
          <p className="text-sm text-gray-500">暂无最近动态。</p>
        ) : (
          <ul className="space-y-2">
            {activity.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-gray-700">
                  <span className="font-mono text-xs text-gray-500">{item.action}</span>
                  {item.projectId !== null && (
                    <Link
                      href={`/projects/${item.projectId}`}
                      className="ml-2 text-primary hover:underline"
                    >
                      {projectNameById.get(item.projectId) ?? `项目 #${item.projectId}`}
                    </Link>
                  )}
                </span>
                <time className="shrink-0 text-xs text-gray-500" dateTime={item.occurredAt}>
                  {formatRelativeTime(item.occurredAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
