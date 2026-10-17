/**
 * v3-ui-next-theater-generation 任务 4.1 / 4.2 —— 生成剧场全链路端到端集成测试。
 *
 * 策略：**真实 W1 客户端 + Mock 网络层注入**——替换 `@/lib/api-client` 的
 * apiRawFetch / apiFetch（客户端唯一的真实网络出口），让页面装配层与客户端状态机
 * （单调过滤 / 断线续传 / outcome 补记 / 停滞看门狗）在集成级真实协作，仅传输可控：
 *
 * - T1 主链路：就绪态点击「开始生成项目草案」→ 9 模块从蓝图待建（pending）逐步脉冲
 *   建造（generating）并坚实完成（completed）→ draft.completed 落定 TheaterSettledView
 *   →「进入草案审查」→ 落定态「重新生成」第二条生成流；
 * - T2 断线续传：传输中断后客户端自动以 Last-Event-ID 语义（draftId + lastSequence）
 *   发起续传，期间已完成模块严禁回退，提示条「正在重新建立进度连接」浮现后平滑落定；
 * - T3 失败重试：draft.failed（MODEL_PROVIDER_CALL_FAILED）→ 错误卡标准错误码 +
 *   上下文保留 →「重试生成」带原上下文重新发起并成功落定；
 * - T4 网络级失败：openStream 硬失败无事件通道 → outcome 补记 setDraftFailed →
 *   [SSE_CONNECTION_FAILED] 错误卡；
 * - T5 红线文案全扫（任务 4.2）：生成中 / 落定 / 失败三态遍历全 DOM 文本与
 *   aria-* 属性，断言杜绝「项目已创建」「创建成功」「已写入数据库」类措辞；
 * - RL-01：全链路零 confirm 请求、零正式项目落库动作（仅断言 transport 调用契约）。
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AI_INTENT_SCHEMA_VERSION,
  PROJECT_DRAFT_MODULES,
  type ConfirmedProjectContext,
  type Marked,
  type ParsedIntent,
} from '@aiproj/types'
import NextCreatePage from '@/app/(next)/next/create/page'
import {
  createDraftProgressProjection,
  reduceDraftProgress,
} from '@/lib/ai-draft/progress-projection'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useAuthStore } from '@/stores/auth-store'
import { formatDraftShortCode } from '@/components/next/theater/TheaterSettledView'
import {
  completedDraftEvent,
  createErrorEndingStream,
  createMockSseStream,
  createSilentAfterSseStream,
  deltaEvent,
  failedEvent,
  heartbeatEvent,
  makeMockValidation,
  moduleCompletedEvent,
  progressEvent,
  responseOf,
  sseFrame,
  startedEvent,
  TEST_DRAFT_ID,
} from './_next-theater-sse-fixtures'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

/**
 * 网络层可编程 mock：替换 `@/lib/api-client` 的 apiRawFetch / apiFetch，
 * 让 W1 真实客户端（单调过滤 / 断线续传 / outcome / watchdog 全真实）消费可控传输。
 * `defaultTheaterTransport` 为客户端模块内自引用，无法经模块替换注入，故在此层替换。
 */
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next/create',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_INTENT = '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计'

function marked(
  value: string | number | string[],
  source: 'explicit' | 'inferred' | 'default',
  needsConfirmation = false,
): Marked<string | number | string[]> {
  return {
    value,
    marker: {
      confidence: 0.92,
      source,
      reason: '测试用标记原因',
      needsConfirmation,
    },
  }
}

const parsedIntent: ParsedIntent = {
  schemaVersion: AI_INTENT_SCHEMA_VERSION,
  projectType: 'software',
  projectName: '企业级敏捷协作平台',
  objectives: ['搭建跨部门敏捷协作平台'],
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

const validation94 = { ...makeMockValidation(), confidenceScore: 94 }

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
  })
}

/** 9 模块「delta → completed」连续序列帧（不含 draft.completed），返回末序号。 */
function moduleFrames(startSequence: number): { frames: string[]; lastSequence: number } {
  let seq = startSequence
  const frames: string[] = []
  for (const module of PROJECT_DRAFT_MODULES) {
    frames.push(sseFrame('module.delta', deltaEvent(module, seq++)))
    frames.push(sseFrame('module.completed', moduleCompletedEvent(module, seq++)))
  }
  return { frames, lastSequence: seq - 1 }
}

/** 主链路完整成功流：started + 9 模块 + progress + draft.completed。 */
function fullSuccessStream(): ReadableStream<Uint8Array> {
  let seq = 1
  const frames = [sseFrame('draft.started', startedEvent(seq++))]
  const modules = moduleFrames(seq)
  seq = modules.lastSequence + 1
  frames.push(...modules.frames)
  frames.push(sseFrame('draft.progress', progressEvent(seq++, 'parsing')))
  frames.push(
    sseFrame('draft.completed', completedDraftEvent(seq, undefined, undefined, validation94)),
  )
  return createMockSseStream(frames)
}

/** 可编程逐步 SSE 流：测试侧按帧推进（验证逐模块建造中间态）。 */
function createSteppableSse() {
  const encoder = new TextEncoder()
  const queue: string[] = []
  let pending: (() => void) | null = null
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (queue.length > 0) {
        controller.enqueue(encoder.encode(queue.shift() ?? ''))
        return undefined
      }
      if (closed) {
        controller.close()
        return undefined
      }
      return new Promise<void>((resolve) => {
        pending = resolve
      }).then(() => {
        if (queue.length > 0) controller.enqueue(encoder.encode(queue.shift() ?? ''))
        else if (closed) controller.close()
      })
    },
  })

  return {
    stream,
    push(frame: string) {
      queue.push(frame)
      const resolve = pending
      pending = null
      resolve?.()
    },
    end() {
      closed = true
      const resolve = pending
      pending = null
      resolve?.()
    },
  }
}

function constructCard(module: string): HTMLElement | null {
  return document.querySelector(`[data-construct-module="${module}"]`)
}

function assertCardState(module: string, state: 'pending' | 'generating' | 'completed' | 'failed') {
  const card = constructCard(module)
  expect(card).not.toBeNull()
  expect(card).toHaveAttribute('data-construct-state', state)
}

/** 下一次 /stream 调用返回给定 SSE 响应体。 */
function mockOpenStreamOnce(stream: ReadableStream<Uint8Array>) {
  networkMock.apiRawFetch.mockImplementationOnce(() => Promise.resolve(responseOf(stream)))
}

/** 断言某次 apiRawFetch 调用命中给定路径片段并返回该字段，供断言请求体。 */
function rawFetchCall(substring: string): { path: string; init: RequestInit } | null {
  const call = networkMock.apiRawFetch.mock.calls.find(([path]) => String(path).includes(substring))
  if (!call) return null
  return { path: String(call[0]), init: (call[1] as RequestInit | undefined) ?? {} }
}

beforeEach(() => {
  sessionStorage.clear()
  networkMock.apiRawFetch.mockReset()
  networkMock.apiFetch.mockReset()
  resetDraft()
  setAuth(['ai:trigger'])
})

// ---------------------------------------------------------------------------
// 4.1 全链路
// ---------------------------------------------------------------------------

describe('生成剧场全链路集成（真实 W1 客户端 + Mock SSE transport，任务 4.1）', () => {
  test('主链路：就绪触发 → 9 模块逐步建造（pending/generating/completed）→ 落定视图 → 进入审查 → 重新生成', async () => {
    const steppable = createSteppableSse()
    mockOpenStreamOnce(steppable.stream)
    render(<NextCreatePage />)

    // 初始：就绪态（人工确认关卡），零网络调用（RL-01）
    expect(screen.getByText('澄清完成 · 生成就绪')).toBeInTheDocument()
    expect(networkMock.apiRawFetch).not.toHaveBeenCalled()

    // 点击开始生成 → 生成中：Stage + 9 模块全蓝图待建（POST /stream 已发起）
    fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))
    await screen.findByRole('heading', { name: '草案生成中' })
    expect(rawFetchCall('/ai/project-drafts/stream')).not.toBeNull()
    expect(document.querySelectorAll('[data-construct-card]')).toHaveLength(9)
    for (const module of PROJECT_DRAFT_MODULES) {
      assertCardState(module, 'pending')
    }
    expect(
      screen.getAllByText('蓝图规划中', { selector: '[data-construct-status-badge]' }),
    ).toHaveLength(9)
    // RL-01：全程零 confirm 请求
    expect(rawFetchCall('/confirm')).toBeNull()

    // 逐步驱动：charter delta → generating；charter completed → completed
    steppable.push(sseFrame('draft.started', startedEvent(1)))
    steppable.push(sseFrame('module.delta', deltaEvent('charter', 2)))
    await waitFor(() => assertCardState('charter', 'generating'))
    expect(
      screen.getByText('建造中', { selector: '[data-construct-status-badge]' }),
    ).toBeInTheDocument()

    steppable.push(sseFrame('module.completed', moduleCompletedEvent('charter', 3)))
    steppable.push(sseFrame('module.delta', deltaEvent('wbs', 4)))
    await waitFor(() => assertCardState('charter', 'completed'))
    await waitFor(() => assertCardState('wbs', 'generating'))
    expect(
      screen.getByText('已就绪', { selector: '[data-construct-status-badge]' }),
    ).toBeInTheDocument()

    // 批量推进剩余模块至全 completed（暂不发 draft.completed）
    steppable.push(sseFrame('module.completed', moduleCompletedEvent('wbs', 5)))
    let seq = 6
    const remainingModules: Array<(typeof PROJECT_DRAFT_MODULES)[number]> = [
      'tasks',
      'dependencies',
      'acceptance',
      'resource',
      'risk',
      'milestone',
      'ganttPreview',
    ]
    for (const module of remainingModules) {
      steppable.push(sseFrame('module.delta', deltaEvent(module, seq++)))
      steppable.push(sseFrame('module.completed', moduleCompletedEvent(module, seq++)))
    }
    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-construct-card][data-construct-state="completed"]'),
      ).toHaveLength(PROJECT_DRAFT_MODULES.length)
    })
    expect(screen.getByText(/已完成/, { selector: '[data-stage-progress]' })).toBeInTheDocument()
    // 模块计数独立断言（计数节点与分隔文本分离）
    expect(screen.getByText('9', { selector: '[data-stage-progress] span' })).toBeInTheDocument()

    // draft.completed → 落定视图（逐帧 push：push 一次只接收一帧）
    steppable.push(sseFrame('draft.progress', progressEvent(seq++, 'persisting')))
    steppable.push(
      sseFrame('draft.completed', completedDraftEvent(seq++, undefined, undefined, validation94)),
    )
    await screen.findByText(`#DRAFT-${formatDraftShortCode(TEST_DRAFT_ID)}`)
    expect(screen.getByText('9/9 模块已就绪')).toBeInTheDocument()
    expect(screen.getByText('94')).toBeInTheDocument()
    expect(screen.getByText('低风险')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /进入草案审查/ })).toBeInTheDocument()

    // B2c 对接锚点：点击「进入草案审查」→ store 进入 reviewing（由 B2c 审查面板接管）
    fireEvent.click(screen.getByRole('button', { name: /进入草案审查/ }))
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('reviewing')
    // 审查面板就地展开：不触发全页刷新、不跳出新轨 Shell（B2c-1 审查态接管）
    expect(screen.getByRole('region', { name: '草案审查面板' })).toBeInTheDocument()

    // 审查面板「返回重试生成」→ resetToContext 清理草案现场、保留已确认上下文退回就绪态
    fireEvent.click(screen.getByRole('button', { name: /返回重试生成/ }))
    expect(useAiProjectDraftStore.getState().draftStatus).toBeNull()
    expect(screen.getByRole('button', { name: /开始生成项目草案/ })).toBeInTheDocument()

    // 就绪态再次发起生成（第二条流延续已确认上下文）
    mockOpenStreamOnce(fullSuccessStream())
    fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))
    await screen.findByRole('heading', { name: '草案生成中' })
    const streamCalls = networkMock.apiRawFetch.mock.calls.filter(([path]) =>
      String(path).includes('/ai/project-drafts/stream'),
    )
    expect(streamCalls).toHaveLength(2)
    await screen.findByText(`#DRAFT-${formatDraftShortCode(TEST_DRAFT_ID)}`)
  })

  test('断线自动续传：传输中断后按游标（draftId + lastSequence）重连，已完成模块不回退，提示条浮现后落定', async () => {
    // 第一段：started + charter 完成（seq 1-3）后传输层报错；续传段从 seq 4 起直至完成
    const resume = moduleFrames(4)
    let resumeSeq = resume.lastSequence + 1
    const replayFrames = [
      ...resume.frames,
      sseFrame('draft.progress', progressEvent(resumeSeq++, 'receiving')),
      sseFrame(
        'draft.completed',
        completedDraftEvent(resumeSeq, undefined, undefined, validation94),
      ),
    ]
    networkMock.apiRawFetch.mockImplementation((path) => {
      const url = String(path)
      if (url.includes('/events?')) {
        return Promise.resolve(responseOf(createMockSseStream(replayFrames)))
      }
      if (url.includes('/ai/project-drafts/stream')) {
        return Promise.resolve(
          responseOf(
            createErrorEndingStream(
              [
                sseFrame('draft.started', startedEvent(1)),
                sseFrame('module.delta', deltaEvent('charter', 2)),
                sseFrame('module.completed', moduleCompletedEvent('charter', 3)),
              ],
              new Error('网络瞬断'),
            ),
          ),
        )
      }
      return Promise.reject(new Error(`unexpected ${url}`))
    })

    render(<NextCreatePage />)
    fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))

    // 断线前：charter 坚实完成
    await waitFor(() => assertCardState('charter', 'completed'))

    // 连接恢复中：提示条浮现（1s 指数退避窗口），且已完成模块保持绿色不回退
    await screen.findByText('正在重新建立进度连接')
    assertCardState('charter', 'completed')

    // 客户端自动携带游标呼叫续传端点（?after=3 + Last-Event-ID: 3）
    await waitFor(() => expect(rawFetchCall('/events?after=3')).not.toBeNull())
    const replayCall = rawFetchCall('/events?after=3')!
    expect(replayCall.init.headers).toMatchObject({ 'Last-Event-ID': '3' })

    // 续传回放衔接 → 平滑落定
    await screen.findByText(`#DRAFT-${formatDraftShortCode(TEST_DRAFT_ID)}`)
    expect(screen.getByText('9/9 模块已就绪')).toBeInTheDocument()
  })

  test('生成失败：draft.failed 标准错误码 + 上下文保留 →「重试生成」带原上下文重新发起并成功', async () => {
    let seq = 1
    mockOpenStreamOnce(
      createMockSseStream([
        sseFrame('draft.started', startedEvent(seq++)),
        sseFrame('module.delta', deltaEvent('charter', seq++)),
        sseFrame(
          'draft.failed',
          failedEvent(seq, 'MODEL_PROVIDER_CALL_FAILED', '模型供应商调用失败'),
        ),
      ]),
    )
    mockOpenStreamOnce(fullSuccessStream())

    render(<NextCreatePage />)
    fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))

    // 错误卡：标准错误码 + 通俗释义 + 生成现场保留
    await screen.findByRole('alert', { name: '草案生成错误' })
    expect(screen.getByText('[MODEL_PROVIDER_CALL_FAILED]')).toBeInTheDocument()
    expect(screen.getByText(/模型供应商调用失败，请检查连接状态后重试/)).toBeInTheDocument()
    expect(
      screen.getByText('已确认的意图与澄清回答上下文完整保留，重试生成时将原样沿用'),
    ).toBeInTheDocument()
    // 失败瞬间的模块状态：generating → failed（多通道语义）
    expect(useAiProjectDraftStore.getState().moduleStatuses.charter).toBe('failed')

    // 重试：复用同一草案会话 POST /:draftId/retry（checkpoint 断点续跑），不再新开 /stream；
    // 沿用同一已确认 context（两次请求体逐字一致）
    fireEvent.click(screen.getByRole('button', { name: /重试生成/ }))
    await screen.findByRole('heading', { name: '草案生成中' })
    const generationCalls = networkMock.apiRawFetch.mock.calls.filter(([path]) =>
      /\/ai\/project-drafts\/(stream|[^/]+\/retry)$/.test(String(path)),
    )
    expect(generationCalls.map(([path]) => String(path))).toEqual([
      '/ai/project-drafts/stream',
      `/ai/project-drafts/${TEST_DRAFT_ID}/retry`,
    ])
    const firstBody = JSON.parse(
      String((generationCalls[0]![1] as RequestInit | undefined)?.body ?? ''),
    ) as {
      context: ConfirmedProjectContext
    }
    const secondBody = JSON.parse(
      String((generationCalls[1]![1] as RequestInit | undefined)?.body ?? ''),
    ) as {
      context: ConfirmedProjectContext
    }
    expect(secondBody.context).toEqual(firstBody.context)

    // 重试成功 → 落定
    await screen.findByText(`#DRAFT-${formatDraftShortCode(TEST_DRAFT_ID)}`)
    expect(screen.getByText('9/9 模块已就绪')).toBeInTheDocument()
  })

  test('网络级不可恢复失败：无事件通道，outcome 补记 setDraftFailed → [SSE_CONNECTION_FAILED] 错误卡', async () => {
    networkMock.apiRawFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    render(<NextCreatePage />)
    fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))

    await screen.findByRole('alert', { name: '草案生成错误' })
    expect(screen.getByText('[SSE_CONNECTION_FAILED]')).toBeInTheDocument()
    expect(screen.getByText('草案生成未能完成')).toBeInTheDocument()
    expect(useAiProjectDraftStore.getState().draftStatus).toBe('error')
    expect(useAiProjectDraftStore.getState().draftFailure?.errorCode).toBe('SSE_CONNECTION_FAILED')
    // 原地恢复入口齐备：重试生成 + 重新开始（二次确认）
    expect(screen.getByRole('button', { name: /重试生成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新开始/ })).toBeInTheDocument()
  })

  test('刷新恢复（W4 加分）：持久化 drafting 会话挂载即自动续传，零新生成请求，进度无缝衔接落定', async () => {
    // 模拟刷新后的 store：drafting 会话 + 真实 draftId + 进度游标（persist 恢复
    // progressProjection：started + charter 已完成，lastSequence=3）
    let projection = createDraftProgressProjection({
      draftId: TEST_DRAFT_ID,
      version: 1,
      connection: 'live',
    })
    for (const event of [
      startedEvent(1),
      deltaEvent('charter', 2),
      moduleCompletedEvent('charter', 3),
    ]) {
      projection = reduceDraftProgress(projection, { kind: 'event', event })
    }
    useAiProjectDraftStore.setState({
      draftStatus: 'drafting',
      draftId: TEST_DRAFT_ID,
      draftVersion: 1,
      lastEventSequence: projection.lastSequence,
      progressProjection: projection,
      moduleStatuses: projection.modules,
    })

    // 续传段：从 seq 4 起直至完成（?after=3 + Last-Event-ID: 3）——可编程流控制节奏
    const replayStepper = createSteppableSse()
    const resume = moduleFrames(4)
    let resumeSeq = resume.lastSequence + 1
    const replayAfterResume = [
      ...resume.frames,
      sseFrame('draft.progress', progressEvent(resumeSeq++, 'receiving')),
      sseFrame(
        'draft.completed',
        completedDraftEvent(resumeSeq, undefined, undefined, validation94),
      ),
    ]
    networkMock.apiRawFetch.mockImplementation((path) => {
      const url = String(path)
      if (url.includes('/events?')) {
        return Promise.resolve(responseOf(replayStepper.stream))
      }
      if (url.includes('/ai/project-drafts/stream')) {
        return Promise.reject(new Error('不应发起全新生成请求'))
      }
      return Promise.reject(new Error(`unexpected ${url}`))
    })

    render(<NextCreatePage />)

    // 挂载即进入生成中：不再回到澄清/就绪，已完成模块不回退
    await screen.findByRole('heading', { name: '草案生成中' })
    assertCardState('charter', 'completed')
    // RL-01：续传不是新生成——绝不发出 /stream 请求
    expect(rawFetchCall('/ai/project-drafts/stream')).toBeNull()

    // 客户端自动携带游标呼叫续传端点（?after=3 + Last-Event-ID: 3）
    await waitFor(() => expect(rawFetchCall('/events?after=3')).not.toBeNull())
    const replayCall = rawFetchCall('/events?after=3')!
    expect(replayCall.init.headers).toMatchObject({ 'Last-Event-ID': '3' })

    // 逐帧回放衔接 → 平滑落定（不丢失此前进度）
    for (const frame of replayAfterResume) {
      replayStepper.push(frame)
    }
    await screen.findByText(`#DRAFT-${formatDraftShortCode(TEST_DRAFT_ID)}`)
    expect(screen.getByText('9/9 模块已就绪')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 4.2 红线文案全扫（生成中 / 落定 / 失败三态）
// ---------------------------------------------------------------------------

describe('红线文案审查（任务 4.2：全 DOM 文本 + aria-* 属性遍历）', () => {
  /** 禁令词汇（spec「绝对禁止暗示项目已创建」）。 */
  const FORBIDDEN_COPY = [
    '项目已创建',
    '项目已完成',
    '创建成功',
    '项目创建完毕',
    '正式项目已入库',
    '已写入数据库',
  ]

  function collectViolations(): string[] {
    const sources: string[] = [document.body.textContent ?? '']
    const attrNames = ['aria-label', 'aria-live', 'aria-valuetext', 'aria-description']
    document
      .querySelectorAll('[aria-label], [aria-live], [aria-valuetext], [aria-description]')
      .forEach((element) => {
        for (const name of attrNames) {
          const value = element.getAttribute(name)
          if (value) sources.push(value)
        }
      })
    const violations: string[] = []
    for (const text of sources) {
      for (const needle of FORBIDDEN_COPY) {
        if (text.includes(needle)) violations.push(`「${needle}」出现于：${text.slice(0, 80)}`)
      }
    }
    return violations
  }

  async function renderGeneratingState() {
    // 静默流：仅 started 后保持连接（验证 3s 常驻文案 + 未完成态文案）
    mockOpenStreamOnce(createSilentAfterSseStream([sseFrame('draft.started', startedEvent(1))]))
    vi.useFakeTimers()
    try {
      render(<NextCreatePage />)
      fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))
      // 推进 3s：常驻「AI 正在生成项目草案」+ 阶段副标题出现（零进度伪造）
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      expect(screen.getByText('AI 正在生成项目草案')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  }

  async function renderGeneratingWithEta() {
    // 2 模块完成 + 心跳：ETA 收敛（估算中…），全扫覆盖 ETA 文案
    let seq = 1
    mockOpenStreamOnce(
      createSilentAfterSseStream([
        sseFrame('draft.started', startedEvent(seq++)),
        sseFrame('module.delta', deltaEvent('charter', seq++)),
        sseFrame('module.completed', moduleCompletedEvent('charter', seq++)),
        sseFrame('module.delta', deltaEvent('wbs', seq++)),
        sseFrame('module.completed', moduleCompletedEvent('wbs', seq++)),
        sseFrame('draft.progress', progressEvent(seq++, 'validating')),
        sseFrame('draft.heartbeat', heartbeatEvent(0, 30_000)),
      ]),
    )
    vi.useFakeTimers()
    try {
      render(<NextCreatePage />)
      fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))
      await act(async () => {
        await Promise.resolve()
      })
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      expect(screen.getByText(/估算中…/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  }

  async function renderSettledState() {
    mockOpenStreamOnce(fullSuccessStream())
    render(<NextCreatePage />)
    fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))
    await screen.findByText(`#DRAFT-${formatDraftShortCode(TEST_DRAFT_ID)}`)
    expect(screen.getByText('项目草案已建造就绪，等待进入审查')).toBeInTheDocument()
  }

  async function renderFailedState() {
    mockOpenStreamOnce(
      createMockSseStream([
        sseFrame('draft.started', startedEvent(1)),
        sseFrame('draft.failed', failedEvent(2, 'AI_SERVICE_ERROR', 'AI 生成服务异常')),
      ]),
    )
    render(<NextCreatePage />)
    fireEvent.click(screen.getByRole('button', { name: /开始生成项目草案/ }))
    await screen.findByRole('alert', { name: '草案生成错误' })
  }

  test('生成中态（含 3s 常驻文案）：全 DOM 文本与 aria-* 零违规措辞', async () => {
    await renderGeneratingState()
    expect(collectViolations()).toEqual([])
    expect(document.body.textContent ?? '').toContain('AI 正在生成项目草案')
  })

  test('生成中态（ETA 收敛文案）：估算剩余时间零违规措辞', async () => {
    await renderGeneratingWithEta()
    expect(collectViolations()).toEqual([])
    expect(document.body.textContent ?? '').toContain('估算中…')
  })

  test('落定态：草案语义常驻，零「已创建/已入库」类措辞（含 aria 属性）', async () => {
    await renderSettledState()
    const violations = collectViolations()
    expect(violations).toEqual([])
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).toContain('9/9 模块已就绪')
    expect(bodyText).toContain('等待进入审查')
  })

  test('失败态：错误卡全 DOM 文本与 aria 属性零违规措辞', async () => {
    await renderFailedState()
    expect(collectViolations()).toEqual([])
    expect(document.body.textContent ?? '').toContain('草案生成未能完成')
  })
})
