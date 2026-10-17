/**
 * v3-triz-copilot-followups · tasks 8.1/8.2 —— B2 信号血缘带入求解流测试。
 *
 * 覆盖：
 * 1. 信号卡唤起求解流（openSignalSolverFlow）后，store 中创建的运行态包含正确的 sourceSignalId；
 * 2. 断言调用 solve 接口的网络载荷中包含该字段；
 * 3. 澄清续轮时，下一轮运行态与 solve 请求继承 sourceSignalId；
 * 4. 自由文本发起的求解，运行态 sourceSignalId 为 null，网络载荷中 sourceSignalId 为 undefined；
 * 5. 结构化传参优先于文本正则兜底；
 * 6. 文本正则兜底兼容机制；
 * 7. 权限不足时物理阻断，零 solve 请求发往服务端。
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { waitFor } from '@testing-library/react'
import {
  buildSignalSolverMessage,
  buildSignalSolverStatement,
  openSignalSolverFlow,
  signalSolverColleagueContext,
} from '@/lib/next/signals/signal-solver-handoff'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import { useAuthStore } from '@/stores/auth-store'
import { makeSignal } from './helpers/project-signals-fixtures'
import {
  installTrizFakeBackend,
  makeContext,
  makeSolveResponse,
  type TrizFakeBackend,
} from './_next-triz-copilot-fixtures'

const TEST_PROJECT_ID = 101
const TEST_SIGNAL_ID = 208

let backend: TrizFakeBackend

beforeEach(() => {
  backend = installTrizFakeBackend()
  useAuthStore.setState({ user: null, permissions: [] })
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
})

describe('task 8.1 / 8.2：B2 信号血缘带入求解流', () => {
  describe('信号卡跳转发起求解（结构化 sourceSignalId 带入）', () => {
    test('断言信号卡唤起求解流后运行态含正确 sourceSignalId', async () => {
      backend.enqueueSolve(makeSolveResponse({ id: 501 }))
      const signal = makeSignal({ id: TEST_SIGNAL_ID, projectId: TEST_PROJECT_ID })

      openSignalSolverFlow({
        projectId: TEST_PROJECT_ID,
        signal,
        permissions: ['ai:trigger', 'project:view'],
      })

      // 面板立即打开
      const stateAfterOpen = useNextAiColleagueStore.getState()
      expect(stateAfterOpen.isOpen).toBe(true)

      // 首条用户消息格式正确
      const userMessage = stateAfterOpen.messages[0]
      expect(userMessage?.sender).toBe('user')
      expect(userMessage?.content).toBe(`矛盾求解 PROJ-${TEST_PROJECT_ID}#S${TEST_SIGNAL_ID}`)

      // 等待助手回复挂载运行态
      await waitFor(() => {
        const assistantMsg = useNextAiColleagueStore
          .getState()
          .messages.find((m) => m.sender === 'assistant' && m.trizRun)
        expect(assistantMsg).toBeDefined()
        expect(assistantMsg?.trizRun?.sourceSignalId).toBe(TEST_SIGNAL_ID)
      })

      const finalState = useNextAiColleagueStore.getState()
      const trizRun = finalState.messages.find((m) => m.trizRun)?.trizRun
      expect(trizRun?.sourceSignalId).toBe(TEST_SIGNAL_ID)
      expect(trizRun?.projectId).toBe(TEST_PROJECT_ID)
      expect(trizRun?.analysisId).toBe(501)
    })

    test('断言 solve 请求网络载荷含 sourceSignalId 字段且值正确', async () => {
      backend.enqueueSolve(makeSolveResponse({ id: 502 }))
      const signal = makeSignal({ id: TEST_SIGNAL_ID, projectId: TEST_PROJECT_ID })

      openSignalSolverFlow({
        projectId: TEST_PROJECT_ID,
        signal,
        permissions: ['ai:trigger', 'project:view'],
      })

      await waitFor(() => {
        expect(backend.count('/triz-copilot/analyses')).toBe(1)
      })

      const solveCall = backend.calls.find((call) => call.url.includes('/triz-copilot/analyses'))
      expect(solveCall).toBeDefined()
      expect(solveCall?.method).toBe('POST')
      expect(solveCall?.body?.sourceSignalId).toBe(TEST_SIGNAL_ID)
      expect(typeof solveCall?.body?.statement).toBe('string')
    })

    test('澄清续轮继承 sourceSignalId：续轮请求载荷与新运行态仍携带原信号 ID', async () => {
      backend.enqueueSolve(
        makeSolveResponse({
          id: 601,
          clarification: {
            needed: true,
            asked: true,
            round: 1,
            maxRounds: 2,
            exhausted: false,
            prompt: '请补充：是进度更紧急还是质量底线更高？',
            reason: null,
          },
        }),
      )
      backend.enqueueSolve(makeSolveResponse({ id: 602, parentAnalysisId: 601 }))

      const signal = makeSignal({ id: TEST_SIGNAL_ID, projectId: TEST_PROJECT_ID })
      openSignalSolverFlow({
        projectId: TEST_PROJECT_ID,
        signal,
        permissions: ['ai:trigger', 'project:view'],
      })

      // 等待第一轮澄清卡就绪
      let firstMsgId = ''
      await waitFor(() => {
        const msg = useNextAiColleagueStore
          .getState()
          .messages.find((m) => m.trizRun?.phase === 'clarifying')
        expect(msg).toBeDefined()
        firstMsgId = msg!.id
      })

      // 用户提交澄清回答
      await useNextAiColleagueStore
        .getState()
        .answerTrizClarification(firstMsgId, '质量底线更高，不能牺牲质量')

      // 等待第二轮求解完成
      await waitFor(() => {
        expect(backend.count('/triz-copilot/analyses')).toBe(2)
      })

      // 断言第二轮网络载荷同样携带 sourceSignalId 与 parentAnalysisId
      const secondCall = backend.calls.filter((call) =>
        call.url.includes('/triz-copilot/analyses'),
      )[1]
      expect(secondCall?.body?.sourceSignalId).toBe(TEST_SIGNAL_ID)
      expect(secondCall?.body?.parentAnalysisId).toBe(601)

      // 断言第二轮助手运行态 sourceSignalId 依然为 TEST_SIGNAL_ID
      const messages = useNextAiColleagueStore.getState().messages
      const latestAssistant = [...messages].reverse().find((m) => m.sender === 'assistant')
      expect(latestAssistant?.trizRun?.sourceSignalId).toBe(TEST_SIGNAL_ID)
    })
  })

  describe('自由文本发起的求解（无信号血缘）', () => {
    test('断言自由文本发起的求解 sourceSignalId 为 null/undefined', async () => {
      backend.enqueueSolve(makeSolveResponse({ id: 701 }))

      const context = makeContext({
        currentProjectId: TEST_PROJECT_ID,
        sourceSignalId: null,
      })

      await useNextAiColleagueStore
        .getState()
        .submitUserMessage('矛盾求解：客户催进度，但再加人测试就跟不上了', context)

      await waitFor(() => {
        expect(backend.count('/triz-copilot/analyses')).toBe(1)
      })

      // 断言网络请求中无 sourceSignalId（undefined / 不提交该字段）
      const solveCall = backend.calls.find((call) => call.url.includes('/triz-copilot/analyses'))
      expect(solveCall).toBeDefined()
      expect(solveCall?.body?.sourceSignalId).toBeUndefined()

      // 断言运行态中 sourceSignalId 为 null
      const trizRun = useNextAiColleagueStore.getState().messages.find((m) => m.trizRun)?.trizRun
      expect(trizRun?.sourceSignalId).toBeNull()
    })

    test('结构化 context.sourceSignalId 优先于用户文本中的正则残留', async () => {
      backend.enqueueSolve(makeSolveResponse({ id: 702 }))

      // 模拟极端情况：用户自由文本中碰巧包含「信号 ID：#999」，但 context 结构化显式指定为 108
      const context = makeContext({
        currentProjectId: TEST_PROJECT_ID,
        sourceSignalId: TEST_SIGNAL_ID,
      })

      await useNextAiColleagueStore
        .getState()
        .submitUserMessage('矛盾求解：信号 ID：#999 读数超标需要处理', context)

      await waitFor(() => {
        expect(backend.count('/triz-copilot/analyses')).toBe(1)
      })

      const solveCall = backend.calls.find((call) => call.url.includes('/triz-copilot/analyses'))
      // 结构化 sourceSignalId 优先级高于文本正则
      expect(solveCall?.body?.sourceSignalId).toBe(TEST_SIGNAL_ID)

      const trizRun = useNextAiColleagueStore.getState().messages.find((m) => m.trizRun)?.trizRun
      expect(trizRun?.sourceSignalId).toBe(TEST_SIGNAL_ID)
    })

    test('文本正则兼容兜底：未传结构化 context.sourceSignalId 时从文本中解析信号 ID', async () => {
      backend.enqueueSolve(makeSolveResponse({ id: 703 }))

      const context = makeContext({
        currentProjectId: TEST_PROJECT_ID,
        sourceSignalId: null,
      })

      await useNextAiColleagueStore
        .getState()
        .submitUserMessage('矛盾求解：信号 ID：#350 进度延误严重', context)

      await waitFor(() => {
        expect(backend.count('/triz-copilot/analyses')).toBe(1)
      })

      const solveCall = backend.calls.find((call) => call.url.includes('/triz-copilot/analyses'))
      expect(solveCall?.body?.sourceSignalId).toBe(350)

      const trizRun = useNextAiColleagueStore.getState().messages.find((m) => m.trizRun)?.trizRun
      expect(trizRun?.sourceSignalId).toBe(350)
    })
  })

  describe('边界与权限防护', () => {
    test('主页首次点击从当前登录态读取权限，发起真实求解请求', async () => {
      useAuthStore.setState({ permissions: ['ai:trigger', 'project:view'] })
      backend.enqueueSolve(makeSolveResponse({ id: 801 }))
      openSignalSolverFlow({
        projectId: TEST_PROJECT_ID,
        signal: makeSignal({ id: TEST_SIGNAL_ID, projectId: TEST_PROJECT_ID }),
      })
      await waitFor(() => {
        expect(backend.count('/triz-copilot/analyses')).toBe(1)
        expect(
          useNextAiColleagueStore.getState().messages.find((m) => m.trizRun)?.trizRun?.analysisId,
        ).toBe(801)
      })
      expect(useNextAiColleagueStore.getState().context?.permissions).toEqual([
        'ai:trigger',
        'project:view',
      ])
    })

    test('不会沿用旧对话的权限或超管身份', () => {
      useAuthStore.setState({ permissions: ['project:view'] })
      useNextAiColleagueStore.setState({
        context: makeContext({ permissions: ['system:admin', 'ai:trigger'], isSuperAdmin: true }),
      })
      const context = signalSolverColleagueContext(TEST_PROJECT_ID, TEST_SIGNAL_ID)
      expect(context.permissions).toEqual(['project:view'])
      expect(context.isSuperAdmin).toBe(false)
      openSignalSolverFlow({
        projectId: TEST_PROJECT_ID,
        signal: makeSignal({ id: TEST_SIGNAL_ID, projectId: TEST_PROJECT_ID }),
      })
      expect(backend.count('/triz-copilot/analyses')).toBe(0)
      expect(
        useNextAiColleagueStore.getState().messages.find((m) => m.sender === 'assistant')?.content,
      ).toContain('缺少 ai:trigger')
    })

    test('缺少 ai:trigger 权限时物理阻断，零 solve 网络请求', async () => {
      const signal = makeSignal({ id: TEST_SIGNAL_ID, projectId: TEST_PROJECT_ID })

      openSignalSolverFlow({
        projectId: TEST_PROJECT_ID,
        signal,
        permissions: ['project:view'], // 缺少 ai:trigger
      })

      const state = useNextAiColleagueStore.getState()
      expect(state.isOpen).toBe(true)

      // 助手应返回权限阻断文案
      const assistantMsg = state.messages.find((m) => m.sender === 'assistant')
      expect(assistantMsg?.content).toContain('缺少 ai:trigger')

      // 网络请求为 0
      expect(backend.count('/triz-copilot/analyses')).toBe(0)
    })

    test('纯函数 signalSolverColleagueContext 结构化字段完整性', () => {
      const ctx = signalSolverColleagueContext(TEST_PROJECT_ID, TEST_SIGNAL_ID, ['ai:trigger'])
      expect(ctx.contextType).toBe('project_space')
      expect(ctx.currentProjectId).toBe(TEST_PROJECT_ID)
      expect(ctx.sourceSignalId).toBe(TEST_SIGNAL_ID)
      expect(ctx.pathname).toBe(`/next/projects/${TEST_PROJECT_ID}`)
      expect(ctx.permissions).toEqual(['ai:trigger'])
    })

    test('纯函数：对话里是短指令，交给求解端的是大白话陈述', () => {
      const signal = makeSignal({ id: TEST_SIGNAL_ID, projectId: TEST_PROJECT_ID })
      const message = buildSignalSolverMessage({
        projectId: TEST_PROJECT_ID,
        signal,
      })
      expect(message).toBe(`矛盾求解 PROJ-${TEST_PROJECT_ID}#S${TEST_SIGNAL_ID}`)

      const statement = buildSignalSolverStatement({ ...signal, projectName: '校园演唱会' })
      expect(statement).toContain('项目「校园演唱会」')
      expect(statement).toContain(signal.observationWindow)
      expect(statement).toContain('请分析其中的矛盾')
      // 不再把读数码（metric=… / 阈值 …）当成陈述
      expect(statement).not.toContain('metric=')
    })

    test('手动输入信号编号也能发起求解：按编号查信号，陈述为大白话', async () => {
      backend.enqueueSolve(makeSolveResponse({ id: 503 }))
      const signal = makeSignal({ id: TEST_SIGNAL_ID, projectId: TEST_PROJECT_ID })
      const store = useNextAiColleagueStore.getState()
      store.rememberSignalForSolve(signal)
      store.openPanel()
      await store.submitUserMessage(
        `帮我解决 PROJ-${TEST_PROJECT_ID}#S${TEST_SIGNAL_ID}`,
        makeContext({ permissions: ['ai:trigger', 'project:view'] }),
      )
      await waitFor(() => {
        const run = useNextAiColleagueStore.getState().messages.find((m) => m.trizRun)?.trizRun
        expect(run?.analysisId).toBe(503)
        expect(run?.sourceSignalId).toBe(TEST_SIGNAL_ID)
        expect(run?.sourceSignalCode).toBe(`PROJ-${TEST_PROJECT_ID}#S${TEST_SIGNAL_ID}`)
        expect(run?.statement).toContain('请分析其中的矛盾')
      })
    })
  })
})
