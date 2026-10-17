import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ConfirmedProjectContext, ProjectPlanUnderstanding } from '@aiproj/types'
import { TheaterUnderstandingPanel } from '@/components/next/theater/TheaterUnderstandingPanel'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const understanding: ProjectPlanUnderstanding = {
  version: '1.0',
  problemStatement: '年会需要抽奖和节目投票',
  successPicture: '12 月 20 日年会现场可用',
  currentState: '没有现成工具',
  stakeholders: [],
  businessFlows: [],
  capabilities: [
    { id: 'cap-1', name: '抽奖', purpose: '现场抽奖', deliverables: ['抽奖页'], dependsOn: [] },
  ],
  constraints: [],
  assumptions: [],
  openQuestions: ['抽奖规则是什么？', '现场大屏分辨率是多少？'],
  confirmedByUser: false,
}

afterEach(() => {
  cleanup()
  useAiProjectDraftStore.setState({
    context: null,
    understandingDraft: null,
    understandingStatus: 'idle',
  })
})

describe('项目理解里的待确认问题可以直接作答', () => {
  it('作答后移到「你已补充的回答」，确认时随理解一起带上；可以改回答', () => {
    const confirm = vi.fn()
    useAiProjectDraftStore.setState({
      context: { rawInput: '年会 H5' } as unknown as ConfirmedProjectContext,
      understandingDraft: understanding,
      understandingStatus: 'ready',
      confirmUnderstanding: confirm,
    })
    render(<TheaterUnderstandingPanel />)

    fireEvent.change(screen.getByLabelText('回答：抽奖规则是什么？'), {
      target: { value: '每人限中一次，分三轮' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: '记下回答' })[0]!)

    expect(screen.queryByLabelText('回答：抽奖规则是什么？')).not.toBeInTheDocument()
    expect(screen.getByText(/每人限中一次，分三轮/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /确认这份理解/ }))
    const confirmed = confirm.mock.calls[0]![0] as ProjectPlanUnderstanding
    expect(confirmed.openQuestions).toEqual(['现场大屏分辨率是多少？'])
    expect(confirmed.answeredQuestions).toEqual([
      { question: '抽奖规则是什么？', answer: '每人限中一次，分三轮' },
    ])
  })

  it('改回答：移回待确认问题', () => {
    useAiProjectDraftStore.setState({
      context: { rawInput: '年会 H5' } as unknown as ConfirmedProjectContext,
      understandingDraft: {
        ...understanding,
        openQuestions: [],
        answeredQuestions: [{ question: '抽奖规则是什么？', answer: '随便' }],
      },
      understandingStatus: 'ready',
    })
    render(<TheaterUnderstandingPanel />)
    fireEvent.click(screen.getByRole('button', { name: '改回答' }))
    expect(screen.getByLabelText('回答：抽奖规则是什么？')).toBeInTheDocument()
  })
})
