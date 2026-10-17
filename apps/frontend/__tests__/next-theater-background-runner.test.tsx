/**
 * 生成剧场后台运行：离开剧场页继续生成；不在剧场页时常驻进度卡片与通知，点一下回生成剧场。
 */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProjectDraft } from '@aiproj/types'
import { startTheaterRunner } from '@/lib/next/theater-runner'
import { describeTheaterRun } from '@/lib/next/theater-run-status'
import { TheaterBackgroundRunner } from '@/components/next/theater/TheaterBackgroundRunner'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  understanding: vi.fn(),
  push: vi.fn(),
  pathname: '/next/projects/7',
  toast: vi.fn(),
}))

vi.mock('@/lib/api/ai-intent', () => ({ aiIntentApi: { analyze: mocks.analyze } }))
vi.mock('@/lib/api/ai-draft', () => ({
  aiDraftApi: { understanding: mocks.understanding },
}))
vi.mock('@/lib/next/theater-sse-client', () => ({ runDraftGenerationStream: vi.fn() }))
vi.mock('@/lib/api/ai-tools', () => ({
  aiToolsApi: { chooseTheaterAnswer: vi.fn(), suggestReplies: vi.fn() },
  isScheduleStaleError: () => false,
}))
vi.mock('@/components/ui/Toast', () => ({ toast: mocks.toast }))
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn() }),
}))

const draftState = () => useAiProjectDraftStore.getState()

beforeEach(() => {
  for (const key of ['analyze', 'understanding', 'push', 'toast'] as const) mocks[key].mockReset()
  mocks.pathname = '/next/projects/7'
  draftState().restart()
  useNextAiColleagueStore.setState({ theaterLink: null, pendingGenerationChoice: null })
})

describe('后台运行器', () => {
  test('剧场页卸载不中止分析：外壳仍持有运行器，结果照常写回', async () => {
    let resolveAnalysis: (value: unknown) => void = () => undefined
    let signal: AbortSignal | null = null
    mocks.analyze.mockImplementation((_body: unknown, abortSignal: AbortSignal) => {
      signal = abortSignal
      return new Promise((resolve) => {
        resolveAnalysis = resolve
      })
    })
    const releaseShell = startTheaterRunner()
    const releasePage = startTheaterRunner()
    act(() => {
      draftState().setRawInput('筹办一场校园演唱会，预计 2000 名观众')
      draftState().startAnalyzing()
    })
    expect(mocks.analyze).toHaveBeenCalledTimes(1)
    releasePage() // 离开剧场页
    expect(signal!.aborted).toBe(false)
    const applied = vi.spyOn(draftState(), 'applyAnalysis')
    await act(async () => {
      resolveAnalysis({ cards: [], branch: 'ready' })
    })
    expect(applied).toHaveBeenCalled()
    releaseShell()
    expect(signal!.aborted).toBe(false)
  })

  test('全部使用者都释放后才停止（中止在途分析）', () => {
    let signal: AbortSignal | null = null
    mocks.analyze.mockImplementation((_body: unknown, abortSignal: AbortSignal) => {
      signal = abortSignal
      return new Promise(() => undefined)
    })
    const release = startTheaterRunner()
    act(() => {
      draftState().setRawInput('筹办一场校园演唱会，预计 2000 名观众')
      draftState().startAnalyzing()
    })
    release()
    expect(signal!.aborted).toBe(true)
  })
})

describe('运行状态描述', () => {
  test('手动模式等回答 / 草案待审查需要提醒；全自动下不打扰，失败与转正完成都提醒', () => {
    useAiProjectDraftStore.setState({
      status: 'clarifying',
      rawInput: '校园演唱会',
      activeCard: { cardId: 'c1', title: '团队有几个人？' } as never,
      cards: [],
    })
    const manual = describeTheaterRun(draftState(), false)
    expect(manual).toMatchObject({ phase: 'clarifying', attention: true, auto: false })
    expect(manual.detail).toBe('团队有几个人？')
    expect(describeTheaterRun(draftState(), true).attention).toBe(false)

    useAiProjectDraftStore.setState({
      status: 'ready',
      draft: { tasks: [] } as unknown as ProjectDraft,
      validation: { blocking: [], warning: [], info: [], canConfirm: true } as never,
      draftStatus: null,
      draftId: 'df_1',
    })
    expect(describeTheaterRun(draftState(), false)).toMatchObject({
      phase: 'review',
      attention: true,
    })
    expect(describeTheaterRun(draftState(), true)).toMatchObject({
      phase: 'auto_confirming',
      attention: false,
    })

    useAiProjectDraftStore.setState({
      draftStatus: 'confirmed',
      confirmResponse: { projectId: 42, createdCounts: {} } as never,
    })
    expect(describeTheaterRun(draftState(), false)).toMatchObject({
      phase: 'confirmed',
      attention: true,
      href: '/next/projects/42',
    })

    useAiProjectDraftStore.setState({ draftStatus: 'error', error: '[X] 模型超时' })
    expect(describeTheaterRun(draftState(), true)).toMatchObject({
      phase: 'error',
      attention: true,
    })
  })
})

describe('离开剧场页时的通知', () => {
  test('需要处理时弹出带按钮的提醒，点按钮回生成剧场；同一件事只提醒一次；在剧场页不提醒；不显示常驻卡片', () => {
    useAiProjectDraftStore.setState({
      status: 'clarifying',
      rawInput: '校园演唱会',
      activeCard: { cardId: 'c1', title: '团队有几个人？' } as never,
      cards: [],
    })
    const { unmount, rerender } = render(<TheaterBackgroundRunner />)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    const options = mocks.toast.mock.calls[0]![0]
    expect(options.title).toBe('生成剧场在等你回答问题')
    expect(options.description).toBe('团队有几个人？')
    expect(options.action.label).toBe('前往生成剧场')
    options.action.onClick()
    expect(mocks.push).toHaveBeenCalledWith('/next/create')
    expect(document.querySelector('[data-theater-run-dock]')).toBeNull()
    rerender(<TheaterBackgroundRunner />)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    unmount()

    mocks.toast.mockReset()
    mocks.pathname = '/next/create'
    useAiProjectDraftStore.setState({ activeCard: { cardId: 'c3', title: '预算？' } as never })
    const onTheater = render(<TheaterBackgroundRunner />)
    expect(mocks.toast).not.toHaveBeenCalled()
    onTheater.unmount()
  })

  test('全自动：追问由 AI 同事回答，不打扰；转正完成提醒并可打开项目', () => {
    useNextAiColleagueStore.setState({ theaterLink: { mode: 'auto' }, messages: [] })
    useAiProjectDraftStore.setState({
      status: 'clarifying',
      activeCard: { cardId: 'c2', title: '预算？' } as never,
      cards: [],
    })
    const { unmount, rerender } = render(<TheaterBackgroundRunner />)
    expect(mocks.toast).not.toHaveBeenCalled()
    useNextAiColleagueStore.setState({ theaterLink: null })
    useAiProjectDraftStore.setState({
      draft: { tasks: [] } as unknown as ProjectDraft,
      validation: { blocking: [], warning: [], info: [], canConfirm: true } as never,
      draftStatus: 'confirmed',
      confirmResponse: { projectId: 42, createdCounts: {} } as never,
    })
    rerender(<TheaterBackgroundRunner />)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    const options = mocks.toast.mock.calls[0]![0]
    expect(options.variant).toBe('success')
    expect(options.action.label).toBe('打开项目')
    options.action.onClick()
    expect(mocks.push).toHaveBeenCalledWith('/next/projects/42')
    unmount()
  })

  test('一键生成弹窗：选「带我到生成剧场」与对话里的问题卡同步', async () => {
    useNextAiColleagueStore.setState({
      messages: [
        {
          id: 'q1',
          sender: 'assistant',
          timestamp: Date.now(),
          question: {
            kind: 'generation_mode',
            meta: { idea: '筹办一场校园演唱会' },
            prompt: '要怎么生成？',
            options: [],
            status: 'open',
          },
        },
      ] as never,
      pendingGenerationChoice: {
        idea: '筹办一场校园演唱会',
        messageId: 'q1',
        canConfirm: true,
        modelLabel: 'DeepSeek',
      },
    })
    const { unmount } = render(<TheaterBackgroundRunner />)
    expect(screen.getByText('使用模型：DeepSeek')).toBeTruthy()
    await act(async () => {
      fireEvent.click(document.querySelector('[data-generation-mode="cancel"]')!)
    })
    const state = useNextAiColleagueStore.getState()
    expect(state.pendingGenerationChoice).toBeNull()
    expect(state.messages[0]!.question?.status).toBe('skipped')
    expect(state.messages.at(-1)?.content).toContain('先不生成')
    unmount()
  })
})
