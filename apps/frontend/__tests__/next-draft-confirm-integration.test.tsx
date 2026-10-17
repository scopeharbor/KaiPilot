/**
 * v3-ui-next-draft-confirm tasks 4.1-4.3 —— 审查 → 局部接受 → 就地编辑 → 确认转正
 * 全链路端到端集成测试（真实组件，仅 Mock 网络层与路由）。
 *
 * 策略：真实 W1/W2/W3 组件 + Mock `@/lib/api-client`（apiFetch/apiRawFetch 单点传输出口）
 * + Mock `next/navigation`；与 `next-draft-review-integration` 同一脉络：经剧场
 * SSE 落定进入审查面板，全链路真实渲染。
 *
 * 覆盖：
 * - 4.1 全链路：剧场落定 → 审查 → 局部选择（父链级联）→ 就地改工期（假设徽章消除）→
 *   save_as_draft 策略 → Warning 勾选（双载体）→ 二次确认汇总 → POST confirm 载荷
 *   逐字段断言 → 成功视窗（#PROJ 编号 + 5 卡计数 + 审计回执）→ 导航新轨项目空间 /next/projects/:id；
 * - 4.2 并发对抗：提交中重复点击单飞（confirm 仅一次）；422 stale → 拉取最新版本恢复；
 *   500 断网 → 勾选与就地编辑现场完整保留 + 原地重试；
 * - 4.3 红线文案：成功前全程零「项目已创建/已写入数据库」措辞（RL-01）；
 *   成功视窗零草案 JSON / 推断全文泄露（RL-12）；无权限角色 DOM 零确认按钮 + 零 confirm 请求（RL-06）。
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AI_INTENT_SCHEMA_VERSION,
  PROJECT_DRAFT_MODULES,
  type AiMarkerSource,
  type ConfirmedProjectContext,
  type DraftValidationReport,
  type Marked,
  type ParsedIntent,
  type ProjectDraft,
  type ProjectDraftDetail,
  type ProjectDraftMeta,
} from '@aiproj/types'
import NextCreatePage from '@/app/(next)/next/create/page'
import { formatDraftShortCode } from '@/components/next/theater/TheaterSettledView'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAuthStore } from '@/stores/auth-store'
import { AI_DRAFT_PROGRESS_CURSOR_KEY } from '@/lib/ai-draft/progress-cursor'
import {
  completedDraftEvent,
  createMockSseStream,
  deltaEvent,
  moduleCompletedEvent,
  progressEvent,
  responseOf,
  sseFrame,
  startedEvent,
  TEST_DRAFT_ID,
} from './_next-theater-sse-fixtures'

// ---------------------------------------------------------------------------
// Module mocks（网络层单点 + 路由 + 意图 API）
// ---------------------------------------------------------------------------

const networkMock = vi.hoisted(() => ({
  apiRawFetch: vi.fn(),
  apiFetch: vi.fn(),
}))

// 就绪页的项目理解会订阅实时输出（只读旁路）：模拟掉，免得它抢走给草案生成准备的 SSE 模拟流。
vi.mock('@/lib/ai-draft/live-output-client', () => ({
  newLiveOutputId: () => '5b1f0c1e-3d2a-4c6b-9e8f-0a1b2c3d4e5f',
  useLiveOutputLanes: () => ({ lanes: [], totalChars: 0 }),
}))
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, apiRawFetch: networkMock.apiRawFetch, apiFetch: networkMock.apiFetch }
})

vi.mock('@/lib/api/ai-intent', () => ({
  aiIntentApi: {
    analyze: vi.fn(),
    explainStream: vi.fn(),
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
  useParams: () => ({ draftId: TEST_DRAFT_ID }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// Fixtures：与 review-integration 同构的 9 模块草案（2 任务 / 4 WBS 节点 / 1 依赖）
// ---------------------------------------------------------------------------

const VALID_INTENT = '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计'

function marked<T>(
  value: T,
  source: AiMarkerSource = 'inferred',
  needsConfirmation = false,
  confidence = 0.85,
  reason = 'AI 依据历史项目经验推断',
): Marked<T> {
  return { value, marker: { confidence, source, reason, needsConfirmation } }
}

function richDraft(): ProjectDraft {
  return {
    schemaVersion: '1.0',
    projectType: 'software',
    charter: {
      title: marked('企业级敏捷协作平台', 'inferred', false, 0.92, '依据项目核心目标提炼'),
      vision: marked('让跨部门项目协作高效透明', 'inferred', false, 0.85, '依据用户愿景描述推断'),
      scope: marked(
        '任务看板、工时统计与里程碑跟踪',
        'inferred',
        false,
        0.85,
        '依据一句话需求拆分业务范围',
      ),
      objectives: marked(
        ['搭建跨部门任务看板', '上线工时统计模块'],
        'inferred',
        false,
        0.85,
        '依据交付物清单推断阶段目标',
      ),
      successCriteria: marked(
        ['看板任务流转可用', '工时报表导出可用'],
        'inferred',
        false,
        0.85,
        '依据验收诉求推断',
      ),
      startDate: marked('2026-09-01', 'inferred', true, 0.7, '依据常见项目启动节奏推断开工日期'),
      endDate: marked('2026-12-31', 'inferred', true, 0.7, '依据工期与里程碑反推结束日期'),
    },
    wbs: [
      {
        id: 'w1',
        parentId: null,
        outlineCode: '1',
        isLeaf: false,
        isNote: false,
        children: [],
        name: marked('核心服务开发', 'inferred', false, 0.9, '依据交付物拆分顶层工作包'),
        description: marked('看板与工时两大核心服务', 'inferred', false, 0.9, '概述性描述'),
      },
      {
        id: 'w1-1',
        parentId: 'w1',
        outlineCode: '1.1',
        isLeaf: true,
        isNote: false,
        children: [],
        name: marked('任务看板模块', 'inferred', false, 0.9, '依据首要交付物命名'),
        description: marked('任务卡片流转与看板视图', 'inferred', false, 0.9, '概述性描述'),
      },
      {
        id: 'w1-2',
        parentId: 'w1',
        outlineCode: '1.2',
        isLeaf: true,
        isNote: false,
        children: [],
        name: marked('工时统计模块', 'inferred', false, 0.9, '依据次要交付物命名'),
        description: marked('工时登记与统计报表', 'inferred', false, 0.9, '概述性描述'),
      },
      {
        id: 'w1-3',
        parentId: 'w1',
        outlineCode: '1.3',
        isLeaf: true,
        isNote: true,
        children: [],
        name: marked('需求冻结说明', 'inferred', false, 0.9, '说明节点'),
        description: marked('纯说明节点，不关联任务', 'inferred', false, 0.9, '说明性描述'),
      },
    ],
    tasks: [
      {
        id: 't1',
        wbsNodeId: 'w1-1',
        status: 'not_started',
        name: marked('搭建任务看板', 'inferred', false, 0.9, '依据 WBS 叶节点命名'),
        description: marked('看板视图与任务流转', 'inferred', false, 0.9, '概述性描述'),
        durationDays: marked(
          10,
          'inferred',
          true,
          0.75,
          '依据类似算法复杂度与历史交付经验推算工期需 10 个工作日',
        ),
        startDate: marked('2026-09-01', 'inferred', true, 0.7, '依据里程碑排期推断'),
        endDate: marked('2026-09-14', 'inferred', true, 0.7, '依据工期推算'),
        assigneeHint: marked('王启明', 'inferred', true, 0.6, '依据角色分工推断负责人'),
        assigneeRoleIds: marked(['app-dev'], 'inferred', true, 0.6, '依据技术栈推断角色'),
      },
      {
        id: 't2',
        wbsNodeId: 'w1-2',
        status: 'not_started',
        name: marked('开发工时统计', 'inferred', false, 0.9, '依据 WBS 叶节点命名'),
        description: marked('工时登记与报表', 'inferred', false, 0.9, '概述性描述'),
        durationDays: marked(
          15,
          'inferred',
          true,
          0.75,
          '依据数据模块复杂度推算工期需 15 个工作日',
        ),
        startDate: marked('2026-09-15', 'inferred', true, 0.7, '依据前置任务完成后顺延'),
        endDate: marked('2026-10-05', 'inferred', true, 0.7, '依据工期推算'),
        assigneeHint: marked('李思远', 'inferred', true, 0.6, '依据角色分工推断负责人'),
      },
    ],
    dependencies: [
      {
        id: 'd1',
        predecessorId: 't1',
        successorId: 't2',
        type: 'FS',
        lagDays: marked(1, 'inferred', true, 0.7, '依据看板上线后启动工时模块推断滞后 1 天'),
      },
    ],
    acceptanceCriteria: [
      {
        id: 'a1',
        statement: marked(
          '任务看板可在浏览器正常打开并流转',
          'inferred',
          false,
          0.9,
          '依据验收诉求逐条转化',
        ),
        linkedTaskId: 't1',
        linkedSuccessIndex: 0,
      },
    ],
    resourceHints: [],
    riskHints: [
      {
        id: 'k1',
        description: marked('跨部门需求变更风险', 'inferred', false, 0.8, '依据多部门协作特征识别'),
        level: marked('high', 'inferred', true, 0.7, '依据需求变更频率经验研判为高风险'),
        mitigation: marked(
          '每周对齐需求优先级',
          'inferred',
          false,
          0.8,
          '依据常见风险管理实践建议',
        ),
      },
    ],
    milestoneHints: [
      {
        id: 'm1',
        name: marked('看板上线', 'inferred', false, 0.9, '依据首个交付物命名'),
        targetDate: marked('2026-09-30', 'inferred', true, 0.7, '依据任务排期推断里程碑日期'),
        linkedTaskIds: ['t1'],
      },
    ],
    ganttPreview: {
      startDate: marked('2026-09-01', 'inferred', true, 0.7, '依据整体排期推断'),
      endDate: marked('2026-12-31', 'inferred', true, 0.7, '依据整体排期推断'),
      totalDurationDays: marked(120, 'inferred', true, 0.75, '依据起止区间推算总工期'),
      criticalPathTaskIds: ['t1', 't2'],
      phaseCount: 3,
    },
  }
}

function richMeta(): ProjectDraftMeta {
  return {
    schemaVersion: '1.0',
    projectType: 'software',
    structuredStrategy: 'native',
    consistency: 'strict',
    fallbackUsed: false,
    provider: 'mock-provider',
    model: 'mock-model',
    usingRealAdapter: false,
    appliedFixes: [],
    moduleCounts: {
      wbsNodes: 4,
      tasks: 2,
      dependencies: 1,
      acceptanceCriteria: 1,
      resourceHints: 0,
      riskHints: 1,
      milestoneHints: 1,
    },
  }
}

/** 可通过校验的权威报告：1 条 Warning（HL-004）→ 必须勾选复核才可转正。 */
function validationClean(): DraftValidationReport {
  return {
    overallRiskLevel: 'low',
    confidenceScore: 94,
    dimensionScores: {
      factualAccuracy: 92,
      logicalConsistency: 90,
      assumptionClarity: 88,
      completeness: 96,
      numericPlausibility: 91,
    },
    blocking: [],
    warning: [
      {
        ruleId: 'HL-004',
        severity: 'warning',
        message: '假设清晰度警告：工期推断依赖历史同类项目数据',
        path: 'tasks[0].durationDays',
      },
    ],
    info: [],
    ruleResults: [],
    autoFixDiffs: [],
    canConfirm: true,
  }
}

/** 转正成功响应（apiFetch mock 为「解包后」语义：直接业务数据）。 */
const CONFIRM_RESPONSE = {
  projectId: 1042,
  createdCounts: {
    wbsNodes: 2,
    tasks: 1,
    dependencies: 0,
    milestones: 1,
    acceptanceCriteria: 0,
    risks: 1,
  },
}

function makeLatestDetail(): ProjectDraftDetail {
  return {
    draftId: TEST_DRAFT_ID,
    version: 2,
    status: 'reviewing',
    generationState: 'settled',
    projectType: 'software',
    draft: richDraft(),
    meta: richMeta(),
    validation: validationClean(),
    events: [],
  }
}

const parsedIntent: ParsedIntent = {
  schemaVersion: AI_INTENT_SCHEMA_VERSION,
  projectType: 'software',
  projectName: '企业级敏捷协作平台',
  objectives: ['搭建跨部门协作平台'],
  deliverables: ['任务看板', '工时统计'],
  timeline: { startDate: '2026-09-01', deadline: '2026-12-01', durationDays: 90 },
  constraints: [],
  entities: [],
  overallConfidence: 0.85,
}

const confirmedContext: ConfirmedProjectContext = {
  schemaVersion: AI_INTENT_SCHEMA_VERSION,
  rawInput: VALID_INTENT,
  parsedIntent,
  resolvedFields: {
    teamSize: marked('6 人', 'explicit'),
    techStack: marked(['Next.js', 'AdonisJS'], 'explicit'),
  },
  assumptions: {
    methodology: marked('敏捷迭代', 'default', true),
  },
  unresolvedCriticalFields: [],
  unansweredOptionalFields: [],
}

// ---------------------------------------------------------------------------
// 网络层与状态辅助
// ---------------------------------------------------------------------------

type ConfirmHandler = (path: string, init?: RequestInit) => unknown

interface ApiFetchHandlers {
  confirm?: ConfirmHandler
  detail?: (path: string) => unknown
  save?: (path: string) => unknown
}

/** 默认 apiFetch 行为：save/confirm/详情快照三类端点可注入，其余显式报错。 */
function installApiFetch(handlers: ApiFetchHandlers = {}): void {
  networkMock.apiFetch.mockImplementation((path: unknown, init?: RequestInit) => {
    const url = String(path)
    if (url.endsWith('/save')) {
      return Promise.resolve(
        handlers.save
          ? handlers.save(url)
          : { draftId: TEST_DRAFT_ID, version: 1, status: 'saved' },
      )
    }
    if (url.includes('/confirm')) {
      return Promise.resolve(handlers.confirm ? handlers.confirm(url, init) : CONFIRM_RESPONSE)
    }
    if (/\/ai\/project-drafts\/[^/]+$/.test(url)) {
      return Promise.resolve(handlers.detail ? handlers.detail(url) : makeLatestDetail())
    }
    return Promise.reject(new Error(`unexpected apiFetch ${url}`))
  })
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

function resetDraft() {
  useAiProjectDraftStore.setState({
    schemaVersion: '1.0',
    userId: 1,
    organizationId: 1,
    status: 'ready',
    rawInput: VALID_INTENT,
    cards: [],
    answers: {},
    parsedIntent,
    context: confirmedContext,
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

/** 转正交互态复位：选择集置空 → 审查面板自动 initSelection 重建全选（集成接线语义）。 */
function resetConfirmFlow() {
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
    unlinkedAlertTaskId: null,
  })
}

function fullSuccessStream(
  draft: ProjectDraft = richDraft(),
  meta: ProjectDraftMeta = richMeta(),
  validation: DraftValidationReport = validationClean(),
): ReadableStream<Uint8Array> {
  let seq = 1
  const frames = [sseFrame('draft.started', startedEvent(seq++))]
  for (const module of PROJECT_DRAFT_MODULES) {
    frames.push(sseFrame('module.delta', deltaEvent(module, seq++)))
    frames.push(sseFrame('module.completed', moduleCompletedEvent(module, seq++)))
  }
  frames.push(sseFrame('draft.progress', progressEvent(seq++, 'validating')))
  frames.push(sseFrame('draft.completed', completedDraftEvent(seq, draft, meta, validation)))
  return createMockSseStream(frames)
}

/** 主链路进入审查：剧场就绪 → 生成落定 → 点击「进入草案审查」→ 面板展开。 */
async function enterReviewThroughTheater(
  validation: DraftValidationReport = validationClean(),
): Promise<void> {
  networkMock.apiRawFetch.mockImplementationOnce(() =>
    Promise.resolve(responseOf(fullSuccessStream(richDraft(), richMeta(), validation))),
  )
  render(<NextCreatePage />)
  fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))
  await screen.findByText(`#DRAFT-${formatDraftShortCode(TEST_DRAFT_ID)}`)
  fireEvent.click(screen.getByRole('button', { name: /进入草案审查/ }))
  await screen.findByRole('region', { name: '草案审查面板' })
}

/** 局部选择流：切局部 → 清空 → 勾选 t2（验证祖先父链级联），返回后继续断言。 */
function drivePartialSelectionOnT2() {
  fireEvent.click(document.querySelector('[data-accept-mode-partial]') as HTMLElement)
  fireEvent.click(document.querySelector('[data-clear-all]') as HTMLElement)
  expect(useAiDraftConfirmStore.getState().selection.taskIds).toEqual([])

  // 打开任务清单 tab，勾选 t2 行
  fireEvent.click(screen.getByRole('tab', { name: '任务清单' }))
  const t2Row = document.querySelector('[data-task-row][data-task-id="t2"]') as HTMLElement
  fireEvent.click(t2Row.querySelector('[data-task-checkbox]') as HTMLElement)

  // 父链级联：t2 的直接宿主 w1-2 与祖先根节点 w1 自动进入选择集
  const selection = useAiDraftConfirmStore.getState().selection
  expect([...selection.taskIds]).toEqual(['t2'])
  expect([...selection.wbsNodeIds].sort()).toEqual(['w1', 'w1-2'])
}

/** 就地编辑 t2 工期：15 → 8（失焦提交，AIMarker 升级 explicit）。 */
function editT2DurationTo(value: string) {
  const t2Row = document.querySelector('[data-task-row][data-task-id="t2"]') as HTMLElement
  fireEvent.click(t2Row.querySelector('[data-edit-trigger="duration"]') as HTMLElement)
  const input = t2Row.querySelector('[data-edit-input="duration"]') as HTMLInputElement
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
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
  window.history.replaceState(null, '', '/')
  networkMock.apiRawFetch.mockReset()
  networkMock.apiFetch.mockReset()
  navMock.push.mockReset()
  navMock.replace.mockReset()
  resetDraft()
  resetConfirmFlow()
  setAuth(['ai:view', 'ai:trigger', 'ai:confirm'])
  installApiFetch()
})

// ---------------------------------------------------------------------------
// 4.1 全链路：局部接受 → 编辑 → 策略 → 复核 → 二次确认 → 落库 → 成功 → 导航
// ---------------------------------------------------------------------------

describe('审查转正全链路（tasks 4.1）', () => {
  test('剧场落定 → 局部勾选父链级联 → 改工期（假设消除）→ save_as_draft → Warning 复核 → confirm 载荷 → 成功视窗 → 项目主页导航', async () => {
    await enterReviewThroughTheater()
    await screen.findByRole('region', { name: '草案审查面板' })

    // 审查面板选择集自动初始化（集成接线）：默认全部接受 = 完整全选
    const confirmStore = useAiDraftConfirmStore.getState()
    expect(confirmStore.mode).toBe('all')
    expect(confirmStore.selection.taskIds).toEqual(['t1', 't2'])
    expect(confirmStore.selection.wbsNodeIds).toHaveLength(4)

    // 存在 Warning 未复核：转正按钮禁用（5 项守卫之 Warning 勾选）
    const confirmButton = screen.getByRole('button', { name: /确认并转正项目/ })
    expect(confirmButton).toHaveProperty('disabled', true)

    // 局部选择 + 父链级联
    drivePartialSelectionOnT2()
    expect(document.querySelector('[data-selected-stats]')?.textContent).toContain(
      '已选 1/2 项任务，2/4 个 WBS 分支',
    )
    // 仅 t2 选中时 d1（t1→t2）悬空：解绑警示横幅出现
    expect(document.querySelector('[data-dangling-banner]')).not.toBeNull()

    // 就地编辑 t2 工期 15 → 8：假设徽章消除（explicit 升级）
    const t2RowBefore = document.querySelector('[data-task-row][data-task-id="t2"]') as HTMLElement
    // 编辑前 4 枚置信度徽章（名称/工期/起止/负责人）
    expect(t2RowBefore.querySelectorAll('[data-marked-confidence]').length).toBe(4)
    editT2DurationTo('8')
    const draftAfterEdit = useAiProjectDraftStore.getState().draft as ProjectDraft
    const t2Edited = draftAfterEdit.tasks.find(
      (task) => task.id === 't2',
    ) as ProjectDraft['tasks'][number]
    expect(t2Edited.durationDays.value).toBe(8)
    expect(t2Edited.durationDays.marker.source).toBe('explicit')
    expect(useAiProjectDraftStore.getState().pendingModifications).toEqual([
      { path: 'tasks[t2].durationDays', value: 8 },
    ])
    const t2Row = document.querySelector('[data-task-row][data-task-id="t2"]') as HTMLElement
    // 工期单元格的推断置信度徽章被「已人工修正」explicit 徽章替代（其余字段徽章保留 3 枚）
    expect(t2Row.querySelector('[data-field-explicit]')?.textContent).toContain('已人工修正')
    expect(t2Row.querySelectorAll('[data-marked-confidence]').length).toBe(3)
    expect(t2Row.textContent).toContain('8 天')

    // 未选策略：save_as_draft（局部模式单选组）
    fireEvent.click(document.querySelector('[data-strategy="save_as_draft"]') as HTMLElement)
    expect(useAiDraftConfirmStore.getState().selection.unselectedStrategy).toBe('save_as_draft')

    // Warning 复核：审查页只保留操作栏（紧挨转正按钮）那一条；PartialAcceptPanel 单独使用时才显示自己的
    const warningCheckboxes = document.querySelectorAll(
      '[data-ack-warnings-checkbox], [data-warning-ack-checkbox]',
    )
    expect(warningCheckboxes.length).toBe(1)
    fireEvent.click(document.querySelector('[data-warning-ack-checkbox]') as HTMLElement)
    expect(useAiDraftConfirmStore.getState().acknowledgedWarnings).toBe(true)

    // 守卫全放行：按钮激活 → 唤起二次确认弹窗
    expect(screen.getByRole('button', { name: /确认并转正项目/ })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    const dialog = screen.getByRole('dialog', { name: '确认转正最终确认' })
    expect(withinText(dialog, '企业级敏捷协作平台')).toBe(true)
    expect(withinText(dialog, '局部选择')).toBe(true)
    expect(withinText(dialog, '保留为后续草稿')).toBe(true)
    // 汇总计数：WBS 2（w1/w1-2）、任务 1、依赖 0（d1 悬空）、里程碑 0、风险 0
    const countOf = (key: string): string | null | undefined =>
      document.querySelector(`[data-count-key="${key}"] [data-count-value]`)?.textContent
    expect(countOf('wbsNodes')).toBe('2')
    expect(countOf('tasks')).toBe('1')
    expect(countOf('dependencies')).toBe('0')
    expect(countOf('milestones')).toBe('0')
    expect(countOf('risks')).toBe('0')

    // 确认落库：POST confirm 载荷逐字段断言
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    await waitFor(() => {
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    })

    const confirmCalls = networkMock.apiFetch.mock.calls.filter(([path]) =>
      String(path).includes('/confirm'),
    )
    expect(confirmCalls).toHaveLength(1)
    const [confirmPath, confirmInit] = confirmCalls[0] as [string, RequestInit | undefined]
    expect(confirmPath).toBe(`/ai/project-drafts/${TEST_DRAFT_ID}/confirm`)
    expect(confirmInit?.method).toBe('POST')
    const payload = JSON.parse(String(confirmInit?.body)) as {
      version: number
      mode: string
      selection: {
        taskIds: string[]
        wbsNodeIds: string[]
        acceptanceIds: string[]
        milestoneIds: string[]
        riskHintIds: string[]
        unselectedStrategy: string
      }
      modifications: Array<{ path: string; value: string | number | boolean | string[] }>
      acknowledgedWarnings: boolean
    }
    expect(payload.version).toBe(1)
    expect(payload.mode).toBe('partial')
    expect(payload.acknowledgedWarnings).toBe(true)
    expect(payload.modifications).toEqual([{ path: 'tasks[t2].durationDays', value: 8 }])
    // 选择集为无序集合语义：wbsNodeIds 排序后比对（t2 的直接宿主 w1-2 + 祖先根 w1）
    expect(payload.selection.taskIds).toEqual(['t2'])
    expect([...payload.selection.wbsNodeIds].sort()).toEqual(['w1', 'w1-2'])
    expect(payload.selection.acceptanceIds).toEqual([])
    expect(payload.selection.milestoneIds).toEqual([])
    expect(payload.selection.riskHintIds).toEqual([])
    expect(payload.selection.unselectedStrategy).toBe('save_as_draft')

    // 成功视窗：项目编号 + 5 卡计数 + 审计回执
    const success = document.querySelector('[data-confirm-success-modal]') as HTMLElement
    expect(success).not.toBeNull()
    expect(success.querySelector('[data-proj-number]')?.textContent).toBe('#PROJ-1042')
    expect(success.textContent).toContain('企业级敏捷协作平台')
    expect(success.querySelectorAll('[data-count-card]')).toHaveLength(5)
    expect(
      success.querySelector('[data-count-key="wbsNodes"] [data-count-card-value]')?.textContent,
    ).toBe('2')
    expect(
      success.querySelector('[data-count-key="tasks"] [data-count-card-value]')?.textContent,
    ).toBe('1')
    expect(
      success.querySelector('[data-count-key="dependencies"] [data-count-card-value]')?.textContent,
    ).toBe('0')
    expect(
      success.querySelector('[data-count-key="milestones"] [data-count-card-value]')?.textContent,
    ).toBe('1')
    expect(
      success.querySelector('[data-count-key="risks"] [data-count-card-value]')?.textContent,
    ).toBe('1')
    expect(success.querySelector('[data-audit-receipt]')?.textContent).toContain('操作人：王启明')
    expect(success.querySelector('[data-audit-receipt]')?.textContent).toContain(
      '已记入组织审计日志',
    )

    // 进入项目主页：清游标 + 导航新轨项目空间 /next/projects/1042
    fireEvent.click(screen.getByRole('button', { name: /进入项目主页/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/1042')
    expect(sessionStorage.getItem(AI_DRAFT_PROGRESS_CURSOR_KEY)).toBeNull()
  })
})

function withinText(element: HTMLElement, text: string): boolean {
  return (element.textContent ?? '').includes(text)
}

// ---------------------------------------------------------------------------
// 4.2 并发对抗与失败恢复
// ---------------------------------------------------------------------------

describe('并发对抗与失败恢复（tasks 4.2）', () => {
  test('提交在途：Spinner + 重复点击绝对拦截，confirm 仅单次发出', async () => {
    const gate: { resolve?: (value: typeof CONFIRM_RESPONSE) => void } = {}
    installApiFetch({
      confirm: () =>
        new Promise((resolve) => {
          gate.resolve = resolve
        }),
    })
    await enterReviewThroughTheater()
    await screen.findByRole('region', { name: '草案审查面板' })

    fireEvent.click(document.querySelector('[data-warning-ack-checkbox]') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    const dialog = screen.getByRole('dialog', { name: '确认转正最终确认' })
    fireEvent.click(within(dialog).getByRole('button', { name: /确认落库/ }))

    // 在途：弹窗与操作栏双按钮呈 loading，重复点击拦截（confirm 单飞）
    const committing = within(dialog).getByRole('button', { name: /正在写入正式项目库…/ })
    expect(committing).toHaveProperty('disabled', true)
    expect(committing.querySelector('.nx-review-spin')).not.toBeNull()
    expect(within(dialog).getByRole('button', { name: /取消/ })).toHaveProperty('disabled', true)
    const actionBarConfirm = document.querySelector('[data-confirm-action]') as HTMLButtonElement
    expect(actionBarConfirm).toHaveProperty('disabled', true)
    expect(actionBarConfirm.textContent).toContain('正在写入正式项目库')

    fireEvent.click(committing)
    fireEvent.click(committing)
    const confirmCalls = networkMock.apiFetch.mock.calls.filter(([path]) =>
      String(path).includes('/confirm'),
    )
    expect(confirmCalls).toHaveLength(1)

    act(() => gate.resolve?.(CONFIRM_RESPONSE))
    await waitFor(() => {
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    })
    expect(
      networkMock.apiFetch.mock.calls.filter(([path]) => String(path).includes('/confirm')),
    ).toHaveLength(1)
  })

  test('422 stale：版本冲突横幅（当前 v1，最新 v2）→ 拉取最新版本恢复审查现场', async () => {
    installApiFetch({
      confirm: () =>
        Promise.reject({
          status: 422,
          code: 'DRAFT_VERSION_CONFLICT',
          message: '草案版本已过期',
          details: { expected: 2, received: 1 },
        }),
    })
    await enterReviewThroughTheater()
    await screen.findByRole('region', { name: '草案审查面板' })

    fireEvent.click(document.querySelector('[data-warning-ack-checkbox]') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))

    await screen.findByRole('alert')
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('当前 v1，最新 v2')
    expect(banner.textContent).toContain('无法基于过期版本转正')

    fireEvent.click(screen.getByRole('button', { name: /拉取最新版本重审/ }))
    await waitFor(() => {
      expect(useAiProjectDraftStore.getState().draftVersion).toBe(2)
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('reviewing')
    })
    // 冲突横幅清除 + 选择集随新版本重建全选
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useAiDraftConfirmStore.getState().selection.taskIds).toEqual(['t1', 't2'])
    // 恢复后可再次发起（Warning 复核需重新勾选）
    expect(screen.getByRole('button', { name: /确认并转正项目/ })).toHaveProperty('disabled', true)
  })

  test('500 断网：未写入任何正式数据 + 勾选与就地编辑现场保留 + 原地重试成功', async () => {
    installApiFetch({
      confirm: () =>
        Promise.reject({ status: 500, code: 'AI_SERVICE_ERROR', message: '服务内部异常' }),
    })
    await enterReviewThroughTheater()
    await screen.findByRole('region', { name: '草案审查面板' })

    // 局部勾选 + 就地编辑现场
    drivePartialSelectionOnT2()
    editT2DurationTo('8')
    fireEvent.click(document.querySelector('[data-warning-ack-checkbox]') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))

    await screen.findByText(/未写入任何正式数据/)
    expect(screen.getByRole('alert').textContent).toContain('转正请求失败：网络连接超时或服务繁忙')

    // 现场完整保留：勾选集与就地编辑不丢
    const selection = useAiDraftConfirmStore.getState().selection
    expect(selection.taskIds).toEqual(['t2'])
    expect(selection.wbsNodeIds.sort()).toEqual(['w1', 'w1-2'])
    expect(useAiProjectDraftStore.getState().pendingModifications).toEqual([
      { path: 'tasks[t2].durationDays', value: 8 },
    ])

    // 原地重试：重开二次确认弹窗（不自动发请求，RL-01 显式确认）
    fireEvent.click(screen.getByRole('button', { name: /重试转正/ }))
    expect(screen.getByRole('dialog', { name: '确认转正最终确认' })).toBeInTheDocument()
    expect(
      networkMock.apiFetch.mock.calls.filter(([path]) => String(path).includes('/confirm')),
    ).toHaveLength(1)

    // 重试成功：以既有现场落库
    installApiFetch()
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    await waitFor(() => {
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    })
    expect(document.querySelector('[data-confirm-success-modal]')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4.3 红线文案：RL-01 成功前零落库措辞 / RL-12 无敏感全文 / RL-06 零请求守卫
// ---------------------------------------------------------------------------

describe('红线文案与零请求守卫（tasks 4.3）', () => {
  test('RL-01：成功落库前全程零「项目已创建/已写入数据库」措辞（含失败横幅态）', async () => {
    installApiFetch({
      confirm: () =>
        Promise.reject({ status: 500, code: 'AI_SERVICE_ERROR', message: '服务内部异常' }),
    })
    await enterReviewThroughTheater()
    await screen.findByRole('region', { name: '草案审查面板' })

    const scanBody = (): string[] =>
      document.body.textContent === null
        ? []
        : FORBIDDEN_COPY.filter((needle) => (document.body.textContent as string).includes(needle))

    // 审查态（含任务表、控制栏、警告条）
    drivePartialSelectionOnT2()
    expect(scanBody()).toEqual([])

    // 二次确认弹窗打开态
    fireEvent.click(document.querySelector('[data-warning-ack-checkbox]') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    expect(screen.getByRole('dialog', { name: '确认转正最终确认' })).toBeInTheDocument()
    expect(scanBody()).toEqual([])

    // 失败横幅态（500）
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))
    await screen.findByText(/未写入任何正式数据/)
    expect(scanBody()).toEqual([])
  })

  test('RL-12：成功视窗不泄露完整草案 JSON / 未脱敏推断全文', async () => {
    await enterReviewThroughTheater()
    await screen.findByRole('region', { name: '草案审查面板' })

    fireEvent.click(document.querySelector('[data-warning-ack-checkbox]') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /确认并转正项目/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认落库/ }))

    await waitFor(() => {
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('confirmed')
    })
    const successText = document.querySelector('[data-confirm-success-modal]')?.textContent ?? ''
    expect(successText).not.toContain('schemaVersion')
    expect(successText).not.toContain('ganttPreview')
    expect(successText).not.toContain('依据类似算法复杂度与历史交付经验推算工期需 10 个工作日')
    expect(successText).not.toContain('marker')
  })

  test('RL-06：无 ai:confirm 权限（Member）DOM 零确认按钮/触发器，客户端零 confirm 请求', async () => {
    setAuth(['ai:view', 'ai:trigger'])
    await enterReviewThroughTheater()
    await screen.findByRole('region', { name: '草案审查面板' })

    expect(document.querySelector('[data-confirm-action]')).toBeNull()
    expect(document.querySelector('[data-confirm-trigger]')).toBeNull()
    expect(screen.queryByRole('button', { name: /确认并转正项目/ })).toBeNull()
    // 权限提示条常驻（spec 文案语义）
    expect(document.querySelector('[data-next-draft-permission-notice]')).not.toBeNull()

    // 全程零 confirm 请求（无任何可点击入口可达）
    expect(
      networkMock.apiFetch.mock.calls.filter(([path]) => String(path).includes('/confirm')),
    ).toHaveLength(0)
    expect(
      networkMock.apiRawFetch.mock.calls.filter(([path]) => String(path).includes('/confirm')),
    ).toHaveLength(0)
  })
})
