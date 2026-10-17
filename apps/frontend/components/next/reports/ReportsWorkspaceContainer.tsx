'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Crosshair } from 'lucide-react'
import { projectsApi, projectKeys } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { cn } from '@/lib/utils'
import {
  isNotFoundError,
  ProjectSpaceNotFoundView,
} from '@/components/next/project-space/ProjectSpaceContainer'
import { ReportExportDropdown, type ReportExportServerTarget } from './ReportExportDropdown'
import { PeriodicReportPanel } from './PeriodicReportPanel'
import { PresetReportPanel } from './PresetReportPanel'
import { ReportVersionReviewPanel } from './ReportVersionReviewPanel'
import { isReportsTabId, ReportsToolbar, type ReportsTabId } from './ReportsToolbar'

/**
 * 项目级报表中心总装容器（v3-ui-next-reports-domain W1·tasks 1.5 + W4 装配）。
 *
 * - 项目详情经 `projectsApi.get` 载入（projectKeys.detail 同键，RL-04）；
 * - RL-05 组织隔离：HTTP 404 或 `organizationId` 与当前会话不一致 → 统一中性
 *   404 空态「项目不存在或已被移除」（复用 ProjectSpaceNotFoundView）；
 * - 三区模式状态机：`?tab=preset|periodic|versions` 双向同步（history.replaceState
 *   + popstate），默认 preset；携带 `?versionId=` 深链自动激活 versions 模式；
 * - 模式插槽（W4 总装）：
 *   - preset → PresetReportPanel（快照选中经 selectedReportId/onSelectedReportChange
 *     提升至容器：跨模式保留 + 汇出目标追踪）；
 *   - periodic → PeriodicReportPanel；`onJobSucceeded` 回切 versions 并定位新版本
 *     （生成闭环：周期配置 → 干跑 → 异步作业 → 版本审阅深链）；
 *   - versions → ReportVersionReviewPanel（selectedVersionId = URL versionId；
 *     选中变化经 onSelectedVersionChange 回写 URL）；
 * - 汇出接线：工具栏 exportSlot 注入 ReportExportDropdown（W3），target 随模式
 *   派生：preset → { kind:'preset-report', reportId }；versions →
 *   { kind:'periodic-version', versionId }；entityName = 项目名；
 * - 沉浸阶梯：precise 档降级纯色仪器背景；加载期渲染结构 1:1 的仪器感骨架屏。
 */

export interface ReportsWorkspaceContainerProps {
  projectId: number
}

/** URL ?tab= 初始解析：白名单校验，非法/缺省回落 preset。 */
export function parseTabParam(params: URLSearchParams): ReportsTabId {
  const raw = params.get('tab')
  return isReportsTabId(raw) ? raw : 'preset'
}

/** URL ?versionId= 初始解析：正整数才有效，其余 null。 */
export function parseVersionIdParam(params: URLSearchParams): number | null {
  const raw = params.get('versionId')
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** 非 404 加载失败（500 / 断网）：规范错误卡 + 重新载入。 */
export function ReportsWorkspaceErrorView({
  onRetry,
  onBackHome,
}: {
  onRetry: () => void
  onBackHome: () => void
}) {
  return (
    <div
      data-reports-error
      role="alert"
      aria-label="报表中心加载错误"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
    >
      <h3 className="text-base font-medium text-[var(--nx-text-primary)]">报表中心加载失败</h3>
      <p className="text-xs text-[var(--nx-text-muted)]">
        报表中心数据加载失败，请稍后重试或返回角色首页。
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-reports-retry
          onClick={onRetry}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          重新载入
        </button>
        <button
          type="button"
          data-reports-back-home
          onClick={onBackHome}
          className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] px-4 text-sm text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          返回角色首页
        </button>
      </div>
    </div>
  )
}

/** 报表中心加载骨架：顶栏 + 左配置列 + 右大快照区卡位（1:1 结构，杜绝 CLS）。 */
export function ReportsWorkspaceSkeleton() {
  return (
    <div
      data-reports-skeleton
      role="status"
      aria-label="正在加载报表中心"
      aria-busy="true"
      className="flex flex-col gap-4"
    >
      <div className="h-11 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="space-y-4">
          {[0, 1, 2].map((card) => (
            <div
              key={card}
              className="h-40 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
            />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      </div>
    </div>
  )
}

export function ReportsWorkspaceContainer({ projectId }: ReportsWorkspaceContainerProps) {
  const router = useRouter()
  const currentOrganizationId = useAuthStore((state) => state.currentOrganizationId)
  const register = useProjectSpaceEntityStore((state) => state.register)
  const clear = useProjectSpaceEntityStore((state) => state.clear)
  const tier = useImmersionTier()

  // 初始模式与深链版本：从 window.location.search 一次性解析（不订阅 useSearchParams 快照）
  const [initial] = React.useState(() => {
    if (typeof window === 'undefined') {
      return { tab: 'preset' as ReportsTabId, versionId: null as number | null }
    }
    const params = new URLSearchParams(window.location.search)
    const explicitTab = parseTabParam(params)
    const versionId = parseVersionIdParam(params)
    // 深链契约：携带有效 ?versionId= 时自动激活版本审查模式并定位目标版本；
    // 显式 ?tab= 优先（如 ?tab=preset&versionId=… 以 preset 为准）。
    if (explicitTab === 'preset' && versionId !== null) {
      return { tab: 'versions' as ReportsTabId, versionId }
    }
    return { tab: explicitTab, versionId: explicitTab === 'versions' ? versionId : null }
  })
  const [activeTab, setActiveTab] = React.useState<ReportsTabId>(initial.tab)
  const [targetVersionId, setTargetVersionId] = React.useState<number | null>(initial.versionId)
  /** 预设模式当前选中快照（提升自 PresetReportPanel，跨模式保留 + 汇出目标）。 */
  const [selectedPresetReportId, setSelectedPresetReportId] = React.useState<number | null>(null)
  /** 最近一次版本审阅选中（跨模式切换保留；changeTab 离开 versions 不清除）。 */
  const versionsSelectionRef = React.useRef<number | null>(null)

  // 深链初始 versionId 也计入“最近审阅选中”，离开 versions 后回切可恢复。
  React.useEffect(() => {
    if (initial.versionId !== null) versionsSelectionRef.current = initial.versionId
  }, [initial.versionId])

  // 深链同步写入 URL：切换模式不触发全页硬刷新（history.replaceState）。
  const changeTab = React.useCallback(
    (tab: ReportsTabId) => {
      setActiveTab(tab)
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)
      if (tab === 'preset') {
        url.searchParams.delete('tab')
      } else {
        url.searchParams.set('tab', tab)
      }
      // 进入 versions 且 URL 未显式携带 versionId 时，回填最近一次审阅选中（状态保留）
      const retainedVersionId =
        tab === 'versions' && targetVersionId === null
          ? versionsSelectionRef.current
          : targetVersionId
      if (tab === 'versions' && retainedVersionId !== null) {
        url.searchParams.set('versionId', String(retainedVersionId))
        setTargetVersionId(retainedVersionId)
      } else {
        url.searchParams.delete('versionId')
      }
      window.history.replaceState(null, '', url.pathname + url.search)
      if (tab !== 'versions') setTargetVersionId(null)
    },
    [targetVersionId],
  )

  // popstate：浏览器前进/后退时还原模式与目标版本
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search)
      const tab = parseTabParam(params)
      const versionId = parseVersionIdParam(params)
      const effectiveTab = versionId !== null && tab === 'preset' ? 'versions' : tab
      const effectiveVersionId =
        versionId !== null && effectiveTab === 'versions' ? versionId : null
      setActiveTab(effectiveTab)
      setTargetVersionId(effectiveVersionId)
      if (effectiveVersionId !== null) versionsSelectionRef.current = effectiveVersionId
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  /**
   * 周期生成作业成功闭环（W2 PeriodicReportPanel.onJobSucceeded）：
   * 切 versions 模式并把新版本写入 URL versionId（ReviewPanel 自动定位高亮）。
   */
  const goToVersions = React.useCallback((versionId: number | null) => {
    setActiveTab('versions')
    setTargetVersionId(versionId)
    if (versionId !== null) versionsSelectionRef.current = versionId
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('tab', 'versions')
    if (versionId !== null) url.searchParams.set('versionId', String(versionId))
    else url.searchParams.delete('versionId')
    window.history.replaceState(null, '', url.pathname + url.search)
  }, [])

  /** 版本审阅选中变化（W2 ReportVersionReviewPanel.onSelectedVersionChange）：回写 URL。 */
  const handleVersionSelect = React.useCallback((versionId: number | null) => {
    setTargetVersionId(versionId)
    if (versionId !== null) versionsSelectionRef.current = versionId
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('tab', 'versions')
    if (versionId !== null) url.searchParams.set('versionId', String(versionId))
    else url.searchParams.delete('versionId')
    window.history.replaceState(null, '', url.pathname + url.search)
  }, [])

  const {
    data: project,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => projectsApi.get(projectId),
  })

  // RL-05 组织隔离：跨组织项目视同不存在。
  const orgMismatch =
    project !== undefined &&
    currentOrganizationId !== null &&
    project.organizationId !== currentOrganizationId
  const notFound = orgMismatch || (isError && isNotFoundError(error))

  // 顶栏坐标联动：加载成功且组织校验通过才上报项目名（NextAppShell 空间面包屑）。
  React.useEffect(() => {
    if (project !== undefined && !orgMismatch) {
      register(projectId, project.name)
    } else {
      clear(projectId)
    }
    return () => clear(projectId)
  }, [project, orgMismatch, projectId, register, clear])

  if (isPending) {
    return <ReportsWorkspaceSkeleton />
  }
  if (notFound) {
    return <ProjectSpaceNotFoundView onBackHome={() => router.push('/next')} />
  }
  if (isError || project === undefined) {
    return (
      <ReportsWorkspaceErrorView
        onRetry={() => void refetch()}
        onBackHome={() => router.push('/next')}
      />
    )
  }

  // 双轨汇出目标派生（W3 ReportExportDropdown）：preset → 当前选中快照；
  // versions → 当前审阅版本（URL 同步）；periodic 配置态无导出目标（占位引导）。
  const exportTarget: ReportExportServerTarget | null =
    activeTab === 'preset' && selectedPresetReportId !== null
      ? { kind: 'preset-report', reportId: selectedPresetReportId }
      : activeTab === 'versions' && targetVersionId !== null
        ? { kind: 'periodic-version', versionId: targetVersionId }
        : null
  const exportViewType =
    activeTab === 'versions'
      ? '版本审阅'
      : activeTab === 'periodic'
        ? '周期报表配置'
        : '预设报表快照'

  return (
    <div
      data-reports-workspace
      className={cn(
        'flex flex-col gap-4',
        tier === 'precise' ? 'bg-[var(--nx-workspace-bg)]' : 'nx-space-atmosphere',
      )}
    >
      <ReportsToolbar
        projectId={projectId}
        projectName={project.name}
        projectCode={project.code}
        activeTab={activeTab}
        onTabChange={changeTab}
        exportSlot={
          <ReportExportDropdown
            projectId={projectId}
            target={exportTarget}
            entityName={project.name}
            viewType={exportViewType}
          />
        }
      />

      {activeTab === 'preset' ? (
        <section
          id="reports-panel-preset"
          role="tabpanel"
          aria-labelledby="reports-tab-preset"
          data-reports-panel="preset"
          data-reports-slot="preset"
          aria-label="预设报表工作区"
        >
          <PresetReportPanel
            projectId={projectId}
            selectedReportId={selectedPresetReportId}
            onSelectedReportChange={setSelectedPresetReportId}
          />
        </section>
      ) : null}
      {activeTab === 'periodic' ? (
        <section
          id="reports-panel-periodic"
          role="tabpanel"
          aria-labelledby="reports-tab-periodic"
          data-reports-panel="periodic"
          data-reports-slot="periodic"
          aria-label="AI 周期报表工作区"
        >
          <PeriodicReportPanel projectId={projectId} onJobSucceeded={goToVersions} />
        </section>
      ) : null}
      {activeTab === 'versions' ? (
        <section
          id="reports-panel-versions"
          role="tabpanel"
          aria-labelledby="reports-tab-versions"
          data-reports-panel="versions"
          data-reports-slot="versions"
          aria-label="版本审查工作区"
          className="flex flex-col gap-2"
        >
          {targetVersionId !== null ? (
            <p
              data-reports-target-version={targetVersionId}
              className="flex items-center gap-1.5 self-end rounded border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-2 py-1 font-mono text-[10px] text-[var(--nx-accent)]"
            >
              <Crosshair className="h-3 w-3" aria-hidden />
              目标版本 #{targetVersionId}
            </p>
          ) : null}
          <ReportVersionReviewPanel
            projectId={projectId}
            selectedVersionId={targetVersionId}
            onSelectedVersionChange={handleVersionSelect}
          />
        </section>
      ) : null}
    </div>
  )
}

export default ReportsWorkspaceContainer
