/**
 * v3-ui-next-reports-domain W4 · tasks 4.1/4.2 —— 三区联动、深链与全链路集成测试。
 *
 * 页面级真实路由（app/(next)/next/projects/[id]/reports/page.tsx）+ 真实 hooks，
 * 网络层二分：
 * - 项目元数据与 V1 预设报表走真实 `lib/api/reports`/`api-client` → 全局 fetch 桩
 *   （可断言写请求与二进制下载流）；
 * - V2 周期报表/版本域（reports-v2）模块级 mock（干跑/生成/作业/版本/签署/导出），
 *   规避 2s 真实轮询与多轮版本状态推进的不确定性。
 *
 * 覆盖（spec「状态联动与深链支持」/「预设模板报表生成…快照预览」/「双轨汇出」/
 * design「异步作业生命周期」）：
 * - 深链 ?tab=versions&versionId=108 自动激活版本审查并高亮目标版本；版本行选择
 *   变化回写 URL versionId；离开 versions 再回切时保留最近选中（状态保留）；
 * - 版本人工签署闭环（RL-01）：pending_review → 确认签署 → confirmed（PATCH 载荷
 *   无 notes 字段）；版本级服务端 PDF 汇出（create export → 二进制流 → 下载）；
 * - 预设生成全链路：参数 → POST 生成 → 底册选中 → 快照渲染 → 汇出下拉目标
 *   （preset-report）→ 服务端 Markdown 导出落盘；
 * - 周期报表生成作业闭环：干跑通过 → 开始生成（携带 previewSnapshotHash）→
 *   作业 succeeded → 容器自动切版本审阅并定位新版本（onJobSucceeded 接线）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AiPeriodicDraft, ReportVersion } from '@aiproj/types'
import NextProjectReportsPage from '@/app/(next)/next/projects/[id]/reports/page'
import { useAuthStore } from '@/stores/auth-store'
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
// reports-v2 API 模块 mock（周期/版本域；V1 preset 走真实 fetch 路由）
// ---------------------------------------------------------------------------

const v2Api = vi.hoisted(() => ({
  listVersions: vi.fn(),
  preview: vi.fn(),
  generate: vi.fn(),
  job: vi.fn(),
  retryJob: vi.fn(),
  review: vi.fn(),
  createExport: vi.fn(),
  downloadExport: vi.fn(),
}))

vi.mock('@/lib/api/reports-v2', () => ({
  v2ListTemplates: vi.fn(),
  v2Preview: vi.fn(),
  v2CreateVersion: vi.fn(),
  v2ListVersions: v2Api.listVersions,
  v2GetJob: vi.fn(),
  v2RetryJob: vi.fn(),
  v2CreateExport: vi.fn(),
  v2ListExports: vi.fn(),
  v2AiReview: vi.fn(),
  v2PeriodicPreview: v2Api.preview,
  v2PeriodicGenerate: v2Api.generate,
  v2PeriodicJob: v2Api.job,
  v2PeriodicRetryJob: v2Api.retryJob,
  v2PeriodicReview: v2Api.review,
  v2PeriodicCreateExport: v2Api.createExport,
  v2PeriodicDownloadExport: v2Api.downloadExport,
}))

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

function setAuth(permissions: string[]) {
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
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

// ---------------------------------------------------------------------------
// 版本夹具
// ---------------------------------------------------------------------------

const PROJECT_ID = 42
const BASE_URL = '/next/projects/42/reports'

const DRAFT: AiPeriodicDraft = {
  executiveSummary: '本周整体进度 64%，核心引擎进入联调冲刺阶段，里程碑 M2 已达成。',
  highlights: ['完成数据源聚合重构', '里程碑 M2 提前 2 天达成'],
  progressNarrative: '任务排程整体提前于基线 1.5 天；关键路径按计划推进。',
  riskAndIssues: '供应链延期风险仍在扩大，预计影响 E2 联调窗口 2 天。',
  resourceNotes: '本周工时消耗 87%，前端组负荷偏高。',
  changeNotes: '',
  suggestedActions: [],
  dataWarningsNarrative: '工时数据未接入周期聚合，工时相关统计存在采信边界。',
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

const versionStore = vi.hoisted(() => ({ list: [] as ReportVersion[] }))

function seedVersions(list: ReportVersion[]) {
  versionStore.list = [...list]
}

// ---------------------------------------------------------------------------
// 预设报表后端（真实 fetch 路由）
// ---------------------------------------------------------------------------

function binaryDownloadResponse(body: string, filename: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-disposition' ? `attachment; filename="${filename}"` : null,
    },
    blob: async () => new Blob([body], { type: 'application/octet-stream' }),
  } as unknown as Response
}

// 本地下载调度桩：jsdom 缺省无 URL.createObjectURL / 锚点 click 语义
const urlMock = URL as unknown as {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}
const downloadAnchorClickSpy = vi
  .spyOn(HTMLAnchorElement.prototype, 'click')
  .mockImplementation(() => undefined)

function lastDownloadAnchor(): HTMLAnchorElement {
  const instance = downloadAnchorClickSpy.mock.instances.at(-1) as unknown
  if (!(instance instanceof HTMLAnchorElement)) {
    throw new Error('未捕获到下载锚点 click 实例')
  }
  return instance
}

/** 报表中心全链路后端：项目 + V1 预设（list/detail/create/export/download）。 */
function installPresetBackend(
  seedReports: Array<{ id: number; template: string; title: string; dataSnapshot: unknown }>,
) {
  const store = [...seedReports]
  let nextId = 1000
  return installFetchRouter((path, method) => {
    const base = path.split('?')[0] ?? path
    if (base === `/projects/${PROJECT_ID}` && method === 'GET') {
      return jsonResponse(200, { data: makeProject() })
    }
    if (base === `/projects/${PROJECT_ID}/reports` && method === 'GET') {
      return jsonResponse(200, {
        data: store,
        meta: { total: store.length, page: 1, perPage: 20, totalPages: 1 },
      })
    }
    if (base === `/projects/${PROJECT_ID}/reports` && method === 'POST') {
      nextId += 1
      const created = {
        id: nextId,
        template: 'progress',
        title: `progress报表 #${nextId}`,
        config: {},
        formatConfig: null,
        dataSnapshot: progressSnapshot(),
        fileFormat: null,
        generatedAt: '2026-09-14T02:00:00.000Z',
        generatedBy: 7,
        createdAt: '2026-09-14T02:00:00.000Z',
        updatedAt: '2026-09-14T02:00:00.000Z',
        deletedAt: null,
      }
      store.unshift(created)
      return jsonResponse(200, { data: created })
    }
    const detailMatch = /^\/reports\/(\d+)$/.exec(base)
    if (detailMatch && method === 'GET') {
      const found = store.find((report) => report.id === Number(detailMatch[1]))
      if (found) return jsonResponse(200, { data: found })
      return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '' } })
    }
    const exportMatch = /^\/reports\/(\d+)\/exports$/.exec(base)
    if (exportMatch && method === 'POST') {
      return jsonResponse(200, {
        data: {
          reportId: Number(exportMatch[1]),
          format: 'markdown',
          downloadUrl: `/reports/${exportMatch[1]}/exports/markdown/download`,
          filename: 'report.md',
          size: 1,
          generatedAt: '2026-09-14T02:00:00.000Z',
        },
      })
    }
    if (/^\/reports\/\d+\/exports\/markdown\/download$/.test(base) && method === 'GET') {
      return binaryDownloadResponse('# 快照', '进度快照导出.md')
    }
    if (base === `/projects/${PROJECT_ID}/reports/v2/versions` && method === 'GET') {
      return jsonResponse(200, {
        data: versionStore.list,
        meta: { total: versionStore.list.length, page: 1, perPage: 50, totalPages: 1 },
      })
    }
    return null
  })
}

function progressSnapshot() {
  return {
    template: 'progress',
    summary: {
      projectId: PROJECT_ID,
      projectName: '开项核心引擎',
      overallProgressPercent: 42,
      totalTasks: 40,
      completedTasks: 22,
      inProgressTasks: 12,
      notStartedTasks: 4,
      blockedTasks: 2,
    },
    statusDistribution: [],
    wbsSummaries: [],
    criticalTasks: [],
    blockers: [],
    snapshotMetadata: {
      templateVersion: '1.0',
      generatedAt: '2026-09-14T02:00:00.000Z',
      generatedBy: 7,
      sourceRange: {},
      sourceDataHash: 'h1',
      warnings: [],
    },
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

function selectedTabId(): string | null {
  return (
    document
      .querySelector('[data-reports-tab-trigger][aria-selected="true"]')
      ?.getAttribute('data-reports-tab-trigger') ?? null
  )
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  reportsUrl()
  seedVersions([])
  urlMock.createObjectURL = () => 'blob:mock-reports-integration'
  urlMock.revokeObjectURL = () => undefined
  setAuth(['report:view', 'report:create', 'report:export', 'report:download', 'ai:confirm'])

  v2Api.listVersions.mockReset()
  v2Api.listVersions.mockImplementation(async () => ({
    data: [...versionStore.list],
    meta: { total: versionStore.list.length, page: 1, perPage: 50, totalPages: 1 },
  }))
  v2Api.preview.mockReset()
  v2Api.preview.mockImplementation(
    async (_projectId: number, req: { fromDate: string; toDate: string }) => ({
      data: {
        templateId: 'weekly-ai-summary',
        title: 'AI 项目周报',
        dateRange: { fromDate: req.fromDate, toDate: req.toDate },
        prevDateRange: { fromDate: '2026-08-31', toDate: '2026-09-06' },
        periodType: 'weekly',
        dataSources: {
          task_summary: {
            sourceKey: 'task_summary',
            status: 'available',
            data: { totalTasks: 14, completedTasks: 9, overdueTasks: 2 },
          },
          risk_summary: {
            sourceKey: 'risk_summary',
            status: 'available',
            data: { totalRisks: 3, openRisks: 2, criticalRisks: 1 },
          },
          schedule_summary: {
            sourceKey: 'schedule_summary',
            status: 'available',
            data: { tasksOnCriticalPath: 5, hasCircularDependency: false },
          },
        },
        warnings: [],
        blocking: false,
        sourceHash: 'snapshot-hash-1',
      },
    }),
  )
  v2Api.generate.mockReset()
  v2Api.generate.mockImplementation(async () => {
    const created = makeVersion(108, { title: 'AI 项目周报 #108' })
    versionStore.list.unshift(created)
    return {
      data: { version: { id: created.id }, job: { id: 42, status: 'queued', versionId: null } },
    }
  })
  v2Api.job.mockReset()
  v2Api.job.mockResolvedValue({ data: { id: 42, status: 'succeeded', versionId: 108 } })
  v2Api.retryJob.mockReset()
  v2Api.retryJob.mockResolvedValue({ data: { id: 43, status: 'queued' } })
  v2Api.review.mockReset()
  v2Api.review.mockImplementation(
    async (
      _projectId: number,
      versionId: number,
      body: { action: 'confirm' | 'return'; returnReason?: string },
    ) => {
      const target = versionStore.list.find((version) => version.id === versionId)
      if (!target) throw new Error('version missing')
      if (body.action === 'confirm') {
        target.aiReviewStatus = 'confirmed'
        target.confirmedAt = '2026-09-15T08:30:00.000Z'
        target.confirmedBy = 7
        return {
          data: {
            versionId,
            reviewStatus: 'confirmed',
            confirmedAt: target.confirmedAt,
            confirmedBy: 7,
          },
        }
      }
      target.aiReviewStatus = 'rejected'
      target.reviewNotes = body.returnReason ?? null
      return { data: { versionId, reviewStatus: 'rejected' } }
    },
  )
  v2Api.createExport.mockReset()
  v2Api.createExport.mockResolvedValue({
    data: { exportId: 9, format: 'pdf', status: 'completed' },
  })
  v2Api.downloadExport.mockReset()
  v2Api.downloadExport.mockResolvedValue(binaryDownloadResponse('pdf-bytes', '周期版本归档.pdf'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 场景一：深链定位 + 版本行选择同步 + 签署闭环
// ---------------------------------------------------------------------------

describe('深链版本审查与人工签署闭环（spec「深链直接定位指定报表版本审阅」）', () => {
  test('?tab=versions&versionId=108：自动激活版本审查、高亮选中 #108 并渲染 8 大章节', async () => {
    seedVersions([
      makeVersion(107, { aiReviewStatus: 'confirmed', title: '周期报表版本 107' }),
      makeVersion(108, { title: '周期报表版本 108' }),
    ])
    reportsUrl('?tab=versions&versionId=108')
    installPresetBackend([])
    renderPage(<NextProjectReportsPage />)

    expect(await screen.findByText('报表中心')).toBeInTheDocument()
    expect(selectedTabId()).toBe('versions')
    // 目标版本回显 + 版本行高亮
    expect(document.querySelector('[data-reports-target-version="108"]')?.textContent).toContain(
      '目标版本 #108',
    )
    await waitFor(() => {
      expect(document.querySelector('[data-version-review-header]')?.textContent).toContain(
        '周期报表版本 108',
      )
    })
    expect(document.querySelector('[data-version-row="108"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    // 状态徽章：待审核（版本行徽章以中文标签呈现）
    expect(document.querySelector('[data-version-row="108"]')?.textContent).toContain('待审核')
    // 8 大章节展开渲染
    await screen.findByText('管理摘要')
    expect(screen.getByText('关键亮点')).toBeInTheDocument()
    expect(screen.getByText('进度叙述')).toBeInTheDocument()
    expect(screen.getByText('风险与问题')).toBeInTheDocument()
    expect(screen.getByText('资源说明')).toBeInTheDocument()
    expect(screen.getByText('变更说明')).toBeInTheDocument()
    expect(screen.getByText('建议行动')).toBeInTheDocument()
    expect(screen.getByText('数据限制说明')).toBeInTheDocument()
    // URL 深链参数保留
    expect(new URLSearchParams(window.location.search).get('versionId')).toBe('108')
  })

  test('版本行选择变化回写 URL；离开 versions 后回切保留最近选中（状态保留）', async () => {
    seedVersions([
      makeVersion(107, { aiReviewStatus: 'confirmed', title: '周期报表版本 107' }),
      makeVersion(108, { title: '周期报表版本 108' }),
    ])
    reportsUrl('?tab=versions&versionId=108')
    installPresetBackend([])
    renderPage(<NextProjectReportsPage />)

    await waitFor(() => {
      expect(document.querySelector('[data-version-review-header]')?.textContent).toContain(
        '周期报表版本 108',
      )
    })
    // 点击 #107 → URL 与目标回显同步切换
    fireEvent.click(document.querySelector('[data-version-row="107"]') as HTMLElement)
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('versionId')).toBe('107')
    })
    expect(document.querySelector('[data-reports-target-version="107"]')?.textContent).toContain(
      '目标版本 #107',
    )
    expect(document.querySelector('[data-version-row="107"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )

    // 切到预设再回版本审查：选中保留（无深链参数也回填最近选中）
    fireEvent.click(screen.getByRole('tab', { name: '预设报表' }))
    expect(new URLSearchParams(window.location.search).has('versionId')).toBe(false)
    fireEvent.click(screen.getByRole('tab', { name: '版本审查' }))
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('versionId')).toBe('107')
    })
    await waitFor(() => {
      expect(document.querySelector('[data-version-review-header]')?.textContent).toContain(
        '周期报表版本 107',
      )
    })
    expect(document.querySelector('[data-version-row="107"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(navMock.push).not.toHaveBeenCalled()
    expect(navMock.replace).not.toHaveBeenCalled()
  })

  test('人工签署闭环（RL-01）：确认签署 → confirmed，PATCH 载荷仅 action 无 notes', async () => {
    seedVersions([makeVersion(108, { title: '周期报表版本 108' })])
    reportsUrl('?tab=versions&versionId=108')
    installPresetBackend([])
    renderPage(<NextProjectReportsPage />)

    await screen.findByText('管理摘要')
    // 签署工具条可用（ai:confirm）
    fireEvent.click(document.querySelector('[data-review-confirm-btn]') as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: '确认签署该报表版本' })
    expect(within(dialog).getByText('确认签署')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认签署' }))

    // 签署请求契约：{ action: 'confirm' }（无 notes 字段）
    await waitFor(() => {
      expect(v2Api.review).toHaveBeenCalledWith(PROJECT_ID, 108, { action: 'confirm' })
    })
    // 状态即时切换为已确认（头部徽章）并展示签署元信息
    await waitFor(() => {
      expect(
        document.querySelector('[data-version-review-header] [data-review-status="confirmed"]'),
      ).not.toBeNull()
    })
    expect(document.querySelector('[data-version-signature]')?.textContent).toContain('已由成员 #7')
    // URL 深链保持
    expect(new URLSearchParams(window.location.search).get('versionId')).toBe('108')
  })

  test('版本级服务端 PDF 汇出：目标 periodic-version → create export → 二进制流落盘', async () => {
    seedVersions([makeVersion(108, { title: '周期报表版本 108' })])
    reportsUrl('?tab=versions&versionId=108')
    installPresetBackend([])
    renderPage(<NextProjectReportsPage />)

    await screen.findByText('管理摘要')
    fireEvent.click(screen.getByRole('button', { name: '汇出报表' }))
    const pdfItem = document.querySelector(
      '[data-report-export-item][data-export-group="server"][data-export-format="pdf"]',
    ) as HTMLButtonElement
    expect(pdfItem).toBeEnabled()
    fireEvent.click(pdfItem)

    await waitFor(() => {
      expect(v2Api.createExport).toHaveBeenCalledWith(PROJECT_ID, 108, {
        format: 'pdf',
        draftOverride: false,
      })
    })
    await waitFor(() => {
      const anchor = lastDownloadAnchor()
      expect(anchor.download).toBe('周期版本归档.pdf')
    })
  })
})

// ---------------------------------------------------------------------------
// 场景二：预设生成 → 快照 → 汇出全链路
// ---------------------------------------------------------------------------

describe('预设生成 → 快照 → 汇出全链路（spec「预设模板报表生成、参数配置与快照预览」）', () => {
  test('生成报表 → 底册追加并选中 → 快照渲染 → 汇出下拉以 preset-report 为目标导出 Markdown', async () => {
    const { records } = installPresetBackend([])
    renderPage(<NextProjectReportsPage />)

    // 空历史引导
    await screen.findByText('暂未生成任何报表快照')
    fireEvent.click(screen.getByRole('button', { name: /生成报表/ }))
    // POST /projects/42/reports
    await waitFor(() => {
      expect(records.some((record) => record.method === 'POST')).toBe(true)
    })
    // 快照选中渲染（KPI 42%）
    await waitFor(() => {
      expect(document.querySelector('[data-report-snapshot-title]')?.textContent).toBe(
        'progress报表 #1001',
      )
    })
    const kpis = document.querySelector('[data-report-kpis]') as HTMLElement
    expect(within(kpis).getByText('42%')).toBeInTheDocument()
    // 客户端视觉汇出捕获目标已标注（data-report-export-target 落在快照面上）
    const surface = document.querySelector(
      '[data-report-snapshot-surface][data-report-export-target]',
    )
    expect(surface).not.toBeNull()

    // 汇出下拉：preset-report 目标 → markdown/csv 可用，pdf/xlsx 明确禁用
    fireEvent.click(screen.getByRole('button', { name: '汇出报表' }))
    const captions = Array.from(
      document.querySelectorAll('[data-report-export-group-caption]'),
    ).map((element) => element.textContent)
    expect(captions).toEqual(['文档归档导出（服务端）', '即时图表快照（客户端）'])
    const markdownItem = document.querySelector(
      '[data-report-export-item][data-export-group="server"][data-export-format="markdown"]',
    ) as HTMLButtonElement
    expect(markdownItem).toBeEnabled()
    const pdfItem = document.querySelector(
      '[data-report-export-item][data-export-group="server"][data-export-format="pdf"]',
    ) as HTMLButtonElement
    expect(pdfItem).toBeDisabled()

    fireEvent.click(markdownItem)
    // 服务端导出请求链：POST /reports/1001/exports → GET …/download（二进制流）
    await waitFor(() => {
      expect(
        records.some(
          (record) => record.method === 'POST' && /\/reports\/1001\/exports$/.test(record.url),
        ),
      ).toBe(true)
    })
    await waitFor(() => {
      const anchor = lastDownloadAnchor()
      expect(anchor.download).toBe('进度快照导出.md')
    })
    expect(writeMethods(records)).toEqual(['POST', 'POST'])
  })

  test('生成选中跨模式保留：切 AI 周期报表再回预设，快照选中不丢失', async () => {
    installPresetBackend([])
    renderPage(<NextProjectReportsPage />)

    await screen.findByText('暂未生成任何报表快照')
    fireEvent.click(screen.getByRole('button', { name: /生成报表/ }))
    await waitFor(() => {
      expect(document.querySelector('[data-report-snapshot-title]')?.textContent).toBe(
        'progress报表 #1001',
      )
    })

    // 去周期模式再回来：容器保留选中快照（右侧快照直接恢复）
    fireEvent.click(screen.getByRole('tab', { name: 'AI 周期报表' }))
    expect(document.querySelector('[data-periodic-panel]')).not.toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '预设报表' }))
    await waitFor(() => {
      expect(document.querySelector('[data-report-snapshot-title]')?.textContent).toBe(
        'progress报表 #1001',
      )
    })
    expect(
      document.querySelector('[data-report-history-item="1001"]')?.getAttribute('aria-current'),
    ).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// 场景三：周期报表作业闭环 → 自动切版本审阅
// ---------------------------------------------------------------------------

describe('周期报表生成作业闭环（design「异步作业生命周期」/ W4 装配 onJobSucceeded）', () => {
  test('干跑通过 → 开始生成（携带 previewSnapshotHash）→ 作业成功自动切入版本审阅并定位新版本', async () => {
    installPresetBackend([])
    renderPage(<NextProjectReportsPage />)
    await screen.findByText('报表中心')

    fireEvent.click(screen.getByRole('tab', { name: 'AI 周期报表' }))
    expect(document.querySelector('[data-periodic-panel]')).not.toBeNull()

    // 干跑预览
    fireEvent.click(screen.getByRole('button', { name: /预检预览/ }))
    await screen.findByText('预检通过：数据源可用，可开始生成', undefined, { timeout: 4000 })

    // 开始生成：载荷携带 previewSnapshotHash（契约：generate 必需字段）
    fireEvent.click(screen.getByRole('button', { name: /开始生成/ }))
    await waitFor(() => {
      expect(v2Api.generate).toHaveBeenCalledTimes(1)
    })
    const generateBody = v2Api.generate.mock.calls[0]?.[1] as {
      templateId: string
      fromDate: string
      toDate: string
      previewSnapshotHash: string
    }
    expect(generateBody.previewSnapshotHash).toBe('snapshot-hash-1')

    // 作业 succeeded → 500ms 后容器自动切版本审查并定位 #108
    await waitFor(
      () => {
        expect(selectedTabId()).toBe('versions')
        expect(new URLSearchParams(window.location.search).get('versionId')).toBe('108')
      },
      { timeout: 6000 },
    )
    await waitFor(() => {
      expect(document.querySelector('[data-version-review-header]')?.textContent).toContain(
        'AI 项目周报 #108',
      )
    })
    expect(document.querySelector('[data-reports-target-version="108"]')?.textContent).toContain(
      '目标版本 #108',
    )
    expect(document.querySelector('[data-version-row="108"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    await screen.findByText('管理摘要')
    expect(document.querySelector('[data-periodic-panel]')).toBeNull()
    expect(navMock.push).not.toHaveBeenCalled()
    expect(navMock.replace).not.toHaveBeenCalled()
  })
})
