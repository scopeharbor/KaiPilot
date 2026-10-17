import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
/**
 * AI 同事本地内存状态 Store 单元测试（v3-ui-next-ai-colleague W1 · tasks 1.6）。
 *
 * Mock `@/lib/api/ai-tools`（网络层），验证：
 * - 面板开关状态流转（open/close/toggle）；
 * - 消息时间线按时间正序追加（user → assistant）；
 * - 状态机 idle → thinking → executing → idle / awaiting_confirmation；
 * - 工具执行中状态锁定（防并发重发）；
 * - 写操作 PREVIEW_REQUIRED 拦截至 awaiting_confirmation 并暂存 pendingAction；
 * - 取消为纯本地操作（零 confirm 请求，RL-01）；
 * - 确认成功重置为 idle；409 冲突呈现 + 重新演练自愈；网络错误进入 error 态。
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  PREVIEW_SUPERSEDED_TEXT,
  SCHEDULE_STALE_DISPLAY_TEXT,
  useNextAiColleagueStore,
} from '@/stores/next-ai-colleague-store'
import {
  COLLEAGUE_CONTEXT_MISSING_TEXT,
  COLLEAGUE_SCHEDULE_INCOMPLETE_TEXT,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'

const mocks = vi.hoisted(() => {
  class MockScheduleConflictError extends Error {
    readonly status = 409
    readonly code: string
    constructor(code: string, message: string) {
      super(message)
      this.name = 'AiToolScheduleConflictError'
      this.code = code
    }
  }
  return {
    execute: vi.fn(),
    confirm: vi.fn(),
    plan: vi.fn(),
    MockScheduleConflictError,
    isScheduleStaleError: (error: unknown): boolean =>
      error instanceof MockScheduleConflictError ||
      (typeof error === 'object' &&
        error !== null &&
        (error as { status?: number }).status === 409 &&
        ((error as { code?: string }).code === 'SCHEDULE_STALE' ||
          (error as { code?: string }).code === 'TOKEN_EXPIRED')),
  }
})

vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: { execute: mocks.execute, confirm: mocks.confirm, plan: mocks.plan },
  isScheduleStaleError: mocks.isScheduleStaleError,
}))

// 自由提问走 Copilot 流式回合（真实模型）；测试里以脚本化事件模拟
const copilotMocks = vi.hoisted(() => ({ submitTurnStream: vi.fn() }))
vi.mock('@/lib/api/copilot', () => ({
  copilotApi: { submitTurnStream: copilotMocks.submitTurnStream },
}))

const projectCtx: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 42,
  pathname: '/next/projects/42',
}

const homeCtx: ColleagueContext = {
  contextType: 'role_home',
  currentProjectId: null,
  pathname: '/next',
}

const PREVIEW_TOKEN_1 = 'e'.repeat(64)
const PREVIEW_TOKEN_2 = 'f'.repeat(64)
const SAMPLE_DIFF = [{ taskId: 12, from: '2026-09-10', to: '2026-09-15' }]

function previewEnvelope(token: string) {
  return {
    data: { projectId: 42, committed: false, changes: SAMPLE_DIFF, warnings: [] },
    meta: {
      toolName: 'update_task_schedule',
      status: 'PREVIEW_REQUIRED',
      durationMs: 8,
      previewToken: token,
      diff: SAMPLE_DIFF,
    },
  }
}

const successEnvelope = {
  data: { name: '开项核心引擎', progressPercent: 68 },
  meta: { toolName: 'get_project_summary', status: 'SUCCESS', durationMs: 11 },
}

beforeEach(() => {
  copilotMocks.submitTurnStream.mockReset()
  useNextAiColleagueStore.setState({
    conversations: [],
    conversationId: 'conv-start',
    openTabIds: ['conv-start'],
    sessionId: null,
    modelPreference: null,
    webSearchEnabled: false,
    isOpen: false,
    executionState: 'idle',
    messages: [],
    pendingAction: null,
  })
  mocks.execute.mockReset()
  mocks.confirm.mockReset()
  mocks.plan.mockReset()
  // 自由提问先经操作理解：默认判定「不是操作」，再转模型问答
  mocks.plan.mockResolvedValue({
    isAction: false,
    actions: [],
    reply: null,
    clarification: null,
    rejected: [],
    model: null,
  })
  mocks.execute.mockResolvedValue(successEnvelope)
})

describe('面板开关状态流转', () => {
  test('openPanel / closePanel / toggleOpen', () => {
    const store = useNextAiColleagueStore.getState()
    expect(store.isOpen).toBe(false)

    store.openPanel()
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)

    store.toggleOpen()
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)

    store.toggleOpen()
    expect(useNextAiColleagueStore.getState().isOpen).toBe(true)

    store.closePanel()
    expect(useNextAiColleagueStore.getState().isOpen).toBe(false)
  })
})

describe('消息时间线与执行状态机', () => {
  test('只读工具成功：idle → executing → idle，消息按正序追加', async () => {
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('查看项目摘要', projectCtx)

    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('idle')
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0]?.sender).toBe('user')
    expect(state.messages[0]?.content).toBe('查看项目摘要')
    expect(state.messages[1]?.sender).toBe('assistant')
    expect(state.messages[1]?.toolExecution?.status).toBe('success')
    expect(state.messages[1]?.toolExecution?.toolName).toBe('get_project_summary')
    expect(state.messages[1]?.toolExecution?.intentSource).toBe('rule_preset')
    expect(state.messages[1]?.toolExecution?.data).toEqual(successEnvelope.data)
    expect(state.messages[1]?.timestamp).toBeGreaterThanOrEqual(state.messages[0]!.timestamp)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith('get_project_summary', { projectId: 42 })
  })

  test('执行在途：executionState 锁定为 executing（呼吸光语义）', async () => {
    let resolveExecute!: (value: unknown) => void
    mocks.execute.mockReturnValue(new Promise((resolve) => (resolveExecute = resolve)))

    const pending = useNextAiColleagueStore.getState().submitUserMessage('项目概况', projectCtx)
    expect(useNextAiColleagueStore.getState().executionState).toBe('executing')

    resolveExecute(successEnvelope)
    await pending
    expect(useNextAiColleagueStore.getState().executionState).toBe('idle')
  })

  test('执行中防并发重发：二次提交被拒（消息不追加、execute 仅一次）', async () => {
    let resolveExecute!: (value: unknown) => void
    mocks.execute.mockReturnValue(new Promise((resolve) => (resolveExecute = resolve)))

    const first = useNextAiColleagueStore.getState().submitUserMessage('项目概况', projectCtx)
    await useNextAiColleagueStore.getState().submitUserMessage('任务列表', projectCtx)

    expect(useNextAiColleagueStore.getState().messages).toHaveLength(2)
    expect(mocks.execute).toHaveBeenCalledTimes(1)

    resolveExecute(successEnvelope)
    await first
  })

  test('空白输入直接忽略，不进入任何状态流转', async () => {
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('   ', projectCtx)
    const state = useNextAiColleagueStore.getState()
    expect(state.messages).toHaveLength(0)
    expect(state.executionState).toBe('idle')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  test('未命中快捷规则的自由提问：交给模型流式作答，带上所选模型与网页搜索同意', async () => {
    copilotMocks.submitTurnStream.mockImplementationOnce(async (_request, handlers) => {
      handlers.onEvent({
        type: 'turn-meta',
        sequence: 1,
        sessionId: 'cps_1',
        destinations: ['general_qa'],
        intentSummary: '',
        scope: 'project',
      })
      handlers.onEvent({ type: 'answer-delta', sequence: 2, delta: '零信任的核心是' })
      handlers.onEvent({ type: 'answer-delta', sequence: 3, delta: '「永不信任，始终验证」。' })
      handlers.onEvent({
        type: 'answer-done',
        sequence: 4,
        assistantMessageId: 'cpm_1',
        contentSummary: '',
        webSearchStatus: { code: 'web_search_quota_exceeded', message: '今日网页搜索额度已用完' },
      })
    })
    useNextAiColleagueStore.setState({
      modelPreference: { connectionId: 3, modelId: 7, label: 'gpt-x（主连接）' },
      webSearchEnabled: true,
    })
    await useNextAiColleagueStore.getState().submitUserMessage('什么是零信任架构', projectCtx)

    const request = copilotMocks.submitTurnStream.mock.calls[0]![0]
    expect(request).toMatchObject({
      sessionId: null,
      scope: 'project',
      attribution: { projectId: '42' },
      text: '什么是零信任架构',
      modelPreference: { connectionId: 3, modelId: 7 },
      webSearchConsent: true,
    })
    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('idle')
    expect(state.sessionId).toBe('cps_1')
    const answer = state.messages[1]!
    expect(answer.content).toBe('零信任的核心是「永不信任，始终验证」。')
    expect(answer.liveAnswer).toMatchObject({
      status: 'done',
      modelLabel: 'gpt-x（主连接）',
      webSearchRequested: true,
      webSearchNote: '今日网页搜索额度已用完',
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  test('服务暂时不可用：回答气泡说明原因而不是静默失败', async () => {
    copilotMocks.submitTurnStream.mockRejectedValueOnce({ status: 503 })
    await useNextAiColleagueStore.getState().submitUserMessage('今天天气不错', projectCtx)
    const answer = useNextAiColleagueStore.getState().messages[1]!
    expect(answer.liveAnswer?.status).toBe('error')
    // 服务端 503 是暂时不可用，不再一律叫用户去检查「AI 连接」配置（2026-10-12 误报修复）
    expect(answer.liveAnswer?.errorMessage).toContain('暂时不可用')
    expect(answer.liveAnswer?.errorMessage).not.toContain('AI 连接')
    expect(useNextAiColleagueStore.getState().executionState).toBe('idle')
  })

  test('浏览器式分页：新分页保留旧分页、关闭当前分页切到相邻分页、关闭的对话可从历史重新打开', async () => {
    const answer =
      (sessionId: string) => async (_r: unknown, handlers: { onEvent: (e: unknown) => void }) => {
        handlers.onEvent({
          type: 'turn-meta',
          sequence: 1,
          sessionId,
          destinations: [],
          intentSummary: '',
          scope: 'project',
        })
        handlers.onEvent({
          type: 'answer-done',
          sequence: 2,
          assistantMessageId: 'm',
          contentSummary: '好的',
        })
      }
    const store = () => useNextAiColleagueStore.getState()
    copilotMocks.submitTurnStream.mockImplementationOnce(answer('cps_a'))
    await store().submitUserMessage('第一段：零信任是什么', projectCtx)
    const first = store().conversationId

    // 空白分页不重复新建
    store().newConversation()
    const second = store().conversationId
    store().newConversation()
    expect(store().conversationId).toBe(second)
    expect(store().openTabIds).toEqual([first, second])

    copilotMocks.submitTurnStream.mockImplementationOnce(answer('cps_b'))
    await store().submitUserMessage('第二段：挣值分析怎么算', projectCtx)

    // 切回第一个分页：内容与服务端会话都在，第二个分页仍开着
    store().switchConversation(first)
    expect(store().messages[0]?.content).toBe('第一段：零信任是什么')
    expect(store().sessionId).toBe('cps_a')
    expect(store().openTabIds).toEqual([first, second])

    // 关闭当前（第一个）分页 → 切到右侧的第二个分页；第一个进历史
    store().closeConversationTab(first)
    expect(store().conversationId).toBe(second)
    expect(store().sessionId).toBe('cps_b')
    expect(store().openTabIds).toEqual([second])
    expect(store().conversations.map((c) => c.id)).toContain(first)

    // 从历史重新打开：加回分页栏
    store().switchConversation(first)
    expect(store().openTabIds).toEqual([second, first])
    expect(store().conversationId).toBe(first)

    // 关掉全部分页：自动留一个空白分页
    store().closeConversationTab(second)
    store().closeConversationTab(first)
    expect(store().openTabIds).toHaveLength(1)
    expect(store().messages).toHaveLength(0)
  })

  test('新对话：当前对话归档进历史并清空；可切回历史对话继续（带回服务端会话）', async () => {
    copilotMocks.submitTurnStream.mockImplementationOnce(async (_request, handlers) => {
      handlers.onEvent({
        type: 'turn-meta',
        sequence: 1,
        sessionId: 'cps_old',
        destinations: [],
        intentSummary: '',
        scope: 'project',
      })
      handlers.onEvent({
        type: 'answer-done',
        sequence: 2,
        assistantMessageId: 'm',
        contentSummary: '好的',
      })
    })
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('零信任和边界安全有什么区别', projectCtx)
    const oldId = useNextAiColleagueStore.getState().conversationId

    useNextAiColleagueStore.getState().newConversation()
    let state = useNextAiColleagueStore.getState()
    expect(state.messages).toHaveLength(0)
    expect(state.sessionId).toBeNull()
    expect(state.conversationId).not.toBe(oldId)
    expect(state.conversations[0]).toMatchObject({
      id: oldId,
      title: '零信任和边界安全有什么区别',
      sessionId: 'cps_old',
    })

    useNextAiColleagueStore.getState().switchConversation(oldId)
    state = useNextAiColleagueStore.getState()
    expect(state.conversationId).toBe(oldId)
    expect(state.sessionId).toBe('cps_old')
    expect(state.messages).toHaveLength(2)
    expect(state.conversations.some((c) => c.id === oldId)).toBe(false)
  })

  test('排程说不完整：交给模型理解，模型反问时零工具请求（防猜忌）', async () => {
    mocks.plan.mockResolvedValue({
      isAction: true,
      actions: [],
      reply: null,
      clarification: '要延期哪个任务、延到哪天？',
      rejected: [],
      model: 'mock/model',
    })
    await useNextAiColleagueStore.getState().submitUserMessage('帮我延期任务', projectCtx)
    const state = useNextAiColleagueStore.getState()
    expect(mocks.plan).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 42, text: '帮我延期任务' }),
    )
    // 追问以卡片呈现，原话随卡保存（回答时一起交给模型）
    expect(state.messages[1]?.question).toMatchObject({
      prompt: '要延期哪个任务、延到哪天？',
      originalText: '帮我延期任务',
      status: 'open',
    })
    expect(state.executionState).toBe('idle')
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  test('排程说不完整且不在项目空间：不是简单固定指令，交给模型理解（不再给死板格式引导）', async () => {
    mocks.plan.mockResolvedValue({
      isAction: true,
      actions: [],
      reply: null,
      clarification: '要延期哪个任务、延到哪天？',
      rejected: [],
      model: 'mock/model',
    })
    await useNextAiColleagueStore.getState().submitUserMessage('帮我延期任务', homeCtx)
    const state = useNextAiColleagueStore.getState()
    expect(mocks.plan).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null, text: '帮我延期任务' }),
    )
    expect(state.messages.at(-1)?.question?.prompt).toBe('要延期哪个任务、延到哪天？')
    expect(state.messages.some((m) => m.content === COLLEAGUE_SCHEDULE_INCOMPLETE_TEXT)).toBe(false)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  test('全域首页缺项目上下文：友好引导入流（spec「全局视图请指定项目」）', async () => {
    await useNextAiColleagueStore.getState().submitUserMessage('查看项目摘要', homeCtx)
    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('idle')
    expect(state.messages[1]?.content).toBe(COLLEAGUE_CONTEXT_MISSING_TEXT)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  test('工具执行错误：消息 error 槽 + executionState error', async () => {
    mocks.execute.mockRejectedValue(
      Object.assign(new Error('缺少 ai:trigger 权限'), {
        status: 403,
        code: 'PERMISSION_DENIED',
        message: '缺少 ai:trigger 权限',
      }),
    )
    await useNextAiColleagueStore.getState().submitUserMessage('查看项目摘要', projectCtx)
    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('error')
    expect(state.messages[1]?.toolExecution?.status).toBe('error')
    expect(state.messages[1]?.toolExecution?.error).toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
    })
  })
})

describe('写操作两阶段确认闭环（RL-01）', () => {
  test('PREVIEW_REQUIRED 拦截：awaiting_confirmation + pendingAction 暂存', async () => {
    mocks.execute.mockResolvedValue(previewEnvelope(PREVIEW_TOKEN_1))
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)

    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('awaiting_confirmation')
    expect(state.pendingAction).toEqual({
      toolName: 'update_task_schedule',
      previewToken: PREVIEW_TOKEN_1,
      parameters: { projectId: 42, taskId: 12, startDate: '2026-09-15', operation: 'move' },
      diff: SAMPLE_DIFF,
    })
    const message = state.messages[1]?.toolExecution
    expect(message?.status).toBe('preview_required')
    expect(message?.previewToken).toBe(PREVIEW_TOKEN_1)
    expect(message?.diff).toEqual(SAMPLE_DIFF)
    expect(mocks.execute).toHaveBeenCalledWith('update_task_schedule', {
      projectId: 42,
      taskId: 12,
      startDate: '2026-09-15',
      operation: 'move',
    })
  })

  test('放弃取消：本地销毁令牌、卡片置灰、零 confirm 请求（RL-01）', async () => {
    mocks.execute.mockResolvedValue(previewEnvelope(PREVIEW_TOKEN_1))
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)

    store.cancelPendingAction()

    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('idle')
    expect(state.pendingAction).toBeNull()
    expect(state.messages[1]?.toolExecution?.status).toBe('cancelled')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  test('确认应用：发起 confirm → committed → pendingAction 清空 → idle', async () => {
    mocks.execute.mockResolvedValue(previewEnvelope(PREVIEW_TOKEN_1))
    mocks.confirm.mockResolvedValue({
      data: { committed: true },
      meta: { toolName: 'update_task_schedule', committed: true, durationMs: 30 },
    })
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)

    await store.confirmPendingAction()

    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('idle')
    expect(state.pendingAction).toBeNull()
    expect(state.messages[1]?.toolExecution?.status).toBe('committed')
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirm).toHaveBeenCalledWith({
      toolName: 'update_task_schedule',
      previewToken: PREVIEW_TOKEN_1,
      parameters: { projectId: 42, taskId: 12, startDate: '2026-09-15', operation: 'move' },
    })
  })

  test('确认 409 SCHEDULE_STALE：消息转冲突告警、锁定待确认现场、可取消自愈', async () => {
    mocks.execute.mockResolvedValue(previewEnvelope(PREVIEW_TOKEN_1))
    mocks.confirm.mockRejectedValue(
      new mocks.MockScheduleConflictError('SCHEDULE_STALE', '排程已被并发修改'),
    )
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)
    await store.confirmPendingAction()

    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('awaiting_confirmation')
    expect(state.pendingAction?.previewToken).toBe(PREVIEW_TOKEN_1)
    expect(state.messages[1]?.toolExecution?.status).toBe('error')
    expect(state.messages[1]?.toolExecution?.error).toEqual({
      code: 'SCHEDULE_STALE',
      message: SCHEDULE_STALE_DISPLAY_TEXT,
      status: 409,
    })

    // 用户仍可放弃：本地取消且不再发请求
    store.cancelPendingAction()
    expect(useNextAiColleagueStore.getState().pendingAction).toBeNull()
    expect(useNextAiColleagueStore.getState().executionState).toBe('idle')
    expect(useNextAiColleagueStore.getState().messages[1]?.toolExecution?.status).toBe('cancelled')
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  test('重新演练：以最新参数重发 execute 换取新 previewToken（D-write §3 自愈）', async () => {
    mocks.execute.mockResolvedValueOnce(previewEnvelope(PREVIEW_TOKEN_1))
    mocks.execute.mockResolvedValueOnce(previewEnvelope(PREVIEW_TOKEN_2))
    mocks.confirm.mockRejectedValue(
      new mocks.MockScheduleConflictError('SCHEDULE_STALE', '排程已被并发修改'),
    )
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)
    await store.confirmPendingAction()
    expect(useNextAiColleagueStore.getState().executionState).toBe('awaiting_confirmation')

    await store.redrillPendingAction()

    const state = useNextAiColleagueStore.getState()
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenLastCalledWith('update_task_schedule', {
      projectId: 42,
      taskId: 12,
      startDate: '2026-09-15',
      operation: 'move',
    })
    expect(state.executionState).toBe('awaiting_confirmation')
    expect(state.pendingAction?.previewToken).toBe(PREVIEW_TOKEN_2)
    expect(state.messages[1]?.toolExecution?.status).toBe('preview_required')
    expect(state.messages[1]?.toolExecution?.previewToken).toBe(PREVIEW_TOKEN_2)
    expect(state.messages[1]?.toolExecution?.error).toBeUndefined()
  })

  test('确认遇到非冲突错误：error 态并保留 pendingAction 供重试', async () => {
    mocks.execute.mockResolvedValue(previewEnvelope(PREVIEW_TOKEN_1))
    mocks.confirm.mockRejectedValue(new TypeError('Failed to fetch'))
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)
    await store.confirmPendingAction()

    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('error')
    expect(state.pendingAction?.previewToken).toBe(PREVIEW_TOKEN_1)
    expect(state.messages[1]?.toolExecution?.status).toBe('error')
    expect(state.messages[1]?.toolExecution?.error?.code).toBe('NETWORK_ERROR')
  })

  test('无待确认动作时 confirm/cancel 均为安全空操作', async () => {
    const store = useNextAiColleagueStore.getState()
    await store.confirmPendingAction()
    store.cancelPendingAction()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(useNextAiColleagueStore.getState().executionState).toBe('idle')
  })

  test('execute 阶段即 409：保留无令牌参数快照，重新演练与放弃均可用（修补4c）', async () => {
    mocks.execute.mockRejectedValue(
      new mocks.MockScheduleConflictError('SCHEDULE_STALE', '并发修改'),
    )
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)

    let state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('awaiting_confirmation')
    expect(state.messages[1]?.toolExecution?.status).toBe('error')
    expect(state.messages[1]?.toolExecution?.error?.code).toBe('SCHEDULE_STALE')
    expect(state.pendingAction).toEqual({
      toolName: 'update_task_schedule',
      previewToken: null,
      parameters: { projectId: 42, taskId: 12, startDate: '2026-09-15', operation: 'move' },
      diff: null,
    })

    // 放弃：清现场且零请求（消息置 cancelled）
    state.cancelPendingAction()
    state = useNextAiColleagueStore.getState()
    expect(state.pendingAction).toBeNull()
    expect(state.executionState).toBe('idle')
    expect(state.messages[1]?.toolExecution?.status).toBe('cancelled')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  test('execute 阶段 409 后重新演练：无令牌快照仍可自愈换新预览（修补4c）', async () => {
    mocks.execute.mockRejectedValueOnce(
      new mocks.MockScheduleConflictError('SCHEDULE_STALE', '并发修改'),
    )
    mocks.execute.mockResolvedValueOnce(previewEnvelope(PREVIEW_TOKEN_2))
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)
    expect(useNextAiColleagueStore.getState().pendingAction?.previewToken).toBeNull()

    await store.redrillPendingAction()

    const state = useNextAiColleagueStore.getState()
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenLastCalledWith('update_task_schedule', {
      projectId: 42,
      taskId: 12,
      startDate: '2026-09-15',
      operation: 'move',
    })
    expect(state.executionState).toBe('awaiting_confirmation')
    expect(state.pendingAction?.previewToken).toBe(PREVIEW_TOKEN_2)
    // 现场消息就地更新为可确认预览（不再残留错误态）
    expect(state.messages[1]?.toolExecution?.status).toBe('preview_required')
    expect(state.messages[1]?.toolExecution?.previewToken).toBe(PREVIEW_TOKEN_2)
  })

  test('awaiting_confirmation 中发起第二写操作：旧预览作废 + 新 pendingAction 接管（修补1c）', async () => {
    mocks.execute
      .mockResolvedValueOnce(previewEnvelope(PREVIEW_TOKEN_1))
      .mockResolvedValueOnce(previewEnvelope(PREVIEW_TOKEN_2))
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)
    expect(useNextAiColleagueStore.getState().pendingAction?.previewToken).toBe(PREVIEW_TOKEN_1)

    await store.submitUserMessage('延期任务 12 至 2026-09-18', projectCtx)

    const state = useNextAiColleagueStore.getState()
    // 旧预览卡作废：cancelled + 取代提示，确认按钮随之消失
    const firstCard = state.messages[1]?.toolExecution
    expect(firstCard?.status).toBe('cancelled')
    expect(firstCard?.cancelNote).toBe(PREVIEW_SUPERSEDED_TEXT)
    // 新预览接管全局 pendingAction
    expect(state.pendingAction?.previewToken).toBe(PREVIEW_TOKEN_2)
    expect(state.messages[3]?.toolExecution?.status).toBe('preview_required')
    expect(state.messages[3]?.toolExecution?.previewToken).toBe(PREVIEW_TOKEN_2)
    // 作废全程零 confirm 请求
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  test('确认令牌身份校验：旧令牌确认被拒、零请求（修补1a）', async () => {
    mocks.execute
      .mockResolvedValueOnce(previewEnvelope(PREVIEW_TOKEN_1))
      .mockResolvedValueOnce(previewEnvelope(PREVIEW_TOKEN_2))
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)
    await store.submitUserMessage('延期任务 12 至 2026-09-18', projectCtx)

    // 旧预览卡的令牌（PREVIEW_TOKEN_1）已不是当前 pendingAction → 拒绝
    const accepted = await store.confirmPendingAction(PREVIEW_TOKEN_1)
    expect(accepted).toBe(false)
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(useNextAiColleagueStore.getState().pendingAction?.previewToken).toBe(PREVIEW_TOKEN_2)

    // 当前令牌确认正常放行
    mocks.confirm.mockResolvedValue({
      data: { committed: true },
      meta: { toolName: 'update_task_schedule', committed: true, durationMs: 30 },
    })
    const ok = await store.confirmPendingAction(PREVIEW_TOKEN_2)
    expect(ok).toBe(true)
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirm).toHaveBeenCalledWith({
      toolName: 'update_task_schedule',
      previewToken: PREVIEW_TOKEN_2,
      parameters: { projectId: 42, taskId: 12, startDate: '2026-09-18', operation: 'move' },
    })
  })

  test('确认同令牌重试：非冲突失败保留 pendingAction，重试成功并落库（修补4b）', async () => {
    mocks.execute.mockResolvedValue(previewEnvelope(PREVIEW_TOKEN_1))
    mocks.confirm.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({
      data: { committed: true },
      meta: { toolName: 'update_task_schedule', committed: true, durationMs: 30 },
    })
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)
    await store.confirmPendingAction(PREVIEW_TOKEN_1)
    expect(useNextAiColleagueStore.getState().executionState).toBe('error')
    expect(useNextAiColleagueStore.getState().pendingAction?.previewToken).toBe(PREVIEW_TOKEN_1)

    // 同令牌重试确认（错误卡「重试确认」路径）
    const ok = await store.confirmPendingAction(PREVIEW_TOKEN_1)
    expect(ok).toBe(true)
    const state = useNextAiColleagueStore.getState()
    expect(state.executionState).toBe('idle')
    expect(state.pendingAction).toBeNull()
    expect(state.messages[1]?.toolExecution?.status).toBe('committed')
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
  })
})

describe('clearMessages — 会话重置', () => {
  test('清空消息、暂存令牌与状态', async () => {
    mocks.execute.mockResolvedValue(previewEnvelope(PREVIEW_TOKEN_1))
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage('延期任务 12 至 2026-09-15', projectCtx)
    expect(useNextAiColleagueStore.getState().pendingAction).not.toBeNull()

    store.clearMessages()

    const state = useNextAiColleagueStore.getState()
    expect(state.messages).toEqual([])
    expect(state.pendingAction).toBeNull()
    expect(state.executionState).toBe('idle')
  })
})

// 同浏览器、同组织也必须保持账号私有；epoch 覆盖 A→B→A 的迟到请求。
describe('账号与组织隔离', () => {
  const legacyKey = 'aiproj-ai-colleague-history'
  const key = (actor: number, org = 7) => `${legacyKey}:v2:${actor}:${org}`
  function loginAs(actor: number, organizationId = 7) {
    useAuthStore.getState().setSession({
      user: {
        id: actor,
        email: `${actor}@test.local`,
        fullName: null,
        organizations: [{ id: organizationId, name: '测试', slug: 'test', role: 'member' }],
      },
      accessToken: accessTokenWith(['ai:trigger'], { organizationId }),
      refreshToken: `r-${actor}`,
    })
  }
  beforeEach(() => {
    useAuthStore.getState().clear()
    localStorage.clear()
  })

  test('删除无归属旧历史；同组织不同账号独立，重新登录只恢复本人历史', () => {
    localStorage.setItem(
      legacyKey,
      JSON.stringify({ conversations: [{ id: 'old', messages: ['秘密'] }] }),
    )
    loginAs(101)
    expect(localStorage.getItem(legacyKey)).toBeNull()
    expect(useNextAiColleagueStore.getState().messages).toEqual([])
    useNextAiColleagueStore.setState({
      messages: [{ id: 'private-a', sender: 'user', content: 'A 私有对话', timestamp: 1 }],
    })
    expect(localStorage.getItem(key(101))).toContain('A 私有对话')
    loginAs(102)
    expect(useNextAiColleagueStore.getState().messages).toEqual([])
    expect(useNextAiColleagueStore.getState().conversations).toEqual([])
    expect(localStorage.getItem(key(102))).toBeNull()
    useNextAiColleagueStore.setState({
      messages: [{ id: 'private-b', sender: 'user', content: 'B 私有对话', timestamp: 2 }],
    })
    useAuthStore.getState().clear()
    expect(useNextAiColleagueStore.getState().messages).toEqual([])
    loginAs(101)
    expect(useNextAiColleagueStore.getState().messages.map((m) => m.content)).toEqual([
      'A 私有对话',
    ])
    expect(localStorage.getItem(key(101))).not.toContain('B 私有对话')
  })

  test('切换组织清除上下文、模型与预览；token 刷新保留本人对话', () => {
    loginAs(101)
    useNextAiColleagueStore.setState({
      messages: [{ id: 'private', sender: 'user', content: '旧组织', timestamp: 1 }],
      context: projectCtx,
      modelPreference: { connectionId: 8, modelId: 9, label: '模型' },
      suggestions: ['秘密建议'],
    })
    useAuthStore
      .getState()
      .setTokens({ accessToken: accessTokenWith([], { organizationId: 7 }), refreshToken: 'new' })
    expect(useNextAiColleagueStore.getState().messages).toHaveLength(1)
    loginAs(101, 8)
    const state = useNextAiColleagueStore.getState()
    expect(state.messages).toEqual([])
    expect(state.context).toBeNull()
    expect(state.modelPreference).toBeNull()
    expect(state.suggestions).toEqual([])
    expect(state.pendingAction).toBeNull()
  })

  test.each(['resolve', 'reject'])('换账号后 planner 迟到 %s 不回填或发起问答', async (outcome) => {
    loginAs(101)
    let resolve!: (value: unknown) => void
    let reject!: (reason: Error) => void
    mocks.plan.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes
          reject = no
        }),
    )
    const pending = useNextAiColleagueStore
      .getState()
      .submitUserMessage('帮我安排一个复杂的工作流程', homeCtx)
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    loginAs(102)
    loginAs(101) // 回到原账号，旧请求仍必须失效
    const before = useNextAiColleagueStore.getState().messages
    if (outcome === 'resolve')
      resolve({ isAction: false, actions: [], rejected: [], clarification: null, model: null })
    else reject(new Error('旧账号错误'))
    await pending
    expect(useNextAiColleagueStore.getState().messages).toEqual(before)
    expect(useNextAiColleagueStore.getState().executionState).toBe('idle')
    expect(copilotMocks.submitTurnStream).not.toHaveBeenCalled()
  })

  test('换账号后旧 SSE 元数据、回答与结束不得回填或保存', async () => {
    loginAs(101)
    let emit!: (event: unknown) => void
    let finish!: () => void
    copilotMocks.submitTurnStream.mockImplementationOnce((_request, handlers) => {
      emit = handlers.onEvent
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const pending = useNextAiColleagueStore.getState().submitUserMessage('零信任是什么', homeCtx)
    await vi.waitFor(() => expect(emit).toBeTypeOf('function'))
    loginAs(102)
    emit({ type: 'turn-meta', sequence: 1, sessionId: 'secret-session' })
    emit({ type: 'answer-delta', sequence: 2, delta: 'A 的秘密' })
    emit({
      type: 'answer-done',
      sequence: 3,
      assistantMessageId: 'secret',
      contentSummary: 'A 的秘密',
    })
    finish()
    await pending
    expect(useNextAiColleagueStore.getState().messages).toEqual([])
    expect(useNextAiColleagueStore.getState().sessionId).toBeNull()
    expect(localStorage.getItem(key(102))).toBeNull()
  })
})

describe('回答进行中可开新分页与打字（2026-10-06）', () => {
  const store = () => useNextAiColleagueStore.getState()

  function gatedAnswer(sessionId: string) {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    copilotMocks.submitTurnStream.mockImplementationOnce(async (_request, handlers) => {
      handlers.onEvent({
        type: 'turn-meta',
        sequence: 1,
        sessionId,
        destinations: ['general_qa'],
        intentSummary: '',
        scope: 'project',
      })
      handlers.onEvent({ type: 'answer-delta', sequence: 2, delta: '第一段' })
      await gate
      handlers.onEvent({ type: 'answer-delta', sequence: 3, delta: '，第二段。' })
      handlers.onEvent({
        type: 'answer-done',
        sequence: 4,
        assistantMessageId: 'm',
        contentSummary: '',
      })
    })
    return () => release()
  }

  function quickAnswer(sessionId: string, text: string) {
    copilotMocks.submitTurnStream.mockImplementationOnce(async (_request, handlers) => {
      handlers.onEvent({
        type: 'turn-meta',
        sequence: 1,
        sessionId,
        destinations: ['general_qa'],
        intentSummary: '',
        scope: 'project',
      })
      handlers.onEvent({ type: 'answer-delta', sequence: 2, delta: text })
      handlers.onEvent({
        type: 'answer-done',
        sequence: 3,
        assistantMessageId: 'q',
        contentSummary: '',
      })
    })
  }

  beforeEach(() => {
    useNextAiColleagueStore.setState({ queuedMessage: null, backgroundRunId: null })
  })

  test('回答到一半新开分页：输出写回原对话；新分页发的消息排队，这一轮结束后自动发出', async () => {
    const release = gatedAnswer('cps_bg')
    const pending = store().submitUserMessage('请详细解释挣值分析', projectCtx)
    await vi.waitFor(() => expect(store().messages.at(-1)?.content).toBe('第一段'))
    expect(store().executionState).toBe('thinking')
    const first = store().conversationId

    // 回答进行中照样能新开分页
    store().newConversation()
    const second = store().conversationId
    expect(second).not.toBe(first)
    expect(store().messages).toHaveLength(0)
    expect(store().executionState).toBe('idle')
    expect(store().backgroundRunId).toBe(first)
    expect(store().openTabIds).toEqual([first, second])

    // 新分页里发出的消息先排队，不打断后台那一轮
    await store().submitUserMessage('新分页：明天有哪些会', homeCtx)
    expect(store().queuedMessage).toMatchObject({
      conversationId: second,
      text: '新分页：明天有哪些会',
    })
    expect(copilotMocks.submitTurnStream).toHaveBeenCalledTimes(1)

    // 后台那一轮继续输出：写回原对话，不会串到新分页
    quickAnswer('cps_new', '明天有两个会。')
    release()
    await pending
    const background = store().conversations.find((c) => c.id === first)!
    expect(background.messages.at(-1)?.content).toBe('第一段，第二段。')
    expect(background.messages.at(-1)?.liveAnswer?.status).toBe('done')
    expect(background.sessionId).toBe('cps_bg')
    expect(store().messages.some((m) => m.content?.includes('第二段'))).toBe(false)
    expect(store().backgroundRunId).toBeNull()

    // 这一轮结束：排队的消息在新分页自动发出
    await vi.waitFor(() => expect(copilotMocks.submitTurnStream).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(store().messages.at(-1)?.content).toBe('明天有两个会。'))
    expect(store().messages[0]?.content).toBe('新分页：明天有哪些会')
    expect(store().queuedMessage).toBeNull()
    expect(store().sessionId).toBe('cps_new')

    // 切回原对话：完整回答与服务端会话都在
    store().switchConversation(first)
    expect(store().messages.at(-1)?.content).toBe('第一段，第二段。')
    expect(store().sessionId).toBe('cps_bg')
  })

  test('回答进行中切回原对话：恢复「思考中」现场，后续输出照常写进当前分页', async () => {
    const release = gatedAnswer('cps_back')
    const pending = store().submitUserMessage('解释一下关键路径', projectCtx)
    await vi.waitFor(() => expect(store().messages.at(-1)?.content).toBe('第一段'))
    const first = store().conversationId

    store().newConversation()
    expect(store().backgroundRunId).toBe(first)
    store().switchConversation(first)
    expect(store().conversationId).toBe(first)
    expect(store().executionState).toBe('thinking')
    expect(store().backgroundRunId).toBeNull()

    release()
    await pending
    expect(store().messages.at(-1)?.content).toBe('第一段，第二段。')
    expect(store().executionState).toBe('idle')
    expect(store().sessionId).toBe('cps_back')
  })

  test('取消排队：排队的消息不再发送', async () => {
    const release = gatedAnswer('cps_cancel')
    const pending = store().submitUserMessage('长问题', projectCtx)
    await vi.waitFor(() => expect(store().messages.at(-1)?.content).toBe('第一段'))
    await store().submitUserMessage('同一分页里再问一句', projectCtx)
    expect(store().queuedMessage?.text).toBe('同一分页里再问一句')
    store().cancelQueuedMessage()
    release()
    await pending
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(copilotMocks.submitTurnStream).toHaveBeenCalledTimes(1)
    expect(store().messages.some((m) => m.content === '同一分页里再问一句')).toBe(false)
  })
})
