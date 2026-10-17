import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClarificationAnswer, ClarificationAnswers, ClarificationCard } from '@aiproj/types'
import { TheaterClarificationCard } from '@/components/next/theater/TheaterClarificationCard'
import { TheaterClarificationExplain } from '@/components/next/theater/TheaterClarificationExplain'

const { explainMock, analyzeMock } = vi.hoisted(() => ({
  explainMock: vi.fn(),
  analyzeMock: vi.fn(),
}))

// 只允许只读解释端点被调用；本分组任何交互都不得触发 analyze / 生成请求（RL-01）。
vi.mock('@/lib/api/ai-intent', () => ({
  aiIntentApi: {
    analyze: analyzeMock,
    explainStream: explainMock,
  },
  aiIntentKeys: { all: ['ai-intent'] as const, analyze: () => ['ai-intent', 'analyze'] as const },
}))

const RAW_INPUT = '搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计'

function makeCard(overrides: Partial<ClarificationCard>): ClarificationCard {
  return {
    cardId: 'card-critical-1',
    field: 'projectGoal',
    category: 'critical',
    title: '项目目标是什么？',
    description: '需要明确这次项目要达成的核心目标。',
    impactScope: [{ domain: '章程', severity: 'high' }],
    questionType: 'single_choice',
    quickOptions: [
      {
        label: '提升运营效率',
        value: '提升运营效率',
        description: '适合内部流程优化项目。',
        recommended: true,
      },
      {
        label: '验证商业模式',
        value: '验证商业模式',
        description: '适合探索型项目。',
      },
    ],
    customInput: {
      enabled: true,
      label: '补充自定义要求',
      placeholder: '输入专属要求…',
      description: '选项不合适时可以直接补充。',
    },
    defaultValue: null,
    confidence: 0.42,
    reasoning: '目标缺失。',
    allowSkip: false,
    isRequired: true,
    ...overrides,
  }
}

const criticalCard = makeCard({})
const recommendedCard = makeCard({
  cardId: 'card-tech-1',
  field: 'techStack',
  category: 'recommended',
  title: '技术栈偏好？',
  description: '技术选型会影响后续草案的研发排期。',
  quickOptions: [{ label: 'React', value: 'react', description: '前端主流框架。' }],
  defaultValue: {
    value: 'React + Node.js',
    marker: {
      confidence: 0.6,
      source: 'default',
      reason: '同类项目常见组合。',
      needsConfirmation: true,
    },
  },
  allowSkip: true,
})
const optionalCard = makeCard({
  cardId: 'card-design-1',
  field: 'designPreference',
  category: 'optional',
  title: '设计风格偏好？',
  description: '仅影响草案的美观细节，不回答也可以。',
  quickOptions: [{ label: '科技感', value: '科技感', description: '深色主题。' }],
  allowSkip: true,
})

/** 复刻 store.recordAnswer 语义的宿主桩：answers 按 field 覆盖、cards 收敛推进。 */
function ClarifyHarness({
  cards: initialCards,
  isBusy = false,
  revealCard = null,
  adaptiveSessionToken = 'token-1',
  onAnswer,
  onAllAnswered,
}: {
  cards: ClarificationCard[]
  isBusy?: boolean
  revealCard?: ClarificationCard | null
  adaptiveSessionToken?: string | null
  onAnswer?: (answer: ClarificationAnswer) => void
  onAllAnswered?: () => void
}) {
  const [cards, setCards] = React.useState<ClarificationCard[]>(initialCards)
  const [answers, setAnswers] = React.useState<ClarificationAnswers>({})
  const handleAnswer = React.useCallback(
    (answer: ClarificationAnswer) => {
      onAnswer?.(answer)
      setAnswers((current) => ({ ...current, [answer.field]: answer }))
      setCards((current) => current.filter((card) => card.field !== answer.field))
    },
    [onAnswer],
  )
  return (
    <TheaterClarificationCard
      cards={cards}
      activeCard={null}
      answers={answers}
      phase="core"
      totalCount={initialCards.length}
      rawInput={RAW_INPUT}
      adaptiveSessionToken={adaptiveSessionToken}
      isBusy={isBusy}
      revealCard={revealCard}
      onAnswer={handleAnswer}
      onAllAnswered={onAllAnswered}
    />
  )
}

function renderExplain(
  props: Partial<React.ComponentProps<typeof TheaterClarificationExplain>> = {},
) {
  const onOpenChange = vi.fn()
  const utils = render(
    <TheaterClarificationExplain
      card={criticalCard}
      rawInput={RAW_INPUT}
      adaptiveSessionToken="token-1"
      open
      onOpenChange={onOpenChange}
      {...props}
    />,
  )
  return { ...utils, onOpenChange }
}

beforeEach(() => {
  explainMock.mockReset()
  analyzeMock.mockReset()
})

afterEach(() => {
  // 防 fake timers 泄漏到全局 afterEach 的 act 定时器。
  vi.useRealTimers()
})

describe('components/next/theater/TheaterClarificationCard（v3-ui-next-theater-intent-clarify tasks 2.1）', () => {
  test('Critical 关键必答阻断：无跳过/默认按钮，未选择或输入时「确认此项」禁用；选项选择后放行并提交 answer', () => {
    const onAnswer = vi.fn()
    const { container } = render(<ClarifyHarness cards={[criticalCard]} onAnswer={onAnswer} />)

    expect(container.querySelector('canvas')).toBeNull()
    expect(screen.getByRole('button', { name: /重新回答上一题/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /跳过此项/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /采用 AI 默认假设/ })).not.toBeInTheDocument()

    const card = container.querySelector('[data-clarify-card]') as HTMLElement
    expect(card.getAttribute('data-category')).toBe('critical')
    expect(screen.getByText('关键必答')).toBeInTheDocument()

    const confirm = screen.getByRole('button', { name: /确认此项/ })
    expect(confirm).toBeDisabled()
    // 令牌消费（禁硬编码色值）：关键按钮样式引用 --nx-* 令牌
    expect(confirm.className).toContain('var(--nx-border-focus)')

    const option = screen.getByRole('button', { name: /提升运营效率/ })
    fireEvent.click(option)
    expect(option).toHaveAttribute('aria-pressed', 'true')
    expect(confirm).not.toBeDisabled()

    fireEvent.click(confirm)
    expect(onAnswer).toHaveBeenCalledTimes(1)
    const answer = onAnswer.mock.calls[0]![0] as ClarificationAnswer
    expect(answer.field).toBe('projectGoal')
    expect(answer.action).toBe('answer')
    expect(answer.value).toBe('提升运营效率')
    expect(answer.marker).toBeNull()
    // 已答后进入完成过渡态（单题流）
    expect(container.querySelector('[data-clarify-complete]')).toBeTruthy()
    expect(analyzeMock).not.toHaveBeenCalled() // RL-01：澄清阶段零分析/生成请求
  })

  test('Critical 自定义输入：输入有效文本后放行提交；text 类型保持字符串原样', () => {
    const onAnswer = vi.fn()
    const { container } = render(<ClarifyHarness cards={[criticalCard]} onAnswer={onAnswer} />)

    // 打开折叠式自定义输入
    fireEvent.click(screen.getByRole('button', { name: '补充自定义要求' }))
    expect(container.querySelector('[data-clarify-custom]')).toBeTruthy()

    const confirm = screen.getByRole('button', { name: /确认此项/ })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('输入专属要求…'), {
      target: { value: '把审批流程全部线上化' },
    })
    expect(confirm).not.toBeDisabled()

    fireEvent.click(confirm)
    const answer = onAnswer.mock.calls[0]![0] as ClarificationAnswer
    expect(answer.action).toBe('answer')
    expect(answer.value).toBe('把审批流程全部线上化')
    expect(cardOf(container)).toBeNull()
  })

  test('Critical 自定义输入 number 类型：提交时转换为数字', () => {
    const numberCard = makeCard({
      cardId: 'card-team-1',
      field: 'teamSize',
      category: 'critical',
      title: '团队规模？',
      questionType: 'number',
      quickOptions: [],
    })
    const onAnswer = vi.fn()
    const { container } = render(<ClarifyHarness cards={[numberCard]} onAnswer={onAnswer} />)

    // 无快捷选项时自定义输入默认展开
    expect(screen.getByRole('button', { name: '补充自定义要求' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: /确认此项/ })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('输入专属要求…'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: /确认此项/ }))

    const answer = onAnswer.mock.calls[0]![0] as ClarificationAnswer
    expect(answer.action).toBe('answer')
    expect(answer.value).toBe(8)
    expect(cardOf(container)).toBeNull()
  })

  test('Critical isBusy：忙碌期间选项、自定义输入与确认全部禁用', () => {
    render(<ClarifyHarness cards={[criticalCard]} isBusy />)

    expect(screen.getByRole('button', { name: /提升运营效率/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /补充自定义要求/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /确认此项/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /重新回答上一题/ })).toBeDisabled()
  })

  test('Recommended 建议补充：支持快捷选择与自定义，且「采用 AI 默认假设」附带 source:default 免责标记', () => {
    const onAnswer = vi.fn()
    const { container } = render(<ClarifyHarness cards={[recommendedCard]} onAnswer={onAnswer} />)

    expect(screen.getByText('建议补充')).toBeInTheDocument()
    expect(document.querySelector('[data-clarify-card]')?.getAttribute('data-category')).toBe(
      'recommended',
    )
    expect(screen.getByText('AI 推断默认值：React + Node.js')).toBeInTheDocument()
    expect(screen.getByText('AI 假设免责')).toBeInTheDocument()
    // Recommended 不提供跳过（三级规约：只有 Optional 显式跳过）
    expect(screen.queryByRole('button', { name: /跳过此项/ })).not.toBeInTheDocument()
    // 未选择时确认按钮同样禁用
    expect(screen.getByRole('button', { name: /确认此项/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /采用 AI 默认假设/ }))
    const answer = onAnswer.mock.calls[0]![0] as ClarificationAnswer
    expect(answer.action).toBe('default')
    expect(answer.value).toBe('React + Node.js')
    expect(answer.marker?.source).toBe('default')
    expect(answer.marker?.needsConfirmation).toBe(true)
    expect(container.querySelector('[data-clarify-complete]')).toBeTruthy()
  })

  test('Optional 可选优化：显式「跳过此项」提交 skip 空值；亦提供默认假设', () => {
    const onAnswer = vi.fn()
    const { container } = render(<ClarifyHarness cards={[optionalCard]} onAnswer={onAnswer} />)

    expect(screen.getByText('可选优化')).toBeInTheDocument()
    expect(document.querySelector('[data-clarify-card]')?.getAttribute('data-category')).toBe(
      'optional',
    )

    const skip = screen.getByRole('button', { name: /跳过此项/ })
    expect(skip).not.toBeDisabled()
    fireEvent.click(skip)

    const answer = onAnswer.mock.calls[0]![0] as ClarificationAnswer
    expect(answer.action).toBe('skip')
    expect(answer.value).toBeNull()
    expect(answer.marker).toBeNull()
    expect(container.querySelector('[data-clarify-complete]')).toBeTruthy()
  })

  test('multi_choice 多选：勾选切换与「确认已选 N 项」', () => {
    const multiCard = makeCard({
      cardId: 'card-scope-1',
      field: 'scopeBoundary',
      category: 'critical',
      title: '范围边界包含哪些？',
      questionType: 'multi_choice',
      quickOptions: [
        { label: '移动端', value: 'mobile', description: 'iOS / Android' },
        { label: 'Web 端', value: 'web', description: '浏览器访问' },
        { label: '管理后台', value: 'admin', description: '内部运维' },
      ],
    })
    const onAnswer = vi.fn()
    render(<ClarifyHarness cards={[multiCard]} onAnswer={onAnswer} />)

    const mobile = screen.getByRole('button', { name: /移动端/ })
    const web = screen.getByRole('button', { name: /Web 端/ })
    fireEvent.click(mobile)
    fireEvent.click(web)
    expect(mobile).toHaveAttribute('aria-pressed', 'true')
    expect(web).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /确认此项（已选 2 项）/ }))
    expect(onAnswer.mock.calls[0]![0].value).toEqual(['mobile', 'web'])

    render(<ClarifyHarness cards={[multiCard]} onAnswer={onAnswer} />)
    const onlyAdmin = screen.getByRole('button', { name: /管理后台/ })
    fireEvent.click(onlyAdmin)
    fireEvent.click(onlyAdmin)
    expect(screen.getByRole('button', { name: /确认此项（已选 0 项）|确认此项/ })).toBeDisabled()
  })

  test('一次一题：仅渲染当前卡片，作答后自动推进下一题并更新进度', () => {
    const onAnswer = vi.fn()
    const { container } = render(
      <ClarifyHarness cards={[criticalCard, recommendedCard, optionalCard]} onAnswer={onAnswer} />,
    )

    expect(container.querySelectorAll('[data-clarify-card]').length).toBe(1)
    expect(screen.getByText(/核心要素 · 第 1 题/)).toBeInTheDocument()
    expect(screen.getByText(/信息够用就结束/)).toBeInTheDocument()
    expect(screen.getByText('项目目标是什么？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /提升运营效率/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认此项/ }))

    expect(screen.getByText('技术栈偏好？')).toBeInTheDocument()
    expect(screen.queryByText('项目目标是什么？')).not.toBeInTheDocument()
    expect(screen.getByText(/第 2 题/)).toBeInTheDocument()
    expect(screen.queryByText(/剩余 \d+ 题/)).not.toBeInTheDocument()
    expect(container.querySelectorAll('[data-clarify-card]').length).toBe(1)
  })

  test('反悔退回：回到上一题重新作答（预填旧答案），再回后续题；无可退回时入口禁用', () => {
    const onAnswer = vi.fn()
    render(<ClarifyHarness cards={[criticalCard, recommendedCard]} onAnswer={onAnswer} />)

    // 第一题走自定义输入
    fireEvent.click(screen.getByRole('button', { name: '补充自定义要求' }))
    fireEvent.change(screen.getByPlaceholderText('输入专属要求…'), {
      target: { value: '旧答案' },
    })
    fireEvent.click(screen.getByRole('button', { name: /确认此项/ }))
    expect(screen.getByText('技术栈偏好？')).toBeInTheDocument()

    // 反悔退回第一题：预填上一次的回答
    fireEvent.click(screen.getByRole('button', { name: /重新回答上一题/ }))
    expect(screen.getByText('项目目标是什么？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '补充自定义要求' }))
    expect(screen.getByDisplayValue('旧答案')).toBeInTheDocument()

    // 重新作答：store.answers 同 field 覆盖
    fireEvent.change(screen.getByPlaceholderText('输入专属要求…'), {
      target: { value: '新答案' },
    })
    fireEvent.click(screen.getByRole('button', { name: /确认此项/ }))
    expect(onAnswer).toHaveBeenCalledTimes(2)
    expect((onAnswer.mock.calls[1]![0] as ClarificationAnswer).value).toBe('新答案')
    expect(screen.getByText('技术栈偏好？')).toBeInTheDocument()

    // 重新作答后 Q1 再次进入历史：退回入口仍可用（可再次反悔），而非禁用
    expect(screen.getByRole('button', { name: /重新回答上一题/ })).not.toBeDisabled()
  })

  test('全部答完：呈现完成过渡态并触发 onAllAnswered 一次', () => {
    const onAllAnswered = vi.fn()
    const { container } = render(
      <ClarifyHarness cards={[criticalCard, optionalCard]} onAllAnswered={onAllAnswered} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /提升运营效率/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认此项/ }))
    fireEvent.click(screen.getByRole('button', { name: /跳过此项/ }))

    expect(container.querySelector('[data-clarify-complete]')).toBeTruthy()
    expect(screen.getByText('澄清进度已全部作答完成')).toBeInTheDocument()
    expect(screen.getByText(/不会自动发起任何生成请求/)).toBeInTheDocument()
    expect(onAllAnswered).toHaveBeenCalledTimes(1)
    expect(analyzeMock).not.toHaveBeenCalled()
  })

  test('revealCard：宿主指令重放指定卡片（幂等）', () => {
    const revealCard = makeCard({
      cardId: 'card-tech-1',
      field: 'techStack',
      title: '技术栈偏好？',
    })
    const onAnswer = vi.fn()
    render(<ClarifyHarness cards={[criticalCard]} revealCard={revealCard} onAnswer={onAnswer} />)
    // 重放卡片优先于 store 卡片呈现
    expect(screen.getByText('技术栈偏好？')).toBeInTheDocument()
  })
})

describe('components/next/theater/TheaterClarificationExplain（v3-ui-next-theater-intent-clarify tasks 2.2）', () => {
  test('打开即自动发起首轮解释请求（不带 question），打字机逐字呈现到完整', async () => {
    vi.useFakeTimers()
    try {
      let releaseStream: (() => void) | null = null
      explainMock.mockImplementation(async (_input: unknown, onDelta: (text: string) => void) => {
        onDelta('这是')
        onDelta('一个')
        onDelta('解释。')
        await new Promise<void>((resolve) => {
          releaseStream = resolve
        })
      })
      const { container } = renderExplain()

      await act(async () => {})
      expect(explainMock).toHaveBeenCalledTimes(1)
      const firstRequest = explainMock.mock.calls[0]![0] as {
        rawInput: string
        adaptiveSessionToken: string
        question?: string
        history?: unknown
      }
      expect(firstRequest.rawInput).toBe(RAW_INPUT)
      expect(firstRequest.adaptiveSessionToken).toBe('token-1')
      // 首轮为「先整体解释一下这道题」：不带 question，也不带历史
      expect(firstRequest.question).toBeUndefined()
      expect(firstRequest.history).toBeUndefined()
      expect(container.querySelector('canvas')).toBeNull()
      expect(screen.getByText(/关于「项目目标是什么？」的解释/)).toBeInTheDocument()

      // 打字机尚未完整揭示
      expect(screen.queryByText('这是一个解释。')).not.toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(16 * 2)
      })
      expect(screen.getByText('这是一个')).toBeInTheDocument()

      // 继续推进：流尚未结束时全文可见
      act(() => {
        vi.advanceTimersByTime(16 * 20)
      })
      expect(screen.getByText('这是一个解释。')).toBeInTheDocument()

      // 流完成：转为完整轮次文本
      await act(async () => {
        releaseStream?.()
      })
      expect(screen.getByText('这是一个解释。')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  test('追问：携带 question 与历史再次流式请求；解释会话只读、绝不计入答案', async () => {
    explainMock.mockImplementation(async (_input: unknown, onDelta: (text: string) => void) => {
      onDelta('首轮解释。')
    })
    renderExplain()
    await act(async () => {})
    expect(screen.getByText('首轮解释。')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('针对这道题继续追问…'), {
      target: { value: '为什么需要确认交付周期？' },
    })
    fireEvent.click(screen.getByRole('button', { name: /发送追问/ }))
    await act(async () => {})

    expect(explainMock).toHaveBeenCalledTimes(2)
    const second = explainMock.mock.calls[1]![0] as {
      question: string
      history: Array<{ role: string; text: string }>
    }
    expect(second.question).toBe('为什么需要确认交付周期？')
    expect(second.history).toEqual([{ role: 'assistant', text: '首轮解释。' }])
    expect(screen.getByText(/追问：为什么需要确认交付周期/)).toBeInTheDocument()
    // RL-01/RL-12：追问与解释全程不触发 analyze，也从未有答案写入动作
    expect(analyzeMock).not.toHaveBeenCalled()
  })

  test('收起解释：立即 abort 底层 SSE 连接', async () => {
    const captured = { signal: null as AbortSignal | null }
    explainMock.mockImplementation(
      async (_input: unknown, _onDelta: (text: string) => void, signal?: AbortSignal) => {
        captured.signal = signal ?? null
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      },
    )
    const { onOpenChange, rerender } = renderExplain()
    await act(async () => {})

    expect(explainMock).toHaveBeenCalledTimes(1)
    expect(captured.signal?.aborted).toBe(false)

    // 点击「收起解释」：先通知宿主，宿主把 open 置 false 后组件中断底层 SSE
    fireEvent.click(screen.getByRole('button', { name: /收起解释/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(
      <TheaterClarificationExplain
        card={criticalCard}
        rawInput={RAW_INPUT}
        adaptiveSessionToken="token-1"
        open={false}
        onOpenChange={onOpenChange}
      />,
    )
    await act(async () => {})
    expect(captured.signal?.aborted).toBe(true)
    expect(screen.queryByLabelText('题目解释')).not.toBeInTheDocument()
  })

  test('换题作答：解释气泡随卡片切换卸载并中断旧解释流', async () => {
    const captured = { signal: null as AbortSignal | null }
    explainMock.mockImplementation(
      async (_input: unknown, _onDelta: (text: string) => void, signal?: AbortSignal) => {
        captured.signal = signal ?? null
        await new Promise<void>(() => undefined)
      },
    )
    const onAnswer = vi.fn()
    render(<ClarifyHarness cards={[criticalCard, optionalCard]} onAnswer={onAnswer} />)

    fireEvent.click(screen.getByRole('button', { name: /我不了解这道题/ }))
    await act(async () => {})
    expect(explainMock).toHaveBeenCalledTimes(1)
    expect(captured.signal?.aborted).toBe(false)

    // 作答推进到下一题 → 卡片换题，解释气泡卸载并中断
    fireEvent.click(screen.getByRole('button', { name: /提升运营效率/ }))
    fireEvent.click(screen.getByRole('button', { name: /确认此项/ }))
    await act(async () => {})

    expect(screen.getByText('设计风格偏好？')).toBeInTheDocument()
    expect(screen.queryByLabelText('题目解释')).not.toBeInTheDocument()
    expect(captured.signal?.aborted).toBe(true)
  })

  test('组件卸载：中断进行中的解释流', async () => {
    const captured = { signal: null as AbortSignal | null }
    explainMock.mockImplementation(
      async (_input: unknown, _onDelta: (text: string) => void, signal?: AbortSignal) => {
        captured.signal = signal ?? null
        await new Promise<void>(() => undefined)
      },
    )
    const { unmount } = renderExplain()
    await act(async () => {})
    expect(captured.signal?.aborted).toBe(false)

    unmount()
    await act(async () => {})
    expect(captured.signal?.aborted).toBe(true)
  })

  test('无会话令牌：解释入口禁用且气泡内给出不可用提示', async () => {
    render(<ClarifyHarness cards={[criticalCard]} adaptiveSessionToken={null} />)
    expect(screen.getByRole('button', { name: /我不了解这道题/ })).toBeDisabled()
  })

  test('缺少令牌直接渲染气泡：提示解释服务不可用，不发起请求', async () => {
    renderExplain({ adaptiveSessionToken: null })
    await act(async () => {})
    expect(explainMock).not.toHaveBeenCalled()
    expect(screen.getByText('解释服务不可用：缺少会话令牌')).toBeInTheDocument()
  })
})

/** 读取当前渲染的澄清卡片（null 表示已进入完成态）。 */
function cardOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-clarify-card]')
}
