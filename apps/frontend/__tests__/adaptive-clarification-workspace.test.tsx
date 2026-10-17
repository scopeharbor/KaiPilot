import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
  type AdaptiveClarificationSession,
} from '@aiproj/types'
import { AdaptiveClarificationWorkspace } from '@/components/ai-copilot/AiProjectIntentWorkspace'

function session(): AdaptiveClarificationSession {
  return {
    schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
    sessionId: 'session-1',
    round: 3,
    understanding: {
      schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
      summaryForUser: '你想筹备一个公开活动，并做出可执行的完整计划。',
      inferredDomainLabel: '公开活动',
      likelyDeliverables: ['执行计划'],
      knownFacts: [],
      informationNeeds: [],
      sufficientForPreliminaryDraft: false,
    },
    ledger: {
      schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
      revision: 1,
      entries: [
        {
          needId: 'need:date',
          topic: '日期',
          status: 'answered',
          questionSummary: '预计什么时候举行？',
          answer: '2026-10-01',
          revision: 1,
          updatedAt: '2026-08-31T00:00:00.000Z',
        },
      ],
    },
    knownUnknowns: [],
    status: 'clarifying',
    conversation: {
      schemaVersion: ADAPTIVE_CLARIFICATION_SCHEMA_VERSION,
      activeNeedId: 'need:people',
      activeQuestion: {
        needId: 'need:people',
        question: '大约有多少人会参加？',
        reason: '人数会影响空间、安全和现场人手。',
        answerKind: 'single_choice',
        options: [
          { id: 'small', label: '300 人以内', value: '300 人以内' },
          { id: 'large', label: '300 人以上', value: '300 人以上' },
        ],
        allowOther: true,
        allowUnknown: true,
        unknownImpact: '需要先以范围规划',
      },
      status: 'awaiting_response',
      turns: [
        {
          id: 'turn-1',
          role: 'assistant',
          kind: 'question',
          text: '大约有多少人会参加？',
          createdAt: '2026-08-31T00:00:00.000Z',
        },
      ],
      understandingRevision: 3,
      ledgerRevision: 1,
      completedCount: 1,
      remainingEstimate: 2,
      remainingBreakdown: { critical: 1, recommended: 1, optional: 0 },
      coverage: [
        { slot: 'schedule', status: 'covered' },
        { slot: 'resource', status: 'open' },
      ],
      remainingEstimateReason: '根据刚才的日期，当前还有约 2 个会影响计划的信息需要确认。',
      canGeneratePreliminaryDraft: true,
      currentUnderstanding: '你想筹备一个公开活动，并做出可执行的完整计划。',
    },
  }
}

describe('AdaptiveClarificationWorkspace', () => {
  it('固定当前问题、动态剩余估计、自由输入与本题帮助入口同时可用', () => {
    const onSubmit = vi.fn()
    render(
      <AdaptiveClarificationWorkspace session={session()} isBusy={false} onSubmit={onSubmit} />,
    )

    expect(screen.getByRole('heading', { name: '大约有多少人会参加？' })).toBeInTheDocument()
    expect(
      screen.getByText(/已确认 1 项 · 还有约 2 项待确认（其中关键必答 1 项）/u),
    ).toBeInTheDocument()
    expect(screen.getByText(/根据刚才的日期/u)).toBeInTheDocument()
    expect(screen.getByLabelText('回答、补充，或继续问 AI…')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '为什么要问？' }))
    expect(onSubmit).toHaveBeenCalledWith('为什么要问这个？')
    fireEvent.click(screen.getByRole('button', { name: '请给我建议' }))
    expect(onSubmit).toHaveBeenCalledWith('请根据目前资料给我建议，但先不要替我确认')
    fireEvent.click(screen.getByRole('button', { name: '还不确定' }))
    expect(onSubmit).toHaveBeenCalledWith('这件事现在还不确定，请先记为待决定事项')
  })

  it('选项只是快捷方式，自由输入仍可提交自然表达', () => {
    const onSubmit = vi.fn()
    render(
      <AdaptiveClarificationWorkspace session={session()} isBusy={false} onSubmit={onSubmit} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '300 人以内' }))
    expect(onSubmit).toHaveBeenCalledWith('300 人以内')

    const input = screen.getByLabelText('回答、补充，或继续问 AI…')
    fireEvent.change(input, { target: { value: '大约 500 人。为什么这个会影响安全？' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSubmit).toHaveBeenCalledWith('大约 500 人。为什么这个会影响安全？')
  })

  it('手机可折叠本题历史，键盘提交与人工复核错误态可访问', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(
      <AdaptiveClarificationWorkspace session={session()} isBusy={false} onSubmit={onSubmit} />,
    )
    expect(screen.getByText(/查看本题对话/).closest('details')).not.toHaveAttribute('open')

    const guarded = {
      ...session(),
      status: 'needs_human_review' as const,
      guardReason: '问题连续校验失败，现有答案已保留。',
      conversation: session().conversation
        ? { ...session().conversation!, status: 'needs_human_review' as const }
        : null,
    }
    rerender(
      <AdaptiveClarificationWorkspace session={guarded} isBusy={false} onSubmit={onSubmit} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('现有答案已保留')
  })

  it('满足条件时可明确选择先生成初步草案，且文案保留人工审查边界', () => {
    const onPreliminaryDraft = vi.fn()
    render(
      <AdaptiveClarificationWorkspace
        session={session()}
        isBusy={false}
        onSubmit={() => undefined}
        onPreliminaryDraft={onPreliminaryDraft}
      />,
    )
    expect(screen.getByText(/尚未决定的内容会明确列为假设/u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '先生成初步草案' }))
    expect(onPreliminaryDraft).toHaveBeenCalledTimes(1)
  })

  it('帮助按钮的回应常驻显示在卡片内，不必展开本题对话才能看到', () => {
    const helped = session()
    helped.conversation!.turns = [
      ...helped.conversation!.turns,
      {
        id: 'turn-2',
        role: 'user',
        kind: 'follow_up',
        text: '我不明白这个问题是什么意思',
        createdAt: '2026-08-31T00:01:00.000Z',
      },
      {
        id: 'turn-3',
        role: 'assistant',
        kind: 'explanation',
        text: '这题不用给准确数字，一个大概方向就够。',
        createdAt: '2026-08-31T00:01:01.000Z',
      },
    ]
    render(
      <AdaptiveClarificationWorkspace session={helped} isBusy={false} onSubmit={() => undefined} />,
    )

    // 回应不能只藏在折叠的历史里：卡片内的常驻区域必须能直接读到
    const live = screen.getByRole('status')
    expect(live.closest('details')).toBeNull()
    expect(within(live).getByText('AI 刚刚的回应')).toBeInTheDocument()
    expect(within(live).getByText('这题不用给准确数字，一个大概方向就够。')).toBeInTheDocument()
  })

  it('建议答案可一键采用，且明示确认前不写入计划', () => {
    const onSubmit = vi.fn()
    const recommended = session()
    recommended.conversation!.status = 'awaiting_confirmation'
    recommended.conversation!.proposedAnswer = '300 人以内'
    recommended.conversation!.turns = [
      ...recommended.conversation!.turns,
      {
        id: 'turn-2',
        role: 'user',
        kind: 'follow_up',
        text: '请根据目前资料给我建议，但先不要替我确认',
        createdAt: '2026-08-31T00:02:00.000Z',
      },
      {
        id: 'turn-3',
        role: 'assistant',
        kind: 'recommendation',
        text: '根据目前资料，建议先用「300 人以内」。',
        createdAt: '2026-08-31T00:02:01.000Z',
      },
    ]
    render(
      <AdaptiveClarificationWorkspace session={recommended} isBusy={false} onSubmit={onSubmit} />,
    )

    expect(screen.getByText(/采用前不会写入你的计划/u)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '采用这个答案' }))
    expect(onSubmit).toHaveBeenCalledWith('300 人以内')
  })

  it('没有预设选项时仍然有「其他」自由输入入口与说明', () => {
    const openEnded = session()
    openEnded.conversation!.activeQuestion = {
      ...openEnded.conversation!.activeQuestion,
      answerKind: 'short_text',
      options: undefined,
      // 后端现在恒为 true：没有选项恰恰最需要自由输入
      allowOther: true,
      allowUnknown: false,
    }
    render(
      <AdaptiveClarificationWorkspace
        session={openEnded}
        isBusy={false}
        onSubmit={() => undefined}
      />,
    )

    expect(screen.getByText(/点下面的「其他（我自己填）」就能直接写/u)).toBeInTheDocument()
    expect(screen.getByText(/暂时不能跳过/u)).toBeInTheDocument()
    // 没有选项时，「其他」本身就是这道题唯一的选项，必须在选项区里
    const grid = screen.getByLabelText('可选答案')
    expect(within(grid).getByRole('button', { name: /其他（我自己填）/u })).toBeEnabled()
    expect(screen.getByLabelText('回答、补充，或继续问 AI…')).toBeEnabled()
  })

  it('「其他」是选项之一，点开就地输入并直接作为答案提交', () => {
    const onSubmit = vi.fn()
    render(
      <AdaptiveClarificationWorkspace session={session()} isBusy={false} onSubmit={onSubmit} />,
    )

    const grid = screen.getByLabelText('可选答案')
    // 位置：与其他候选项并列，而不是躲在底部的辅助按钮行里
    fireEvent.click(within(grid).getByRole('button', { name: /其他（我自己填）/u }))

    const otherInput = screen.getByLabelText('其他答案')
    expect(otherInput).toBeEnabled()
    fireEvent.change(otherInput, { target: { value: '我们大概 700 人，按两场分流' } })
    fireEvent.submit(otherInput.closest('form')!)
    expect(onSubmit).toHaveBeenCalledWith('我们大概 700 人，按两场分流')
  })

  it('多选题的「其他」先并入已选，再一起确认', () => {
    const onSubmit = vi.fn()
    const multi = session()
    multi.conversation!.activeQuestion = {
      ...multi.conversation!.activeQuestion,
      answerKind: 'multi_choice',
    }
    render(<AdaptiveClarificationWorkspace session={multi} isBusy={false} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: '300 人以内' }))
    fireEvent.click(screen.getByRole('button', { name: /其他（我自己填）/u }))
    const otherInput = screen.getByLabelText('其他答案')
    fireEvent.change(otherInput, { target: { value: '还要留一批线上名额' } })
    fireEvent.submit(otherInput.closest('form')!)
    // 「加入所选」不应该直接提交
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认已选 2 项' }))
    expect(onSubmit).toHaveBeenCalledWith('300 人以内、还要留一批线上名额')
  })

  it('没有选项时可以要 AI 现补选项；已有选项时不再出现该入口', () => {
    const onSubmit = vi.fn()
    const openEnded = session()
    openEnded.conversation!.activeQuestion = {
      ...openEnded.conversation!.activeQuestion,
      answerKind: 'short_text',
      options: undefined,
      allowOther: false,
    }
    const { rerender } = render(
      <AdaptiveClarificationWorkspace session={openEnded} isBusy={false} onSubmit={onSubmit} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '给我选项' }))
    expect(onSubmit).toHaveBeenCalledWith('请给我几个选项')

    // 已经有选项的题目不该再出现这个按钮
    rerender(
      <AdaptiveClarificationWorkspace session={session()} isBusy={false} onSubmit={onSubmit} />,
    )
    expect(screen.queryByRole('button', { name: '给我选项' })).toBeNull()
  })

  it('等待模型时显示进度并可主动停止，卡片不会静默卡死', () => {
    const onCancel = vi.fn()
    render(
      <AdaptiveClarificationWorkspace
        session={session()}
        isBusy
        onSubmit={() => undefined}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText(/正在把你的回答交给模型/u)).toBeInTheDocument()
    const cancel = screen.getByRole('button', { name: '停止等待' })
    expect(cancel).toBeEnabled()
    fireEvent.click(cancel)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('上一轮失败或超时的原因直接显示在问题卡片里', () => {
    render(
      <AdaptiveClarificationWorkspace
        session={session()}
        isBusy={false}
        onSubmit={() => undefined}
        errorMessage="模型超过 10 分钟没有回应，已经停止等待。"
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('模型超过 10 分钟没有回应')
    // 出错后必须重新可作答，而不是继续锁死
    expect(screen.getByLabelText('回答、补充，或继续问 AI…')).toBeEnabled()
    expect(screen.getByRole('button', { name: '请给我建议' })).toBeEnabled()
  })

  it('等待计时持续走动，并说明最长等到 50 分钟', () => {
    vi.useFakeTimers()
    try {
      render(
        <AdaptiveClarificationWorkspace
          session={session()}
          isBusy
          onSubmit={() => undefined}
          onCancel={() => undefined}
        />,
      )

      act(() => {
        vi.advanceTimersByTime(21_000)
      })
      const status = screen.getByRole('status')
      expect(status.textContent).toContain('已等待 21 秒')
      // 慢端点单轮可能几分钟，上限必须写清楚，避免用户以为又卡死了
      expect(status.textContent).toContain('最长等到 50 分钟')

      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      expect(screen.getByRole('status').textContent).toContain('已等待 1 分 21 秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('「我不明白」打开流式解释，可继续追问，且不会被记成答案', async () => {
    const onSubmit = vi.fn()
    const asked: { question: string; historyLength: number }[] = []
    const onExplain = vi.fn(
      async (
        payload: { question: string; history: { role: string; text: string }[] },
        onDelta: (text: string) => void,
      ) => {
        asked.push({ question: payload.question, historyLength: payload.history.length })
        onDelta('这题是在问')
        onDelta('你现在怎么做。')
      },
    )

    render(
      <AdaptiveClarificationWorkspace
        session={session()}
        isBusy={false}
        onSubmit={onSubmit}
        onExplain={onExplain}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '我不明白' }))
    })

    const panel = screen.getByRole('region', { name: '这道题的解释' })
    expect(within(panel).getByText('这题是在问你现在怎么做。')).toBeInTheDocument()
    // 第一次是「先整体解释」，不带追问文本
    expect(asked[0]).toEqual({ question: '', historyLength: 0 })

    // 追问：把上一轮解释作为 history 带上
    const followUp = screen.getByLabelText('继续问这道题')
    fireEvent.change(followUp, { target: { value: '这跟表单有什么关系' } })
    await act(async () => {
      fireEvent.submit(followUp.closest('form')!)
    })
    expect(asked[1]?.question).toBe('这跟表单有什么关系')
    expect(asked[1]?.historyLength).toBe(1)

    // 关键边界：解释链路完全不走作答
    expect(onSubmit).not.toHaveBeenCalled()
    expect(within(panel).getByText(/这里只解释、不作答/u)).toBeInTheDocument()
  })

  it('没有接上解释链路时，「我不明白」退回旧的澄清轮次行为', () => {
    const onSubmit = vi.fn()
    render(
      <AdaptiveClarificationWorkspace session={session()} isBusy={false} onSubmit={onSubmit} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '我不明白' }))
    expect(onSubmit).toHaveBeenCalledWith('我不明白这个问题是什么意思')
  })

  it('已确认列表逐条列出，长多选答案不会被截断', () => {
    const answered = session()
    answered.ledger.entries = [
      {
        needId: 'need:kinds',
        topic: '费用类型',
        status: 'answered',
        questionSummary: '第一阶段要支援哪些费用类型？',
        answer: '差旅费用、日常办公与交通、业务招待与客户相关费用、采购装置或专案费用',
        revision: 1,
        updatedAt: '2026-08-31T00:00:00.000Z',
      },
      {
        needId: 'need:budget',
        topic: '预算',
        status: 'known_unknown',
        questionSummary: '预算上限大概多少？',
        knownUnknown: {
          needId: 'need:budget',
          topic: '预算',
          impact: '影响范围与排期',
          recordedAt: '2026-08-31T00:00:00.000Z',
        },
        revision: 2,
        updatedAt: '2026-08-31T00:00:00.000Z',
      },
    ]
    render(
      <AdaptiveClarificationWorkspace
        session={answered}
        isBusy={false}
        onSubmit={() => undefined}
      />,
    )

    expect(screen.getByText('你已经确认的内容')).toBeInTheDocument()
    expect(screen.getByText('第一阶段要支援哪些费用类型？')).toBeInTheDocument()
    // 多选答案拆成条目逐个显示，而不是挤成会被切掉的一长串
    expect(screen.getByText('差旅费用')).toBeInTheDocument()
    expect(screen.getByText('采购装置或专案费用')).toBeInTheDocument()
    // 待决定要说清楚后续会怎么处理
    expect(screen.getByText(/待决定（会作为假设与风险列入计划）/u)).toBeInTheDocument()
  })

  it('从自由文本额外读到的答案会标出来源，便于当场纠正', () => {
    const withAbsorbed = session()
    withAbsorbed.ledger.entries.push({
      needId: 'need:people',
      topic: '人员配置',
      status: 'answered',
      questionSummary: '可以投入多少人力？',
      answer: '大概 5 个人',
      revision: 2,
      updatedAt: '2026-09-08T00:00:00.000Z',
      source: 'absorbed',
      coverageSlots: ['resource'],
    })
    render(
      <AdaptiveClarificationWorkspace session={withAbsorbed} isBusy={false} onSubmit={vi.fn()} />,
    )
    expect(screen.getByText('从你的描述中读到')).toBeInTheDocument()
    expect(screen.getByText('大概 5 个人')).toBeInTheDocument()
  })

  it('生成入口关着时说清还差什么，开着时用服务端给的理由', () => {
    const blocked = session()
    blocked.conversation!.canGeneratePreliminaryDraft = false
    blocked.conversation!.preliminaryDraftReason = '还差 2 项会显著改变计划的信息（人力与预算）。'
    const { unmount } = render(
      <AdaptiveClarificationWorkspace
        session={blocked}
        isBusy={false}
        onSubmit={vi.fn()}
        onPreliminaryDraft={vi.fn()}
      />,
    )
    expect(screen.getByText('还差 2 项会显著改变计划的信息（人力与预算）。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '先生成初步草案' })).toBeNull()
    unmount()

    const open = session()
    open.conversation!.canGeneratePreliminaryDraft = true
    open.conversation!.preliminaryDraftReason =
      '已确认的资料够开工了。继续问只会拖时间，剩下的会明确列为假设与待决定事项。'
    render(
      <AdaptiveClarificationWorkspace
        session={open}
        isBusy={false}
        onSubmit={vi.fn()}
        onPreliminaryDraft={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: '先生成初步草案' })).toBeInTheDocument()
    expect(screen.getByText(/已确认的资料够开工了/u)).toBeInTheDocument()
  })

  it('澄清收尾后列出全部已确认信息，而不是整块面板消失', () => {
    const finished = session()
    finished.status = 'ready'
    finished.conversation = null
    finished.ledger.entries.push(
      {
        needId: 'need:people',
        topic: '人员配置',
        status: 'answered',
        questionSummary: '可以投入多少人力？',
        answer: '大概 5 个人',
        revision: 2,
        updatedAt: '2026-09-08T00:00:00.000Z',
        source: 'absorbed',
      },
      {
        needId: 'need:venue',
        topic: '场地',
        status: 'superseded',
        questionSummary: '在哪里办？',
        answer: '旧答案',
        revision: 3,
        updatedAt: '2026-09-08T00:00:00.000Z',
      },
    )
    const onRetry = vi.fn()
    render(
      <AdaptiveClarificationWorkspace
        session={finished}
        isBusy={false}
        onSubmit={vi.fn()}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('澄清已完成，这些是要写进草案的信息')).toBeInTheDocument()
    expect(screen.getByText('已确认 2 项')).toBeInTheDocument()
    expect(screen.getByText('预计什么时候举行？')).toBeInTheDocument()
    expect(screen.getByText('可以投入多少人力？')).toBeInTheDocument()
    expect(screen.getByText('从你的描述中读到')).toBeInTheDocument()
    // 被取代的历史版本不能出现在复核列表里
    expect(screen.queryByText('在哪里办？')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重新回答' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
