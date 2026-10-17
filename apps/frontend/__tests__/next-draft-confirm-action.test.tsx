/**
 * v3-ui-next-draft-confirm tasks 3.8 —— W3 操作栏确认转正、RBAC 零请求守卫、
 * 二次确认弹窗、成功视窗与失败分类恢复单元测试。
 *
 * 覆盖：
 * - 操作栏 5 项前置守卫（ai:confirm 权限 / Blocking 清零 / Warning 显式勾选 /
 *   选中任务 ≥1 / 非提交中）与未激活 Tooltip 禁用原因；
 * - Warning 告警提示条 + 「我已复核并确认上述警告项」复选框解锁转正；
 * - 二次确认弹窗数据汇总（项目名 / 实体计数 / 模式 / 未选策略）与「确认落库」
 *   权威载荷组装（version/mode/selection/modifications/acknowledgedWarnings）；
 * - 提交中 Spinner + 防重复点击单飞；成功 → enterConfirmed + 成功视窗
 *   （#PROJ 编号 / 5 卡计数 / 审计回执 / 清游标导航 /next/projects/:id）；
 * - 失败分类：422 stale → 拉取最新版本重审；422 blocking → 违规卡片；
 *   422 autoFix → AutoFixModal 门禁；500/断网 → 原地重试保留现场；
 * - Member 无 ai:confirm → DOM 无确认按钮 + 零 confirm 请求（RL-06）；
 * - RL-01 落库措辞门禁与 RL-12 敏感全文防护；
 * - ReviewPanel 总装（PartialAcceptPanel / ConfirmModal / AutoFixModal / SuccessModal）
 *   与全局 ESC 关闭二次确认。
 *
 * 并行边界：W1/W2 的 confirm store 与 PartialAcceptPanel / AutoFixModal 在本文件内
 * 以契约桩代位（design.md file structure：store 状态/actions 与组件 props 照 design 契约），
 * 避免并行开发期依赖未落地模块。
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  DraftAutoFixDiff,
  ProjectDraft,
  ProjectDraftDetail,
  ProjectDraftMeta,
  ProjectDraftSelection,
  DraftValidationIssue,
  DraftValidationReport,
} from '@aiproj/types'
import { NextDraftActionBar } from '@/components/next/review/NextDraftActionBar'
import {
  classifyConfirmFailure,
  computeDraftConfirmCounts,
  NextDraftConfirmModal,
} from '@/components/next/review/NextDraftConfirmModal'
import { NextDraftConfirmSuccessModal } from '@/components/next/review/NextDraftConfirmSuccessModal'
import { NextDraftReviewPanel } from '@/components/next/review/NextDraftReviewPanel'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAuthStore } from '@/stores/auth-store'
import { AI_DRAFT_PROGRESS_CURSOR_KEY } from '@/lib/ai-draft/progress-cursor'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  reject: vi.fn(),
  retry: vi.fn(),
  confirm: vi.fn(),
  validate: vi.fn(),
}))

vi.mock('@/lib/api/ai-draft', () => ({
  aiDraftApi: {
    get: apiMock.get,
    save: apiMock.save,
    reject: apiMock.reject,
    retry: apiMock.retry,
    confirm: apiMock.confirm,
    validate: apiMock.validate,
  },
}))

const navMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/draft/df_7e3f1a90',
  useParams: () => ({ draftId: 'df_7e3f1a90' }),
  useSearchParams: () => new URLSearchParams(),
}))

/**
 * 并行边界：W1/W2 的 PartialAcceptPanel 在下方以契约桩代位（design.md file structure：
 * 消费 draftId/draft props）；confirm store 与 AutoFixModal 均使用真实落地组件。
 */
// W1 并行组件契约桩。
vi.mock('@/components/next/review/NextDraftPartialAcceptPanel', () => ({
  NextDraftPartialAcceptPanel: () => <div>局部接受控制栏（Mock）</div>,
}))

vi.mock('@/components/next/review/NextDraftModuleInspector', () => ({
  NextDraftModuleInspector: () => <div>模块检视四区（Mock）</div>,
}))

vi.mock('@/components/next/review/NextDraftValidationReport', () => ({
  NextDraftValidationReport: () => <div>反幻觉自检报告（Mock）</div>,
}))

vi.mock('@/components/next/review/NextDraftAssumptionList', () => ({
  NextDraftAssumptionList: () => <div>假设清单（Mock）</div>,
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function blockingIssue(ruleId: string, message = `规则 ${ruleId} 违规`): DraftValidationIssue {
  return { ruleId, severity: 'blocking', message, path: 'dependencies', failed: true }
}

function warningIssue(ruleId: string, message: string): DraftValidationIssue {
  return { ruleId, severity: 'warning', message, path: null, failed: false }
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
      {
        id: 't2',
        wbsNodeId: 'w1-1',
        status: 'not_started',
        name: {
          value: '前端对接联调',
          marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
        description: {
          value: '联调',
          marker: { confidence: 0.9, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
        durationDays: {
          value: 5,
          marker: { confidence: 0.75, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
        startDate: {
          value: '2026-09-15',
          marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
        endDate: {
          value: '2026-09-22',
          marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
        assigneeHint: {
          value: '李明月',
          marker: { confidence: 0.6, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
      },
    ],
    dependencies: [
      {
        id: 'd1',
        predecessorId: 't1',
        successorId: 't2',
        type: 'FS',
        lagDays: {
          value: 1,
          marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
      },
      {
        id: 'd2',
        predecessorId: 't0',
        successorId: 't1',
        type: 'FS',
        lagDays: {
          value: 0,
          marker: { confidence: 0.7, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
      },
    ],
    acceptanceCriteria: [
      {
        id: 'a1',
        statement: {
          value: '看板可拖拽',
          marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
        linkedTaskId: 't1',
        linkedSuccessIndex: null,
      },
    ],
    resourceHints: [],
    riskHints: [
      {
        id: 'r1',
        description: {
          value: '人员流动',
          marker: { confidence: 0.6, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
        level: {
          value: 'medium',
          marker: { confidence: 0.6, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
        mitigation: {
          value: '交叉培训',
          marker: { confidence: 0.6, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
      },
    ],
    milestoneHints: [
      {
        id: 'm1',
        name: {
          value: '一期上线',
          marker: { confidence: 0.8, source: 'inferred', reason: '推断', needsConfirmation: false },
        },
        targetDate: {
          value: '2026-11-30',
          marker: { confidence: 0.6, source: 'inferred', reason: '推断', needsConfirmation: true },
        },
        linkedTaskIds: ['t1'],
      },
    ],
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
      tasks: 2,
      dependencies: 2,
      acceptanceCriteria: 1,
      resourceHints: 0,
      riskHints: 1,
      milestoneHints: 1,
    },
  }
}

function makeDetail(overrides: Partial<ProjectDraftDetail> = {}): ProjectDraftDetail {
  return {
    draftId: 'df_7e3f1a90',
    version: 3,
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

/** 全选选择集（含部分勾选的变体由各用例覆盖）。 */
function allSelectedSelection(): ProjectDraftSelection {
  const draft = makeDraft()
  return {
    taskIds: draft.tasks.map((task) => task.id),
    wbsNodeIds: draft.wbs.map((node) => node.id),
    acceptanceIds: draft.acceptanceCriteria.map((item) => item.id),
    milestoneIds: draft.milestoneHints.map((item) => item.id),
    riskHintIds: draft.riskHints.map((item) => item.id),
    unselectedStrategy: 'discard',
  }
}

const CONFIRM_COUNTS_RESPONSE = {
  projectId: 1042,
  createdCounts: {
    wbsNodes: 2,
    tasks: 2,
    dependencies: 2,
    milestones: 1,
    acceptanceCriteria: 1,
    risks: 1,
  },
}

// ---------------------------------------------------------------------------
// Store priming helpers
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
    confirmResponse: null,
    lastEventSequence: 0,
    pendingModifications: [],
    streamOutput: '',
    streamOutputActive: false,
  })
}

/** 审查现场（reviewing）快照。 */
function enterReviewingStore(
  overrides: Partial<Parameters<typeof useAiProjectDraftStore.setState>[0]> = {},
) {
  useAiProjectDraftStore.setState({
    draftStatus: 'reviewing',
    draftId: 'df_7e3f1a90',
    draftVersion: 2,
    draft: makeDraft(),
    draftMeta: makeMeta(),
    validation: makeValidation(),
    pendingModifications: [],
    ...overrides,
  })
}

function resetConfirmStore() {
  useAiDraftConfirmStore.setState({
    mode: 'all',
    selection: allSelectedSelection(),
    acknowledgedWarnings: false,
    isConfirming: false,
    confirmModalOpen: false,
    autoFixModalState: { open: false, diffs: [], version: 0 },
  })
}

/** RL-01 禁措辞清单（转正成功前绝对不得出现）。 */
const FORBIDDEN_COPY = [
  '项目已创建',
  '项目已完成',
  '创建成功',
  '项目创建完毕',
  '正式项目已入库',
  '已写入数据库',
]

beforeEach(() => {
  sessionStorage.clear()
  apiMock.get.mockReset()
  apiMock.save.mockReset()
  apiMock.reject.mockReset()
  apiMock.confirm.mockReset()
  apiMock.validate.mockReset()
  navMock.push.mockReset()
  navMock.replace.mockReset()
  resetDraftStore()
  resetConfirmStore()
  setAuth(['ai:view', 'ai:trigger', 'ai:confirm'])
})

// ---------------------------------------------------------------------------
// 3.1 ActionBar：5 项前置守卫矩阵与禁用原因 Tooltip
// ---------------------------------------------------------------------------

describe('NextDraftActionBar 前置守卫矩阵（tasks 3.1）', () => {
  test('Blocking 违规存在：按钮强制 disabled，聚焦 Tooltip 逐条列出阻断规则（RL-02）', () => {
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation({ blocking: [blockingIssue('HL-007', '检测到任务依赖循环')] })}
      />,
    )
    const button = screen.getByRole('button', { name: /确认并转正项目/ })
    expect(button).toHaveProperty('disabled', true)

    fireEvent.focus(document.querySelector('[data-confirm-trigger]') as HTMLElement)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('存在 1 项阻断级严重违规')
    expect(tooltip).toHaveTextContent('[HL-007] 检测到任务依赖循环')
    expect(tooltip).toHaveTextContent('严禁转正')
    expect(button.className).toContain('cursor-not-allowed')
  })

  test('canConfirm === false 且无 blocking 条目：同样强制 disabled', () => {
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation({ canConfirm: false, blocking: [] })}
      />,
    )
    expect(screen.getByRole('button', { name: /确认并转正项目/ })).toHaveProperty('disabled', true)
  })

  test('选中任务为 0：按钮 disabled，Tooltip 提示「至少需要选择 1 项任务方可转正」', () => {
    useAiDraftConfirmStore.setState({ selection: { ...allSelectedSelection(), taskIds: [] } })
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    const button = screen.getByRole('button', { name: /确认并转正项目/ })
    expect(button).toHaveProperty('disabled', true)

    fireEvent.focus(document.querySelector('[data-confirm-trigger]') as HTMLElement)
    expect(screen.getByRole('tooltip')).toHaveTextContent('至少需要选择 1 项任务方可转正')
  })

  test('存在 Warning 且未勾选复核：警告提示条呈现 + 按钮 disabled；勾选后解锁', () => {
    const validation = makeValidation({
      warning: [warningIssue('HL-004', '资源人天接近饱和'), warningIssue('VE-003', '工期偏紧')],
    })
    const { container } = render(
      <NextDraftActionBar draftId="df_7e3f1a90" validation={validation} />,
    )
    const bar = container.querySelector('[data-warning-ack-bar]')
    expect(bar).not.toBeNull()
    expect(bar?.textContent).toContain('当前草案存在需关注的风险或假设（2 项告警）')

    const confirmButton = screen.getByRole('button', { name: /确认并转正项目/ })
    expect(confirmButton).toHaveProperty('disabled', true)
    fireEvent.focus(document.querySelector('[data-confirm-trigger]') as HTMLElement)
    expect(screen.getByRole('tooltip')).toHaveTextContent('请先勾选「我已复核并确认上述警告项」')

    // 勾选复核 → acknowledgedWarnings 落 store → 按钮解锁
    const checkbox = container.querySelector('[data-warning-ack-checkbox]') as HTMLInputElement
    fireEvent.click(checkbox)
    expect(useAiDraftConfirmStore.getState().acknowledgedWarnings).toBe(true)
    expect(screen.getByRole('button', { name: /确认并转正项目/ })).toHaveProperty('disabled', false)
    // 再次取消勾选 → 重新禁用
    fireEvent.click(checkbox)
    expect(screen.getByRole('button', { name: /确认并转正项目/ })).toHaveProperty('disabled', true)
  })

  test('无 Warning 时警告提示条不渲染', () => {
    const { container } = render(
      <NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />,
    )
    expect(container.querySelector('[data-warning-ack-bar]')).toBeNull()
  })

  test('提交中（isConfirming）：按钮 disabled + Spinner 旋转 + 落库文案（防重复点击）', () => {
    useAiDraftConfirmStore.setState({ isConfirming: true })
    const { container } = render(
      <NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />,
    )
    const button = screen.getByRole('button', { name: /正在写入正式项目库…/ })
    expect(button).toHaveProperty('disabled', true)
    expect(container.querySelector('[data-confirm-action] .nx-review-spin')).not.toBeNull()

    fireEvent.focus(document.querySelector('[data-confirm-trigger]') as HTMLElement)
    expect(screen.getByRole('tooltip')).toHaveTextContent('正在写入正式项目库，请稍候')
  })

  test('五项守卫全部满足：按钮解禁为冷蓝高亮态，点击仅唤起二次确认弹窗（零网络请求）', () => {
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    const confirmButton = screen.getByRole('button', { name: /确认并转正项目/ })
    expect(confirmButton).toHaveProperty('disabled', false)
    expect(confirmButton.className).toContain('bg-[var(--nx-accent)]')

    fireEvent.focus(document.querySelector('[data-confirm-trigger]') as HTMLElement)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      '草案已通过反幻觉与转换校验，具备转正资格',
    )

    fireEvent.click(confirmButton)
    // 二次确认未完成前绝对零 confirm 请求（RL-01 显式点击才 confirm）
    expect(apiMock.confirm).not.toHaveBeenCalled()
    expect(useAiDraftConfirmStore.getState().confirmModalOpen).toBe(true)
  })

  test('RL-01：转正前界面全程零「已创建/已入库」措辞（含守卫激活态）', () => {
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    expect(useAiDraftConfirmStore.getState().confirmModalOpen).toBe(true)

    const bodyText = document.body.textContent ?? ''
    for (const forbidden of FORBIDDEN_COPY) {
      expect(bodyText).not.toContain(forbidden)
    }
  })
})

// ---------------------------------------------------------------------------
// 3.2/3.3 二次确认弹窗：数据汇总、权威载荷、防重防并发
// ---------------------------------------------------------------------------

describe('NextDraftConfirmModal 二次确认与单事务提交（tasks 3.2-3.3）', () => {
  test('弹窗汇总：项目名称、实体计数（含双端选中的依赖过滤）、模式与未选策略', () => {
    useAiDraftConfirmStore.setState({
      mode: 'partial',
      selection: {
        taskIds: ['t1'],
        wbsNodeIds: ['w1', 'w1-1'],
        acceptanceIds: ['a1'],
        milestoneIds: ['m1'],
        riskHintIds: [],
        unselectedStrategy: 'save_as_draft',
      },
    })
    enterReviewingStore()
    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)

    expect(screen.getByText('企业级敏捷协作平台')).toBeInTheDocument()
    expect(screen.getByText('局部选择')).toBeInTheDocument()
    expect(screen.getByText('保留为后续草稿')).toBeInTheDocument()

    // d1 (t1→t2) 因 t2 未选而悬空排除；d2 (t0→t1) 前置 t0 未选同样排除 → 依赖数 0
    const countOf = (key: string): string | null | undefined =>
      document.querySelector(`[data-count-key="${key}"] [data-count-value]`)?.textContent
    expect(countOf('wbsNodes')).toBe('2')
    expect(countOf('tasks')).toBe('1')
    expect(countOf('dependencies')).toBe('0')
    expect(countOf('milestones')).toBe('1')
    expect(countOf('risks')).toBe('0')

    // save_as_draft + partial：策略行追加草稿箱保留计数提示（未选数 = 总任务数 − 选中数）
    const hint = document.querySelector('[data-save-as-draft-hint]')
    expect(hint).not.toBeNull()
    expect(hint?.textContent).toContain('转正后未选的 1 项任务将保留在草稿箱')
  })

  test('未选策略非 save_as_draft（discard/ask_later）或全量模式：不渲染草稿箱提示', () => {
    enterReviewingStore()
    useAiDraftConfirmStore.setState({
      mode: 'partial',
      selection: {
        taskIds: ['t1'],
        wbsNodeIds: ['w1', 'w1-1'],
        acceptanceIds: [],
        milestoneIds: [],
        riskHintIds: [],
        unselectedStrategy: 'discard',
      },
    })
    const { container, rerender } = render(
      <NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />,
    )
    expect(container.querySelector('[data-save-as-draft-hint]')).toBeNull()

    useAiDraftConfirmStore.setState({
      mode: 'all',
      selection: {
        ...allSelectedSelection(),
        unselectedStrategy: 'save_as_draft',
      },
    })
    rerender(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)
    // 全量模式（mode=all）下无未选任务，即使策略为 save_as_draft 也不渲染提示
    expect(document.querySelector('[data-save-as-draft-hint]')).toBeNull()
  })

  test('「确认落库」组装权威载荷调用 confirm：version/mode/selection/modifications/acknowledgedWarnings', async () => {
    apiMock.confirm.mockResolvedValueOnce(CONFIRM_COUNTS_RESPONSE)
    useAiDraftConfirmStore.setState({
      mode: 'partial',
      selection: {
        taskIds: ['t1', 't2'],
        wbsNodeIds: ['w1', 'w1-1'],
        acceptanceIds: ['a1'],
        milestoneIds: ['m1'],
        riskHintIds: ['r1'],
        unselectedStrategy: 'discard',
      },
      acknowledgedWarnings: true,
    })
    enterReviewingStore({
      draftVersion: 2,
      pendingModifications: [{ path: 'tasks[t1].durationDays', value: 8 }],
    })

    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))

    await waitFor(() => {
      expect(apiMock.confirm).toHaveBeenCalledTimes(1)
    })
    expect(apiMock.confirm).toHaveBeenCalledWith('df_7e3f1a90', {
      version: 2,
      mode: 'partial',
      selection: {
        taskIds: ['t1', 't2'],
        wbsNodeIds: ['w1', 'w1-1'],
        acceptanceIds: ['a1'],
        milestoneIds: ['m1'],
        riskHintIds: ['r1'],
        unselectedStrategy: 'discard',
      },
      modifications: [{ path: 'tasks[t1].durationDays', value: 8 }],
      acknowledgedWarnings: true,
    })

    // 成功后状态流转：enterConfirmed → draftStatus=confirmed + confirmResponse 落定
    await waitFor(() => {
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    })
    expect(useAiProjectDraftStore.getState().confirmResponse?.projectId).toBe(1042)
    expect(useAiDraftConfirmStore.getState().isConfirming).toBe(false)
  })

  test('请求在途：按钮 loading + 二次点击被绝对拦截（confirm 单飞单次调用）', async () => {
    const gate: { resolve?: (value: typeof CONFIRM_COUNTS_RESPONSE) => void } = {}
    apiMock.confirm.mockReturnValue(
      new Promise((resolve) => {
        gate.resolve = resolve
      }),
    )
    enterReviewingStore()
    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    expect(useAiDraftConfirmStore.getState().isConfirming).toBe(true)

    const committing = screen.getByRole('button', { name: /正在写入正式项目库…/ })
    expect(committing).toHaveProperty('disabled', true)
    expect(committing.querySelector('.nx-review-spin')).not.toBeNull()
    // 取消按钮同步禁用，杜绝中途逃逸
    expect(screen.getByRole('button', { name: /取消/ })).toHaveProperty('disabled', true)

    // 在途重复点击：绝对拦截
    fireEvent.click(committing)
    fireEvent.click(committing)
    expect(apiMock.confirm).toHaveBeenCalledTimes(1)

    gate.resolve?.(CONFIRM_COUNTS_RESPONSE)
    await waitFor(() => {
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    })
    expect(useAiDraftConfirmStore.getState().isConfirming).toBe(false)
  })

  test('取消：关闭弹窗，零 confirm 请求', () => {
    enterReviewingStore()
    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /取消/ }))
    expect(useAiDraftConfirmStore.getState().confirmModalOpen).toBe(false)
    expect(apiMock.confirm).not.toHaveBeenCalled()
  })

  test('RL-02 纵深加固：Blocking 存在 + store 强开弹窗 → 点击确认落库零网络请求', async () => {
    apiMock.confirm.mockResolvedValue(CONFIRM_COUNTS_RESPONSE)
    enterReviewingStore({
      validation: makeValidation({ blocking: [blockingIssue('HL-007', '检测到任务依赖循环')] }),
    })
    // 模拟 devtools 绕过操作栏守卫强开二次确认弹窗
    useAiDraftConfirmStore.setState({ confirmModalOpen: true })
    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    expect(apiMock.confirm).not.toHaveBeenCalled()
    expect(useAiDraftConfirmStore.getState().isConfirming).toBe(false)
    expect(useAiProjectDraftStore.getState().draftStatus).not.toBe('confirmed')
  })

  test('RL-02 纵深加固：存在 Warning 且未勾选复核 + store 强开弹窗 → 点击确认零网络请求', () => {
    apiMock.confirm.mockResolvedValue(CONFIRM_COUNTS_RESPONSE)
    enterReviewingStore({
      validation: makeValidation({ warning: [warningIssue('HL-004', '资源人天接近饱和')] }),
    })
    useAiDraftConfirmStore.setState({ confirmModalOpen: true, acknowledgedWarnings: false })
    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    expect(apiMock.confirm).not.toHaveBeenCalled()
    expect(useAiDraftConfirmStore.getState().isConfirming).toBe(false)
  })

  test('RL-02 纵深加固：选择集为空 + store 强开弹窗 → 点击确认落库零网络请求', () => {
    apiMock.confirm.mockResolvedValue(CONFIRM_COUNTS_RESPONSE)
    enterReviewingStore()
    useAiDraftConfirmStore.setState({
      confirmModalOpen: true,
      selection: { ...allSelectedSelection(), taskIds: [] },
    })
    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    expect(apiMock.confirm).not.toHaveBeenCalled()
    expect(useAiDraftConfirmStore.getState().isConfirming).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3.4 成功视窗：计数看板、审计回执、清游标导航
// ---------------------------------------------------------------------------

describe('NextDraftConfirmSuccessModal（tasks 3.4）', () => {
  test('成功视窗：绿盾主标题 + #PROJ 编号 + 5 卡计数 + 审计回执（操作人/时间/事务标识）', () => {
    useAiProjectDraftStore.setState({
      draftStatus: 'confirmed',
      confirmResponse: CONFIRM_COUNTS_RESPONSE,
      draft: makeDraft(),
    })
    render(<NextDraftConfirmSuccessModal />)

    expect(screen.getByText('项目已正式转正落库')).toBeInTheDocument()
    expect(document.querySelector('[data-proj-number]')?.textContent).toBe('#PROJ-1042')
    expect(screen.getByText('企业级敏捷协作平台')).toBeInTheDocument()

    const countOf = (key: string): string | null | undefined =>
      document.querySelector(`[data-count-key="${key}"] [data-count-card-value]`)?.textContent
    expect(countOf('wbsNodes')).toBe('2')
    expect(countOf('tasks')).toBe('2')
    expect(countOf('dependencies')).toBe('2')
    expect(countOf('milestones')).toBe('1')
    expect(countOf('risks')).toBe('1')
    expect(document.querySelectorAll('[data-count-card]').length).toBe(5)

    const receipt = document.querySelector('[data-audit-receipt]')?.textContent ?? ''
    expect(receipt).toContain('操作人：王启明')
    expect(receipt).toContain('导入时间：')
    expect(receipt).toContain('#PROJ-1042 已记入组织审计日志')
  })

  test('RL-12：成功视窗不泄露完整草案 JSON / 原始推断理由全文', () => {
    useAiProjectDraftStore.setState({
      draftStatus: 'confirmed',
      confirmResponse: CONFIRM_COUNTS_RESPONSE,
      draft: makeDraft(),
    })
    render(<NextDraftConfirmSuccessModal />)
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toContain('schemaVersion')
    expect(bodyText).not.toContain('ganttPreview')
    expect(bodyText).not.toContain('依据类似算法复杂度与历史交付经验推算工期需 10 个工作日')
  })

  test('「进入项目主页」：清本地恢复游标 + 导航至新轨项目空间 /next/projects/1042', () => {
    sessionStorage.setItem(
      AI_DRAFT_PROGRESS_CURSOR_KEY,
      JSON.stringify({ userId: 1, organizationId: 1, draftId: 'df_7e3f1a90' }),
    )
    useAiProjectDraftStore.setState({
      draftStatus: 'confirmed',
      confirmResponse: CONFIRM_COUNTS_RESPONSE,
      draft: makeDraft(),
    })
    render(<NextDraftConfirmSuccessModal />)

    fireEvent.click(screen.getByRole('button', { name: /进入项目主页/ }))
    expect(sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY)).toBeNull()
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/1042')
  })

  test('未落定（confirmResponse 为 null）：不渲染任何内容', () => {
    const { container } = render(<NextDraftConfirmSuccessModal />)
    expect(container.firstChild).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3.5 失败分类呈现与恢复路径
// ---------------------------------------------------------------------------

describe('转正失败分类与自愈恢复（tasks 3.5）', () => {
  test('422 stale（details.expected/received）：横幅 + 「拉取最新版本重审」刷新草案并复位选择集', async () => {
    const onClear = vi.fn()
    apiMock.get.mockResolvedValueOnce(makeDetail())
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation()}
        confirmFailure={{ kind: 'stale', expected: 3, received: 2 }}
        onClearConfirmFailure={onClear}
      />,
    )

    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain(
      '草案在其他会话或自动微调中已生成新版本（当前 v2，最新 v3）',
    )
    expect(banner.textContent).toContain('无法基于过期版本转正')

    fireEvent.click(screen.getByRole('button', { name: /拉取最新版本重审/ }))
    await waitFor(() => {
      expect(apiMock.get).toHaveBeenCalledWith('df_7e3f1a90')
      expect(useAiProjectDraftStore.getState().draftVersion).toBe(3)
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('reviewing')
      expect(onClear).toHaveBeenCalledTimes(1)
    })
    // 选择集已随新版本重新初始化（全选）
    expect(useAiDraftConfirmStore.getState().selection.taskIds.length).toBe(2)
  })

  test('拉取最新版本失败：横幅保留并给出网络排查提示', async () => {
    apiMock.get.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const onClear = vi.fn()
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation()}
        confirmFailure={{ kind: 'stale', expected: 3, received: 2 }}
        onClearConfirmFailure={onClear}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /拉取最新版本重审/ }))
    await screen.findByText('拉取最新版本失败，请检查网络后重试。')
    expect(onClear).not.toHaveBeenCalled()
  })

  test('422 blocking：红色违规卡片逐条呈现「服务端最终校验拦截」', () => {
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation()}
        confirmFailure={{
          kind: 'blocking',
          issues: [blockingIssue('HL-007', '依赖关系存在循环回路')],
        }}
      />,
    )
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('服务端最终校验拦截，禁止落库')
    const card = document.querySelector('[data-blocking-violation]')
    expect(card?.textContent).toContain('[HL-007] 依赖关系存在循环回路')
  })

  test('422 autoFix：确认弹窗关闭并直接呼出自动修正复核门禁（RL-02 严禁静默转正）', async () => {
    const autoFixDiffs: DraftAutoFixDiff[] = [
      {
        path: 'tasks[t1].durationDays',
        before: 400,
        after: 365,
        reason: '工期超出上限，自动收敛为 365 天',
      },
    ]
    apiMock.confirm.mockRejectedValueOnce({
      status: 422,
      code: 'DRAFT_AUTO_FIXED',
      message: '草案已自动修正',
      details: { autoFixDiffs, version: 3 },
    })
    const onError = vi.fn()
    enterReviewingStore()
    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={onError} />)

    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    await waitFor(() => {
      expect(useAiDraftConfirmStore.getState().isConfirming).toBe(false)
    })
    expect(useAiDraftConfirmStore.getState().confirmModalOpen).toBe(false)
    expect(useAiDraftConfirmStore.getState().autoFixModalState).toEqual({
      open: true,
      diffs: autoFixDiffs,
      version: 3,
    })
    // autoFix 走复核门禁，不落入操作栏错误横幅
    expect(onError).not.toHaveBeenCalled()
    expect(apiMock.confirm).toHaveBeenCalledTimes(1)
  })

  test('500/断网：红色重试提示 + 「重试转正」原样保留现场重开二次确认', async () => {
    // 请求失败
    apiMock.confirm.mockRejectedValueOnce({
      status: 500,
      code: 'AI_SERVICE_ERROR',
      message: '内部异常',
    })
    const onError = vi.fn()
    enterReviewingStore()
    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={onError} />)
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith({ kind: 'fatal', message: '内部异常' })
    })
    // 现场保留：勾选集与就地编辑原地不动
    expect(useAiDraftConfirmStore.getState().selection.taskIds.length).toBe(2)

    // 操作栏横幅 + 重试转正 → 重开二次确认弹窗
    useAiDraftConfirmStore.setState({ confirmModalOpen: false })
    render(
      <NextDraftActionBar
        draftId="df_7e3f1a90"
        validation={makeValidation()}
        confirmFailure={{ kind: 'fatal', message: '内部异常' }}
        onClearConfirmFailure={vi.fn()}
      />,
    )
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain(
      '转正请求失败：网络连接超时或服务繁忙，未写入任何正式数据，请重试',
    )
    fireEvent.click(screen.getByRole('button', { name: /重试转正/ }))
    expect(useAiDraftConfirmStore.getState().confirmModalOpen).toBe(true)
    // 重试不自动发请求，仍需用户在弹窗内显式确认（RL-01）
    expect(apiMock.confirm).toHaveBeenCalledTimes(1)
  })

  test('错误恢复后提交中状态复位：转正按钮重新可交互', async () => {
    apiMock.confirm.mockRejectedValueOnce({ status: 500 })
    const onError = vi.fn()
    enterReviewingStore()
    const { unmount } = render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={onError} />)
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    await waitFor(() => expect(onError).toHaveBeenCalled())
    unmount()

    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    const button = screen.getByRole('button', { name: /确认并转正项目/ })
    expect(button).toHaveProperty('disabled', false)
    expect(useAiDraftConfirmStore.getState().isConfirming).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3.6 RBAC 权限边界与零请求守卫
// ---------------------------------------------------------------------------

describe('RBAC 权限零请求守卫（tasks 3.6）', () => {
  test('Member（无 ai:confirm）：DOM 绝对无确认按钮/触发器，权限提示条常驻，零 confirm 请求', async () => {
    setAuth(['ai:view', 'ai:trigger'])
    apiMock.save.mockResolvedValueOnce({ draftId: 'df_7e3f1a90', status: 'saved' })
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)

    expect(screen.queryByRole('button', { name: /确认并转正项目/ })).toBeNull()
    expect(document.querySelector('[data-confirm-action]')).toBeNull()
    expect(document.querySelector('[data-confirm-trigger]')).toBeNull()
    expect(document.querySelector('[data-next-draft-permission-notice]')).not.toBeNull()

    // 其余安全操作仍可用；任何点击都不触发 confirm 请求
    fireEvent.click(screen.getByRole('button', { name: /保存为草稿/ }))
    await waitFor(() => expect(apiMock.save).toHaveBeenCalledTimes(1))
    expect(apiMock.confirm).not.toHaveBeenCalled()
  })

  test('二次确认弹窗自身防御：无权限直接不渲染（杜绝控制台绕过 setState 触发）', () => {
    setAuth(['ai:view', 'ai:trigger'])
    useAiDraftConfirmStore.setState({ confirmModalOpen: true })
    enterReviewingStore()
    const { container } = render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  test('PM（具备 ai:confirm）：按钮渲染且权限提示条不出现', () => {
    render(<NextDraftActionBar draftId="df_7e3f1a90" validation={makeValidation()} />)
    expect(screen.getByRole('button', { name: /确认并转正项目/ })).toBeInTheDocument()
    expect(document.querySelector('[data-next-draft-permission-notice]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3.7 ReviewPanel 总装：PartiallyAcceptPanel / 弹窗挂载 / ESC 协调
// ---------------------------------------------------------------------------

describe('NextDraftReviewPanel 总装（tasks 3.7）', () => {
  test('总装：控制栏 + 操作栏 + 弹窗状态机挂载（成功视窗仅在 confirmed 终态呈现）', () => {
    enterReviewingStore()
    render(<NextDraftReviewPanel />)

    expect(screen.getByText('局部接受控制栏（Mock）')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '草案审查面板' })).toBeInTheDocument()
    expect(document.querySelector('[data-confirm-modal]')).toBeNull()
    expect(document.querySelector('[data-success-modal-backdrop]')).toBeNull()
    expect(document.querySelector('[data-autofix-modal]')).toBeNull()
  })

  test('点击转正 → 弹窗弹出；全局 ESC 关闭；提交中 ESC 绝对拦截', () => {
    enterReviewingStore()
    render(<NextDraftReviewPanel />)

    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    expect(screen.getByRole('dialog', { name: '确认转正最终确认' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '确认转正最终确认' })).toBeNull()
    expect(apiMock.confirm).not.toHaveBeenCalled()

    // 提交中 ESC 拦截
    act(() => {
      useAiDraftConfirmStore.setState({ confirmModalOpen: true, isConfirming: true })
    })
    render(<NextDraftConfirmModal draftId="df_7e3f1a90" onError={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useAiDraftConfirmStore.getState().confirmModalOpen).toBe(true)
  })

  test('autoFix 状态开启时挂载真实自动修正复核弹窗（store 驱动，展示 diffs 与版本号）', () => {
    act(() => {
      useAiDraftConfirmStore.setState({
        autoFixModalState: {
          open: true,
          diffs: [
            { path: 'tasks[t1].durationDays', before: 400, after: 365, reason: '超出上限自动收敛' },
          ],
          version: 3,
        },
      })
    })
    enterReviewingStore()
    render(<NextDraftReviewPanel />)

    const dialog = screen.getByRole('dialog', { name: '自动修正复核' })
    expect(dialog.textContent).toContain('1 处自动修正')
    expect(dialog.textContent).toContain('已复核并载入新版本草案')
    expect(document.querySelector('[data-autofix-version]')?.textContent).toBe('v3')
    // 修正对比呈现（修正前/修正后/原因，W2 AutoFixModal 消费 store 中 diffs）
    expect(dialog.textContent).toContain('修正前')
    expect(dialog.textContent).toContain('修正后')
    expect(dialog.textContent).toContain('超出上限自动收敛')
  })

  test('全链路：守卫通过 → 二次确认 → 落库成功 → 成功视窗 → 导航项目主页', async () => {
    apiMock.confirm.mockResolvedValueOnce(CONFIRM_COUNTS_RESPONSE)
    enterReviewingStore()
    render(<NextDraftReviewPanel />)

    // 守卫通过点击 → 二次确认弹窗
    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    expect(screen.getByRole('dialog', { name: '确认转正最终确认' })).toBeInTheDocument()

    // 弹窗内显式「确认落库」→ 网络请求 → 成功视窗
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    await waitFor(() => {
      expect(apiMock.confirm).toHaveBeenCalledWith(
        'df_7e3f1a90',
        expect.objectContaining({ version: 2, mode: 'all', acknowledgedWarnings: false }),
      )
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    })

    const success = document.querySelector('[data-confirm-success-modal]')
    expect(success).not.toBeNull()
    expect(success?.textContent).toContain('#PROJ-1042')

    // RL-01：成功后文案门禁反向校验——成功视窗出现的「正式转正」措辞仅限成功态
    expect(success?.textContent).toContain('项目已正式转正落库')

    fireEvent.click(screen.getByRole('button', { name: /进入项目主页/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/1042')
    expect(sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 纯函数：失败分类与计数投影（单测直连）
// ---------------------------------------------------------------------------

describe('classifyConfirmFailure / computeDraftConfirmCounts 纯函数', () => {
  test('分类：stale / blocking / autoFix / fatal 各分支', () => {
    expect(
      classifyConfirmFailure({ status: 422, details: { expected: 3, received: 2 } }, 2),
    ).toEqual({ kind: 'stale', expected: 3, received: 2 })
    expect(
      classifyConfirmFailure({ status: 422, details: { blocking: [blockingIssue('HL-007')] } }, 2),
    ).toEqual({ kind: 'blocking', issues: [blockingIssue('HL-007')] })
    expect(
      classifyConfirmFailure(
        {
          status: 422,
          details: { autoFixDiffs: [{ path: 'a', before: 1, after: 2, reason: 'r' }] },
        },
        2,
      ),
    ).toEqual({
      kind: 'autoFix',
      diffs: [{ path: 'a', before: 1, after: 2, reason: 'r' }],
      version: 2,
    })
    expect(classifyConfirmFailure(new TypeError('Failed to fetch'), 2)).toEqual({
      kind: 'fatal',
      message: 'Failed to fetch',
    })
    expect(classifyConfirmFailure({ status: 500 }, 2)).toEqual({
      kind: 'fatal',
      message: '网络连接超时或服务繁忙',
    })
  })

  test('computeDraftConfirmCounts：悬空依赖（两端任一未选）不计入', () => {
    const draft = makeDraft()
    expect(
      computeDraftConfirmCounts(draft, {
        taskIds: ['t1', 't2'],
        wbsNodeIds: ['w1', 'w1-1'],
        acceptanceIds: ['a1'],
        milestoneIds: ['m1'],
        riskHintIds: ['r1'],
        unselectedStrategy: 'discard',
      }),
    ).toEqual({ wbsNodes: 2, tasks: 2, dependencies: 1, milestones: 1, risks: 1 })
  })
})
