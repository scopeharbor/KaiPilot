/**
 * v3-ui-next-draft-review-panel tasks 4.1-4.3 —— 审查空间全链路端到端集成测试。
 *
 * 策略：**真实 W1/W2/W3 组件 + Mock 网络层注入**（替换 `@/lib/api-client` 的
 * apiRawFetch / apiFetch 为唯一传输出口），与 `next-theater-generation-integration`
 * 同一络：真实 SSE 客户端消费可控传输帧，审查面板四区 / 自检报告 / 假设清单 /
 * Diff / 操作栏全部真实渲染，仅传输可控。
 *
 * 覆盖：
 * - T1 剧场落定 →「进入草案审查」→ 审查面板就地展开 + URL replaceState 协同
 *   （?draftId=...&view=review）→ 顶栏 / 章程 / 五维报告 / 假设清单 / Diff 回显；
 * - T2 模块检视四区：WBS 树 / 任务表 / 甘特预览 / 配套折叠区回显；
 * - T3 Blocking 阻断：确认按钮强制 disabled + Tooltip 阻断解释（RL-02），
 *   阻断态下保存 / 重试仍可用；
 * - T4 保存为草稿闭环：POST .../save → enterSaved → 落定视图回显；
 *   RL-01：全程零 confirm 请求、零可编辑输入控件；
 * - T5 红线文案全扫（task 4.2）：审查面板全态 DOM 文本 + aria-* 属性杜绝
 *   「项目已创建」「已写入数据库」类措辞；跨租户 404 中性空态零泄露词（RL-05）；
 * - T6 精确档降级与 A11y（task 4.3）：`data-immersion="precise"` 与
 *   `prefers-reduced-motion: reduce` 下呼吸脉冲规则强制停用；Tabs 键盘
 *   ArrowLeft/ArrowRight/Home/End 导航；ARIA tablist/tab/aria-selected 与
 *   折叠区 aria-expanded/aria-controls 双通道断言。
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  type ProjectDraftMeta,
} from '@aiproj/types'
import NextCreatePage from '@/app/(next)/next/create/page'
import NextDraftReviewRoute from '@/app/(next)/next/draft/[draftId]/page'
import { formatDraftShortCode } from '@/components/next/theater/TheaterSettledView'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAiDraftConfirmStore } from '@/stores/ai-draft-confirm-store'
import { useAuthStore } from '@/stores/auth-store'
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
  useParams: () => ({ draftId: 'df_other_org' }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// Fixtures：丰富 9 模块草案（四区回显全覆盖）
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
      {
        id: 'a2',
        statement: marked('工时统计支持按月导出', 'inferred', false, 0.9, '依据验收诉求逐条转化'),
        linkedTaskId: 't2',
        linkedSuccessIndex: 1,
      },
    ],
    resourceHints: [
      {
        id: 'r1',
        role: marked('前端开发工程师', 'inferred', false, 0.8, '依据技术栈推断岗位'),
        headcount: marked(2, 'inferred', true, 0.7, '依据看板与报表双模块并行推断 2 人'),
        allocationNote: marked('全职投入看板模块', 'inferred', false, 0.8, '依据工作内容推断分工'),
      },
    ],
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
      acceptanceCriteria: 2,
      resourceHints: 1,
      riskHints: 1,
      milestoneHints: 1,
    },
  }
}

/** 可通过校验的权威报告：1 条 Warning（HL-004）+ 1 条自动修正 Diff。 */
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
    autoFixDiffs: [
      {
        path: 'tasks[1].durationDays',
        before: 0,
        after: 1,
        reason: 'HL-002 规则要求单任务工期至少 0.5 天',
      },
    ],
    canConfirm: true,
  }
}

/** 阻断态报告：HL-007 循环依赖（RL-02 禁确认阻断）。 */
function validationBlocked(): DraftValidationReport {
  return {
    overallRiskLevel: 'critical',
    confidenceScore: 61,
    dimensionScores: {
      factualAccuracy: 60,
      logicalConsistency: 52,
      assumptionClarity: 64,
      completeness: 70,
      numericPlausibility: 58,
    },
    blocking: [
      {
        ruleId: 'HL-007',
        severity: 'blocking',
        message: '检测到任务依赖循环：t1 -> t2 -> t1',
        path: 'dependencies',
      },
    ],
    warning: [],
    info: [],
    ruleResults: [],
    autoFixDiffs: [],
    canConfirm: false,
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
    lastEventSequence: 0,
    pendingModifications: [],
  })
}

/** 完整成功流：started + 9 模块 + progress + draft.completed（可注入实体）。 */
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

/**
 * 网络层辅助：默认 apiFetch 行为（mock 替换整个 apiFetch —— 语义为「解包后」数据：
 * 成功 resolve 业务数据；失败 reject ApiError 形状 {status, code, message}）。
 */
function defaultApiFetch(): void {
  networkMock.apiFetch.mockImplementation((path) => {
    const url = String(path)
    if (url.endsWith('/save')) {
      return Promise.resolve({ draftId: TEST_DRAFT_ID, version: 1, status: 'saved' })
    }
    return Promise.reject(new Error(`unexpected apiFetch ${url}`))
  })
}

/** 主链路进入审查：剧场就绪 → 开始生成 → 落定 → 点击「进入草案审查」→ 面板展开。 */
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

/** task 4.2：全 DOM 文本 + aria-* 属性遍历，收集命中禁词的违规描述。 */
function collectForbiddenViolations(needles: string[]): string[] {
  const sources: string[] = [document.body.textContent ?? '']
  const attrNames = ['aria-label', 'aria-live', 'aria-valuetext', 'aria-description', 'title']
  document
    .querySelectorAll('[aria-label], [aria-live], [aria-valuetext], [aria-description], [title]')
    .forEach((element) => {
      for (const name of attrNames) {
        const value = element.getAttribute(name)
        if (value) sources.push(value)
      }
    })
  const violations: string[] = []
  for (const text of sources) {
    for (const needle of needles) {
      if (text.includes(needle)) violations.push(`「${needle}」出现于：${text.slice(0, 100)}`)
    }
  }
  return violations
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
const TENANT_LEAK_WORDS = ['其他组织', '无权访问', '不属于本组织', '租户']

beforeEach(() => {
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  document.documentElement.removeAttribute('data-immersion')
  networkMock.apiRawFetch.mockReset()
  networkMock.apiFetch.mockReset()
  navMock.replace.mockReset()
  navMock.push.mockReset()
  useNextTrackStore.setState({ immersionTier: null })
  resetDraft()
  setAuth(['ai:view', 'ai:trigger', 'ai:confirm'])
  defaultApiFetch()
})

// ---------------------------------------------------------------------------
// 4.1 全链路：进入审查 + URL 协同 + 数据回显
// ---------------------------------------------------------------------------

describe('审查空间全链路（tasks 4.1）', () => {
  test('剧场落定 → 进入草案审查：审查面板就地展开、URL 协同同步、顶栏与章程回显', async () => {
    await enterReviewThroughTheater()

    // store 状态流转 + URL replaceState 协同（?draftId=...&view=review）
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('reviewing')
    expect(window.location.search).toContain(`draftId=${TEST_DRAFT_ID}`)
    expect(window.location.search).toContain('view=review')

    // 顶栏：UID 短码 / 版本 / 完备绿标 / 耗时 / 项目类型
    expect(screen.getByText(`#DRAFT-${formatDraftShortCode(TEST_DRAFT_ID)}`)).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText('9/9 模块已完备')).toBeInTheDocument()
    // 「软件系统」同时出现在剧场 HUD 常驻条与审查顶栏，取全部命中
    expect(screen.getAllByText('软件系统').length).toBeGreaterThan(0)

    // 左侧章程区（默认标签）：标题 / 愿景 / 范围 / 目标 / 成功标准 / 起止日期
    expect(screen.getByText('企业级敏捷协作平台')).toBeInTheDocument()
    expect(screen.getByText('让跨部门项目协作高效透明')).toBeInTheDocument()
    expect(screen.getByText('任务看板、工时统计与里程碑跟踪')).toBeInTheDocument()
    expect(screen.getByText('搭建跨部门任务看板')).toBeInTheDocument()
    expect(screen.getByText('看板任务流转可用')).toBeInTheDocument()
    expect(screen.getByText('整体计划周期')).toBeInTheDocument()
    // 整体周期跨度（章程专用节点；其他 tab 面板常驻 DOM 同含日期文本，故限定节点）
    expect(document.querySelector('[data-charter-dates]')?.textContent).toContain('2026-09-01')
    expect(document.querySelector('[data-charter-dates]')?.textContent).toContain('2026-12-31')
  })

  test('模块检视四区：WBS 树 / 任务表 / 甘特预览 / 配套折叠区完整回显（只读）', async () => {
    await enterReviewThroughTheater()

    // WBS 分解树：大纲编码 + 节点名 + 说明节点徽章（「说明节点」徽章与说明性描述都会命中）
    fireEvent.click(screen.getByRole('tab', { name: 'WBS 分解树' }))
    expect(screen.getAllByText('1.1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('任务看板模块').length).toBeGreaterThan(0)
    expect(screen.getAllByText('工时统计模块').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/说明节点/).length).toBeGreaterThan(0)

    // 任务清单：任务名 / 工期 / 计划起止 / 负责人建议 / 角色
    fireEvent.click(screen.getByRole('tab', { name: '任务清单' }))
    expect(screen.getAllByText(/搭建任务看板/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/开发工时统计/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/10 天/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/王启明/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/李思远/).length).toBeGreaterThan(0)

    // 甘特预览：总工期 / 阶段数 / 关键路径高亮 / 依赖类型
    fireEvent.click(screen.getByRole('tab', { name: '甘特预览' }))
    expect(screen.getByText(/120 天/)).toBeInTheDocument()
    expect(screen.getAllByText('3').length).toBeGreaterThan(0)
    expect(screen.getByText(/关键路径任务/)).toBeInTheDocument()
    expect(screen.getAllByText('关键路径').length).toBe(2) // t1 + t2
    expect(screen.getAllByText(/FS · 完成-开始/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1 天/).length).toBeGreaterThan(0) // lagDays=1

    // 配套折叠区：展开验收标准 / 资源 / 风险 / 里程碑（aria-expanded 切换）
    const acceptanceToggle = document.querySelector(
      '[data-support-panel-id="acceptance"]',
    ) as HTMLElement
    expect(acceptanceToggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(acceptanceToggle)
    expect(acceptanceToggle).toHaveAttribute('aria-expanded', 'true')
    expect(acceptanceToggle).toHaveAttribute('aria-controls', 'nx-support-panel-acceptance')
    expect(screen.getByText('任务看板可在浏览器正常打开并流转')).toBeInTheDocument()
    expect(screen.getByText('工时统计支持按月导出')).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-support-panel-id="resource"]') as HTMLElement)
    expect(screen.getAllByText(/前端开发工程师/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/2 人/).length).toBeGreaterThan(0)

    fireEvent.click(document.querySelector('[data-support-panel-id="risk"]') as HTMLElement)
    expect(screen.getAllByText(/跨部门需求变更风险/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('高风险').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/每周对齐需求优先级/).length).toBeGreaterThan(0)

    fireEvent.click(document.querySelector('[data-support-panel-id="milestone"]') as HTMLElement)
    expect(screen.getAllByText(/看板上线/).length).toBeGreaterThan(0)

    // 可编辑控件边界（RL-01、RL-06，B2c-2 语义）：审查面板允许的输入控件仅限
    // 任务清单勾选/就地编辑区 + 警告复核与未选策略控制区；其余检视区严格只读
    const editableControls = document.querySelectorAll(
      '[data-next-draft-review-panel] input, [data-next-draft-review-panel] textarea, [data-next-draft-review-panel] select',
    )
    expect(editableControls.length).toBeGreaterThan(0)
    for (const control of Array.from(editableControls)) {
      const allowed =
        control.closest('[data-tasks-section]') !== null ||
        control.hasAttribute('data-warning-ack-checkbox') ||
        control.hasAttribute('data-ack-warnings-checkbox') ||
        control.closest('[data-strategy-group]') !== null ||
        // 人员分配只写入确认载荷（roleAssignments），导入前不落库。
        control.closest('[data-member-assignment]') !== null ||
        control.hasAttribute('data-edit-input')
      expect(allowed).toBe(true)
    }
  })

  test('右侧边栏：假设清单 / 五维自检报告 / 自动修正 Diff 权威回显', async () => {
    await enterReviewThroughTheater()

    // AI 假设检查清单：待确认计数 + 常驻裁决提示 + 高影响徽章 + 来源/置信度/理由
    expect(screen.getByText('AI 假设检查清单')).toBeInTheDocument()
    expect(
      screen.getByText('以下要素由 AI 启发式推断得出，待确认转正阶段人工裁决'),
    ).toBeInTheDocument()
    expect(screen.getByText(/项待确认/)).toBeInTheDocument()
    expect(screen.getAllByText('高影响假设').length).toBeGreaterThan(0)
    expect(screen.getAllByText('AI 推断（inferred）').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/置信度: 70%/).length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/依据类似算法复杂度与历史交付经验推算工期需 10 个工作日/).length,
    ).toBeGreaterThan(0)

    // 五维自检报告：五维标签 + 权重 + 综合置信度 + 风险徽章 + Warning 明细
    expect(screen.getByText('反幻觉自检报告')).toBeInTheDocument()
    expect(screen.getByText(/综合置信度/)).toBeInTheDocument()
    expect(screen.getByText('94')).toBeInTheDocument()
    for (const label of ['事实准确性', '逻辑一致性', '假设清晰度', '完整性', '数值合理性']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText(/权重 0\.30/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('低风险').length).toBeGreaterThan(0)
    expect(screen.getByText(/警告项（1）/)).toBeInTheDocument()
    expect(screen.getByText('[HL-004]')).toBeInTheDocument()
    // 自检报告与转正按钮旁的复核条都列出告警内容
    expect(screen.getAllByText('假设清晰度警告：工期推断依赖历史同类项目数据')).toHaveLength(2)

    // 自动修正 Diff：受影响路径 / 修正前（红删除线）/ 修正后（绿高亮）/ 修正原因
    expect(screen.getByText('自动修正 Diff')).toBeInTheDocument()
    expect(screen.getByText('1 处')).toBeInTheDocument()
    expect(document.querySelector('[data-fix-diff-path]')?.textContent).toBe(
      'tasks[1].durationDays',
    )
    expect(document.querySelector('[data-fix-diff-before]')?.textContent).toBe('0 天')
    expect(document.querySelector('[data-fix-diff-after]')?.textContent).toBe('1 天')
    expect(document.querySelector('[data-fix-diff-reason]')?.textContent).toContain(
      'HL-002 规则要求单任务工期至少 0.5 天',
    )
  })

  test('保存为草稿闭环：POST .../save → enterSaved → 落定视图回显；RL-01 全程零 confirm', async () => {
    await enterReviewThroughTheater()

    // 新守卫矩阵：先初始化选择集（全选）并勾选 Warning 复核（validationClean 含 1 条 HL-004），
    // 确认按钮方可激活（5 项前置守卫：权限/Blocking 清零/Warning 勾选/选中≥1/非提交中）
    const draftSnapshot = useAiProjectDraftStore.getState().draft
    act(() => {
      if (draftSnapshot) {
        useAiDraftConfirmStore.getState().initSelection(draftSnapshot)
      }
    })
    fireEvent.click(document.querySelector('[data-warning-ack-checkbox]') as HTMLElement)

    // 可转正态：确认按钮激活（本地守卫通过，点击仅唤起二次确认弹窗，零网络副作用）
    const confirmButton = screen.getByRole('button', { name: /确认并转正项目/ })
    expect(confirmButton).toHaveProperty('disabled', false)
    fireEvent.click(confirmButton)
    expect(screen.getByRole('dialog', { name: '确认转正最终确认' })).toBeInTheDocument()
    // 收起二次确认弹窗（全局 ESC），继续保存流
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '确认转正最终确认' })).toBeNull()

    // 保存为草稿：调用成熟端点，绝不写正式表
    fireEvent.click(screen.getByRole('button', { name: /保存为草稿/ }))
    await waitFor(() => {
      expect(useAiProjectDraftStore.getState().draftStatus).toBe('saved')
    })

    const saveCalls = networkMock.apiFetch.mock.calls.filter(([path]) =>
      String(path).endsWith('/save'),
    )
    expect(saveCalls).toHaveLength(1)
    expect(String(saveCalls[0]![0])).toContain(`/ai/project-drafts/${TEST_DRAFT_ID}/save`)
    expect((saveCalls[0]![1] as RequestInit | undefined)?.method ?? 'GET').toBe('POST')

    // RL-01：保存/审查全程零 confirm 请求
    const confirmCalls = networkMock.apiFetch.mock.calls.filter(([path]) =>
      String(path).includes('/confirm'),
    )
    expect(confirmCalls).toHaveLength(0)
    expect(
      networkMock.apiRawFetch.mock.calls.filter(([path]) => String(path).includes('/confirm')),
    ).toHaveLength(0)

    // enterSaved → 退回落定视图（草案仍可继续审查/保存）
    expect(screen.getByText('9/9 模块已就绪')).toBeInTheDocument()
  })

  test('Blocking 阻断（HL-007）：确认按钮强制 disabled + Tooltip 逐条阻断解释（RL-02）', async () => {
    await enterReviewThroughTheater(validationBlocked())

    const confirmButton = screen.getByRole('button', { name: /确认并转正项目/ })
    expect(confirmButton).toHaveProperty('disabled', true)
    expect(confirmButton.className).toContain('opacity-40')
    expect(confirmButton.className).toContain('cursor-not-allowed')

    // 聚焦 Tooltip 触发容器：阻断规则逐条列出
    const trigger = document.querySelector('[data-confirm-trigger]') as HTMLElement
    expect(trigger).not.toBeNull()
    fireEvent.focus(trigger)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('存在 1 项阻断级严重违规')
    expect(tooltip).toHaveTextContent('[HL-007] 检测到任务依赖循环：t1 -> t2 -> t1')
    expect(tooltip).toHaveTextContent('严禁转正')

    // 阻断态下安全操作仍可用
    expect(screen.getByRole('button', { name: /返回重试生成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保存为草稿/ })).toBeInTheDocument()

    // 阻断报告明细同步呈现（Blocking 分组）
    expect(screen.getByText(/阻断项（1）/)).toBeInTheDocument()
    expect(screen.getByText('[HL-007]')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 4.2 红线文案全扫 + RL-05 404 中性空态
// ---------------------------------------------------------------------------

describe('红线文案审查（tasks 4.2）', () => {
  test('审查面板全态：DOM 文本与 aria-* 属性零「已创建/已入库」类措辞', async () => {
    await enterReviewThroughTheater()

    const violations = collectForbiddenViolations(FORBIDDEN_COPY)
    expect(violations).toEqual([])
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).toContain('确认并转正项目')
    expect(bodyText).toContain('9/9 模块已完备')
  })

  test('跨租户/非法 ID 深链接 404：中性空态卡，零租户泄露词（RL-05）', async () => {
    // mock apiFetch 语义为「解包后」：404 以 ApiError 形状 reject（toApiError 抛出物）
    networkMock.apiFetch.mockImplementation((path) => {
      const url = String(path)
      if (url.includes('/ai/project-drafts/')) {
        return Promise.reject({ status: 404, code: 'RESOURCE_NOT_FOUND', message: '资源不存在' })
      }
      return Promise.reject(new Error(`unexpected apiFetch ${url}`))
    })
    render(<NextDraftReviewRoute />)

    await screen.findByRole('status', { name: '未找到该草案或链接已失效' })
    expect(screen.getByText('草案不存在或已被移除，请核对链接后重试。')).toBeInTheDocument()

    const violations = collectForbiddenViolations(TENANT_LEAK_WORDS)
    expect(violations).toEqual([])
    for (const needle of FORBIDDEN_COPY) {
      expect(document.body.textContent ?? '').not.toContain(needle)
    }

    // 返回首页导航
    fireEvent.click(screen.getByRole('button', { name: /返回首页/ }))
    expect(navMock.replace).toHaveBeenCalledWith('/next')
  })
})

// ---------------------------------------------------------------------------
// 4.3 精确档降级与 A11y
// ---------------------------------------------------------------------------

describe('精确档降级与无障碍（tasks 4.3）', () => {
  test('审查面板注入降级 CSS：precise 档与 reduced-motion 下呼吸脉冲强制停用', async () => {
    // 精确档：manifest 层面 data-immersion="precise"
    useNextTrackStore.setState({ immersionTier: 'precise' })
    await enterReviewThroughTheater()

    // 审查面板位于 TheaterShell 内：壳层 data-immersion 回显 precise 档
    // （documentElement 全局属性会被 TheaterGenerationStage 卸载时清理，
    // 属上一 change 的既有竞态；面板降级以壳层属性为准）
    expect(document.querySelector('[data-theater-shell]')?.getAttribute('data-immersion')).toBe(
      'precise',
    )
    const styleText = document.querySelector('style[data-nx-review-css]')?.textContent ?? ''
    expect(styleText).toContain("[data-immersion='precise'] .nx-review-breathe")
    expect(styleText).toContain('animation: none !important')
    expect(styleText).toContain('transition: none !important')
    expect(styleText).toContain('@media (prefers-reduced-motion: reduce)')
  })

  test('系统减弱动效偏好（prefers-reduced-motion: reduce）自动降级为 precise', async () => {
    const realMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    try {
      await enterReviewThroughTheater()
      expect(document.querySelector('[data-theater-shell]')?.getAttribute('data-immersion')).toBe(
        'precise',
      )
    } finally {
      window.matchMedia = realMatchMedia
    }
  })

  test('模块检视标签页：全键盘 Arrow/Home/End 导航 + ARIA 双通道语义', async () => {
    await enterReviewThroughTheater()

    expect(screen.getByRole('tablist', { name: '草案模块检视' })).toBeInTheDocument()
    const charterTab = screen.getByRole('tab', { name: '项目章程' })
    expect(charterTab).toHaveAttribute('aria-selected', 'true')
    expect(charterTab).toHaveAttribute('tabindex', '0')

    // ArrowRight：章程 → WBS
    fireEvent.keyDown(charterTab, { key: 'ArrowRight' })
    const wbsTab = screen.getByRole('tab', { name: 'WBS 分解树' })
    expect(wbsTab).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-panel-id="wbs"]')).not.toHaveAttribute('hidden')
    expect(charterTab).toHaveAttribute('aria-selected', 'false')

    // ArrowRight 循环：WBS → 任务 → 甘特；再 ArrowRight 回到章程
    fireEvent.keyDown(wbsTab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '任务清单' })).toHaveAttribute('aria-selected', 'true')
    const ganttTab = screen.getByRole('tab', { name: '甘特预览' })
    fireEvent.keyDown(screen.getByRole('tab', { name: '任务清单' }), { key: 'ArrowRight' })
    expect(ganttTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(ganttTab, { key: 'ArrowRight' })
    expect(charterTab).toHaveAttribute('aria-selected', 'true')

    // Home / End
    fireEvent.keyDown(charterTab, { key: 'End' })
    expect(ganttTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(ganttTab, { key: 'Home' })
    expect(charterTab).toHaveAttribute('aria-selected', 'true')

    // ArrowLeft 反向循环：章程 ← 甘特
    fireEvent.keyDown(charterTab, { key: 'ArrowLeft' })
    expect(ganttTab).toHaveAttribute('aria-selected', 'true')
  })

  test('审查面板各状态双通道：颜色令牌 + 中文文字 + 语义图标并存', async () => {
    await enterReviewThroughTheater()

    // 风险徽章：低风险（成功绿令牌 + ShieldCheck 图标 + 中文）
    const riskBadge = document.querySelector('[data-risk-badge]') as HTMLElement
    expect(riskBadge).not.toBeNull()
    expect(riskBadge.style.color).toBe('var(--nx-status-success)')
    expect(riskBadge.textContent).toContain('低风险')
    expect(riskBadge.querySelector('svg')).not.toBeNull()

    // 关键路径徽章：冷蓝 + 中文
    fireEvent.click(screen.getByRole('tab', { name: '甘特预览' }))
    const criticalBadge = document.querySelector('[data-gantt-critical-badge]') as HTMLElement
    expect(criticalBadge).not.toBeNull()
    expect(criticalBadge.textContent).toContain('关键路径')
    expect(criticalBadge.querySelector('svg')).not.toBeNull()

    // 高影响假设徽章：琥珀警示 + 中文
    const highImpactBadge = document.querySelector('[data-assumption-high-impact-badge]')
    expect(highImpactBadge).not.toBeNull()
    expect(highImpactBadge?.textContent).toContain('高影响假设')
  })
})
