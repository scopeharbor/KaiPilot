/**
 * v3-ui-next-reports-domain tasks 2.7 —— 版本审阅面板与人工签署流组件测试。
 *
 * 覆盖（design「版本审查多章节展示与人工签署流」/ spec「报表版本详情多章节审查与
 * 人工确认签署流」）：
 * - 8 大结构化章节数据映射与渲染；空章节优雅折叠（「本周期无相关记录」）且可展开；
 * - 状态机徽章：pending_review 待审核 / confirmed 已确认 / rejected 已退回（含退回
 *   意见常驻条）/ editing 编辑中；
 * - 具备 ai:confirm（或 report:create）时「确认签署」弹窗提交 `{ action: 'confirm' }`，
 *   成功后状态即时切换为已确认并展示签署时间戳；「退回草稿」空原因阻止提交，填写后
 *   发送 `{ action: 'return', returnReason }` 并切换为已退回；
 * - 只读权限用户（仅 report:view）隐藏签署/退回按钮（RL-01 人工签署闭环）。
 *
 * 技术说明：hooks 真实实现（含签署成功后缓存失效回读），仅 mock API 层；版本列表
 * 在签署成功后经 invalidate → refetch 从服务端（mock store）读到最新状态。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AiPeriodicDraft, ReportVersion, V2ReportTemplateId } from '@aiproj/types'
import {
  collectDraftChapters,
  parseAiDraftPayload,
  ReportVersionReviewPanel,
  reviewStatusMeta,
  templateDisplayLabel,
} from '@/components/next/reports/ReportVersionReviewPanel'
import { useAuthStore } from '@/stores/auth-store'

// ---------------------------------------------------------------------------
// Module mocks（仅 API 层）
// ---------------------------------------------------------------------------

const apiMocks = vi.hoisted(() => ({
  listVersions: vi.fn(),
  periodicReview: vi.fn(),
}))

vi.mock('@/lib/api/reports-v2', () => ({
  v2ListVersions: apiMocks.listVersions,
  v2PeriodicReview: apiMocks.periodicReview,
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 7

const DRAFT: AiPeriodicDraft = {
  executiveSummary: '本周整体进度 64%，核心引擎进入联调冲刺阶段，里程碑 M2 已达成。',
  highlights: ['完成数据源聚合重构', '里程碑 M2 提前 2 天达成', '消除 3 项高危依赖阻塞'],
  progressNarrative: '任务排程整体提前于基线 1.5 天；关键路径上编译服务模块按计划推进，未见漂移。',
  riskAndIssues: '供应链延期风险仍在扩大，预计影响 E2 联调窗口 2 天；已启用备用镜像源。',
  resourceNotes: '本周工时消耗 87%，前端组负荷偏高，建议下周为联调预留缓冲人员。',
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

const versionStore = vi.hoisted(() => ({
  list: [] as Array<{
    id: number
    aiReviewStatus: string | null
    aiDraft: string | null
    templateId: V2ReportTemplateId
    title: string
    reviewNotes: string | null
    confirmedAt: string | null
    confirmedBy: number | null
    createdAt: string
    generatedAt: string
  }>,
  rejectOnce: false,
}))

function seedVersions(list: ReportVersion[]) {
  versionStore.list = list.map((version) => ({
    id: version.id,
    aiReviewStatus: version.aiReviewStatus,
    aiDraft: version.aiDraft,
    templateId: version.templateId,
    title: version.title,
    reviewNotes: version.reviewNotes,
    confirmedAt: version.confirmedAt,
    confirmedBy: version.confirmedBy,
    createdAt: version.createdAt,
    generatedAt: version.generatedAt,
  }))
  versionStore.rejectOnce = false
}

function applyReview(versionId: number, action: 'confirm' | 'return', notes?: string) {
  const target = versionStore.list.find((version) => version.id === versionId)
  if (!target) return
  if (action === 'confirm') {
    target.aiReviewStatus = 'confirmed'
    target.confirmedAt = '2026-09-15T08:30:00.000Z'
    target.confirmedBy = 7
  } else {
    target.aiReviewStatus = 'rejected'
    target.reviewNotes = notes ?? null
  }
}

let queryClient: QueryClient

function renderReview(props: Partial<React.ComponentProps<typeof ReportVersionReviewPanel>> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportVersionReviewPanel projectId={PROJECT_ID} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
  apiMocks.listVersions.mockReset()
  apiMocks.periodicReview.mockReset()
  apiMocks.listVersions.mockImplementation(async () => ({
    data: [...versionStore.list],
    meta: { total: versionStore.list.length, page: 1, perPage: 50, totalPages: 1 },
  }))
  apiMocks.periodicReview.mockImplementation(
    async (
      _projectId: number,
      versionId: number,
      body: { action: 'confirm' | 'return'; returnReason?: string },
    ) => {
      if (body.action === 'confirm') {
        applyReview(versionId, 'confirm')
        return {
          data: {
            versionId,
            reviewStatus: 'confirmed',
            confirmedAt: '2026-09-15T08:30:00.000Z',
            confirmedBy: 7,
          },
        }
      }
      applyReview(versionId, 'return', body.returnReason)
      return { data: { versionId, reviewStatus: 'rejected' } }
    },
  )
  setAuth(['report:view', 'ai:confirm'])
})

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

describe('草稿解析与章节收集纯函数', () => {
  test('8 大章节映射与空章节折叠判定', () => {
    const chapters = collectDraftChapters(DRAFT)
    expect(chapters).toHaveLength(8)
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      '管理摘要',
      '关键亮点',
      '进度叙述',
      '风险与问题',
      '资源说明',
      '变更说明',
      '建议行动',
      '数据限制说明',
    ])
    const emptyKeys = chapters.filter((chapter) => chapter.isEmpty).map((chapter) => chapter.key)
    expect(emptyKeys).toEqual(['change-notes', 'suggested-actions'])
  })

  test('aiDraft 解析：非法 JSON / 缺字段返回 null', () => {
    expect(parseAiDraftPayload('{bad json')).toBeNull()
    expect(parseAiDraftPayload('{"executiveSummary": 1}')).toBeNull()
    expect(parseAiDraftPayload(null)).toBeNull()
    const parsed = parseAiDraftPayload(JSON.stringify(DRAFT))
    expect(parsed?.highlights).toHaveLength(3)
  })

  test('reviewStatusMeta 状态徽章文案', () => {
    expect(reviewStatusMeta('pending_review').label).toBe('待审核')
    expect(reviewStatusMeta('confirmed').label).toBe('已确认')
    expect(reviewStatusMeta('rejected').label).toBe('已退回')
    expect(reviewStatusMeta('editing').label).toBe('编辑中')
    expect(reviewStatusMeta(null).label).toBe('未审核')
  })

  test('templateDisplayLabel 中文映射', () => {
    expect(templateDisplayLabel('weekly-ai-summary')).toBe('AI 项目周报')
    expect(templateDisplayLabel('monthly-ai-summary')).toBe('AI 项目月报')
    expect(templateDisplayLabel('progress')).toBe('进度报表')
  })
})

// ---------------------------------------------------------------------------
// 版本时间轴与 8 章节渲染
// ---------------------------------------------------------------------------

describe('版本时间轴与多章节结构化渲染', () => {
  function seedDefault() {
    seedVersions([
      makeVersion(108, {
        aiReviewStatus: 'pending_review',
        aiDraft: JSON.stringify(DRAFT),
      }),
      makeVersion(107, {
        templateId: 'monthly-ai-summary',
        title: '八月项目月报',
        aiReviewStatus: 'confirmed',
        aiDraft: JSON.stringify(DRAFT),
        confirmedAt: '2026-09-05T09:00:00.000Z',
        confirmedBy: 5,
      }),
      makeVersion(106, {
        templateId: 'monthly-ai-summary',
        title: '八月项目月报（草稿）',
        aiReviewStatus: 'rejected',
        aiDraft: JSON.stringify(DRAFT),
        reviewNotes: '缺少供应链延期风险说明',
        returnedAt: '2026-09-06T09:00:00.000Z',
        returnedBy: 5,
      }),
    ])
  }

  test('默认选中待审核版本：8 章节渲染、空章节折叠、非空章节展开', async () => {
    seedDefault()
    renderReview()
    // 时间轴三行 + 自动选中 108（pending_review 优先）
    await waitFor(() => expect(document.querySelector('[data-version-row="108"]')).toBeTruthy())
    expect(
      (document.querySelector('[data-version-row="108"]') as HTMLElement).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true')
    // 8 大章节卡齐备
    const chapterKeys = Array.from(document.querySelectorAll('[data-chapter-key]')).map((node) =>
      node.getAttribute('data-chapter-key'),
    )
    expect(chapterKeys).toEqual([
      'executive-summary',
      'highlights',
      'progress-narrative',
      'risk-issues',
      'resource-notes',
      'change-notes',
      'suggested-actions',
      'data-warnings',
    ])
    // 管理摘要内容可见
    expect(screen.getByText(/本周整体进度 64%/)).toBeTruthy()
    // 关键亮点为条目清单（天青色勾选微标）
    expect(screen.getByText('完成数据源聚合重构')).toBeTruthy()
    expect(screen.getByText('里程碑 M2 提前 2 天达成')).toBeTruthy()
    // 数据限制说明（RL-07 诚实披露）可见
    expect(screen.getByText(/工时数据未接入周期聚合/)).toBeTruthy()
    // 空章节折叠：变更说明/建议行动默认收起并呈现「本周期无相关记录」
    const changeChapter = screen
      .getByText('变更说明')
      .closest('[data-chapter-key="change-notes"]') as HTMLElement
    const changeToggle = changeChapter.querySelector('button') as HTMLButtonElement
    expect(changeToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getAllByText('本周期无相关记录')).toHaveLength(2)
    // 展开空章节：展示补录提示
    fireEvent.click(changeToggle)
    await waitFor(() => expect(changeChapter.textContent).toContain('数据源未提供该章节内容'))
  })

  test('头部徽章与签署元信息：confirmed/rejected 版本', async () => {
    seedDefault()
    renderReview()
    await waitFor(() => expect(document.querySelector('[data-version-row="108"]')).toBeTruthy())
    const header = () => document.querySelector('[data-version-review-header]') as HTMLElement
    // 点击已确认版本 107 → 展示签署时间戳
    fireEvent.click(screen.getByText('八月项目月报'))
    await waitFor(() => expect(within(header()).getByText('已确认')).toBeTruthy())
    expect(screen.getByText(/已由成员 #5 于 .+ 签署，草稿已锁定/)).toBeTruthy()
    // 点击已退回版本 106 → 常驻退回意见条（RL-01 反馈闭环）
    fireEvent.click(screen.getByText('八月项目月报（草稿）'))
    await waitFor(() => expect(within(header()).getByText('已退回')).toBeTruthy())
    const banner = screen.getByText('退回意见：').parentElement as HTMLElement
    expect(banner.textContent).toContain('缺少供应链延期风险说明')
  })

  test('深链 selectedVersionId 直达指定版本并高亮', async () => {
    seedDefault()
    const onSelect = vi.fn()
    const firstView = renderReview({ selectedVersionId: 108, onSelectedVersionChange: onSelect })
    await waitFor(() =>
      expect(
        (document.querySelector('[data-version-row="108"]') as HTMLElement).getAttribute(
          'aria-pressed',
        ),
      ).toBe('true'),
    )
    // 深链 id 变更 → 高亮切换（替换整棵树重渲染以模拟外部驱动）
    firstView.unmount()
    renderReview({ selectedVersionId: 107, onSelectedVersionChange: onSelect })
    await waitFor(() =>
      expect(
        (document.querySelector('[data-version-row="107"]') as HTMLElement).getAttribute(
          'aria-pressed',
        ),
      ).toBe('true'),
    )
  })

  test('空版本列表：展示引导空态', async () => {
    seedVersions([])
    renderReview()
    await waitFor(() => expect(screen.getByText('暂未生成任何报表版本')).toBeTruthy())
  })

  test('版本列表错误态：错误卡 + 重新加载恢复', async () => {
    seedDefault()
    versionStore.rejectOnce = true
    apiMocks.listVersions.mockImplementation(async () => {
      if (versionStore.rejectOnce) {
        versionStore.rejectOnce = false
        throw new Error('网络超时')
      }
      return {
        data: [...versionStore.list],
        meta: { total: versionStore.list.length, page: 1, perPage: 50, totalPages: 1 },
      }
    })
    renderReview()
    await waitFor(() => expect(screen.getByText('版本列表加载失败')).toBeTruthy())
    fireEvent.click(screen.getByText('重新加载'))
    await waitFor(() => expect(document.querySelector('[data-version-row="108"]')).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// 人工签署闭环（RL-01）
// ---------------------------------------------------------------------------

describe('人工签署确认与退回操作流（RL-01）', () => {
  test('确认签署：弹窗展示签署人身份，提交后状态即时切换为已确认', async () => {
    seedVersions([
      makeVersion(108, { aiReviewStatus: 'pending_review', aiDraft: JSON.stringify(DRAFT) }),
    ])
    renderReview()
    await waitFor(() => expect(screen.getAllByText('待审核').length).toBeGreaterThan(0))
    const header = document.querySelector('[data-version-review-header]') as HTMLElement

    fireEvent.click(screen.getByText('确认签署'))
    const dialog = document.querySelector('[data-review-dialog="confirm"]') as HTMLElement
    expect(dialog).toBeTruthy()
    expect(within(dialog).getByText('王启明')).toBeTruthy() // 签署人身份
    expect(within(dialog).getByText('#108')).toBeTruthy()

    fireEvent.click(screen.getByText('确认签署', { selector: '[data-review-submit="confirm"]' }))
    await waitFor(() => expect(apiMocks.periodicReview).toHaveBeenCalledTimes(1))
    // 契约：仅发送 action: confirm（无多余批注字段）
    expect(apiMocks.periodicReview.mock.calls[0]).toEqual([PROJECT_ID, 108, { action: 'confirm' }])
    // 签署成功：缓存失效回读 → 状态即时切换为已确认 + 签署时间戳
    await waitFor(() => expect(within(header).getByText('已确认')).toBeTruthy())
    expect(screen.getByText(/已由成员 #7 于 .+ 签署，草稿已锁定/)).toBeTruthy()
    expect(document.querySelector('[data-review-dialog="confirm"]')).toBeNull()
  })

  test('退回草稿：空原因阻止提交，填写原因后成功退回并常驻退回意见', async () => {
    seedVersions([
      makeVersion(108, { aiReviewStatus: 'pending_review', aiDraft: JSON.stringify(DRAFT) }),
    ])
    renderReview()
    await waitFor(() => expect(screen.getAllByText('待审核').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByText('退回草稿'))
    const dialog = document.querySelector('[data-review-dialog="reject"]') as HTMLElement
    expect(dialog).toBeTruthy()
    const reasonInput = document.querySelector('[data-review-reject-reason]') as HTMLTextAreaElement
    const submitBtn = document.querySelector('[data-review-submit="reject"]') as HTMLButtonElement
    // 空原因：提交按钮禁用 + 校验提示（点击亦被拦截）
    expect(submitBtn.disabled).toBe(true)
    expect(within(dialog).getByText('退回原因不能为空')).toBeTruthy()
    fireEvent.click(submitBtn)
    expect(apiMocks.periodicReview).not.toHaveBeenCalled()

    fireEvent.change(reasonInput, { target: { value: '缺少供应链延期风险说明' } })
    expect(submitBtn.disabled).toBe(false)
    fireEvent.click(submitBtn)
    await waitFor(() => expect(apiMocks.periodicReview).toHaveBeenCalledTimes(1))
    expect(apiMocks.periodicReview.mock.calls[0]).toEqual([
      PROJECT_ID,
      108,
      { action: 'return', returnReason: '缺少供应链延期风险说明' },
    ])
    // 状态切换为已退回 + 退回意见常驻条
    const header = document.querySelector('[data-version-review-header]') as HTMLElement
    await waitFor(() => expect(within(header).getByText('已退回')).toBeTruthy())
    const banner = screen.getByText('退回意见：').parentElement as HTMLElement
    expect(banner.textContent).toContain('缺少供应链延期风险说明')
  })

  test('只读权限用户（仅 report:view）：签署/退回按钮完全隐藏', async () => {
    setAuth(['report:view'])
    seedVersions([
      makeVersion(108, { aiReviewStatus: 'pending_review', aiDraft: JSON.stringify(DRAFT) }),
    ])
    renderReview()
    await waitFor(() => expect(screen.getAllByText('待审核').length).toBeGreaterThan(0))
    expect(document.querySelector('[data-review-action-bar]')).toBeNull()
    expect(document.querySelector('[data-review-confirm-btn]')).toBeNull()
    expect(document.querySelector('[data-review-reject-btn]')).toBeNull()
    // 只读成员仍可浏览 8 章节
    expect(screen.getByText(/本周整体进度 64%/)).toBeTruthy()
    expect(apiMocks.periodicReview).not.toHaveBeenCalled()
  })

  test('report:create 权限成员同样具备审核操作权（权限并集）', async () => {
    setAuth(['report:view', 'report:create'])
    seedVersions([
      makeVersion(108, { aiReviewStatus: 'pending_review', aiDraft: JSON.stringify(DRAFT) }),
    ])
    renderReview()
    await waitFor(() => expect(screen.getByText('确认签署')).toBeTruthy())
    expect(document.querySelector('[data-review-reject-btn]')).toBeTruthy()
  })
})
