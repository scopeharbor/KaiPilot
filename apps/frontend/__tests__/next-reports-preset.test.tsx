/**
 * v3-ui-next-reports-domain W1 · tasks 1.4 —— 预设报表面板与快照渲染组件测试。
 *
 * 网络层走真实模块（lib/api/reports.ts + hooks/use-reports.ts），以全局 fetch 桩
 * 伪后端（记录 method/url/body），从而可以断言：
 * - 4 类白名单模板切换与参数表单输入/校验（提交 payload 精确匹配）；
 * - 生成成功后历史底册自动追加并选中最新条目（列表失效刷新 + 详情拉取）；
 * - 历史条目切换时快照明细与 KPI 卡片准确渲染（冻结快照，数字等宽右对齐）；
 * - 「重新生成」带入原过滤参数（config）发起新生成；
 * - 只读会话（仅 report:view）浏览全程零写请求（RL-01：生成入口锁定）。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  DelaySnapshot,
  MilestoneSnapshot,
  ProgressSnapshot,
  Report,
  ReportSnapshot,
  ReportTemplate,
  WorkloadSnapshot,
} from '@aiproj/types'
import { PresetReportPanel } from '@/components/next/reports/PresetReportPanel'
import { useAuthStore } from '@/stores/auth-store'
import {
  API_PREFIX,
  jsonResponse,
  resetFetchRouter,
  writeMethods,
} from './helpers/chart-gallery-network'

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
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
// 请求桩（记录 method/url/body）
// ---------------------------------------------------------------------------

interface RequestRecord {
  method: string
  url: string
  body?: Record<string, unknown>
}

function installReportsRouter(
  route: (request: {
    path: string
    method: string
    body?: Record<string, unknown>
  }) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | undefined
    if (typeof init?.body === 'string' && init.body.length > 0) {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = undefined
      }
    }
    records.push({ method, url: rawUrl, body })
    const path = rawUrl.replace(API_PREFIX, '')
    const matched = route({ path, method, body })
    if (matched) return matched
    return jsonResponse(404, {
      error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` },
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function jsonEnvelope(status: number, body: unknown): Response {
  return jsonResponse(status, body)
}

// ---------------------------------------------------------------------------
// 报表夹具（冻结快照实体）
// ---------------------------------------------------------------------------

const PROJECT_ID = 42
const NOW = '2026-07-08T00:00:00.000Z'

function snapshotMetadata() {
  return {
    templateVersion: '1.0' as const,
    generatedAt: NOW,
    generatedBy: 1,
    sourceRange: {},
    sourceDataHash: 'hash-fixture',
    warnings: [],
  }
}

function makeDelaySnapshot(): DelaySnapshot {
  return {
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
      {
        taskId: 202,
        title: '导出引擎白底垫色回归',
        assigneeName: undefined,
        plannedEndDate: '2026-07-12',
        actualEndDate: null,
        overdueDays: 1,
        onCriticalPath: false,
      },
    ],
    upcomingTasks: [
      {
        taskId: 203,
        title: '周期报表干跑预览',
        assigneeName: '林澈',
        plannedEndDate: '2026-07-18',
        daysUntilDue: 2,
      },
    ],
    dependencyWarnings: [],
    snapshotMetadata: snapshotMetadata(),
  }
}

function makeProgressSnapshot(): ProgressSnapshot {
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
    statusDistribution: [
      { status: 'done', count: 22, ratio: 55 },
      { status: 'in_progress', count: 12, ratio: 30 },
    ],
    wbsSummaries: [
      {
        wbsNodeId: 1,
        code: 'M1',
        name: '交付主线',
        totalTasks: 40,
        completedTasks: 22,
        progressPercent: 42,
      },
    ],
    criticalTasks: [
      {
        taskId: 301,
        title: '签署闭环联调',
        status: 'in_progress',
        progressPercent: 60,
        assigneeName: '陈默',
        dueDate: '2026-07-20',
      },
    ],
    blockers: [{ taskId: 302, title: '真机推送验证', reason: '等待测试机到位' }],
    snapshotMetadata: snapshotMetadata(),
  }
}

function makeWorkloadSnapshot(): WorkloadSnapshot {
  return {
    template: 'workload',
    summary: {
      projectId: PROJECT_ID,
      projectName: '开项核心引擎',
      totalAssignees: 4,
      totalPlannedHours: 120,
      totalActualHours: 96,
      unassigned: { totalTasks: 2, plannedHours: 8 },
    },
    byAssignee: [
      {
        userId: 11,
        displayName: '林澈',
        totalTasks: 6,
        completedTasks: 3,
        inProgressTasks: 2,
        notStartedTasks: 1,
        plannedHours: 40,
        actualHours: 44,
        overloadHint: true,
      },
    ],
    snapshotMetadata: snapshotMetadata(),
  }
}

function makeMilestoneSnapshot(): MilestoneSnapshot {
  return {
    template: 'milestone',
    summary: {
      projectId: PROJECT_ID,
      projectName: '开项核心引擎',
      totalMilestones: 4,
      completedMilestones: 1,
      overdueMilestones: 1,
      upcomingMilestones: 2,
    },
    milestones: [
      {
        milestoneId: 71,
        name: 'B6e 报表中心 GA',
        plannedDate: '2026-07-30',
        status: 'on_track',
        linkedTaskCount: 6,
        linkedTaskCompletedCount: 4,
        linkedTaskProgressPercent: 66,
        overdueDays: 0,
        autoCalculated: true,
      },
    ],
    risks: [{ milestoneId: 72, name: '接入周报模板', reason: '上游数据源未就绪' }],
    snapshotMetadata: snapshotMetadata(),
  }
}

function snapshotForTemplate(template: ReportTemplate): ReportSnapshot {
  switch (template) {
    case 'delay':
      return makeDelaySnapshot()
    case 'progress':
      return makeProgressSnapshot()
    case 'workload':
      return makeWorkloadSnapshot()
    case 'milestone':
      return makeMilestoneSnapshot()
  }
}

function makeReport(id: number, template: ReportTemplate, overrides: Partial<Report> = {}): Report {
  return {
    id,
    organizationId: 1,
    projectId: PROJECT_ID,
    template,
    title: `${template}报表 #${id}`,
    config: {},
    formatConfig: null,
    dataSnapshot: snapshotForTemplate(template),
    fileFormat: null,
    generatedAt: NOW,
    generatedBy: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 伪后端：内存底册 + 生成
// ---------------------------------------------------------------------------

interface FakeBackendOptions {
  seed: Report[]
}

/** 可变内存后端：POST 生成 → 置顶；GET 列表返回当前底册；GET /reports/:id 回读。 */
function installPresetBackend({ seed }: FakeBackendOptions) {
  const store: Report[] = [...seed]
  // 生成 id 起始 1000（与种子 id 101+ 不冲突），每次 POST +1。
  let nextId = 1000
  return installReportsRouter(({ path, method, body }) => {
    const base = path.split('?')[0] ?? path
    if (base === `/projects/${PROJECT_ID}/reports` && method === 'GET') {
      return jsonEnvelope(200, {
        data: store,
        meta: { total: store.length, page: 1, perPage: 20, totalPages: 1 },
      })
    }
    if (base === `/projects/${PROJECT_ID}/reports` && method === 'POST') {
      const payload = (body ?? {}) as {
        template?: string
        title?: string
        filters?: Record<string, unknown>
      }
      const template = (['progress', 'delay', 'workload', 'milestone'] as const).includes(
        payload.template as ReportTemplate,
      )
        ? (payload.template as ReportTemplate)
        : 'progress'
      nextId += 1
      const created = makeReport(nextId, template, {
        title:
          typeof payload.title === 'string' && payload.title.length > 0
            ? payload.title
            : `${template}报表 #${nextId}`,
        config: (payload.filters ?? {}) as Report['config'],
        formatConfig: null,
      })
      store.unshift(created)
      return jsonEnvelope(200, { data: created })
    }
    const detailMatch = /^\/reports\/(\d+)$/.exec(base)
    if (detailMatch && method === 'GET') {
      const reportId = Number(detailMatch[1])
      const found = store.find((report) => report.id === reportId)
      if (found) return jsonEnvelope(200, { data: found })
      return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: 'not found' } })
    }
    return null
  })
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PresetReportPanel projectId={PROJECT_ID} />
    </QueryClientProvider>,
  )
}

const DELAY_REPORT = makeReport(101, 'delay', { title: '2026-07 延期任务分析' })
const PROGRESS_REPORT = makeReport(102, 'progress', {
  title: '2026-07 进度快照',
  config: { fromDate: '2026-07-01', toDate: '2026-07-31' },
})

beforeEach(() => {
  setAuth(['report:view', 'report:create'])
})

afterEach(() => {
  resetFetchRouter()
})

describe('模板切换与参数表单（tasks 1.4 · spec「预设模板报表生成」）', () => {
  test('四类白名单模板单选切换：aria-checked 跟随点击', async () => {
    installPresetBackend({ seed: [] })
    renderPanel()
    await screen.findByText('暂未生成任何报表快照')

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
    expect(radios.map((radio) => radio.textContent?.replace(/\s+/g, ' ').trim()).join('|')).toMatch(
      /项目进度|延期分析|资源工作量|里程碑达成/,
    )
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true')

    const delay = screen.getByRole('radio', { name: /延期分析/ })
    fireEvent.click(delay)
    expect(delay.getAttribute('aria-checked')).toBe('true')
    expect(radios[0]?.getAttribute('aria-checked')).toBe('false')

    const milestone = screen.getByRole('radio', { name: /里程碑达成/ })
    fireEvent.click(milestone)
    expect(milestone.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /资源工作量/ }))
    expect(screen.getByRole('radio', { name: /资源工作量/ }).getAttribute('aria-checked')).toBe(
      'true',
    )
  })

  test('提交 payload 携带模板 + 标题 + 日期跨度 + formatConfig', async () => {
    const { records } = installPresetBackend({ seed: [] })
    renderPanel()
    await screen.findByText('暂未生成任何报表快照')

    fireEvent.click(screen.getByRole('radio', { name: /延期分析/ }))
    fireEvent.change(screen.getByLabelText('报表标题（可选）'), {
      target: { value: '七月延期复盘' },
    })
    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-07-31' } })
    fireEvent.click(screen.getByRole('button', { name: /生成报表/ }))

    await waitFor(() => {
      expect(records.some((record) => record.method === 'POST')).toBe(true)
    })
    const post = records.find((record) => record.method === 'POST')
    expect(post?.url).toContain(`/projects/${PROJECT_ID}/reports`)
    expect(post?.body).toMatchObject({
      template: 'delay',
      title: '七月延期复盘',
      filters: { fromDate: '2026-07-01', toDate: '2026-07-31' },
      formatConfig: { includeDetails: true, includeWarnings: true, locale: 'zh-CN' },
    })
  })

  test('起始日期晚于结束日期：前端拦截且零 POST', async () => {
    const { records } = installPresetBackend({ seed: [] })
    renderPanel()
    await screen.findByText('暂未生成任何报表快照')

    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-07-01' } })
    fireEvent.click(screen.getByRole('button', { name: /生成报表/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('起始日期不能晚于结束日期')
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })
})

describe('生成成功 → 底册追加并选中新条目（spec「用户基于进度模板…成功生成报表」）', () => {
  test('生成成功后列表顶部追加新条目且右侧快照视窗即时渲染新快照', async () => {
    const { records } = installPresetBackend({ seed: [DELAY_REPORT] })
    renderPanel()

    // 初始历史底册：一条 delay
    await screen.findByText('2026-07 延期任务分析')

    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-07-01' } })
    fireEvent.click(screen.getByRole('button', { name: /生成报表/ }))

    // 等待 POST 落库并触发列表失效刷新
    await waitFor(() => {
      expect(records.some((record) => record.method === 'POST')).toBe(true)
    })
    const historyList = document.querySelector('[data-report-history-list]')
    expect(historyList).not.toBeNull()
    await waitFor(() => {
      const items = within(historyList as HTMLElement).getAllByRole('button')
      expect(items).toHaveLength(2)
      expect(within(historyList as HTMLElement).getByText('progress报表 #1001')).toBeInTheDocument()
    })
    // 新条目自动选中（aria-current）
    expect(
      document.querySelector('[data-report-history-item="1001"]')?.getAttribute('aria-current'),
    ).toBe('true')
    // 右侧快照视窗：detail GET /reports/1001 拉取后 KPI 卡渲染进度快照数字（42%）
    await waitFor(() => {
      const snapshotTitle = document.querySelector('[data-report-snapshot-title]')
      expect(snapshotTitle?.textContent).toBe('progress报表 #1001')
    })
    const kpis = document.querySelector('[data-report-kpis]')
    expect(kpis).not.toBeNull()
    expect(within(kpis as HTMLElement).getByText('42%')).toBeInTheDocument()
    expect(records.some((record) => record.url.includes('/reports/1001'))).toBe(true)
  })
})

describe('历史条目切换 → 快照 KPI 与明细渲染（spec「报表历史列表选择快照…」）', () => {
  test('选中 delay 快照渲染延期统计与逾期明细，切换 progress 后数字随之切换', async () => {
    installPresetBackend({ seed: [DELAY_REPORT, PROGRESS_REPORT] })
    renderPanel()

    // 空视窗引导 + 历史底册加载完成
    expect(await screen.findByText('报表快照视窗')).toBeInTheDocument()
    await screen.findByText('2026-07 延期任务分析')

    const historyList = document.querySelector('[data-report-history-list]') as HTMLElement
    fireEvent.click(within(historyList).getByText('2026-07 延期任务分析'))

    // delay 快照 KPI 卡 + 明细表（标题在历史与视窗两处重复，以明细标志等待渲染）
    await screen.findByText('逾期任务明细')
    const kpis = document.querySelector('[data-report-kpis]') as HTMLElement
    expect(within(kpis).getByText('逾期任务')).toBeInTheDocument()
    expect(within(kpis).getByText('3')).toBeInTheDocument()
    expect(within(kpis).getByText('25%')).toBeInTheDocument()
    expect(within(kpis).getByText('2.5')).toBeInTheDocument()
    // 逾期明细表行
    expect(screen.getByText('修复登录态刷新竞态')).toBeInTheDocument()
    expect(screen.getByText('导出引擎白底垫色回归')).toBeInTheDocument()
    expect(screen.getByText('即将到期任务')).toBeInTheDocument()
    // 关键路径转换（是/否）
    expect(screen.getAllByText('是').length).toBeGreaterThan(0)

    // 切换 progress 条目 → 快照随详情切换
    fireEvent.click(within(historyList).getByText('2026-07 进度快照'))
    await screen.findByText('WBS 分支进度')
    const kpis2 = document.querySelector('[data-report-kpis]') as HTMLElement
    expect(within(kpis2).getByText('42%')).toBeInTheDocument()
    expect(within(kpis2).getByText('22')).toBeInTheDocument()
    expect(screen.getByText('关键任务')).toBeInTheDocument()
  })

  test('快照数字采用等宽字体（MONO_FONT_STACK）且数值列带 data-report-numeric 标记', async () => {
    installPresetBackend({ seed: [DELAY_REPORT] })
    renderPanel()
    await screen.findByText('2026-07 延期任务分析')

    const historyList = document.querySelector('[data-report-history-list]') as HTMLElement
    fireEvent.click(within(historyList).getByText('2026-07 延期任务分析'))
    await screen.findByText('逾期任务明细')

    const surface = document.querySelector('[data-report-snapshot-surface]') as HTMLElement
    const numericCells = within(surface).queryAllByText(/.+/, {
      selector: '[data-report-numeric="true"]',
    })
    expect(numericCells.length).toBeGreaterThan(0)
    // 数值格内联等宽字体栈（JetBrains Mono 优先）
    const cell = surface.querySelector('[data-report-numeric="true"]') as HTMLElement
    expect(cell.style.fontFamily).toContain('JetBrains Mono')
    // KPI 卡数值同样等宽
    const kpiValue = document.querySelector('[data-report-kpi] dd') as HTMLElement
    expect(kpiValue.style.fontFamily).toContain('JetBrains Mono')
  })

  test('四种模板的 KPI 卡片与数据摘要均能渲染（workload / milestone）', async () => {
    installPresetBackend({
      seed: [
        DELAY_REPORT,
        PROGRESS_REPORT,
        makeReport(103, 'workload', { title: '2026-07 工作量' }),
        makeReport(104, 'milestone', { title: '2026-07 里程碑' }),
      ],
    })
    renderPanel()
    await screen.findByText('2026-07 延期任务分析')

    const historyList = document.querySelector('[data-report-history-list]') as HTMLElement
    fireEvent.click(within(historyList).getByText('2026-07 工作量'))
    const workloadKpis = await screen.findByText('负责人数')
    expect(workloadKpis).toBeInTheDocument()
    let kpis = document.querySelector('[data-report-kpis]') as HTMLElement
    expect(within(kpis).getByText('120h')).toBeInTheDocument()
    expect(within(kpis).getByText('96h')).toBeInTheDocument()
    expect(screen.getByText('按负责人聚合')).toBeInTheDocument()
    expect(screen.getByText('林澈')).toBeInTheDocument()

    fireEvent.click(within(historyList).getByText('2026-07 里程碑'))
    await screen.findByText('总里程碑')
    kpis = document.querySelector('[data-report-kpis]') as HTMLElement
    expect(within(kpis).getByText('4')).toBeInTheDocument()
    expect(screen.getByText('里程碑清单')).toBeInTheDocument()
    expect(screen.getByText('B6e 报表中心 GA')).toBeInTheDocument()
    expect(screen.getByText('里程碑风险')).toBeInTheDocument()
  })
})

describe('重新生成（spec「重新生成」操作）', () => {
  test('点击「重新生成」带入原 config 参数发起新生成并选中新快照', async () => {
    const { records } = installPresetBackend({ seed: [PROGRESS_REPORT] })
    renderPanel()

    await screen.findByText('2026-07 进度快照')
    const historyList = document.querySelector('[data-report-history-list]') as HTMLElement
    fireEvent.click(within(historyList).getByText('2026-07 进度快照'))
    await screen.findByText('重新生成')

    fireEvent.click(document.querySelector('[data-report-regenerate]') as HTMLElement)

    await waitFor(() => {
      const posts = records.filter((record) => record.method === 'POST')
      expect(posts.length).toBeGreaterThanOrEqual(1)
    })
    const post = records.find((record) => record.method === 'POST')
    expect(post?.body).toMatchObject({
      template: 'progress',
      title: '2026-07 进度快照（重新生成）',
      filters: { fromDate: '2026-07-01', toDate: '2026-07-31' },
    })
    // 新条目（id=1001）自动选中并以带「（重新生成）」后缀的标题渲染为快照
    await waitFor(() => {
      expect(
        document.querySelector('[data-report-history-item="1001"]')?.getAttribute('aria-current'),
      ).toBe('true')
      expect(document.querySelector('[data-report-snapshot-title]')?.textContent).toBe(
        '2026-07 进度快照（重新生成）',
      )
    })
  })
})

describe('只读会话（仅 report:view）——零写请求（RL-01）', () => {
  test('生成表单只读提示、主按钮禁用；快照无「重新生成」；全程无 POST/PATCH/PUT', async () => {
    setAuth(['report:view'])
    const { records } = installPresetBackend({ seed: [DELAY_REPORT, PROGRESS_REPORT] })
    renderPanel()

    // 只读微标 + 生成按钮禁用
    expect(await screen.findByText(/只读 · 缺少 report:create 权限/)).toBeInTheDocument()
    await screen.findByText('2026-07 延期任务分析')
    const submit = screen.getByRole('button', { name: /生成报表/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    // 输入域同样禁用
    expect(screen.getByLabelText('报表标题（可选）')).toBeDisabled()

    // 历史浏览照常（GET）
    const historyList = document.querySelector('[data-report-history-list]') as HTMLElement
    fireEvent.click(within(historyList).getByText('2026-07 延期任务分析'))
    await screen.findByText('逾期任务明细')
    expect(screen.getByText('修复登录态刷新竞态')).toBeInTheDocument()

    // 快照视图隐藏「重新生成」（无 report:create 通道）
    expect(document.querySelector('[data-report-regenerate]')).toBeNull()

    // 尝试点击禁用的生成按钮 → 无任何写请求
    fireEvent.click(submit)
    await waitFor(() => expect(records.length).toBeGreaterThan(0))
    expect(writeMethods(records)).toEqual([])
  })
})
