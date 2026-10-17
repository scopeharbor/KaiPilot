import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import {
  RoleSuggestionCards,
  type SuggestionItem,
} from '@/components/next/home/RoleSuggestionCards'

/** 测试夹具：组件本身不再内置范例卡，避免假数据流入界面 */
const DEFAULT_SITUATION_SUGGESTIONS: readonly SuggestionItem[] = [
  {
    id: 'risk-intervention',
    category: 'risk',
    title: '关键路径进度滞后干预',
    desc: '核心交付链路上发现 3 个关键任务存在延期风险。',
    metricLabel: '偏离 3 天',
    actionLabel: '呼出 AI 同事推演',
    contextPayload: { category: 'risk', impactDays: 3 },
  },
  {
    id: 'resource-overload',
    category: 'resource',
    title: '跨项目人员超载预警',
    desc: '核心成员未来两周负荷率偏高。',
    metricLabel: '超载 140%',
    actionLabel: '呼出 AI 同事推演',
  },
  {
    id: 'schedule-advance',
    category: 'schedule',
    title: '待 PM 确认的排程推进',
    desc: '2 项关键依赖已前置交付。',
    metricLabel: '2 项待确认',
    actionLabel: '呼出 AI 同事推演',
  },
  {
    id: 'okr-alignment',
    category: 'okr',
    title: '战略 OKR 支撑偏离提醒',
    desc: '组织级目标缺少关键成果支撑。',
    metricLabel: '1 个目标无支撑',
    actionLabel: '呼出 AI 同事推演',
  },
]

describe('RoleSuggestionCards（v3-ui-next-batch3-global-convergence W4 · tasks 4.5/4.6）', () => {
  const originalFetch = global.fetch
  let fetchCalls: Array<{ url: string; method: string }> = []

  beforeEach(() => {
    fetchCalls = []
    const stubFetch = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        const method = (init?.method || 'GET').toUpperCase()
        fetchCalls.push({ url, method })
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response
      })
    vi.stubGlobal('fetch', stubFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalFetch) {
      global.fetch = originalFetch
    }
  })

  test('1. 4 类态势感知业务建议卡数据绑定：正确呈现风险干预、资源超载、排程推进与 OKR 对齐', () => {
    render(<RoleSuggestionCards cards={DEFAULT_SITUATION_SUGGESTIONS} />)

    // 确认标题栏及 4 类卡片标题
    expect(screen.getByText('AI 态势感知建议')).toBeInTheDocument()
    expect(screen.getByText('4 类态势雷达')).toBeInTheDocument()

    // 风险干预类
    expect(screen.getByText('关键路径进度滞后干预')).toBeInTheDocument()
    expect(screen.getByText('偏离 3 天')).toBeInTheDocument()

    // 资源超载类
    expect(screen.getByText('跨项目人员超载预警')).toBeInTheDocument()
    expect(screen.getByText('超载 140%')).toBeInTheDocument()

    // 排程推进类
    expect(screen.getByText('待 PM 确认的排程推进')).toBeInTheDocument()
    expect(screen.getByText('2 项待确认')).toBeInTheDocument()

    // 战略 OKR 对齐类
    expect(screen.getByText('战略 OKR 支撑偏离提醒')).toBeInTheDocument()
    expect(screen.getByText('1 个目标无支撑')).toBeInTheDocument()
  })

  test('2. 验证 DOM 语义属性与分类标注 (data-suggestion-category)', () => {
    const { container } = render(<RoleSuggestionCards cards={DEFAULT_SITUATION_SUGGESTIONS} />)

    const riskCard = container.querySelector('[data-suggestion-category="risk"]')
    const resourceCard = container.querySelector('[data-suggestion-category="resource"]')
    const scheduleCard = container.querySelector('[data-suggestion-category="schedule"]')
    const okrCard = container.querySelector('[data-suggestion-category="okr"]')

    expect(riskCard).toBeInTheDocument()
    expect(resourceCard).toBeInTheDocument()
    expect(scheduleCard).toBeInTheDocument()
    expect(okrCard).toBeInTheDocument()
  })

  test('3. 点击「呼出 AI 同事推演」按钮正确注入上下文', () => {
    const handleAiSummon = vi.fn()
    const handleActionClick = vi.fn()

    render(
      <RoleSuggestionCards
        cards={DEFAULT_SITUATION_SUGGESTIONS}
        onAiSummon={handleAiSummon}
        onActionClick={handleActionClick}
      />,
    )

    // 点击风险干预卡的「呼出 AI 同事推演」
    const riskActionBtn = screen.getByRole('button', {
      name: '呼出 AI 同事推演 - 关键路径进度滞后干预',
    })
    expect(riskActionBtn).toBeInTheDocument()

    fireEvent.click(riskActionBtn)

    expect(handleActionClick).toHaveBeenCalledTimes(1)
    expect(handleActionClick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'risk-intervention',
        category: 'risk',
        title: '关键路径进度滞后干预',
      }),
    )

    expect(handleAiSummon).toHaveBeenCalledTimes(1)
    expect(handleAiSummon).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId: 'risk-intervention',
        title: '关键路径进度滞后干预',
        prompt: expect.stringContaining('偏离 3 天'),
        payload: expect.objectContaining({
          category: 'risk',
          impactDays: 3,
        }),
      }),
    )
  })

  test('未传 cards/slots 时显示诚实空态，不渲染任何写死的范例卡', () => {
    const { container } = render(<RoleSuggestionCards />)

    expect(container.querySelector('[data-role-suggestion-empty]')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-suggestion-card]')).toHaveLength(0)
    expect(screen.queryByText('超载 140%')).toBeNull()
  })

  test('4. 严格恪守 RL-01：交互期间写操作 HTTP 请求严格为 0', () => {
    const handleAiSummon = vi.fn()
    render(
      <RoleSuggestionCards cards={DEFAULT_SITUATION_SUGGESTIONS} onAiSummon={handleAiSummon} />,
    )

    // 遍历点击全部 4 个建议卡按钮
    for (const card of DEFAULT_SITUATION_SUGGESTIONS) {
      const btn = screen.getByRole('button', {
        name: `呼出 AI 同事推演 - ${card.title}`,
      })
      fireEvent.click(btn)
    }

    expect(handleAiSummon).toHaveBeenCalledTimes(4)

    // 严苛断言：零写操作（POST / PATCH / PUT / DELETE）
    const writeCalls = fetchCalls.filter((c) =>
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.method),
    )
    expect(writeCalls.length).toBe(0)
    // 零网络写请求
    expect(writeCalls).toEqual([])
  })
})

describe('没有传回调时「呼出 AI 同事推演」直接打开 AI 同事面板', () => {
  test('打开面板并把推演请求作为首条消息发出', async () => {
    const { useNextAiColleagueStore } = await import('@/stores/next-ai-colleague-store')
    const openPanel = vi.fn()
    const submitUserMessage = vi.fn().mockResolvedValue(undefined)
    useNextAiColleagueStore.setState({ openPanel, submitUserMessage } as never)
    render(
      <RoleSuggestionCards
        slots={[{ id: 's1', title: '权限矩阵', desc: 'x', metricLabel: '4 类角色' } as never]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /呼出 AI 同事推演 - 权限矩阵/ }))
    expect(openPanel).toHaveBeenCalled()
    expect(submitUserMessage.mock.calls[0]![0]).toContain('权限矩阵')
    expect(submitUserMessage.mock.calls[0]![1]).toMatchObject({ contextType: 'role_home' })
  })
})
