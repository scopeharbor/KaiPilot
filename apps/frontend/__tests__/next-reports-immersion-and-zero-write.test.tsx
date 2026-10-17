/**
 * v3-ui-next-reports-domain W4 · tasks 4.3 —— 沉浸阶梯感知（精确档降级）与
 * 只读用户零写断言集成测试。
 *
 * 覆盖（spec「沉浸阶梯感知与精确档降级」/「细粒度权限控制」/ RL-15 视觉防 Slop）：
 * - 精确档（precise）：文档根 data-immersion=precise；工作台根节点剥离
 *   nx-space-atmosphere 深空氛围类（纯色仪器背景）；三区面板（预设/周期/版本）
 *   根节点带 data-immersion=precise；快照表格度量数字保持 MONO_FONT_STACK；
 * - 系统减弱动画（prefers-reduced-motion: reduce）且未手动覆盖 → 自动生效精确档；
 * - 轻量档（light）：恢复深空氛围类（nx-space-atmosphere），html 同步；
 * - 只读用户（仅 report:view）：预设生成入口只读禁用、快照无「重新生成」、
 *   汇出触发器整体禁用；周期报表「开始生成」置灰；版本审阅无签署/退回工具条；
 *   全程零写请求（fetch 记录无 POST/PATCH/PUT/DELETE；签署 API 零调用）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AiPeriodicDraft, Report, ReportVersion } from '@aiproj/types'
import NextProjectReportsPage from '@/app/(next)/next/projects/[id]/reports/page'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import {
  installFetchRouter,
  jsonResponse,
  makeProject,
  writeMethods,
} from './helpers/chart-gallery-network'

// ---------------------------------------------------------------------------
// next/navigation + next/link mock
// ---------------------------------------------------------------------------

const paramsMock = vi.hoisted(() => ({
  value: { id: '42' } as { id: string },
}))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/reports',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话 / 沉浸档
// ---------------------------------------------------------------------------

const PROJECT_ID = 42
const BASE_URL = '/next/projects/42/reports'

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 7,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const DRAFT: AiPeriodicDraft = {
  executiveSummary: '本周整体进度 64%，核心引擎进入联调冲刺阶段。',
  highlights: ['完成数据源聚合重构'],
  progressNarrative: '任务排程整体提前于基线 1.5 天。',
  riskAndIssues: '供应链延期风险仍在扩大。',
  resourceNotes: '本周工时消耗 87%。',
  changeNotes: '',
  suggestedActions: [],
  dataWarningsNarrative: '工时数据未接入周期聚合，存在采信边界。',
}

function makeVersion(id: number, overrides: Partial<ReportVersion> = {}): ReportVersion {
  return {
    id,
    organizationId: 1,
    projectId: PROJECT_ID,
    reportId: null,
    templateId: 'weekly-ai-summary',
    templateVersion: '1.0',
    title: `周期报表版本 ${id}`,
    dateRange: { fromDate: '2026-09-07', toDate: '2026-09-13' },
    periodType: 'weekly',
    prevDateRange: { fromDate: '2026-08-31', toDate: '2026-09-06' },
    filters: {},
    dataSourceHashes: {},
    snapshotHash: 'snapshot-hash-x',
    warnings: [],
    documentRef: null,
    aiDraft: JSON.stringify(DRAFT),
    aiReviewStatus: 'pending_review',
    aiDraftRef: 'draft:abc123',
    inputSourceHashes: null,
    modelSummary: null,
    costSummary: null,
    aiCostRef: null,
    attempt: 1,
    idempotencyKey: null,
    reviewNotes: null,
    reviewAction: null,
    generatedBy: 3,
    generatedAt: '2026-09-14T02:00:00.000Z',
    confirmedAt: null,
    confirmedBy: null,
    returnedAt: null,
    returnedBy: null,
    createdAt: '2026-09-14T02:00:00.000Z',
    updatedAt: '2026-09-14T02:00:00.000Z',
    ...overrides,
  }
}

function makeDelayReport(): Report {
  return {
    id: 101,
    organizationId: 1,
    projectId: PROJECT_ID,
    template: 'delay',
    title: '2026-07 延期任务分析',
    config: {},
    formatConfig: null,
    dataSnapshot: {
      template: 'delay',
      summary: {
        projectId: PROJECT_ID,
        projectName: '开项核心引擎',
        totalTasksWithDueDate: 12,
        overdueTasks: 3,
        upcomingTasks: 2,
        delayRatePercent: 25,
        averageOverdueDays: 2.5,
        maxOverdueDays: 7,
      },
      overdueTasks: [
        {
          taskId: 201,
          title: '修复登录态刷新竞态',
          assigneeName: '林澈',
          plannedEndDate: '2026-07-10',
          actualEndDate: null,
          overdueDays: 3,
          onCriticalPath: true,
        },
      ],
      upcomingTasks: [],
      dependencyWarnings: [],
      snapshotMetadata: {
        templateVersion: '1.0',
        generatedAt: '2026-09-14T02:00:00.000Z',
        generatedBy: 3,
        sourceRange: {},
        sourceDataHash: 'h1',
        warnings: [],
      },
    },
    fileFormat: null,
    generatedAt: '2026-09-14T02:00:00.000Z',
    generatedBy: 3,
    createdAt: '2026-09-14T02:00:00.000Z',
    updatedAt: '2026-09-14T02:00:00.000Z',
    deletedAt: null,
  }
}

/** 报表中心数据后端：项目 + 预设 delay 报表 + 单一 pending_review 周期版本。 */
function reportsBackend(versionList: ReportVersion[] = [makeVersion(108)]) {
  return (path: string, method: string): Response | null => {
    const base = path.split('?')[0] ?? path
    if (base === `/projects/${PROJECT_ID}` && method === 'GET') {
      return jsonResponse(200, { data: makeProject() })
    }
    if (base === `/projects/${PROJECT_ID}/reports` && method === 'GET') {
      return jsonResponse(200, {
        data: [makeDelayReport()],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      })
    }
    if (base === `/reports/101` && method === 'GET') {
      return jsonResponse(200, { data: makeDelayReport() })
    }
    if (base === `/projects/${PROJECT_ID}/reports/v2/versions` && method === 'GET') {
      return jsonResponse(200, {
        data: versionList,
        meta: { total: versionList.length, page: 1, perPage: 50, totalPages: 1 },
      })
    }
    return null
  }
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function reportsUrl(search = ''): void {
  window.history.replaceState(null, '', `${BASE_URL}${search}`)
}

function workspaceClassName(): string {
  return document.querySelector('[data-reports-workspace]')?.className ?? ''
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  reportsUrl()
  useNextTrackStore.setState({ immersionTier: null })
  setAuth(['report:view', 'report:create', 'report:export', 'report:download', 'ai:confirm'])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 沉浸阶梯感知
// ---------------------------------------------------------------------------

describe('沉浸阶梯与精确档降级（spec「沉浸阶梯感知与精确档降级」）', () => {
  test('精确档（precise）：html 同步、工作台剥离深空氛围、三区面板携带 data-immersion', async () => {
    useNextTrackStore.setState({ immersionTier: 'precise' })
    installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)

    await screen.findByText('报表中心')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    // 精确档：纯色仪器背景，彻底无深空氛围类
    expect(workspaceClassName()).not.toContain('nx-space-atmosphere')
    expect(workspaceClassName()).toContain('bg-[var(--nx-workspace-bg)]')

    // 预设快照表格：度量数字等宽（MONO_FONT_STACK 内联样式恒等，精确档仪器排版）
    await screen.findByText('2026-07 延期任务分析')
    const historyItem = document.querySelector('[data-report-history-item="101"]') as HTMLElement
    fireEvent.click(historyItem)
    await screen.findByText('逾期任务明细')
    const numericCell = document.querySelector('[data-report-numeric="true"]') as HTMLElement
    expect(numericCell).not.toBeNull()
    expect(numericCell.style.fontFamily).toContain('JetBrains Mono')

    // AI 周期报表面板根节点
    fireEvent.click(screen.getByRole('tab', { name: 'AI 周期报表' }))
    expect(document.querySelector('[data-periodic-panel]')?.getAttribute('data-immersion')).toBe(
      'precise',
    )

    // 版本审查面板根节点（版本列表就绪后仍为 precise）
    fireEvent.click(screen.getByRole('tab', { name: '版本审查' }))
    await screen.findByText('管理摘要')
    expect(
      document.querySelector('[data-version-review-panel]')?.getAttribute('data-immersion'),
    ).toBe('precise')
  })

  test('轻量档（light）：恢复深空氛围类并同步 html', async () => {
    useNextTrackStore.setState({ immersionTier: 'light' })
    installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)

    await screen.findByText('报表中心')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('light')
    expect(workspaceClassName()).toContain('nx-space-atmosphere')
    expect(workspaceClassName()).not.toContain('bg-[var(--nx-workspace-bg)]')
  })

  test('系统减弱动画（prefers-reduced-motion）且未手动覆盖 → 自动生效精确档', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
    installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)

    await screen.findByText('报表中心')
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    expect(workspaceClassName()).not.toContain('nx-space-atmosphere')
  })
})

// ---------------------------------------------------------------------------
// 只读用户零写断言（RL-01 / RL-15）
// ---------------------------------------------------------------------------

describe('只读用户（仅 report:view）浏览零写（spec「普通只读权限用户无法执行生成、导出或审核操作」）', () => {
  test('预设/周期/版本三区操作入口受控，全程无写请求且无审阅签署入口', async () => {
    setAuth(['report:view'])
    const router = installFetchRouter(reportsBackend())
    renderPage(<NextProjectReportsPage />)

    // ---------------- 预设模式：只读生成表单 + 快照无重新生成 + 汇出禁用
    expect(await screen.findByText(/只读 · 缺少 report:create 权限/)).toBeInTheDocument()
    const generateSubmit = screen.getByRole('button', { name: /生成报表/ }) as HTMLButtonElement
    expect(generateSubmit.disabled).toBe(true)
    fireEvent.click(generateSubmit) // 禁用点击零效果

    // 汇出触发器整体禁用（无 report:export）
    const exportTrigger = screen.getByRole('button', { name: '汇出报表' }) as HTMLButtonElement
    expect(exportTrigger.disabled).toBe(true)
    expect(exportTrigger.getAttribute('title')).toContain('report:export')

    // 选择历史快照：只读渲染，无「重新生成」
    await screen.findByText('2026-07 延期任务分析')
    const historyItem = document.querySelector('[data-report-history-item="101"]') as HTMLElement
    fireEvent.click(historyItem)
    await screen.findByText('逾期任务明细')
    expect(screen.getByText('修复登录态刷新竞态')).toBeInTheDocument()
    expect(document.querySelector('[data-report-regenerate]')).toBeNull()

    // ---------------- 周期模式：生成按钮置灰 + 权限提示
    fireEvent.click(screen.getByRole('tab', { name: 'AI 周期报表' }))
    await screen.findByText(/缺少 report:create 权限，仅可查看配置与预检/)
    const generateBtn = screen.getByRole('button', { name: /开始生成/ }) as HTMLButtonElement
    expect(generateBtn.disabled).toBe(true)
    fireEvent.click(generateBtn) // 禁用点击零效果

    // ---------------- 版本模式：章节只读可见、签署/退回工具条完全隐藏
    fireEvent.click(screen.getByRole('tab', { name: '版本审查' }))
    await screen.findByText('管理摘要')
    expect(document.querySelector('[data-review-action-bar]')).toBeNull()
    expect(document.querySelector('[data-review-confirm-btn]')).toBeNull()
    expect(document.querySelector('[data-review-reject-btn]')).toBeNull()
    // 版本行与章节仅 GET 渲染
    expect(document.querySelector('[data-version-row="108"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )

    // 全程零写：fetch 记录无 POST/PATCH/PUT/DELETE
    await waitFor(() => expect(router.records.length).toBeGreaterThan(0))
    expect(writeMethods(router.records)).toEqual([])
    expect(navMock.push).not.toHaveBeenCalled()
  })
})
