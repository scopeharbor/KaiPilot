/**
 * 矛盾求解对话流 Store 测试（v3-triz-contradiction-copilot W5 · tasks 5.1/5.4/5.5）。
 *
 * 伪后端：`vi.stubGlobal('fetch')` 按真实端点契约应答（受理 / 执行 / 确认 / 改判），
 * 断言全部落在**请求计数与载荷**上：
 * - 受理→澄清两轮→第 3 轮触顶（不停在空结果）；
 * - 零自动落库：选定方案只改本地态；预览是唯一写工具 execute；确认前零 confirm；
 * - 「三秒内无确认点击 → 零写请求」（无定时器、无自动提交路径）；
 * - 取消 / 无权限 是物理阻断：请求计数 = 0；
 * - 409 防御：冲突态 + 重新预览换新令牌，绝不静默重试；
 * - 写工具集合泛化：矛盾落库预览与排程待确认预览互斥（RL-01 唯一可确认卡）。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  SCHEDULE_STALE_DISPLAY_TEXT,
  TRIZ_CONFIRM_PERMISSION_DENIED_TEXT,
  TRIZ_SOLVE_PERMISSION_DENIED_TEXT,
  TRIZ_WRITE_PERMISSION_DENIED_TEXT,
  useNextAiColleagueStore,
  type ColleagueTrizRun,
} from '@/stores/next-ai-colleague-store'
import { COLLEAGUE_CONTEXT_MISSING_TEXT } from '@/lib/next/ai-colleague-intent'
import {
  installTrizFakeBackend,
  makeCommitEnvelope,
  makeContext,
  makePreviewEnvelope,
  makeSolveResponse,
  TRIZ_FULL_PERMISSIONS,
  TRIZ_PROJECT_ID,
  type TrizFakeBackend,
} from './_next-triz-copilot-fixtures'

let backend: TrizFakeBackend
const STATEMENT = '矛盾求解：客户催进度，但再加人测试就跟不上了'

beforeEach(() => {
  backend = installTrizFakeBackend()
  useNextAiColleagueStore.setState({
    isOpen: false,
    executionState: 'idle',
    messages: [],
    pendingAction: null,
    pendingTriz: null,
    context: null,
  })
})

afterEach(() => {
  backend.restore()
  vi.useRealTimers()
})

function lastTrizRun(): ColleagueTrizRun {
  const messages = useNextAiColleagueStore.getState().messages
  for (const message of [...messages].reverse()) {
    if (message.trizRun) return message.trizRun
  }
  throw new Error('未找到矛盾求解运行消息')
}

function trizMessageId(): string {
  const messages = useNextAiColleagueStore.getState().messages
  for (const message of [...messages].reverse()) {
    if (message.trizRun) return message.id
  }
  throw new Error('未找到矛盾求解运行消息')
}

describe('受理与澄清链（tasks 5.1）', () => {
  test('图表馆令牌（矛盾矩阵）不触发求解：留给导航规则，零求解请求', async () => {
    const store = useNextAiColleagueStore.getState()

    await store.submitUserMessage('查看矛盾矩阵', makeContext())

    expect(backend.count('/triz-copilot/analyses')).toBe(0)
    const messages = useNextAiColleagueStore.getState().messages
    expect(messages.some((message) => message.trizRun)).toBe(false)
  })

  test('受理：陈述经 /triz-copilot/analyses 求解并落定运行态（含映射依据与 Top 3）', async () => {
    backend.enqueueSolve(makeSolveResponse())
    const store = useNextAiColleagueStore.getState()

    await store.submitUserMessage(STATEMENT, makeContext())

    const run = lastTrizRun()
    expect(run.phase).toBe('solved')
    expect(run.analysisId).toBe(501)
    expect(run.contradictionTypeLabel).toBe('技术矛盾')
    expect(run.mapping?.improvingParameter?.number).toBe(25)
    expect(run.solutions).toHaveLength(3)
    expect(run.excludedPrincipleNumbers).toEqual([31])
    expect(backend.count('/triz-copilot/analyses')).toBe(1)
    expect(backend.calls[0]?.body).toEqual({
      statement: '客户催进度，但再加人测试就跟不上了',
    })
    expect(useNextAiColleagueStore.getState().executionState).toBe('idle')
  })

  test('澄清两轮：自由文本回答自动挂到上一轮分析记录下，第 3 轮返回触顶且不停在空结果', async () => {
    backend.enqueueSolve(
      makeSolveResponse({
        id: 501,
        clarification: {
          needed: true,
          asked: true,
          round: 1,
          prompt: '请补充：你希望改善的那一项',
        },
      }),
    )
    backend.enqueueSolve(
      makeSolveResponse({
        id: 502,
        parentAnalysisId: 501,
        clarification: {
          needed: true,
          asked: true,
          round: 2,
          prompt: '再补充一句：因此变差的那一项',
        },
      }),
    )
    backend.enqueueSolve(
      makeSolveResponse({
        id: 503,
        parentAnalysisId: 502,
        clarification: {
          needed: true,
          asked: false,
          round: 2,
          exhausted: true,
          reason: '澄清追问已达上限（2 轮）',
        },
        budgetState: 'exhausted',
        budgetReason: '澄清追问已达上限（2 轮）',
      }),
    )
    const store = useNextAiColleagueStore.getState()

    await store.submitUserMessage(STATEMENT, makeContext())
    expect(lastTrizRun().phase).toBe('clarifying')
    expect(lastTrizRun().clarificationRound).toBe(1)

    // 第 1 轮回答（自由文本：不命中任何意图规则，靠澄清上下文路由）
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('我想改善进度，但质量会跟着变差', makeContext())
    expect(lastTrizRun().phase).toBe('clarifying')
    expect(lastTrizRun().clarificationRound).toBe(2)

    // 第 2 轮回答 → 服务端不再追问（触顶），中间成果照常返回
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('我想压缩成本，但范围会缩水', makeContext())

    const run = lastTrizRun()
    expect(run.phase).toBe('exhausted')
    expect(run.clarificationRound).toBe(2)
    expect(run.maxClarificationRounds).toBe(2)
    expect(run.budgetState).toBe('exhausted')
    // 中间成果仍在：方案可继续选定（不停在空结果）
    expect(run.solutions).toHaveLength(3)
    expect(run.mapping).not.toBeNull()

    // 三次受理请求，澄清链 parentAnalysisId 逐轮串联
    const solveBodies = backend.calls
      .filter((call) => call.url.includes('/triz-copilot/analyses'))
      .map((call) => call.body)
    expect(solveBodies).toHaveLength(3)
    expect(solveBodies[1]?.parentAnalysisId).toBe(501)
    expect(solveBodies[2]?.parentAnalysisId).toBe(502)
  })

  test('澄清回答入口：answerTrizClarification 携带上一轮记录 ID 并追加用户消息', async () => {
    backend.enqueueSolve(
      makeSolveResponse({
        id: 501,
        clarification: { needed: true, asked: true, round: 1, prompt: '请补充…' },
      }),
    )
    backend.enqueueSolve(makeSolveResponse({ id: 502, parentAnalysisId: 501 }))
    const store = useNextAiColleagueStore.getState()

    await store.submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()
    await useNextAiColleagueStore
      .getState()
      .answerTrizClarification(messageId, '我想提高质量，但工期会被拖长')

    const messages = useNextAiColleagueStore.getState().messages
    expect(messages.at(-2)?.content).toBe('我想提高质量，但工期会被拖长')
    expect(messages.at(-1)?.trizRun?.phase).toBe('solved')
    // 上一轮运行消息标记为已补充，避免重复回答同一轮
    const answered = messages.find((message) => message.id === messageId)
    expect(answered?.trizRun?.phase).toBe('answered')
  })
})

describe('权限物理阻断（task 5.5）', () => {
  test('无 ai:trigger：零请求 + 中性提示', async () => {
    const store = useNextAiColleagueStore.getState()

    await store.submitUserMessage(
      STATEMENT,
      makeContext({ permissions: ['project:view', 'task:view'] }),
    )

    expect(backend.calls).toHaveLength(0)
    const messages = useNextAiColleagueStore.getState().messages
    expect(messages.at(-1)?.content).toBe(TRIZ_SOLVE_PERMISSION_DENIED_TEXT)
    expect(messages.at(-1)?.trizRun).toBeUndefined()
  })

  test('上下文缺权限声明同样失败关闭（不猜测放行）', async () => {
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage(STATEMENT, makeContext({ permissions: undefined }))

    expect(backend.calls).toHaveLength(0)
  })

  test('无目标实体写权限：选「风险」零写请求 + 中性提示（可改选其他类型）', async () => {
    backend.enqueueSolve(makeSolveResponse())
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()
    useNextAiColleagueStore.getState().selectTrizSolution(messageId, 2)

    useNextAiColleagueStore.setState({
      context: makeContext({
        permissions: TRIZ_FULL_PERMISSIONS.filter((permission) => permission !== 'risk:manage'),
      }),
    })
    await useNextAiColleagueStore.getState().previewTrizIntervention(messageId, 'risk')

    expect(backend.count('/ai/tools/execute')).toBe(0)
    expect(backend.count('/ai/tools/confirm')).toBe(0)
    const run = lastTrizRun()
    expect(run.phase).toBe('solved')
    expect(run.error?.code).toBe('PERMISSION_DENIED')
    expect(run.error?.message).toBe(TRIZ_WRITE_PERMISSION_DENIED_TEXT)
  })

  test('无 ai:confirm：确认被阻断，零 confirm 请求', async () => {
    backend.enqueueSolve(makeSolveResponse())
    backend.enqueueExecute(makePreviewEnvelope('task'))
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()
    useNextAiColleagueStore.getState().selectTrizSolution(messageId, 2)
    await useNextAiColleagueStore.getState().previewTrizIntervention(messageId, 'task')
    expect(lastTrizRun().phase).toBe('preview_ready')

    useNextAiColleagueStore.setState({
      context: makeContext({
        permissions: TRIZ_FULL_PERMISSIONS.filter((permission) => permission !== 'ai:confirm'),
      }),
    })
    const accepted = await useNextAiColleagueStore.getState().confirmTrizIntervention(messageId)

    expect(accepted).toBe(false)
    expect(backend.count('/ai/tools/confirm')).toBe(0)
    expect(lastTrizRun().error?.message).toBe(TRIZ_CONFIRM_PERMISSION_DENIED_TEXT)
  })

  test('项目上下文缺失：受理前给出诚实引导且零请求', async () => {
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage(STATEMENT, makeContext({ currentProjectId: null, pathname: '/next' }))

    expect(backend.calls).toHaveLength(0)
    expect(useNextAiColleagueStore.getState().messages.at(-1)?.content).toBe(
      COLLEAGUE_CONTEXT_MISSING_TEXT,
    )
  })
})

describe('落库两阶段与零自动执行（task 5.4）', () => {
  async function reachPreviewReady(target: 'task' | 'risk' | 'change_request' = 'task') {
    backend.enqueueSolve(makeSolveResponse())
    backend.enqueueExecute(makePreviewEnvelope(target))
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()
    useNextAiColleagueStore.getState().selectTrizSolution(messageId, 2)
    await useNextAiColleagueStore.getState().previewTrizIntervention(messageId, target)
    return messageId
  }

  test('选定方案本身零请求；选落库类型才发一次 execute（阶段一业务表零写入）', async () => {
    backend.enqueueSolve(makeSolveResponse())
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()

    useNextAiColleagueStore.getState().selectTrizSolution(messageId, 2)
    expect(backend.count('/ai/tools/execute')).toBe(0)
    expect(backend.count('/ai/tools/confirm')).toBe(0)
    expect(lastTrizRun().selectedSolutionIndex).toBe(2)
    expect(lastTrizRun().phase).toBe('solved')

    backend.enqueueExecute(makePreviewEnvelope('risk'))
    await useNextAiColleagueStore.getState().previewTrizIntervention(messageId, 'risk')

    expect(backend.count('/ai/tools/execute')).toBe(1)
    expect(backend.calls.at(-1)?.body).toEqual({
      toolName: 'create_risk_from_intervention',
      parameters: {
        projectId: TRIZ_PROJECT_ID,
        analysisId: 501,
        solutionIndex: 2,
      },
    })
    const run = lastTrizRun()
    expect(run.phase).toBe('preview_ready')
    expect(run.previewToken).toBe('a'.repeat(64))
    expect(run.diff?.target).toBe('risk')
    // 预览后仍未提交：零 confirm（零自动落库）
    expect(backend.count('/ai/tools/confirm')).toBe(0)
  })

  test('三秒内无确认点击 → 零写请求（无定时器 / 无自动提交路径）', async () => {
    vi.useFakeTimers()
    const messageId = await reachPreviewReady('risk')

    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(3000)

    expect(backend.count('/ai/tools/confirm')).toBe(0)
    expect(lastTrizRun().phase).toBe('preview_ready')
    expect(useNextAiColleagueStore.getState().pendingTriz?.messageId).toBe(messageId)
  })

  test('显式确认：携带 previewToken 单次提交 → 回执（分析记录 / 方案序号 / 原则编号）', async () => {
    const messageId = await reachPreviewReady('risk')
    backend.enqueueConfirm(makeCommitEnvelope('risk'))

    const accepted = await useNextAiColleagueStore
      .getState()
      .confirmTrizIntervention(messageId, 'a'.repeat(64))

    expect(accepted).toBe(true)
    expect(backend.count('/ai/tools/confirm')).toBe(1)
    expect(backend.calls.at(-1)?.body).toEqual({
      toolName: 'create_risk_from_intervention',
      previewToken: 'a'.repeat(64),
      parameters: { projectId: TRIZ_PROJECT_ID, analysisId: 501, solutionIndex: 2 },
    })
    const run = lastTrizRun()
    expect(run.phase).toBe('committed')
    expect(run.receipt).toMatchObject({
      target: 'risk',
      entityId: 9001,
      analysisId: 501,
      solutionIndex: 2,
      principleNumber: 28,
    })
    expect(useNextAiColleagueStore.getState().pendingTriz).toBeNull()
  })

  test('重复点击确认：令牌已失效，零第二次请求（防重复写入）', async () => {
    const messageId = await reachPreviewReady('task')
    backend.enqueueConfirm(makeCommitEnvelope('task'))
    await useNextAiColleagueStore.getState().confirmTrizIntervention(messageId)

    const again = await useNextAiColleagueStore.getState().confirmTrizIntervention(messageId)

    expect(again).toBe(false)
    expect(backend.count('/ai/tools/confirm')).toBe(1)
  })

  test('令牌身份校验：旧卡令牌确认被拒（零请求）', async () => {
    const messageId = await reachPreviewReady('task')

    const accepted = await useNextAiColleagueStore
      .getState()
      .confirmTrizIntervention(messageId, 'f'.repeat(64))

    expect(accepted).toBe(false)
    expect(backend.count('/ai/tools/confirm')).toBe(0)
  })

  test('放弃落库：本地销毁令牌、零写请求、零 confirm', async () => {
    const messageId = await reachPreviewReady('task')

    useNextAiColleagueStore.getState().cancelTrizIntervention(messageId)

    const run = lastTrizRun()
    expect(run.phase).toBe('cancelled')
    expect(run.previewToken).toBeNull()
    expect(backend.count('/ai/tools/confirm')).toBe(0)
    expect(useNextAiColleagueStore.getState().pendingTriz).toBeNull()
  })

  test('409 防御：确认冲突 → conflict 态，重新预览换新令牌（不静默重试）', async () => {
    const messageId = await reachPreviewReady('risk')
    backend.enqueueConfirm({ error: { code: 'SCHEDULE_STALE', message: '预览已过期' } }, 409)

    const accepted = await useNextAiColleagueStore
      .getState()
      .confirmTrizIntervention(messageId, 'a'.repeat(64))

    expect(accepted).toBe(false)
    expect(lastTrizRun().phase).toBe('conflict')
    expect(lastTrizRun().error).toMatchObject({ code: 'SCHEDULE_STALE', status: 409 })
    expect(lastTrizRun().error?.message).toBe(SCHEDULE_STALE_DISPLAY_TEXT)

    // 重新预览：再次 execute 换新令牌，确认请求仍只有那一次（无静默重试）
    backend.enqueueExecute(makePreviewEnvelope('risk', 'b'.repeat(64)))
    await useNextAiColleagueStore.getState().retryTrizPreview(messageId)

    expect(lastTrizRun().phase).toBe('preview_ready')
    expect(lastTrizRun().previewToken).toBe('b'.repeat(64))
    expect(backend.count('/ai/tools/confirm')).toBe(1)
    expect(backend.count('/ai/tools/execute')).toBe(2)
  })

  test('execute 阶段 409：同样进入 conflict 态并提供重新预览入口', async () => {
    backend.enqueueSolve(makeSolveResponse())
    backend.enqueueExecute({ error: { code: 'SCHEDULE_STALE', message: '冲突' } }, 409)
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()
    useNextAiColleagueStore.getState().selectTrizSolution(messageId, 1)

    await useNextAiColleagueStore.getState().previewTrizIntervention(messageId, 'task')

    expect(lastTrizRun().phase).toBe('conflict')
    expect(lastTrizRun().previewToken).toBeNull()
    expect(backend.count('/ai/tools/confirm')).toBe(0)
  })

  test('降级（澄清触顶）后仍可完成确认链路：选定 → 预览 → 确认 → 回执', async () => {
    backend.enqueueSolve(
      makeSolveResponse({
        clarification: {
          needed: true,
          asked: false,
          round: 2,
          exhausted: true,
          reason: '澄清追问已达上限（2 轮）',
        },
        budgetState: 'exhausted',
        budgetReason: '澄清追问已达上限（2 轮）',
      }),
    )
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()
    expect(lastTrizRun().phase).toBe('exhausted')
    expect(lastTrizRun().solutions).toHaveLength(3)

    useNextAiColleagueStore.getState().selectTrizSolution(messageId, 1)
    backend.enqueueExecute(makePreviewEnvelope('task'))
    await useNextAiColleagueStore.getState().previewTrizIntervention(messageId, 'task')
    expect(lastTrizRun().phase).toBe('preview_ready')

    backend.enqueueConfirm(makeCommitEnvelope('task'))
    const accepted = await useNextAiColleagueStore
      .getState()
      .confirmTrizIntervention(messageId, 'a'.repeat(64))

    expect(accepted).toBe(true)
    expect(lastTrizRun().phase).toBe('committed')
    expect(lastTrizRun().receipt?.principleNumber).toBe(28)
  })
})

describe('映射依据改判（task 5.3）', () => {
  test('改判触发重算：只改分析记录，业务数据零写入请求', async () => {
    backend.enqueueSolve(makeSolveResponse())
    const store = useNextAiColleagueStore.getState()
    await store.submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()

    backend.enqueueOverride({
      data: {
        ...makeSolveResponse().data,
        humanOverride: true,
        worseningParameter: {
          number: 36,
          nameZh: '系统的复杂性',
          displayName: '系统与组织复杂度',
          pmMeaning: '组织与系统的耦合复杂度',
        },
        change: {
          from: { improvingParameter: 25, worseningParameter: 27 },
          to: { improvingParameter: 25, worseningParameter: 36 },
        },
      },
    })
    await useNextAiColleagueStore
      .getState()
      .overrideTrizParameters(messageId, { worseningParameter: 36 })

    const run = lastTrizRun()
    expect(run.humanOverride).toBe(true)
    expect(run.mapping?.worseningParameter?.number).toBe(36)
    expect(run.excludedPrincipleNumbers).toBeDefined()
    const overrideCalls = backend.calls.filter((call) => call.url.includes('/override'))
    expect(overrideCalls).toHaveLength(1)
    expect(overrideCalls[0]?.body).toEqual({ worseningParameter: 36 })
    // 改判是分析记录级操作：不产生任何写工具请求
    expect(backend.count('/ai/tools/execute')).toBe(0)
    expect(backend.count('/ai/tools/confirm')).toBe(0)
  })
})

describe('写工具集合泛化（RL-01 唯一可确认卡）', () => {
  test('矛盾落库预览取代排程待确认预览：旧排程卡作废且零 confirm', async () => {
    // 先制造一张排程待确认卡
    backend.enqueueExecute({
      data: { projectId: TRIZ_PROJECT_ID, committed: false, changes: [] },
      meta: {
        toolName: 'update_task_schedule',
        status: 'PREVIEW_REQUIRED',
        durationMs: 5,
        previewToken: 'c'.repeat(64),
        diff: [],
      },
    })
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('延期任务 12 至 2026-09-15', makeContext())
    expect(useNextAiColleagueStore.getState().pendingAction?.previewToken).toBe('c'.repeat(64))

    backend.enqueueSolve(makeSolveResponse())
    await useNextAiColleagueStore.getState().submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()
    useNextAiColleagueStore.getState().selectTrizSolution(messageId, 1)
    backend.enqueueExecute(makePreviewEnvelope('task'))
    await useNextAiColleagueStore.getState().previewTrizIntervention(messageId, 'task')

    const state = useNextAiColleagueStore.getState()
    expect(state.pendingAction).toBeNull()
    expect(state.pendingTriz?.messageId).toBe(messageId)
    const scheduleCard = state.messages.find(
      (message) => message.toolExecution?.toolName === 'update_task_schedule',
    )
    expect(scheduleCard?.toolExecution?.status).toBe('cancelled')
    expect(backend.count('/ai/tools/confirm')).toBe(0)
  })

  test('新的排程写操作发起时，矛盾落库待确认预览被作废', async () => {
    backend.enqueueSolve(makeSolveResponse())
    backend.enqueueExecute(makePreviewEnvelope('task'))
    await useNextAiColleagueStore.getState().submitUserMessage(STATEMENT, makeContext())
    const messageId = trizMessageId()
    useNextAiColleagueStore.getState().selectTrizSolution(messageId, 1)
    await useNextAiColleagueStore.getState().previewTrizIntervention(messageId, 'task')
    expect(useNextAiColleagueStore.getState().pendingTriz).not.toBeNull()

    backend.enqueueExecute({
      data: { projectId: TRIZ_PROJECT_ID, committed: false, changes: [] },
      meta: {
        toolName: 'update_task_schedule',
        status: 'PREVIEW_REQUIRED',
        durationMs: 5,
        previewToken: 'd'.repeat(64),
        diff: [],
      },
    })
    await useNextAiColleagueStore
      .getState()
      .submitUserMessage('延期任务 12 至 2026-09-18', makeContext())

    expect(lastTrizRun().phase).toBe('cancelled')
    expect(useNextAiColleagueStore.getState().pendingTriz).toBeNull()
    expect(useNextAiColleagueStore.getState().pendingAction?.previewToken).toBe('d'.repeat(64))
  })
})
