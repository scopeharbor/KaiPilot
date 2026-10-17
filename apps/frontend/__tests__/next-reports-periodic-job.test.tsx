/**
 * v3-ui-next-reports-domain tasks 2.4 —— 周期报表配置、干跑阻断与异步轮询组件测试。
 *
 * 覆盖（design「AI 周期报表预填与轮询接线」/ spec「AI 周期报表参数配置、前置预览与
 * 异步作业流」）：
 * - 周报/月报自然周期推算与上一周期回溯（纯函数断言，锚点注入确定性日期）；
 * - blocking:true 阻断警告时「开始生成」按钮置灰禁用（零写请求）；
 * - 无 report:create 权限时生成禁用；
 * - 预检通过后数据覆盖度指标卡回显（任务/风险/里程碑，工时诚实置灰 RL-07）；
 * - 触发生成：请求体携带 templateId/fromDate/toDate/previewSnapshotHash；
 * - 异步作业 queued → running → succeeded：真实 hook refetchInterval 2000ms 轮询推进，
 *   成功后自动切入版本审阅；failed 呈现错误详情并一键重试（retry 后接管新作业 id）。
 *
 * 技术说明：hooks 走真实实现（含轮询），仅 mock 底层 API 模块；轮询由 TanStack
 * Query 定时器驱动，采用真实定时器 + 长超时 waitFor。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  computePeriodRange,
  derivePreviousRange,
  PeriodicReportPanel,
  type PeriodicPreviewPayload,
  type PeriodicPreviewEnvelope,
} from '@/components/next/reports/PeriodicReportPanel'
import {
  describeJobStatus,
  formatElapsed,
  type PeriodicJobEnvelope,
} from '@/components/next/reports/ReportJobStatusIndicator'
import { useAuthStore } from '@/stores/auth-store'

// ---------------------------------------------------------------------------
// Module mocks（仅 API 层；hooks/组件为真实实现）
// ---------------------------------------------------------------------------

const apiMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  generate: vi.fn(),
  job: vi.fn(),
  retryJob: vi.fn(),
}))

vi.mock('@/lib/api/reports-v2', () => ({
  v2PeriodicPreview: apiMocks.preview,
  v2PeriodicGenerate: apiMocks.generate,
  v2PeriodicJob: apiMocks.job,
  v2PeriodicRetryJob: apiMocks.retryJob,
}))

// ---------------------------------------------------------------------------
// Fixtures / 测试工具
// ---------------------------------------------------------------------------

const PROJECT_ID = 7

const CURRENT_WEEK = computePeriodRange('weekly-ai-summary')
const CURRENT_MONTH = computePeriodRange('monthly-ai-summary')

function previewOf(overrides: Partial<PeriodicPreviewPayload> = {}): PeriodicPreviewEnvelope {
  return {
    data: {
      templateId: 'weekly-ai-summary',
      title: 'AI 项目周报',
      dateRange: { fromDate: CURRENT_WEEK.fromDate, toDate: CURRENT_WEEK.toDate },
      prevDateRange: { fromDate: CURRENT_WEEK.prevFromDate, toDate: CURRENT_WEEK.prevToDate },
      periodType: 'weekly',
      dataSources: {
        task_summary: {
          sourceKey: 'task_summary',
          status: 'available',
          data: {
            totalTasks: 14,
            completedTasks: 9,
            inProgressTasks: 3,
            overdueTasks: 2,
            milestoneCount: 3,
            completedMilestones: 1,
          },
        },
        dashboard_metrics: {
          sourceKey: 'dashboard_metrics',
          status: 'available',
          data: { taskTotal: 14, overdueTaskCount: 2, milestoneTotal: 3, completedMilestones: 1 },
        },
        risk_summary: {
          sourceKey: 'risk_summary',
          status: 'available',
          data: {
            totalRisks: 3,
            openRisks: 2,
            criticalRisks: 1,
            highRisks: 1,
            mediumRisks: 1,
            lowRisks: 0,
          },
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
      ...overrides,
    },
  }
}

function jobOf(
  id: number,
  overrides: Partial<NonNullable<PeriodicJobEnvelope['data']>> = {},
): PeriodicJobEnvelope {
  return {
    data: {
      id,
      versionId: null,
      templateId: 'weekly-ai-summary',
      status: 'queued',
      progress: null,
      errorCategory: null,
      errorDetail: null,
      startedAt: null,
      createdAt: '2026-09-14T00:00:00.000Z',
      finishedAt: null,
      ...overrides,
    },
  }
}

function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 7,
      email: 'owner@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'owner' }],
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

let queryClient: QueryClient

function renderPanel(props: Partial<React.ComponentProps<typeof PeriodicReportPanel>> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <PeriodicReportPanel projectId={PROJECT_ID} {...props} />
    </QueryClientProvider>,
  )
}

function clickPreview() {
  fireEvent.click(screen.getByText('预检预览'))
}

async function waitPreviewPassed() {
  await waitFor(() => expect(screen.getByText('预检通过：数据源可用，可开始生成')).toBeTruthy(), {
    timeout: 4000,
  })
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
  apiMocks.preview.mockReset()
  apiMocks.generate.mockReset()
  apiMocks.job.mockReset()
  apiMocks.retryJob.mockReset()
  apiMocks.preview.mockResolvedValue(previewOf())
  apiMocks.job.mockResolvedValue(jobOf(42))
  setAuth(['report:view', 'report:create'])
})

// ---------------------------------------------------------------------------
// 纯函数：周期推算
// ---------------------------------------------------------------------------

describe('周期起止推算（周报/月报）', () => {
  test('周报：锚点所在自然周（周一~周日）并回溯上一周', () => {
    const anchor = new Date(2026, 8, 17) // 2026-09-17 周四
    const range = computePeriodRange('weekly-ai-summary', anchor)
    expect(range.fromDate).toBe('2026-09-14')
    expect(range.toDate).toBe('2026-09-20')
    expect(range.prevFromDate).toBe('2026-09-07')
    expect(range.prevToDate).toBe('2026-09-13')
  })

  test('月报：锚点所在自然月（1 日~月末）并回溯等长窗口', () => {
    const anchor = new Date(2026, 8, 17)
    const range = computePeriodRange('monthly-ai-summary', anchor)
    expect(range.fromDate).toBe('2026-09-01')
    expect(range.toDate).toBe('2026-09-30')
    // 与后端 derivePrevPeriod 同口径：等时长回溯（30 天月 → 08-02 ~ 08-31）
    expect(range.prevFromDate).toBe('2026-08-02')
    expect(range.prevToDate).toBe('2026-08-31')
  })

  test('derivePreviousRange 与后端同口径', () => {
    expect(derivePreviousRange('2026-09-14', '2026-09-20')).toEqual({
      prevFromDate: '2026-09-07',
      prevToDate: '2026-09-13',
    })
    expect(derivePreviousRange('2026-09-01', '2026-09-30')).toEqual({
      prevFromDate: '2026-08-02',
      prevToDate: '2026-08-31',
    })
  })

  test('切换月报模板自动预填当月 1 日~月末', () => {
    renderPanel()
    fireEvent.click(screen.getByText('项目月报'))
    const from = screen.getByLabelText('周期开始日期') as HTMLInputElement
    const to = screen.getByLabelText('周期结束日期') as HTMLInputElement
    expect(from.value).toBe(CURRENT_MONTH.fromDate)
    expect(to.value).toBe(CURRENT_MONTH.toDate)
    // 对比周期（等长回溯窗口）同步呈现
    expect(
      screen.getByText(`对比周期：${CURRENT_MONTH.prevFromDate} ~ ${CURRENT_MONTH.prevToDate}`),
    ).toBeTruthy()
  })

  test('周报默认预填当前自然周', () => {
    renderPanel()
    const from = screen.getByLabelText('周期开始日期') as HTMLInputElement
    const to = screen.getByLabelText('周期结束日期') as HTMLInputElement
    expect(from.value).toBe(CURRENT_WEEK.fromDate)
    expect(to.value).toBe(CURRENT_WEEK.toDate)
  })
})

describe('辅助纯函数', () => {
  test('describeJobStatus 阶段文案', () => {
    expect(describeJobStatus('queued').title).toBe('作业排队中')
    expect(describeJobStatus('running').phases).toContain('AI 正在结构化撰写 8 大核心章节…')
    expect(describeJobStatus('succeeded').title).toBe('生成完成')
    expect(describeJobStatus('failed').title).toBe('生成失败')
  })

  test('formatElapsed 秒表格式', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65)).toBe('01:05')
  })
})

// ---------------------------------------------------------------------------
// 前置干跑阻断校验（Dry-run Guard）
// ---------------------------------------------------------------------------

describe('前置干跑阻断校验', () => {
  test('存在 blocking:true 警告时生成按钮置灰禁用并高亮阻断原因', async () => {
    apiMocks.preview.mockResolvedValue(
      previewOf({
        warnings: [
          { level: 'info', message: '工时数据源未接入周期聚合' },
          { level: 'critical', message: '周期内无任何活动任务', blocking: true },
        ],
        blocking: true,
      }),
    )
    renderPanel()
    clickPreview()
    await waitFor(
      () => expect(screen.getByText('存在阻断问题，请先补充项目数据后再生成')).toBeTruthy(),
      {
        timeout: 4000,
      },
    )
    // 阻断原因同时出现在警告清单与阻断横幅中（重复呈现合法，断言数量即可）
    expect(screen.getAllByText('周期内无任何活动任务').length).toBeGreaterThan(0)
    expect(screen.getByText('工时数据源未接入周期聚合')).toBeTruthy()
    const generateBtn = screen.getByText('开始生成') as HTMLButtonElement
    expect(generateBtn.disabled).toBe(true)
    // 阻断状态下零写请求
    expect(apiMocks.generate).not.toHaveBeenCalled()
  })

  test('响应级 blocking:true（核心数据源缺失）同样阻断', async () => {
    apiMocks.preview.mockResolvedValue(previewOf({ blocking: true, warnings: [] }))
    renderPanel()
    clickPreview()
    await waitFor(
      () => expect(screen.getByText('存在阻断问题，请先补充项目数据后再生成')).toBeTruthy(),
      {
        timeout: 4000,
      },
    )
    expect((screen.getByText('开始生成') as HTMLButtonElement).disabled).toBe(true)
  })

  test('无 report:create 权限：生成按钮禁用且提示缺权', async () => {
    setAuth(['report:view'])
    renderPanel()
    clickPreview()
    await waitPreviewPassed()
    expect(screen.getByText('缺少 report:create 权限，仅可查看配置与预检')).toBeTruthy()
    const generateBtn = screen.getByText('开始生成') as HTMLButtonElement
    expect(generateBtn.disabled).toBe(true)
    fireEvent.click(generateBtn)
    expect(apiMocks.generate).not.toHaveBeenCalled()
  })

  test('周期参数变更后需重新预检（陈旧预览不回显）', async () => {
    renderPanel()
    clickPreview()
    await waitPreviewPassed()
    // 修改日期 → 预览请求清空，指标卡不回显，生成禁用
    const from = screen.getByLabelText('周期开始日期') as HTMLInputElement
    // 默认周期按「今天」推算：写死的日期会在某一周恰好等于默认值（等于没改）。
    // 取当前开始日的前 7 天，保证是一次真实的参数变更。
    const shifted = new Date(`${from.value}T00:00:00Z`)
    shifted.setUTCDate(shifted.getUTCDate() - 7)
    fireEvent.change(from, { target: { value: shifted.toISOString().slice(0, 10) } })
    expect(screen.getByText('需先通过预检后方可生成')).toBeTruthy()
    expect(screen.queryByText('预检通过：数据源可用，可开始生成')).toBeNull()
    expect(screen.queryAllByText('任务更新')).toHaveLength(0)
    expect((screen.getByText('开始生成') as HTMLButtonElement).disabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 数据覆盖度与生成触发
// ---------------------------------------------------------------------------

describe('数据覆盖度指标卡与生成触发', () => {
  test('预检通过后回显任务/风险/里程碑覆盖指标', async () => {
    renderPanel()
    clickPreview()
    await waitPreviewPassed()
    const taskCard = screen.getByText('任务更新').closest('[data-coverage-key]') as HTMLElement
    expect(taskCard.getAttribute('data-coverage-key')).toBe('task-update')
    expect(taskCard.textContent).toContain('14')
    expect(taskCard.textContent).toContain('9 已完成')
    expect(taskCard.textContent).toContain('2 逾期')
    const riskCard = screen.getByText('风险敞口').closest('[data-coverage-key]') as HTMLElement
    expect(riskCard.textContent).toContain('3')
    const milestoneCard = screen.getByText('里程碑').closest('[data-coverage-key]') as HTMLElement
    expect(milestoneCard.textContent).toContain('3')
    // 工时数据源诚实置灰（RL-07）：fixture 无工时登记 → 置灰并说明
    const hoursCard = screen.getByText('工时投入').closest('[data-coverage-key]') as HTMLElement
    expect(hoursCard.textContent).toContain('—')
    expect(hoursCard.textContent).toContain('暂无工时登记')
  })

  test('工时投入卡：任务域有估算/实际工时登记时回显合计（不再置灰）', async () => {
    const withHours = previewOf()
    const payload = withHours.data!
    const sources = {
      ...(payload.dataSources as Record<
        string,
        { sourceKey: string; status: string; data: Record<string, unknown> }
      >),
    }
    sources['task_summary'] = {
      ...sources['task_summary']!,
      data: {
        ...sources['task_summary']!.data,
        estimatedHoursTotal: 120,
        actualHoursTotal: 96,
        hoursRecordedTasks: 8,
      },
    }
    payload.dataSources = sources as never
    apiMocks.preview.mockResolvedValue(withHours)
    renderPanel()
    clickPreview()
    await waitPreviewPassed()
    const hoursCard = screen.getByText('工时投入').closest('[data-coverage-key]') as HTMLElement
    expect(hoursCard.textContent).toContain('96')
    expect(hoursCard.textContent).toContain('实际 96h')
    expect(hoursCard.textContent).toContain('估算 120h')
    expect(hoursCard.textContent).toContain('8 任务登记')
  })

  test('预检通过后点击开始生成：携带模板/周期/hash 并激活作业监视器', async () => {
    apiMocks.generate.mockResolvedValue({
      data: { version: { id: 108 }, job: { id: 42, status: 'queued', versionId: 108 } },
    })
    renderPanel()
    clickPreview()
    await waitPreviewPassed()
    fireEvent.click(screen.getByText('开始生成'))
    await waitFor(() => expect(apiMocks.generate).toHaveBeenCalledTimes(1), { timeout: 4000 })
    const generateArgs = apiMocks.generate.mock.calls[0] as unknown as [
      number,
      Record<string, unknown>,
    ]
    expect(generateArgs[0]).toBe(PROJECT_ID)
    expect(generateArgs[1]).toMatchObject({
      templateId: 'weekly-ai-summary',
      fromDate: CURRENT_WEEK.fromDate,
      toDate: CURRENT_WEEK.toDate,
      previewSnapshotHash: 'snapshot-hash-1',
    })
    // RL-01：生成请求不含任何自动签署/转正字段
    expect(generateArgs[1]).not.toHaveProperty('periodStart')
    expect(generateArgs[1]).not.toHaveProperty('action')
    // 作业监视器激活并进入排队态
    await waitFor(() => expect(screen.getByText('作业排队中')).toBeTruthy(), { timeout: 4000 })
  })

  test('生成接口失败时展示错误且不激活作业', async () => {
    apiMocks.generate.mockRejectedValue(new Error('存在阻断性警告，无法生成报表'))
    renderPanel()
    clickPreview()
    await waitPreviewPassed()
    fireEvent.click(screen.getByText('开始生成'))
    await waitFor(() => expect(screen.getByText(/生成失败/)).toBeTruthy(), { timeout: 4000 })
    expect(screen.queryByText('作业排队中')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 异步作业生命周期（真实 2s 轮询）
// ---------------------------------------------------------------------------

describe('异步作业状态监视与 2s 轮询', () => {
  test('作业 queued → running → succeeded：轮询推进并在成功后切入版本审阅', async () => {
    const onJobSucceeded = vi.fn()
    const callTimes: number[] = []
    apiMocks.generate.mockResolvedValue({
      data: { version: { id: 108 }, job: { id: 42, status: 'queued', versionId: 108 } },
    })
    const sequence = [
      jobOf(42, { status: 'queued', versionId: 108 }),
      jobOf(42, {
        status: 'running',
        versionId: 108,
        startedAt: '2026-09-14T00:00:01.000Z',
        progress: '抽取数据',
      }),
      jobOf(42, {
        status: 'succeeded',
        versionId: 108,
        startedAt: '2026-09-14T00:00:01.000Z',
        finishedAt: '2026-09-14T00:00:05.000Z',
      }),
    ]
    apiMocks.job.mockImplementation(async () => {
      callTimes.push(Date.now())
      const next = sequence.shift()
      return next ?? sequence[0] ?? jobOf(42, { status: 'succeeded', versionId: 108 })
    })

    renderPanel({ onJobSucceeded })
    clickPreview()
    await waitPreviewPassed()
    fireEvent.click(screen.getByText('开始生成'))

    // queued：初始即显示排队
    await waitFor(() => expect(screen.getByText('作业排队中')).toBeTruthy(), { timeout: 4000 })
    expect(apiMocks.job).toHaveBeenCalledWith(PROJECT_ID, 42)

    // ~2s 后轮询推进到 running：阶段文案
    await waitFor(() => expect(screen.getByText('AI 草稿生成中')).toBeTruthy(), { timeout: 8000 })
    expect(screen.getByText('正在抽取项目交付数据…')).toBeTruthy()
    expect(screen.getByText('AI 正在结构化撰写 8 大核心章节…')).toBeTruthy()
    expect(screen.getByText('进度：抽取数据')).toBeTruthy()

    // 再次 ~2s：succeeded → 500ms 后自动切入版本审阅
    await waitFor(() => expect(screen.getByText('生成成功，正在进入版本审阅…')).toBeTruthy(), {
      timeout: 8000,
    })
    await waitFor(() => expect(onJobSucceeded).toHaveBeenCalledWith(108), { timeout: 8000 })

    // 轮询节拍证据：连续作业拉取间隔接近 2000ms（非阻塞轮询）
    expect(callTimes.length).toBeGreaterThanOrEqual(3)
    const gaps = callTimes.slice(1).map((t, index) => t - (callTimes[index] ?? t))
    expect(Math.min(...gaps)).toBeGreaterThan(1500)
    // 成功后不再发起新轮询（终态停止）
    const settledCallCount = callTimes.length
    await new Promise((resolve) => setTimeout(resolve, 2100))
    expect(callTimes.length).toBe(settledCallCount)
  }, 40000)

  test('作业失败：呈现错误详情并可一键重试，重试后接管新作业 id', async () => {
    apiMocks.generate.mockResolvedValue({
      data: { version: { id: 109 }, job: { id: 42, status: 'queued', versionId: 109 } },
    })
    // 42 首次查询即失败；retry 后新作业 43 立即返回 queued
    apiMocks.job.mockImplementation(async (_projectId: number, jobId: number) => {
      if (jobId === 43) return jobOf(43, { status: 'queued', versionId: 109 })
      return jobOf(42, {
        status: 'failed',
        versionId: 109,
        errorCategory: 'ai_timeout',
        errorDetail: '上游 AI 模型响应超时',
        startedAt: '2026-09-14T00:00:01.000Z',
        finishedAt: '2026-09-14T00:00:05.000Z',
      })
    })
    apiMocks.retryJob.mockResolvedValue(jobOf(43, { status: 'queued', versionId: 109 }))

    const view = renderPanel()
    clickPreview()
    await waitPreviewPassed()
    fireEvent.click(screen.getByText('开始生成'))

    await waitFor(() => expect(screen.getByText('上游 AI 模型响应超时')).toBeTruthy(), {
      timeout: 4000,
    })
    expect(screen.getByText(/生成失败（作业 #42）/)).toBeTruthy()
    // 失败为终态：无自动重试轮询
    expect(apiMocks.job).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('重试生成'))
    await waitFor(() => expect(apiMocks.retryJob).toHaveBeenCalledWith(PROJECT_ID, 42), {
      timeout: 4000,
    })
    // 重试后接管新作业（id 43 立即查询），无需用户重配日期参数
    await waitFor(() => expect(screen.getByText('作业排队中')).toBeTruthy(), { timeout: 4000 })
    expect(screen.getByText('#43')).toBeTruthy()
    expect(screen.queryByText('上游 AI 模型响应超时')).toBeNull()
    view.unmount()
  }, 30000)

  test('作业查询失败（404/网络）：错误卡 + 重新获取', async () => {
    apiMocks.generate.mockResolvedValue({
      data: { version: { id: 110 }, job: { id: 44, status: 'queued', versionId: 110 } },
    })
    apiMocks.job.mockRejectedValueOnce(new Error('任务不存在')).mockResolvedValueOnce(
      jobOf(44, {
        status: 'failed',
        versionId: 110,
        errorCategory: 'unknown',
        errorDetail: '生成服务内部错误',
      }),
    )
    const view = renderPanel()
    clickPreview()
    await waitPreviewPassed()
    fireEvent.click(screen.getByText('开始生成'))
    await waitFor(() => expect(screen.getByText('无法获取作业状态')).toBeTruthy(), {
      timeout: 4000,
    })
    // 重新获取恢复为可见状态
    fireEvent.click(screen.getByText('重新获取'))
    await waitFor(() => expect(screen.getByText('生成服务内部错误')).toBeTruthy(), {
      timeout: 4000,
    })
    view.unmount()
  })
})
