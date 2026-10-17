'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  BarChart3,
  Compass,
  LayoutGrid,
  Layers,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { PM_CHART_DEFINITIONS } from '@/lib/next/charts/chart-catalog-metadata'
import { OrgReportsGalleryWing } from '@/components/next/charts/OrgReportsGalleryWing'

type ChartsPageTab = 'charts' | 'reports-wing'

/**
 * 全域图表馆顶层入口（/next/charts，v3-ui-next-chart-gallery tasks 1.7 /
 * spec「全局图表馆路由」；v3-ui-next-batch4-reports-change-queue W1 · tasks 1.7
 * 装配组织级报表分馆 Tab）。
 *
 * - 全景概览：24 项图表（20 经典 PM + 4 TRIZ 分馆，当前全部已就绪）+ 三通道说明；
 * - 消费当前组织项目列表（最近更新优先），引导选择目标项目进入项目级图表馆
 *   `/next/projects/:id/charts`；
 * - `?tab=charts|reports-wing` 联动切换「图表全览」与「组织级报表分馆」；
 * - 加载/空态/错误统一收敛；零写请求（RL-01）。
 */
export default function GlobalChartsGalleryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const hasHydrated = useAuthStore((state) => state.hasHydrated)

  const initialTab: ChartsPageTab =
    searchParams.get('tab') === 'reports-wing' ? 'reports-wing' : 'charts'
  const [activeTab, setActiveTab] = React.useState<ChartsPageTab>(initialTab)

  function handleTabChange(tab: ChartsPageTab) {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`/next/charts?${params.toString()}`)
  }

  const counts = React.useMemo(
    () => ({
      available: PM_CHART_DEFINITIONS.filter((d) => d.status === 'available').length,
      comingSoon: PM_CHART_DEFINITIONS.filter((d) => d.status === 'coming-soon').length,
    }),
    [],
  )

  const {
    data: page,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: projectKeys.list(currentOrganizationId ?? 0, {
      sort: '-updatedAt',
      perPage: 24,
    }),
    queryFn: () => projectsApi.list({ sort: '-updatedAt', perPage: 24 }),
    enabled: hasHydrated && currentOrganizationId !== null,
    retry: false,
  })

  const projects = page?.data ?? []

  return (
    <div data-global-charts-gallery className="flex flex-col gap-6">
      {/* 全景标题区 */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
            <BarChart3 className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold text-[var(--nx-text-primary)]">图表馆</h1>
          <span className="rounded border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-accent)]">
            已就绪 {counts.available}
          </span>
          {counts.comingSoon > 0 && (
            <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-text-muted)]">
              即将上线 {counts.comingSoon}
            </span>
          )}
        </div>
        <p className="max-w-2xl text-xs leading-relaxed text-[var(--nx-text-secondary)]">
          20 项业界经典项目管理图表与高维分析矩阵（D12/D15）。选择下方项目进入项目级图表馆；
          也可在任意项目空间呼出空间地图（Ctrl/Cmd + M）或让 AI 同事直接带你直达图表镜头。
        </p>
      </header>

      {/* 图表全览 / 组织级报表分馆 Tab 切换 */}
      <div
        data-charts-page-tabs
        role="tablist"
        aria-label="图表馆分区导航"
        className="flex items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1 text-xs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'charts'}
          data-charts-page-tab="charts"
          onClick={() => handleTabChange('charts')}
          className={`flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${
            activeTab === 'charts'
              ? 'bg-[var(--nx-space-surface)] text-[var(--nx-text-primary)] shadow-sm font-medium'
              : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          图表全览
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'reports-wing'}
          data-charts-page-tab="reports-wing"
          onClick={() => handleTabChange('reports-wing')}
          className={`flex items-center gap-1.5 rounded px-3 py-1.5 transition-colors ${
            activeTab === 'reports-wing'
              ? 'bg-[var(--nx-space-surface)] text-[var(--nx-accent)] shadow-sm font-medium'
              : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
          }`}
        >
          <Layers className="h-3.5 w-3.5" aria-hidden />
          组织级报表分馆
        </button>
      </div>

      {activeTab === 'reports-wing' ? (
        <OrgReportsGalleryWing organizationId={currentOrganizationId} />
      ) : (
        <>
          {/* 三通道可达说明（纯静态，零请求） */}
          <section
            data-global-charts-channels
            aria-label="图表馆三通道可达说明"
            className="grid grid-cols-1 gap-3 md:grid-cols-3"
          >
            {[
              {
                icon: LayoutGrid,
                title: '独立空间直达',
                text: '/next/charts 与 /next/projects/:id/charts 深层路由随时直达',
              },
              {
                icon: Compass,
                title: '空间地图点亮',
                text: '全域空间地图中「图表馆」已就绪，一键唤起跳转',
              },
              {
                icon: WandSparkles,
                title: 'AI 同事唤起',
                text: '「去图表馆」「打开鱼骨图」等自然语言直达图表镜头',
              },
            ].map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="flex items-start gap-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3.5"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
                <div className="min-w-0">
                  <h3 className="text-xs font-medium text-[var(--nx-text-primary)]">{title}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                    {text}
                  </p>
                </div>
              </div>
            ))}
          </section>

          {/* 项目选择区 */}
          <section
            data-global-charts-projects
            aria-label="选择项目进入图表馆"
            className="flex flex-col gap-3"
          >
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--nx-text-primary)]">
              <Sparkles className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
              选择项目 · 进入项目级图表馆
            </h2>

            {!hasHydrated || currentOrganizationId === null ? (
              <div
                data-global-charts-loading
                role="status"
                aria-busy="true"
                className="text-xs text-[var(--nx-text-muted)]"
              >
                正在加载项目列表…
              </div>
            ) : isPending ? (
              <div
                data-global-charts-loading
                role="status"
                aria-label="正在加载项目列表"
                aria-busy="true"
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
              >
                {[0, 1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-24 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
                  />
                ))}
              </div>
            ) : isError ? (
              <div
                data-global-charts-error
                role="alert"
                className="flex items-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-3"
              >
                <p className="text-xs text-[var(--nx-text-secondary)]">
                  项目列表加载失败，请稍后重试。
                </p>
                <button
                  type="button"
                  data-global-charts-retry
                  onClick={() => void refetch()}
                  className="h-8 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
                >
                  重新载入
                </button>
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-6 py-12 text-center">
                <p className="text-sm text-[var(--nx-text-secondary)]">
                  当前组织还没有可进入的项目
                </p>
                <Link
                  href="/next/create"
                  data-global-charts-empty-cta
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
                >
                  去生成剧场用一句话创建项目
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    data-global-charts-project={project.id}
                    aria-label={`打开 ${project.name} 的图表馆`}
                    onClick={() => router.push(`/next/projects/${project.id}/charts`)}
                    className="flex items-center justify-between gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4 text-left transition-colors hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-space-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
                          {project.name}
                        </span>
                        {project.code ? (
                          <span className="shrink-0 rounded border border-[var(--nx-border-hairline)] px-1 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                            {project.code}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 flex items-center gap-2 text-[11px] text-[var(--nx-text-muted)]">
                        <span data-project-health data-health={project.healthStatus}>
                          {project.healthStatus}
                        </span>
                        <span className="font-mono">进度 {project.progressPercent}%</span>
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[var(--nx-accent)]" aria-hidden />
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
