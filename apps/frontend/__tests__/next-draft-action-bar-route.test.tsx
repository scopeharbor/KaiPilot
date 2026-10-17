/**
 * v3-ui-next-draft-review-panel tasks 3.8 —— W3 操作栏（Blocking 禁确认/工具提示/安全操作）、
 * RBAC 权限感知、路由双态与深链接、加载/错误/空态卡单元测试。
 *
 * 覆盖：
 * - 6 项 Blocking HL（HL-001/002/003/006/007/008）与 3 项 Blocking VE（VE-001/002/010）
 *   任一存在 → 确认按钮强制 disabled + 悬停/聚焦 Tooltip 逐条列出阻断规则；
 * - `canConfirm === false` 阻断；零 Blocking 时冷蓝可转正态与 Tooltip「具备转正资格」；
 * - RL-01：确认按钮为纯哨兵，全程零 confirm 请求、零正式表写入措辞；
 * - 返回重试生成（resetToContext 保上下文）/ 保存为草稿（POST save + enterSaved）/
 *   放弃草案（二次确认 + POST reject + 会话清理）；
 * - Member/Observer 无 ai:confirm → 转正按钮隐藏、权限提示条常驻（spec 文案逐字断言）；
 * - 深链接路由：aiDraftApi.get 快照恢复 → 骨架屏 → 审查面板；404 中性空态（RL-05
 *   防泄露禁词扫描）；500/网络断开 → 错误卡（规范错误码 + 重新载入）；实体缺失空态；
 * - create 页双态协同：reviewing 就地展开面板 + URL replaceState 协同、陈旧 URL 重定
 *   向深链接、重试后 URL 摘除 review 查询。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  DraftValidationIssue,
  DraftValidationReport,
  ProjectDraft,
  ProjectDraftDetail,
  ProjectDraftMeta,
} from '@aiproj/types'
import NextDraftReviewRoute from '@/app/(next)/next/draft/[draftId]/page'
import { describeDraftLoadError, isNotFoundError } from '@/app/(next)/next/draft/[draftId]/page'
import NextCreatePage from '@/app/(next)/next/create/page'
import { NextDraftActionBar } from '@/components/next/review/NextDraftActionBar'
import { NextDraftEmptyView } from '@/components/next/review/NextDraftEmptyView'
import { NextDraftErrorView } from '@/components/next/review/NextDraftErrorView'
import { formatElapsed, NextDraftHeader } from '@/components/next/review/NextDraftHeader'
import { NextDraftPermissionNotice } from '@/components/next/review/NextDraftPermissionNotice'
import { NextDraftSkeleton } from '@/components/next/review/NextDraftSkeleton'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAuthStore } from '@/stores/auth-store'

// ---------------------------------------------------------------------------
// Module mocks（W1/W2 组件契约见 design.md file structure：props 为
// draft / validation；此处以文本桩代位，避免并行开发期依赖未落地模块）
// ---------------------------------------------------------------------------

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  reject: vi.fn(),
  retry: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('@/lib/api/ai-draft', () => ({
  aiDraftApi: {
    get: apiMock.get,
    save: apiMock.save,
    reject: apiMock.reject,
    retry: apiMock.retry,
    confirm: apiMock.confirm,
  },
}))

const navMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/create',
  useParams: () => ({ draftId: 'df_7e3f1a90' }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/next/review/NextDraftModuleInspector', () => ({
  NextDraftModuleInspector: () => <div>模块检视四区（Mock）</div>,
}))

vi.mock('@/components/next/review/NextDraftValidationReport', () => ({
  NextDraftValidationReport: () => <div>反幻觉自检报告（Mock）</div>,
}))

vi.mock('@/components/next/review/NextDraftAutoFixDiff', () => ({
  NextDraftAutoFixDiff: () => <div>自动修正 Diff（Mock）</div>,
}))

vi.mock('@/components/next/review/NextDraftAssumptionList', () => ({
  NextDraftAssumptionList: () => <div>假设清单（Mock）</div>,
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 9 项 Blocking 规则（6 HL + 3 VE，spec「Blocking 禁确认阻断呈现」）。 */
const BLOCKING_RULE_IDS = [
  'HL-001',
  'HL-002',
  'HL-003',
  'HL-006',
  'HL-007',
  'HL-008',
  'VE-001',
  'VE-002',
  'VE-010',
] as const

function blockingIssue(ruleId: string, message = `规则 ${ruleId} 违规`): DraftValidationIssue {
  return { ruleId, severity: 'blocking', message, path: 'dependencies', failed: true }
}

function makeValidation(overrides: Partial<DraftValidationReport> = {}): DraftValidationReport {
  return {
    overallRiskLevel: 'low',
    confidenceScore: 0.94,
    dimensionScores: {
      factualAccuracy: 92,
      logicalConsistency: 90,
      assumptionClarity: 88,
      completeness: 96,
      numericPlausibility: 91,
    },
    blocking: [],
    warning: [],
    info: [],
    ruleResults: [],
    autoFixDiffs: [],
    canConfirm: true,
    ...overrides,
  }
}

function makeDraft(): ProjectDraft {
  return {
    schemaVersion: '1.0',
    projectType: 'software',
    charter: {
      title: {
        value: '企业级敏捷协作平台',
        marker: {
          confidence: 0.9,
          source: 'inferred',
          reason: '依据项目目标推断',
          needsConfirmation: false,
        },
      },
      vision: {
        value: '让跨部门协作高效透明',
        marker: {
          confidence: 0.8,
          source: 'inferred',
          reason: '依据愿景描述推断',
          needsConfirmation: false,
        },
      },
      scope: {
        value: '任务看板与工时统计',
        marker: {
          confidence: 0.8,
          source: 'inferred',
          reason: '依据范围描述推断',
          needsConfirmation: false,
        },
      },
      objectives: {
        value: ['搭建跨部门协作平台'],
        marker: {
          confidence: 0.8,
          source: 'inferred',
          reason: '依据目标推断',
          needsConfirmation: false,
        },
      },
      successCriteria: {
        value: ['任务看板可用'],
        marker: {
          confidence: 0.8,
          source: 'inferred',
          reason: '依据验收推断',
          needsConfirmation: false,
        },
      },
      startDate: {
        value: '2026-09-01',
        marker: {
          confidence: 0.7,
          source: 'inferred',
          reason: '依据常见项目节奏推断',
          needsConfirmation: true,
        },
      },
      endDate: {
        value: '2026-12-31',
        marker: {
          confidence: 0.7,
          source: 'inferred',
          reason: '依据工期推断',
          needsConfirmation: true,
        },
      },
    },
    wbs: [
      {
        id: 'w1',
        parentId: null,
        outlineCode: '1',
        isLeaf: false,
        isNote: false,
        children: [],
        name: {
          value: '核心服务开发',
          marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
        description: {
          value: '主服务',
          marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
      },
      {
        id: 'w1-1',
        parentId: 'w1',
        outlineCode: '1.1',
        isLeaf: true,
        isNote: false,
        children: [],
        name: {
          value: '任务看板模块',
          marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
        description: {
          value: '看板',
          marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
      },
    ],
    tasks: [
      {
        id: 't1',
        wbsNodeId: 'w1-1',
        status: 'not_started',
        name: {
          value: '搭建任务看板',
          marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
        description: {
          value: '看板搭建',
          marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
        durationDays: {
          value: 10,
          marker: {
            confidence: 0.75,
            source: 'inferred',
            reason: '依据类似算法复杂度与历史交付经验推算工期需 10 个工作日',
            needsConfirmation: true,
          },
        },
        startDate: {
          value: '2026-09-01',
          marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
        endDate: {
          value: '2026-09-14',
          marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
        assigneeHint: {
          value: '王启明',
          marker: {
            confidence: 0.6,
            source: 'inferred',
            reason: '依据角色推断',
            needsConfirmation: true,
          },
        },
        assigneeRoleIds: {
          value: ['app-dev'],
          marker: { confidence: 0.6, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
      },
    ],
    dependencies: [
      {
        id: 'd1',
        predecessorId: 't0',
        successorId: 't1',
        type: 'FS',
        lagDays: {
          value: 1,
          marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
      },
    ],
    acceptanceCriteria: [],
    resourceHints: [],
    riskHints: [],
    milestoneHints: [],
    ganttPreview: {
      startDate: {
        value: '2026-09-01',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      endDate: {
        value: '2026-12-31',
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      totalDurationDays: {
        value: 120,
        marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
      },
      criticalPathTaskIds: ['t1'],
      phaseCount: 3,
    },
  }
}

function makeMeta(): ProjectDraftMeta {
  return {
    schemaVersion: '1.0',
    projectType: 'software',
    structuredStrategy: 'native',
    consistency: 'strict',
    fallbackUsed: false,
    provider: 'mock',
    model: 'mock-model',
    usingRealAdapter: false,
    appliedFixes: [],
    moduleCounts: {
      wbsNodes: 2,
      tasks: 1,
      dependencies: 1,
      acceptanceCriteria: 0,
      resourceHints: 0,
      riskHints: 0,
      milestoneHints: 0,
    },
  }
}

function makeDetail(overrides: Partial<ProjectDraftDetail> = {}): ProjectDraftDetail {
  return {
    draftId: 'df_7e3f1a90',
    version: 2,
    status: 'reviewing',
    generationState: 'settled',
    projectType: 'software',
    draft: makeDraft(),
    meta: makeMeta(),
    validation: makeValidation(),
    events: [],
    ...overrides,
  }
}

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

function resetDraftStore() {
  sessionStorage.clear()
  useAiProjectDraftStore.setState({
    schemaVersion: '1.0',
    userId: 1,
    organizationId: 1,
    status: 'ready',
    rawInput: '',
    cards: [],
    answers: {},
    parsedIntent: null,
    context: null,
    clarificationPhase: 'ready',
    activeCard: null,
    remainingCount: 0,
    completedCount: 0,
    totalCount: 0,
    questionPlanRevision: null,
    agentQuestionPlanToken: null,
    adaptiveSession: null,
    adaptiveSessionToken: null,
    questionPlanCoverage: null,
    error: null,
    restored: false,
    draftStatus: null,
    draftId: null,
    draftVersion: 0,
    draft: null,
    draftMeta: null,
    draftFailure: null,
    validation: null,
    moduleStatuses: {},
    lastEventSequence: 0,
    pendingModifications: [],
  })
}

/** 进入审查现场的 store 快照（模拟剧场落定后 enterReview）。 */
function enterReviewingStore() {
  useAiProjectDraftStore.setState({
    draftStatus: 'reviewing',
    draftId: 'df_7e3f1a90',
    draftVersion: 2,
    draft: makeDraft(),
    draftMeta: makeMeta(),
    validation: makeValidation(),
  })
}

/** RL-01 禁措辞清单（spec「绝对禁止暗示项目已创建/已入库」）。 */
const FORBIDDEN_COPY = [
  '项目已创建',
  '项目已完成',
  '创建成功',
  '项目创建完毕',
  '正式项目已入库',
  '已写入数据库',
]

/** RL-05 租户防泄露禁词（中性 404 空态绝不允许出现）。 */
const TENANT_LEAK_WORDS = ['无权', '其他组织', '不属于', '租户']

beforeEach(() => {
  sessionStorage.clear()
  // URL 隔离：还原纯净根路径，避免前序用例 replaceState 残留 review 查询。
  window.history.replaceState(null, '', '/')
  apiMock.get.mockReset()
  apiMock.save.mockReset()
  apiMock.reject.mockReset()
  apiMock.confirm.mockReset()
  navMock.replace.mockReset()
  navMock.push.mockReset()
  resetDraftStore()
  // 转正交互态复位（B2c-2 守卫矩阵依赖确认 Store：选中集 / Warning 复核 / 提交中）
  useAiDraftConfirmStore.setState({
    mode: 'all',
    selection: {
      taskIds: [],
      wbsNodeIds: [],
      acceptanceIds: [],
      milestoneIds: [],
      riskHintIds: [],
      unselectedStrategy: 'discard',
    },
    acknowledgedWarnings: false,
    isConfirming: false,
    confirmModalOpen: false,
    autoFixModalState: { open: false, diffs: [], version: 0 },
  })
  setAuth(['ai:view', 'ai:trigger', 'ai:confirm'])
})

// ---------------------------------------------------------------------------
// 3.1/3.2 NextDraftActionBar：Blocking 禁确认 + Tooltip + 安全操作
// ---------------------------------------------------------------------------

describe('NextDraftActionBar（tasks 3.1-3.2）', () => {
  test.each(BLOCKING_RULE_IDS)(
    'Blocking 规则 %s 存在时确认按钮强制 disabled，聚焦 Tooltip 列出阻断',
    (ruleId) => {
      render(
        <NextDraftActionBar
          draftId="df_7e3f1a90"
          validation={makeValidation({ blocking: [blockingIssue(ruleId)] })}
        />,
      )

      const confirmButton = screen.getByRole('button', { name: /确认并转正项目/ })
      expect(confirmButton).toHaveProperty('disabled', true)
      expect(confirmButton.className).toContain('opacity-40')
      expect(confirmButton.className).toContain('cursor-not-allowed')

      // 键盘聚焦触发 Tooltip（design D6：悬停/聚焦双通道）
      const trigger = document.querySelector('[data-confirm-trigger]') as HTMLElement
      expect(trigger).not.toBeNull()
      fireEvent.focus(trigger)
      expect(screen.getByRole('tooltip')).toHaveTextContent(`[${ruleId}] 规则 ${ruleId} 违规`)
      expect(screen.getByRole('tooltip')).toHaveTextContent('存在 1 项阻断级严重违规')
    },
  )

  test('悬停触发展开 Tooltip（onMouseEnter 通道）', () => {
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation({
          blocking: [blockingIssue('HL-007', '检测到任务依赖循环：task-1 -> task-2 -> task-1')],
        })}
      />,
    )
    expect(screen.queryByRole('tooltip')).toBeNull()
    const trigger = document.querySelector('[data-confirm-trigger]') as HTMLElement
    fireEvent.mouseEnter(trigger)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('[HL-007] 检测到任务依赖循环：task-1 -> task-2 -> task-1')
    expect(tooltip).toHaveTextContent('严禁转正')
    expect(tooltip).toHaveTextContent('请返回重试生成或保存为草案')
  })

  test('多条 Blocking 违规：Tooltip 逐条列出且总数正确', () => {
    const validation = makeValidation({
      blocking: [
        blockingIssue('HL-007', '依赖循环'),
        blockingIssue('VE-010', '必填项缺失'),
        blockingIssue('HL-002', '工期非法'),
      ],
    })
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={validation} />)
    fireEvent.focus(document.querySelector('[data-confirm-trigger]') as HTMLElement)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('存在 3 项阻断级严重违规')
    expect(tooltip).toHaveTextContent('[HL-007] 依赖循环')
    expect(tooltip).toHaveTextContent('[VE-010] 必填项缺失')
    expect(tooltip).toHaveTextContent('[HL-002] 工期非法')
  })

  test('canConfirm === false 且无 blocking 条目时同样阻断', () => {
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation({ canConfirm: false, blocking: [] })}
      />,
    )
    expect(screen.getByRole('button', { name: /确认并转正项目/ })).toHaveProperty('disabled', true)
  })

  test('零 Blocking 且 canConfirm=true：选中任务 ≥1 时按钮解禁为冷蓝高亮态，Tooltip 提示具备转正资格', () => {
    // B2c-2 守卫矩阵：选中集至少 1 项任务才激活转正（初始化全选集合）
    useAiDraftConfirmStore.getState().initSelection(makeDraft())
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    const confirmButton = screen.getByRole('button', { name: /确认并转正项目/ })
    expect(confirmButton).toHaveProperty('disabled', false)
    expect(confirmButton.className).toContain('bg-[var(--nx-accent)]')

    fireEvent.focus(document.querySelector('[data-confirm-trigger]') as HTMLElement)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      '草案已通过反幻觉与转换校验，具备转正资格',
    )
  })

  test('RL-01：可转正态点击仅唤起二次确认弹窗，零网络请求、零 confirm 调用、无落库措辞', () => {
    useAiDraftConfirmStore.getState().initSelection(makeDraft())
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    // 显式点击仅进入二次确认（转正网络请求 100% 由弹窗「确认落库」发出）
    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    expect(useAiDraftConfirmStore.getState().confirmModalOpen).toBe(true)
    expect(apiMock.confirm).not.toHaveBeenCalled()
    expect(apiMock.save).not.toHaveBeenCalled()
    expect(apiMock.reject).not.toHaveBeenCalled()

    const bodyText = document.body.textContent ?? ''
    for (const forbidden of FORBIDDEN_COPY) {
      expect(bodyText).not.toContain(forbidden)
    }
  })

  test('返回重试生成：调用 store.resetToContext 清理草案现场、保留已确认上下文，并触发 onRetry', () => {
    enterReviewingStore()
    const onRetry = vi.fn()
    render(
      <NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} onRetry={onRetry} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /返回重试生成/ }))
    const state = useAiProjectDraftStore.getState()
    expect(state.draftStatus).toBeNull()
    expect(state.draft).toBeNull()
    expect(state.validation).toBeNull()
    // 已确认上下文保留（退回就绪态可重新调度生成）
    expect(state.status).toBe('ready')
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('保存为草稿：POST save 成功 → enterSaved + 成功提示 + onSaved', async () => {
    apiMock.save.mockResolvedValueOnce(makeDetail())
    const onSaved = vi.fn()
    render(
      <NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} onSaved={onSaved} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /保存为草稿/ }))
    await screen.findByText('草案已保存至草稿箱')
    expect(apiMock.save).toHaveBeenCalledWith('df_7e3f1a90')
    expect(apiMock.confirm).not.toHaveBeenCalled()
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('saved')
    expect(onSaved).toHaveBeenCalledTimes(1)
    // 保存成功后按钮置灰，防止重复提交
    expect(screen.getByRole('button', { name: /保存为草稿/ })).toHaveProperty('disabled', true)
  })

  test('保存草稿失败：呈现规范错误码提示，草案保持审查态', async () => {
    apiMock.save.mockRejectedValueOnce({ code: 'DRAFT_SAVE_FAILED', message: '服务暂不可用' })
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)

    fireEvent.click(screen.getByRole('button', { name: /保存为草稿/ }))
    await screen.findByRole('alert')
    expect(screen.getByText('[DRAFT_SAVE_FAILED] 服务暂不可用')).toBeInTheDocument()
    expect(screen.queryByText('草案已保存至草稿箱')).toBeNull()
    expect(useAiProjectDraftStore.getState().draftStatus).not.toBe('saved')
  })

  test('放弃草案：二次确认后才调用 POST reject，随后 enterRejected + 会话清理 + onDiscarded', async () => {
    apiMock.reject.mockResolvedValueOnce({ draftId: 'df_7e3f1a90', status: 'rejected' })
    const onDiscarded = vi.fn()
    enterReviewingStore()
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation()}
        onDiscarded={onDiscarded}
      />,
    )

    // 第一次点击仅武装确认态（防误触）
    fireEvent.click(screen.getByRole('button', { name: /放弃草案/ }))
    expect(apiMock.reject).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /确认放弃草案/ })).toBeInTheDocument()

    // 二次点击才执行
    fireEvent.click(screen.getByRole('button', { name: /确认放弃草案/ }))
    await waitFor(() => expect(apiMock.reject).toHaveBeenCalledWith('df_7e3f1a90'))
    expect(apiMock.confirm).not.toHaveBeenCalled()
    const state = useAiProjectDraftStore.getState()
    expect(state.draftStatus).toBeNull()
    expect(state.draft).toBeNull()
    expect(onDiscarded).toHaveBeenCalledTimes(1)
  })

  test('放弃草案武装态可取消，不发起任何请求', () => {
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    fireEvent.click(screen.getByRole('button', { name: /放弃草案/ }))
    fireEvent.click(screen.getByRole('button', { name: /取消/ }))
    expect(screen.getByRole('button', { name: /放弃草案/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /确认放弃草案/ })).toBeNull()
    expect(apiMock.reject).not.toHaveBeenCalled()
  })

  test('放弃草案接口失败：错误提示呈现，阻断状态解除（可重新操作）', async () => {
    apiMock.reject.mockRejectedValueOnce({ code: 'DRAFT_REJECT_FAILED', message: '网络中断' })
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    fireEvent.click(screen.getByRole('button', { name: /放弃草案/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认放弃草案/ }))
    await screen.findByText('[DRAFT_REJECT_FAILED] 网络中断')
    expect(screen.getByRole('button', { name: /放弃草案/ })).toBeInTheDocument()
  })

  test('RL-01：全程零「已创建/已入库」措辞（含 Tooltip 展开态）', () => {
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation({
          blocking: [blockingIssue('VE-010', '必填项缺失')],
        })}
      />,
    )
    fireEvent.focus(document.querySelector('[data-confirm-trigger]') as HTMLElement)
    const bodyText = document.body.textContent ?? ''
    for (const forbidden of FORBIDDEN_COPY) {
      expect(bodyText).not.toContain(forbidden)
    }
  })
})

// ---------------------------------------------------------------------------
// 3.3 NextDraftPermissionNotice：RBAC 权限感知
// ---------------------------------------------------------------------------

describe('NextDraftActionBar / NextDraftPermissionNotice 权限感知（tasks 3.3）', () => {
  test('Member（无 ai:confirm）：操作栏不渲染转正按钮，权限提示条常驻（spec 文案逐字断言）', () => {
    setAuth(['ai:view', 'ai:trigger'])
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)

    expect(screen.queryByRole('button', { name: /确认并转正项目/ })).toBeNull()
    const notice = document.querySelector('[data-next-draft-permission-notice]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain(
      '当前账号具备草案审查权限；项目转正入库需由项目经理或组织管理员操作确认',
    )
    // 其余安全操作仍可用
    expect(screen.getByRole('button', { name: /保存为草稿/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /放弃草案/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /返回重试生成/ })).toBeInTheDocument()
  })

  test('PM（具备 ai:confirm）：转正哨兵按钮渲染，权限提示条不出现', () => {
    setAuth(['ai:view', 'ai:trigger', 'ai:confirm'])
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    expect(screen.getByRole('button', { name: /确认并转正项目/ })).toBeInTheDocument()
    expect(document.querySelector('[data-next-draft-permission-notice]')).toBeNull()
  })

  test('NextDraftPermissionNotice 独立渲染：有确认权限为空，无确认权限展示提示条', () => {
    setAuth(['ai:view', 'ai:trigger', 'ai:confirm'])
    const { container: withPermission } = render(<NextDraftPermissionNotice />)
    expect(withPermission.firstChild).toBeNull()

    setAuth(['ai:view', 'ai:trigger'])
    const { container: withoutPermission } = render(<NextDraftPermissionNotice />)
    expect(withoutPermission.firstChild).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3.4 骨架屏 / 错误卡 / 中性 404 空态卡
// ---------------------------------------------------------------------------

describe('NextDraftSkeleton / NextDraftErrorView / NextDraftEmptyView（tasks 3.4）', () => {
  test('骨架屏：仪表风占位与审查面板同构（顶栏/检视区/侧栏），双通道加载语义', () => {
    const { container } = render(<NextDraftSkeleton />)
    const skeleton = document.querySelector('[data-next-draft-skeleton]')
    expect(skeleton).not.toBeNull()
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status', { name: '正在加载草案数据' })).toBeInTheDocument()
    expect(container.querySelector('[data-skeleton-header]')).not.toBeNull()
    expect(container.querySelector('[data-skeleton-inspector]')).not.toBeNull()
    expect(container.querySelector('[data-skeleton-aside]')).not.toBeNull()
    // 1.5s 发丝呼吸动画类存在（精确档/减弱动效由 NX_REVIEW_CSS 归零）
    expect(container.querySelectorAll('.nx-review-breathe').length).toBeGreaterThan(0)
  })

  test('错误卡：规范错误码 + 中文指引 + 重新载入/返回首页', () => {
    const onReload = vi.fn()
    const onBackHome = vi.fn()
    render(
      <NextDraftErrorView
        code="DRAFT_LOAD_FAILED"
        message="草案服务暂时不可用，请稍后重试"
        onReload={onReload}
        onBackHome={onBackHome}
      />,
    )
    expect(screen.getByRole('alert', { name: '草案加载错误' })).toBeInTheDocument()
    expect(screen.getByText('[DRAFT_LOAD_FAILED]')).toBeInTheDocument()
    expect(screen.getByText('草案服务暂时不可用，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新载入/ }))
    expect(onReload).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /返回首页/ }))
    expect(onBackHome).toHaveBeenCalledTimes(1)
  })

  test('错误卡缺省：网络断开文案与 DRAFT_LOAD_FAILED 兜底', () => {
    render(<NextDraftErrorView onReload={vi.fn()} />)
    expect(screen.getByText('[DRAFT_LOAD_FAILED]')).toBeInTheDocument()
    expect(screen.getByText('无法连接到草案服务，请检查网络设置。')).toBeInTheDocument()
  })

  test('中性 404 空态（RL-05）：统一中性文案，零租户敏感词，提供返回首页', () => {
    const onBackHome = vi.fn()
    render(<NextDraftEmptyView onBackHome={onBackHome} />)
    expect(screen.getByText('未找到该草案或链接已失效')).toBeInTheDocument()
    expect(screen.getByText('草案不存在或已被移除，请核对链接后重试。')).toBeInTheDocument()
    const bodyText = document.body.textContent ?? ''
    for (const word of TENANT_LEAK_WORDS) {
      expect(bodyText).not.toContain(word)
    }
    fireEvent.click(screen.getByRole('button', { name: /返回首页/ }))
    expect(onBackHome).toHaveBeenCalledTimes(1)
  })

  test('实体缺失空态（empty 变体）：引导发起全新项目创建', () => {
    const onCreate = vi.fn()
    render(<NextDraftEmptyView variant="empty" onBackHome={vi.fn()} onCreate={onCreate} />)
    expect(screen.getByText('暂无可供审查的草案数据')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /发起全新项目创建/ }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 3.5 NextDraftHeader
// ---------------------------------------------------------------------------

describe('NextDraftHeader（tasks 3.5）', () => {
  test('短码 / 版本 / 9/9 完备绿标 / 项目类型 / 生成耗时呈现', () => {
    render(
      <NextDraftHeader draftId="df_7e3f1a90" version={2} projectType="software" elapsedMs={2400} />,
    )
    expect(screen.getByText('#DRAFT-7E3F1A90')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText('9/9 模块已完备')).toBeInTheDocument()
    expect(screen.getByText('软件系统')).toBeInTheDocument()
    expect(screen.getByText('2.4s')).toBeInTheDocument()
  })

  test('formatElapsed：无数据/非法值回退「—」', () => {
    expect(formatElapsed(2400)).toBe('2.4s')
    expect(formatElapsed(null)).toBe('—')
    expect(formatElapsed(Number.NaN)).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// 3.6 深链接路由 /next/draft/[draftId]
// ---------------------------------------------------------------------------

describe('深链接路由 NextDraftReviewRoute（tasks 3.6）', () => {
  test('成功快照恢复：骨架屏 → setDraftCompleted + enterReview → 同一审查面板', async () => {
    apiMock.get.mockResolvedValueOnce(makeDetail())
    render(<NextDraftReviewRoute />)

    // 在途：高保真骨架屏
    expect(screen.getByRole('status', { name: '正在加载草案数据' })).toBeInTheDocument()

    // 载入后渲染同一主容器（与剧场内 100% 相同组件树）
    await screen.findByRole('region', { name: '草案审查面板' })
    expect(screen.getByText('#DRAFT-7E3F1A90')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText('模块检视四区（Mock）')).toBeInTheDocument()
    expect(screen.getByText('反幻觉自检报告（Mock）')).toBeInTheDocument()
    expect(screen.getByText('自动修正 Diff（Mock）')).toBeInTheDocument()
    expect(screen.getByText('假设清单（Mock）')).toBeInTheDocument()

    expect(apiMock.get).toHaveBeenCalledWith('df_7e3f1a90')
    const state = useAiProjectDraftStore.getState()
    expect(state.draftStatus).toBe('reviewing')
    expect(state.draftId).toBe('df_7e3f1a90')
    expect(state.draftVersion).toBe(2)
    expect(state.draft).not.toBeNull()
    expect(state.validation).not.toBeNull()
  })

  test('深链接载入：resetConfirmState + initSelection 重建全选选择集（防上一草案 partial 残留串台）', async () => {
    // 预置上一草案的残留交互态：partial 选择集 + 弹窗强开 + Warning 已勾选
    useAiDraftConfirmStore.setState({
      mode: 'partial',
      selection: {
        taskIds: ['stale-task-1'],
        wbsNodeIds: ['stale-wbs-1'],
        acceptanceIds: [],
        milestoneIds: [],
        riskHintIds: [],
        unselectedStrategy: 'save_as_draft',
      },
      acknowledgedWarnings: true,
      confirmModalOpen: true,
      isConfirming: false,
    })
    apiMock.get.mockResolvedValueOnce(makeDetail())
    render(<NextDraftReviewRoute />)

    await screen.findByRole('region', { name: '草案审查面板' })
    const confirm = useAiDraftConfirmStore.getState()
    // 选择集按当前草案全选重建（makeDetail 草案仅含 t1），残留任务绝不串台
    expect(confirm.mode).toBe('all')
    expect(confirm.selection.taskIds).toEqual(['t1'])
    expect(confirm.selection.wbsNodeIds).toEqual(['w1', 'w1-1'])
    expect(confirm.selection.unselectedStrategy).toBe('discard')
    // 弹窗 / 复核勾选等瞬态一并复位
    expect(confirm.confirmModalOpen).toBe(false)
    expect(confirm.acknowledgedWarnings).toBe(false)
  })

  test('HTTP 404：渲染中性空态卡，绝不泄露资源存在性（RL-05）', async () => {
    apiMock.get.mockRejectedValueOnce({ status: 404, code: 'RESOURCE_NOT_FOUND', message: '' })
    render(<NextDraftReviewRoute />)

    await screen.findByRole('status', { name: '未找到该草案或链接已失效' })
    expect(screen.getByText('草案不存在或已被移除，请核对链接后重试。')).toBeInTheDocument()
    const bodyText = document.body.textContent ?? ''
    for (const word of TENANT_LEAK_WORDS) {
      expect(bodyText).not.toContain(word)
    }
    // 返回首页导航
    fireEvent.click(screen.getByRole('button', { name: /返回首页/ }))
    expect(navMock.replace).toHaveBeenCalledWith('/next')
  })

  test('服务端 500：错误卡展示规范错误码，重新载入重新发起请求并恢复', async () => {
    apiMock.get
      .mockRejectedValueOnce({ status: 500, code: 'AI_SERVICE_ERROR', message: '草案服务内部异常' })
      .mockResolvedValueOnce(makeDetail())
    render(<NextDraftReviewRoute />)

    await screen.findByRole('alert', { name: '草案加载错误' })
    expect(screen.getByText('[AI_SERVICE_ERROR]')).toBeInTheDocument()
    expect(screen.getByText('草案服务内部异常')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /重新载入/ }))
    await screen.findByRole('region', { name: '草案审查面板' })
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })

  test('网络断开（TypeError）：NETWORK_DISCONNECTED 规范码 + 中文排查指引', async () => {
    apiMock.get.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<NextDraftReviewRoute />)

    await screen.findByRole('alert', { name: '草案加载错误' })
    expect(screen.getByText('[NETWORK_DISCONNECTED]')).toBeInTheDocument()
    expect(screen.getByText('无法连接到草案服务，请检查网络设置。')).toBeInTheDocument()
  })

  test('快照实体缺失（draft==null）：数据缺失空态 + 发起全新项目创建', async () => {
    apiMock.get.mockResolvedValueOnce(makeDetail({ draft: null, meta: null, validation: null }))
    render(<NextDraftReviewRoute />)

    await screen.findByRole('status', { name: '暂无可供审查的草案数据' })
    fireEvent.click(screen.getByRole('button', { name: /发起全新项目创建/ }))
    expect(navMock.replace).toHaveBeenCalledWith('/next/create')
  })

  test('无 ai:view 权限角色：PermissionGuard 拦截为只读降级卡，不发起请求', () => {
    setAuth([])
    render(<NextDraftReviewRoute />)
    expect(document.querySelector('[data-theater-permission-fallback]')).not.toBeNull()
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  test('放弃草案：双确认后 reject + 会话清理 → 中性「草案已放弃」终态卡', async () => {
    apiMock.get.mockResolvedValueOnce(makeDetail())
    apiMock.reject.mockResolvedValueOnce({ draftId: 'df_7e3f1a90', status: 'rejected' })
    render(<NextDraftReviewRoute />)
    await screen.findByRole('region', { name: '草案审查面板' })

    fireEvent.click(screen.getByRole('button', { name: /放弃草案/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认放弃草案/ }))

    await screen.findByText('草案已放弃，会话已结束')
    expect(apiMock.reject).toHaveBeenCalledWith('df_7e3f1a90')
    expect(useAiProjectDraftStore.getState().draft).toBeNull()
  })

  test('返回重试生成：resetToContext 后导航回生成剧场', async () => {
    apiMock.get.mockResolvedValueOnce(makeDetail())
    render(<NextDraftReviewRoute />)
    await screen.findByRole('region', { name: '草案审查面板' })

    fireEvent.click(screen.getByRole('button', { name: /返回重试生成/ }))
    expect(navMock.replace).toHaveBeenCalledWith('/next/create')
    expect(useAiProjectDraftStore.getState().draft).toBeNull()
  })
})

describe('describeDraftLoadError / isNotFoundError 归一', () => {
  test('404 判定与错误归一映射', () => {
    expect(isNotFoundError({ status: 404 })).toBe(true)
    expect(isNotFoundError({ status: 500 })).toBe(false)
    expect(isNotFoundError(new Error('x'))).toBe(false)
    expect(describeDraftLoadError({ code: 'AI_SERVICE_ERROR', message: '内部异常' })).toEqual({
      code: 'AI_SERVICE_ERROR',
      message: '内部异常',
    })
    expect(describeDraftLoadError(new TypeError('Failed to fetch'))).toEqual({
      code: 'NETWORK_DISCONNECTED',
      message: '无法连接到草案服务，请检查网络设置。',
    })
    expect(describeDraftLoadError({ status: 500 })).toEqual({
      code: 'DRAFT_LOAD_FAILED',
      message: '草案数据加载失败，请稍后重试。',
    })
  })
})

// ---------------------------------------------------------------------------
// 3.7 create 页双态协同：reviewing 就地展开 + URL 协同
// ---------------------------------------------------------------------------

describe('create 页双态协同（tasks 3.7）', () => {
  test('reviewing 状态：就地展开审查面板，URL 静默协同同步（无二次网络请求）', async () => {
    enterReviewingStore()
    render(<NextCreatePage />)

    const panel = screen.getByRole('region', { name: '草案审查面板' })
    expect(panel).toBeInTheDocument()
    // 零二次草案请求：仅审查面板就地展开
    expect(apiMock.get).not.toHaveBeenCalled()

    // URL 坐标协同：?draftId=...&view=review
    expect(window.location.search).toContain('draftId=df_7e3f1a90')
    expect(window.location.search).toContain('view=review')
  })

  test('非审查态（ready）不受影响：渲染就绪视图，URL 无 review 查询', () => {
    render(<NextCreatePage />)
    expect(window.location.search).not.toContain('view=review')
  })

  test('陈旧 URL 引导：view=review 且 store 无匹配审查会话 → 重定向深链接路由', () => {
    // 模拟 F5/新标签页打开分享链接：store 未恢复审查会话
    window.history.replaceState(null, '', '/next/create?draftId=df_other&view=review')
    render(<NextCreatePage />)
    expect(navMock.replace).toHaveBeenCalledWith('/next/draft/df_other')
  })

  test('store 已有匹配审查会话时，F5 不做深链接重定向（就地零请求恢复）', () => {
    window.history.replaceState(null, '', '/next/create?draftId=df_7e3f1a90&view=review')
    enterReviewingStore()
    render(<NextCreatePage />)
    expect(navMock.replace).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: '草案审查面板' })).toBeInTheDocument()
  })

  test('返回重试生成：审查面板收回，URL 摘除 review 查询', async () => {
    enterReviewingStore()
    render(<NextCreatePage />)
    expect(screen.getByRole('region', { name: '草案审查面板' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /返回重试生成/ }))
    await waitFor(() => {
      expect(window.location.search).not.toContain('view=review')
    })
    expect(screen.queryByRole('region', { name: '草案审查面板' })).toBeNull()
  })
})
