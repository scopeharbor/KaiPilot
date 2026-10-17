'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  ChevronRight,
  Clock,
  Filter,
  Flag,
  Layers,
  RefreshCw,
  Search,
  Users,
  X,
} from 'lucide-react'
import { projectsApi } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { MONO_FONT_STACK } from '@/lib/next/chart-export'
import {
  fetchAndComposeOrgReport,
  type OrgDelaySnapshotData,
  type OrgMilestoneSnapshotData,
  type OrgProgressSnapshotData,
  type OrgReportTemplate,
  type OrgWorkloadSnapshotData,
} from '@/lib/next/org-reports-composer'
import { ChartExportMenu } from './ChartExportMenu'

export interface OrgReportsGalleryWingProps {
  organizationId?: number | null
  className?: string
  initialTemplate?: OrgReportTemplate | null
  onTemplateChange?: (template: OrgReportTemplate | null) => void
  immersionTier?: 'immersive' | 'light' | 'precise'
}

interface TemplateMetadata {
  id: OrgReportTemplate
  name: string
  subtitle: string
  icon: typeof BarChart3
  badgeColor: string
  description: string
}

const TEMPLATE_METAS: TemplateMetadata[] = [
  {
    id: 'progress',
    name: '组织进度概览报表',
    subtitle: 'Org Progress Summary',
    icon: BarChart3,
    badgeColor: 'text-[var(--nx-accent)] border-[var(--nx-border-focus)]',
    description: '汇总组织内全部活跃项目的任务完成率、延期比例与总体推进健康度。',
  },
  {
    id: 'delay',
    name: '全域延期任务全景',
    subtitle: 'Cross-Project Delay Panorama',
    icon: Clock,
    badgeColor: 'text-[var(--nx-status-danger)] border-[var(--nx-status-danger)]/40',
    description: '聚合各项目逾期高危任务、阻塞节点与归因分析，实时洞悉关键路径风险。',
  },
  {
    id: 'workload',
    name: '组织资源工时负荷',
    subtitle: 'Org Resource Workload Matrix',
    icon: Users,
    badgeColor: 'text-[var(--nx-ai)] border-[var(--nx-ai)]/40',
    description: '按成员与项目双维度透视工时投入、超额分配率与空闲容量，防范团队过载。',
  },
  {
    id: 'milestone',
    name: '里程碑交付全景',
    subtitle: 'Org Milestone Roadmap',
    icon: Flag,
    badgeColor: 'text-[var(--nx-status-success)] border-[var(--nx-status-success)]/40',
    description: '展示组织跨项目的关键里程碑时间轴、达成率与偏差走势，保障战略节点按期兑现。',
  },
]

/**
 * 图表馆组织级报表分馆组件 (OrgReportsGalleryWing)
 *
 * 满足:
 * - D8/D12/D15 & tasks 1.3/1.4;
 * - Layer 2 暗黑仪器感与 1px 发丝线设计系统;
 * - 4 类预设报表模板（进度、延期、工时、里程碑）跨项目聚合卡片;
 * - 按项目与时间范围过滤工具栏;
 * - 精确档 (data-immersion="precise") 纯平降级 (RL-15);
 * - 未选组织中性引导态且零数据请求 (RL-05);
 * - 纯只读浏览与零写网络请求 (RL-01);
 * - 客户端多格式汇出引擎复用 (SVG/PNG/JPG).
 */
export function OrgReportsGalleryWing({
  organizationId: propOrgId,
  className = '',
  initialTemplate = null,
  onTemplateChange,
  immersionTier: propImmersionTier,
}: OrgReportsGalleryWingProps) {
  const currentOrgIdFromStore = useAuthStore((s) => s.currentOrganizationId)
  const organizationId = propOrgId !== undefined ? propOrgId : currentOrgIdFromStore
  const hookTier = useImmersionTier()
  const immersionTier = propImmersionTier ?? hookTier
  const isPrecise = immersionTier === 'precise'

  // 状态管理
  const [activeTemplate, setActiveTemplate] = React.useState<OrgReportTemplate | null>(
    initialTemplate,
  )
  const [selectedProjectIds, setSelectedProjectIds] = React.useState<number[]>([])
  const [fromDate, setFromDate] = React.useState<string>('')
  const [toDate, setToDate] = React.useState<string>('')
  const [projectSearchQuery, setProjectSearchQuery] = React.useState<string>('')

  const snapshotSurfaceRef = React.useRef<HTMLDivElement | null>(null)

  // 1. 获取组织活跃项目列表（未选组织时不发请求 RL-05）
  const { data: projects = [] } = useQuery({
    queryKey: ['org-reports-wing-projects', organizationId],
    queryFn: async () => {
      if (!organizationId) return []
      const res = await projectsApi.list({ perPage: 50, sort: '-updatedAt' })
      return res.data ?? []
    },
    enabled: organizationId != null,
    staleTime: 60_000,
  })

  // 过滤后的项目集合
  const filteredProjects = React.useMemo(() => {
    if (!projectSearchQuery.trim()) return projects
    const q = projectSearchQuery.toLowerCase()
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.code && p.code.toLowerCase().includes(q)),
    )
  }, [projects, projectSearchQuery])

  // 2. 报表快照合成查询（当选定模板时触发前端多查询合成）
  const {
    data: snapshot,
    isPending: isLoadingSnapshot,
    isFetching: isFetchingSnapshot,
    refetch: refetchSnapshot,
  } = useQuery({
    queryKey: [
      'org-reports-wing-snapshot',
      organizationId,
      activeTemplate,
      selectedProjectIds,
      fromDate,
      toDate,
    ],
    queryFn: async () => {
      if (!organizationId || !activeTemplate) return null
      return fetchAndComposeOrgReport(organizationId, {
        template: activeTemplate,
        projectIds: selectedProjectIds.length > 0 ? selectedProjectIds : undefined,
        today: toDate || undefined,
      })
    },
    enabled: organizationId != null && activeTemplate != null,
    staleTime: 30_000,
  })

  function handleSelectTemplate(tmpl: OrgReportTemplate | null) {
    setActiveTemplate(tmpl)
    onTemplateChange?.(tmpl)
  }

  function toggleProjectFilter(projectId: number) {
    setSelectedProjectIds((prev) =>
      prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId],
    )
  }

  function clearProjectFilters() {
    setSelectedProjectIds([])
  }

  // RL-05: 未选组织时渲染中性引导态，零数据发包
  if (organizationId == null) {
    return (
      <div
        data-org-reports-gallery-wing
        data-unselected-org-neutral
        data-immersion={isPrecise ? 'precise' : immersionTier}
        className={`flex flex-col items-center justify-center rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-12 text-center ${className}`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]">
          <Layers className="h-6 w-6" aria-hidden />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-[var(--nx-text-primary)]">未选择有效组织</h3>
        <p className="mt-1.5 max-w-sm text-xs text-[var(--nx-text-secondary)]">
          组织级报表分馆需在具体的企业或部门组织上下文下运行。请在顶栏或个人空间选择组织后继续。
        </p>
      </div>
    )
  }

  return (
    <div
      data-org-reports-gallery-wing
      data-immersion={isPrecise ? 'precise' : immersionTier}
      className={`flex flex-col gap-6 font-sans ${className}`}
    >
      {/* 顶部标题与分馆 Tab */}
      <div className="flex flex-col gap-4 border-b border-[var(--nx-border-hairline)] pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)]">
            <Layers className="h-5 w-5 text-[var(--nx-accent)]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--nx-text-primary)]">
                组织级报表分馆
              </h2>
              <span className="rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-accent)]">
                组织视角
              </span>
              <span className="text-[11px] text-[var(--nx-text-muted)]">
                共 {projects.length} 个纳入项目
              </span>
            </div>
            <p className="text-xs text-[var(--nx-text-secondary)]">
              4 类标准化组织级预设报表模板聚合快照，支持多项目交叉收敛与零网络纯客户端汇出。
            </p>
          </div>
        </div>

        {/* 模板快速分流 Tabs */}
        <div
          data-org-reports-tabs
          className="flex items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-1 text-xs"
        >
          <button
            type="button"
            data-template-tab="all"
            onClick={() => handleSelectTemplate(null)}
            className={`rounded px-2.5 py-1 transition-colors ${
              activeTemplate === null
                ? 'bg-[var(--nx-space-surface)] text-[var(--nx-text-primary)] shadow-sm'
                : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
            }`}
          >
            模板全览
          </button>
          {TEMPLATE_METAS.map((meta) => {
            const isSelected = activeTemplate === meta.id
            return (
              <button
                key={meta.id}
                type="button"
                data-template-tab={meta.id}
                onClick={() => handleSelectTemplate(meta.id)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${
                  isSelected
                    ? 'bg-[var(--nx-space-surface)] text-[var(--nx-accent)] shadow-sm font-medium'
                    : 'text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]'
                }`}
              >
                <meta.icon className="h-3.5 w-3.5" />
                <span>{meta.name.replace(/（.*）/, '')}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 过滤工具栏：按项目多选与时间范围过滤 */}
      <div
        data-org-reports-filter-toolbar
        className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3.5 text-xs md:flex-row md:items-center md:justify-between"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 font-medium text-[var(--nx-text-secondary)]">
            <Filter className="h-3.5 w-3.5" />
            <span>项目范围:</span>
          </span>

          {/* 项目搜索输入 */}
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-[var(--nx-text-muted)]" />
            <input
              type="text"
              placeholder="搜索项目..."
              value={projectSearchQuery}
              onChange={(e) => setProjectSearchQuery(e.target.value)}
              className="h-7.5 w-32 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] pl-7 pr-2 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
            />
          </div>

          {/* 项目过滤芯片组 */}
          <div className="flex max-h-16 flex-wrap items-center gap-1.5 overflow-y-auto">
            {filteredProjects.slice(0, 8).map((p) => {
              const isChecked = selectedProjectIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  data-project-filter-item={p.id}
                  onClick={() => toggleProjectFilter(p.id)}
                  className={`flex h-6.5 items-center gap-1 rounded border px-2 text-[11px] transition-colors ${
                    isChecked
                      ? 'border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] text-[var(--nx-accent)] font-medium'
                      : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)]'
                  }`}
                >
                  <span className="truncate max-w-[120px]">{p.name}</span>
                  {isChecked && <X className="h-3 w-3" />}
                </button>
              )
            })}
          </div>

          {selectedProjectIds.length > 0 && (
            <button
              type="button"
              data-action="clear-project-filters"
              onClick={clearProjectFilters}
              className="text-[11px] text-[var(--nx-accent)] hover:underline"
            >
              重置项目 ({selectedProjectIds.length})
            </button>
          )}
        </div>

        {/* 时间范围输入 */}
        <div className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1 text-[var(--nx-text-secondary)]">
            <Calendar className="h-3.5 w-3.5" />
            <span>时间范围:</span>
          </span>
          <input
            type="date"
            data-from-date-input
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-7.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          />
          <span className="text-[var(--nx-text-muted)]">至</span>
          <input
            type="date"
            data-to-date-input
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-7.5 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          />
        </div>
      </div>

      {/* 四大预设报表模板卡片网格 */}
      <div
        data-org-reports-cards-grid
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
        {TEMPLATE_METAS.map((meta) => {
          const isSelected = activeTemplate === meta.id
          const Icon = meta.icon
          const projectCount =
            selectedProjectIds.length > 0 ? selectedProjectIds.length : projects.length

          return (
            <div
              key={meta.id}
              data-report-template-card={meta.id}
              onClick={() => handleSelectTemplate(meta.id)}
              className={`group flex cursor-pointer flex-col justify-between rounded-lg border p-4 transition-all duration-150 ${
                isSelected
                  ? 'border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] shadow-md ring-1 ring-[var(--nx-border-focus)]'
                  : 'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] hover:border-[var(--nx-border-focus)]/60'
              }`}
            >
              <div>
                <div className="flex items-start justify-between">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded border bg-[var(--nx-bg-1)] ${meta.badgeColor}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]">
                    {projectCount} 个项目
                  </span>
                </div>

                <h3 className="mt-3 text-sm font-semibold text-[var(--nx-text-primary)] group-hover:text-[var(--nx-accent)] transition-colors">
                  {meta.name}
                </h3>
                <p className="text-[10px] text-[var(--nx-text-muted)] font-mono">{meta.subtitle}</p>

                <p className="mt-2 text-xs leading-relaxed text-[var(--nx-text-secondary)] line-clamp-3">
                  {meta.description}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[var(--nx-border-hairline)] pt-3 text-xs">
                <span className="text-[10px] text-[var(--nx-text-muted)]">
                  {snapshot?.template === meta.id && snapshot?.generatedAt
                    ? `更新于 ${snapshot.generatedAt.slice(11, 16)}`
                    : '就绪'}
                </span>
                <button
                  type="button"
                  data-action="view-snapshot"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSelectTemplate(meta.id)
                  }}
                  className="flex items-center gap-1 text-[11px] font-medium text-[var(--nx-accent)] hover:underline"
                >
                  <span>查看快照</span>
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* 选定模板后的组织级快照高密度暗黑仪器风预览面板 */}
      {activeTemplate && (
        <div
          ref={snapshotSurfaceRef}
          data-report-snapshot-panel
          data-chart-viewport-slot
          className="relative flex flex-col gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-5"
        >
          {/* 预览面板头部 */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)]">
                {activeTemplate === 'progress' && (
                  <BarChart3 className="h-4 w-4 text-[var(--nx-accent)]" />
                )}
                {activeTemplate === 'delay' && (
                  <Clock className="h-4 w-4 text-[var(--nx-status-danger)]" />
                )}
                {activeTemplate === 'workload' && <Users className="h-4 w-4 text-[var(--nx-ai)]" />}
                {activeTemplate === 'milestone' && (
                  <Flag className="h-4 w-4 text-[var(--nx-status-success)]" />
                )}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                  {snapshot?.title ?? '报表快照预览'}
                </h3>
                <p className="text-[11px] text-[var(--nx-text-muted)] font-mono">
                  {snapshot?.generatedAt ? `生成时刻: ${snapshot.generatedAt}` : '计算中...'}
                </p>
              </div>
            </div>

            {/* 操作按钮区：重新生成 + 汇出菜单 + 关闭 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-action="refresh-snapshot"
                onClick={() => refetchSnapshot()}
                disabled={isFetchingSnapshot}
                className="flex h-7 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)] disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isFetchingSnapshot ? 'animate-spin' : ''}`} />
                <span>重新汇编</span>
              </button>

              {/* 汇出菜单 */}
              <div data-chart-export-mount>
                <ChartExportMenu
                  entityName={`组织报表-${activeTemplate}`}
                  viewType="组织级报表分馆快照"
                  targetRef={snapshotSurfaceRef}
                />
              </div>

              <button
                type="button"
                data-action="close-snapshot"
                onClick={() => handleSelectTemplate(null)}
                className="flex h-7 w-7 items-center justify-center rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
                title="关闭快照预览"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 单项目降级告警（若有） */}
          {snapshot?.metadata?.warnings && snapshot.metadata.warnings.length > 0 && (
            <div
              data-report-degraded-banner
              className="flex items-start gap-2.5 rounded border border-[var(--nx-status-warning)]/40 bg-[var(--nx-status-warning)]/10 p-3 text-xs text-[var(--nx-status-warning)]"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex flex-col gap-1">
                <span className="font-semibold">部分项目降级告警</span>
                {snapshot.metadata.warnings.map((w, idx) => (
                  <span key={idx} className="text-[11px] text-[var(--nx-text-secondary)]">
                    {w.message}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 快照核心内容区 */}
          {isLoadingSnapshot ? (
            <div
              data-snapshot-loading
              className="flex h-48 items-center justify-center text-xs text-[var(--nx-text-muted)]"
            >
              <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[var(--nx-accent)]" />
              <span>正在并发拉取多项目数据并合成组织级报表...</span>
            </div>
          ) : snapshot ? (
            <div data-snapshot-content className="flex flex-col gap-5">
              {/* 1. 进度概览快照 */}
              {snapshot.data.template === 'progress' && (
                <ProgressSnapshotView
                  data={snapshot.data as OrgProgressSnapshotData}
                  isPrecise={isPrecise}
                />
              )}

              {/* 2. 延期全景快照 */}
              {snapshot.data.template === 'delay' && (
                <DelaySnapshotView
                  data={snapshot.data as OrgDelaySnapshotData}
                  isPrecise={isPrecise}
                />
              )}

              {/* 3. 工时负荷快照 */}
              {snapshot.data.template === 'workload' && (
                <WorkloadSnapshotView
                  data={snapshot.data as OrgWorkloadSnapshotData}
                  isPrecise={isPrecise}
                />
              )}

              {/* 4. 里程碑全景快照 */}
              {snapshot.data.template === 'milestone' && (
                <MilestoneSnapshotView
                  data={snapshot.data as OrgMilestoneSnapshotData}
                  isPrecise={isPrecise}
                />
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 细分快照展示子组件
// ---------------------------------------------------------------------------

function ProgressSnapshotView({
  data,
  isPrecise,
}: {
  data: OrgProgressSnapshotData
  isPrecise: boolean
}) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      {/* 核心 KPI 卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">全组织加权总进度</span>
          <div
            data-snapshot-metric-overall-progress
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-2xl font-bold text-[var(--nx-accent)]"
          >
            {data.overallProgressPercent}%
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">任务完成率</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-2xl font-bold text-[var(--nx-status-success)]"
          >
            {data.taskCompletionRate}%
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">总任务 / 已完成</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-lg font-semibold text-[var(--nx-text-primary)]"
          >
            {data.completedTasks} / {data.totalTasks}
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">阻塞高危任务</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className={`mt-1 text-lg font-semibold ${
              data.blockedTasks > 0
                ? 'text-[var(--nx-status-danger)]'
                : 'text-[var(--nx-text-secondary)]'
            }`}
          >
            {data.blockedTasks}
          </div>
        </div>
      </div>

      {/* 项目级明细表格 */}
      <div className="overflow-x-auto rounded border border-[var(--nx-border-hairline)]">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr
              className={`border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[11px] text-[var(--nx-text-muted)] ${
                isPrecise ? 'h-8' : 'h-9'
              }`}
            >
              <th className="px-3 font-medium">项目名称</th>
              <th className="px-3 font-medium">健康度</th>
              <th className="px-3 font-medium">任务数</th>
              <th className="px-3 font-medium">进行中</th>
              <th className="px-3 font-medium">已完成</th>
              <th className="px-3 font-medium">综合进度</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--nx-border-hairline)]">
            {data.projectItems.map((p) => (
              <tr
                key={p.projectId}
                className={`hover:bg-[var(--nx-bg-1)]/50 transition-colors ${
                  isPrecise ? 'h-8' : 'h-9'
                } ${p.isDegraded ? 'opacity-60 bg-[var(--nx-bg-1)]/30' : ''}`}
              >
                <td className="px-3 font-medium text-[var(--nx-text-primary)]">
                  {p.projectName}
                  {p.isDegraded && (
                    <span className="ml-1.5 rounded bg-[var(--nx-status-warning)]/20 px-1 py-0.5 text-[9px] text-[var(--nx-status-warning)]">
                      已降级
                    </span>
                  )}
                </td>
                <td className="px-3">
                  <span className="rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
                    {p.healthStatus}
                  </span>
                </td>
                <td className="px-3 font-mono text-[var(--nx-text-secondary)]">{p.totalTasks}</td>
                <td className="px-3 font-mono text-[var(--nx-text-secondary)]">
                  {p.inProgressTasks}
                </td>
                <td className="px-3 font-mono text-[var(--nx-status-success)]">
                  {p.completedTasks}
                </td>
                <td className="px-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--nx-bg-0)]">
                      <div
                        className="h-full bg-[var(--nx-accent)]"
                        style={{ width: `${Math.min(100, p.progressPercent)}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-[var(--nx-text-secondary)]">
                      {p.progressPercent}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DelaySnapshotView({
  data,
  isPrecise,
}: {
  data: OrgDelaySnapshotData
  isPrecise: boolean
}) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">全域延期率</span>
          <div
            data-snapshot-metric-delay-rate
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-2xl font-bold text-[var(--nx-status-danger)]"
          >
            {data.overallDelayRatePercent}%
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">总逾期任务数</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-2xl font-bold text-[var(--nx-status-danger)]"
          >
            {data.totalOverdueTasks}
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">最大逾期天数</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-lg font-semibold text-[var(--nx-text-primary)]"
          >
            {data.maxOverdueDays} 天
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">平均逾期天数</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-lg font-semibold text-[var(--nx-text-secondary)]"
          >
            {data.averageOverdueDays} 天
          </div>
        </div>
      </div>

      {/* 逾期高危任务列表 */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-[var(--nx-text-primary)]">跨项目高危逾期任务</h4>
        <div className="overflow-x-auto rounded border border-[var(--nx-border-hairline)]">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr
                className={`border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[11px] text-[var(--nx-text-muted)] ${
                  isPrecise ? 'h-8' : 'h-9'
                }`}
              >
                <th className="px-3 font-medium">任务名称</th>
                <th className="px-3 font-medium">所属项目</th>
                <th className="px-3 font-medium">责任人</th>
                <th className="px-3 font-medium">计划截止</th>
                <th className="px-3 font-medium text-right">逾期天数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--nx-border-hairline)]">
              {data.topOverdueTasks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-[var(--nx-text-muted)]">
                    全域暂无逾期任务
                  </td>
                </tr>
              ) : (
                data.topOverdueTasks.map((t) => (
                  <tr
                    key={t.taskId}
                    className={`hover:bg-[var(--nx-bg-1)]/50 transition-colors ${
                      isPrecise ? 'h-8' : 'h-9'
                    }`}
                  >
                    <td className="px-3 font-medium text-[var(--nx-text-primary)]">
                      {t.title}
                      {t.onCriticalPath && (
                        <span className="ml-1.5 rounded bg-[var(--nx-status-danger)]/20 px-1 py-0.2 text-[9px] text-[var(--nx-status-danger)]">
                          关键路径
                        </span>
                      )}
                    </td>
                    <td className="px-3 text-[var(--nx-text-secondary)]">{t.projectName}</td>
                    <td className="px-3 text-[var(--nx-text-muted)]">
                      {t.assigneeName ?? '未分配'}
                    </td>
                    <td className="px-3 font-mono text-[var(--nx-text-muted)]">
                      {t.plannedEndDate}
                    </td>
                    <td className="px-3 text-right font-mono font-semibold text-[var(--nx-status-danger)]">
                      +{t.overdueDays}d
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function WorkloadSnapshotView({
  data,
  isPrecise,
}: {
  data: OrgWorkloadSnapshotData
  isPrecise: boolean
}) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">总计划工时</span>
          <div
            data-snapshot-metric-workload
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-2xl font-bold text-[var(--nx-accent)]"
          >
            {data.totalPlannedHours}h
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">总实际投入工时</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-2xl font-bold text-[var(--nx-ai)]"
          >
            {data.totalActualHours}h
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">超负荷成员数</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className={`mt-1 text-lg font-semibold ${
              data.overallocatedMemberCount > 0
                ? 'text-[var(--nx-status-warning)]'
                : 'text-[var(--nx-text-secondary)]'
            }`}
          >
            {data.overallocatedMemberCount} 人
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">未分配工时</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-lg font-semibold text-[var(--nx-text-muted)]"
          >
            {data.unassignedPlannedHours}h ({data.unassignedTasksCount} 任务)
          </div>
        </div>
      </div>

      {/* 成员工时负荷表格 */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-[var(--nx-text-primary)]">成员跨项目工时负荷</h4>
        <div className="overflow-x-auto rounded border border-[var(--nx-border-hairline)]">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr
                className={`border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[11px] text-[var(--nx-text-muted)] ${
                  isPrecise ? 'h-8' : 'h-9'
                }`}
              >
                <th className="px-3 font-medium">成员</th>
                <th className="px-3 font-medium">参与项目数</th>
                <th className="px-3 font-medium">承接任务数</th>
                <th className="px-3 font-medium">计划工时</th>
                <th className="px-3 font-medium">实际工时</th>
                <th className="px-3 font-medium">负荷状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--nx-border-hairline)]">
              {data.memberWorkloads.map((m) => (
                <tr
                  key={m.userId}
                  className={`hover:bg-[var(--nx-bg-1)]/50 transition-colors ${
                    isPrecise ? 'h-8' : 'h-9'
                  }`}
                >
                  <td className="px-3 font-medium text-[var(--nx-text-primary)]">
                    {m.displayName}
                  </td>
                  <td className="px-3 font-mono text-[var(--nx-text-secondary)]">
                    {m.projectCount}
                  </td>
                  <td className="px-3 font-mono text-[var(--nx-text-secondary)]">{m.totalTasks}</td>
                  <td className="px-3 font-mono font-semibold text-[var(--nx-accent)]">
                    {m.plannedHours}h
                  </td>
                  <td className="px-3 font-mono text-[var(--nx-text-secondary)]">
                    {m.actualHours}h
                  </td>
                  <td className="px-3">
                    {m.overloadHint ? (
                      <span className="rounded border border-[var(--nx-status-warning)]/40 bg-[var(--nx-status-warning)]/10 px-1.5 py-0.5 text-[10px] text-[var(--nx-status-warning)]">
                        超负荷风险
                      </span>
                    ) : (
                      <span className="rounded border border-[var(--nx-status-success)]/40 bg-[var(--nx-status-success)]/10 px-1.5 py-0.5 text-[10px] text-[var(--nx-status-success)]">
                        适中
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MilestoneSnapshotView({
  data,
  isPrecise,
}: {
  data: OrgMilestoneSnapshotData
  isPrecise: boolean
}) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">里程碑交付达成率</span>
          <div
            data-snapshot-metric-delivery-rate
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-2xl font-bold text-[var(--nx-status-success)]"
          >
            {data.deliveryRatePercent}%
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">总里程碑数</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-2xl font-bold text-[var(--nx-text-primary)]"
          >
            {data.totalMilestones}
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">已达成 / 即将到期</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className="mt-1 text-lg font-semibold text-[var(--nx-status-success)]"
          >
            {data.completedMilestones} / {data.upcomingMilestones}
          </div>
        </div>
        <div className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3">
          <span className="text-[11px] text-[var(--nx-text-muted)]">风险与逾期里程碑</span>
          <div
            style={{ fontFamily: MONO_FONT_STACK }}
            className={`mt-1 text-lg font-semibold ${
              data.overdueMilestones > 0
                ? 'text-[var(--nx-status-danger)]'
                : 'text-[var(--nx-text-secondary)]'
            }`}
          >
            {data.overdueMilestones}
          </div>
        </div>
      </div>

      {/* 里程碑时间线表格 */}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-[var(--nx-text-primary)]">
          跨项目关键里程碑序列
        </h4>
        <div className="overflow-x-auto rounded border border-[var(--nx-border-hairline)]">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr
                className={`border-b border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[11px] text-[var(--nx-text-muted)] ${
                  isPrecise ? 'h-8' : 'h-9'
                }`}
              >
                <th className="px-3 font-medium">里程碑名称</th>
                <th className="px-3 font-medium">所属项目</th>
                <th className="px-3 font-medium">计划时间</th>
                <th className="px-3 font-medium">状态</th>
                <th className="px-3 font-medium text-right">逾期状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--nx-border-hairline)]">
              {data.milestoneTimeline.map((m) => (
                <tr
                  key={m.milestoneId}
                  className={`hover:bg-[var(--nx-bg-1)]/50 transition-colors ${
                    isPrecise ? 'h-8' : 'h-9'
                  }`}
                >
                  <td className="px-3 font-medium text-[var(--nx-text-primary)]">{m.name}</td>
                  <td className="px-3 text-[var(--nx-text-secondary)]">{m.projectName}</td>
                  <td className="px-3 font-mono text-[var(--nx-text-muted)]">{m.plannedDate}</td>
                  <td className="px-3">
                    <span className="rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
                      {m.status}
                    </span>
                  </td>
                  <td className="px-3 text-right font-mono">
                    {m.overdueDays > 0 ? (
                      <span className="text-[var(--nx-status-danger)]">逾期 {m.overdueDays}d</span>
                    ) : (
                      <span className="text-[var(--nx-text-muted)]">正常</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
