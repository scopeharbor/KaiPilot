import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ConfirmedProjectContext, FeasibilityAssessment } from '@aiproj/types'

vi.mock('@/lib/api/ai-draft', () => ({
  aiDraftApi: {
    feasibility: vi.fn(),
    negotiateFeasibility: vi.fn(),
  },
}))
vi.mock('@/lib/ai-draft/live-output-client', () => ({
  newLiveOutputId: () => '5b1f0c1e-3d2a-4c6b-9e8f-0a1b2c3d4e5f',
  useLiveOutputLanes: () => ({ lanes: [], totalChars: 0 }),
}))

import { aiDraftApi } from '@/lib/api/ai-draft'
import { TheaterFeasibilityPanel } from '@/components/next/theater/TheaterFeasibilityPanel'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const feasibility = vi.mocked(aiDraftApi.feasibility)
const negotiate = vi.mocked(aiDraftApi.negotiateFeasibility)

const assessment: FeasibilityAssessment = {
  verdict: 'over',
  startDate: '2026-11-02',
  deadline: '2026-11-27',
  workdays: 20,
  team: [{ role: '后端开发', headcount: 2 }],
  teamSource: 'user',
  capacityPersonDays: 26,
  effortPersonDays: { low: 70, high: 110, expected: 90 },
  historyFactor: null,
  estimates: [
    {
      capabilityId: 'cap-3',
      name: '兑换商城',
      low: 20,
      high: 30,
      deferrable: true,
      priority: 4,
      reason: '',
    },
  ],
  calendarNotices: ['截止日 2026-11-28 是星期六，按前一个工作日 2026-11-27 交付计算。'],
  contradictions: ['说 2 个人做，但又要求 4 周内做完含商城的全部功能。'],
  summary: '预计工作量约 70–110 人日；你们可投入约 26 人日。',
  options: [
    {
      id: 'extend',
      kind: 'extend',
      label: '截止日推迟到 2027-02-05',
      detail: '多出约 50 个工作日。',
      decision: {
        kind: 'extend',
        summary: '截止日从 2026-11-27 推迟到 2027-02-05',
        deadline: '2027-02-05',
      },
      recommended: true,
    },
    {
      id: 'as_is',
      kind: 'as_is',
      label: '照原计划生成',
      detail: '不改。',
      decision: { kind: 'as_is', summary: '生成前评估后决定照原计划生成' },
    },
  ],
}

beforeEach(() => {
  useAiProjectDraftStore.setState({
    context: {
      rawInput: '社区志愿者小程序',
      parsedIntent: {
        timeline: { startDate: '2026-11-02', deadline: '2026-11-27', durationDays: 26 },
      },
      planUnderstanding: { capabilities: [] },
      feasibilityDecision: {
        kind: 'as_is',
        summary: '旧的决定',
        decidedAt: '2026-09-28T00:00:00Z',
      },
    } as unknown as ConfirmedProjectContext,
    understandingStatus: 'confirmed',
    feasibilityAssessment: null,
    feasibilityChat: [],
  })
  feasibility.mockResolvedValue({ assessment })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('生成前：能否如期完成', () => {
  it('确认项目理解后自动评估（不带已选决定），显示结论、日历提醒与矛盾', async () => {
    render(<TheaterFeasibilityPanel />)
    await screen.findByText('预计工作量约 70–110 人日；你们可投入约 26 人日。')
    expect(screen.getByText('会超期')).toBeTruthy()
    expect(screen.getByText(/截止日 2026-11-28 是星期六/)).toBeTruthy()
    expect(screen.getByText(/说 2 个人做/)).toBeTruthy()
    const sent = feasibility.mock.calls[0]![0].context
    expect(sent.feasibilityDecision).toBeUndefined()
    expect(sent.planUnderstanding).toBeTruthy()
  })

  it('选方案：决定写进 context，可撤销', async () => {
    render(<TheaterFeasibilityPanel />)
    const card = await screen.findByText('截止日推迟到 2027-02-05')
    fireEvent.click(
      within(card.closest('[data-feasibility-option]') as HTMLElement).getByText('选这个'),
    )
    expect(useAiProjectDraftStore.getState().context?.feasibilityDecision).toMatchObject({
      kind: 'extend',
      deadline: '2027-02-05',
    })
    expect(screen.getByText(/已选：截止日从 2026-11-27 推迟到 2027-02-05/)).toBeTruthy()
    fireEvent.click(screen.getByText('撤销'))
    expect(useAiProjectDraftStore.getState().context?.feasibilityDecision).toBeUndefined()
  })

  it('用自己的话商量：显示回应，方案点「就这样」才生效', async () => {
    negotiate.mockResolvedValue({
      reply: '只把商城放第二期就能在 11 月底前做完核心功能。',
      proposal: {
        id: 'proposal',
        kind: 'defer',
        label: '第二期再做：兑换商城',
        detail: '程序核算：工作量约 65 人日……',
        decision: {
          kind: 'defer',
          summary: '第二期再做：兑换商城',
          deferredCapabilityIds: ['cap-3'],
          deferredNames: ['兑换商城'],
        },
      },
    })
    render(<TheaterFeasibilityPanel />)
    await screen.findByText('会超期')
    fireEvent.change(screen.getByLabelText('说说你的想法'), {
      target: { value: '老板要求 11 月底上线，商城可以晚点' },
    })
    fireEvent.click(screen.getByLabelText('发送'))
    await screen.findByText('只把商城放第二期就能在 11 月底前做完核心功能。')
    expect(negotiate.mock.calls[0]![0]).toMatchObject({
      message: '老板要求 11 月底上线，商城可以晚点',
      history: [],
    })
    expect(useAiProjectDraftStore.getState().context?.feasibilityDecision?.kind).not.toBe('defer')
    fireEvent.click(screen.getByText('就这样'))
    await waitFor(() =>
      expect(useAiProjectDraftStore.getState().context?.feasibilityDecision).toMatchObject({
        kind: 'defer',
        deferredCapabilityIds: ['cap-3'],
      }),
    )
  })
})
