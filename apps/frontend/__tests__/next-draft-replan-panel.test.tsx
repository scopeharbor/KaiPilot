import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { FeasibilityAssessment, ReplanPreview } from '@aiproj/types'

vi.mock('@/lib/api/ai-draft', () => ({
  aiDraftApi: {
    replanAssessment: vi.fn(),
    replanPreview: vi.fn(),
    replanApply: vi.fn(),
    negotiateFeasibility: vi.fn(),
  },
}))
vi.mock('@/lib/ai-draft/live-output-client', () => ({
  newLiveOutputId: () => '5b1f0c1e-3d2a-4c6b-9e8f-0a1b2c3d4e5f',
  useLiveOutputLanes: () => ({ lanes: [], totalChars: 0 }),
}))

import { aiDraftApi } from '@/lib/api/ai-draft'
import { NextDraftReplanPanel } from '@/components/next/review/NextDraftReplanPanel'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

const api = vi.mocked(aiDraftApi)

const assessment: FeasibilityAssessment = {
  verdict: 'over',
  startDate: '2026-10-08',
  deadline: '2026-12-06',
  workdays: 40,
  team: [{ role: '后端', headcount: 1 }],
  teamSource: 'user',
  capacityPersonDays: 26,
  effortPersonDays: { low: 146, high: 146, expected: 146 },
  historyFactor: null,
  estimates: [],
  calendarNotices: [],
  contradictions: [],
  summary: '按现在的排期 2026-12-08 才能做完，比截止日 2026-12-06 晚约 2 个工作日。',
  options: [
    {
      id: 'add_people',
      kind: 'add_people',
      label: '加人：后端 +1',
      detail: '程序按新人数实际重排过：2026-11-30 完工，赶得上截止日。',
      decision: {
        kind: 'add_people',
        summary: '团队加人：后端 +1',
        team: [{ role: '后端', headcount: 2 }],
      },
      recommended: true,
    },
  ],
}

const preview: ReplanPreview = {
  decision: assessment.options[0]!.decision,
  before: {
    plannedEndDate: '2026-12-08',
    deadline: '2026-12-06',
    exceededWorkdays: 2,
    taskCount: 107,
    team: [{ role: '后端', headcount: 1 }],
  },
  after: {
    plannedEndDate: '2026-11-30',
    deadline: '2026-12-06',
    exceededWorkdays: 0,
    taskCount: 107,
    team: [{ role: '后端', headcount: 2 }],
  },
  removedTasks: 0,
  movedTasks: [{ name: '积分兑换接口', fromEnd: '2026-11-20', toEnd: '2026-11-12' }],
  summary: '',
}

beforeEach(() => {
  useAiProjectDraftStore.setState({ draftStatus: 'reviewing' })
  api.replanAssessment.mockResolvedValue({ assessment, version: 1 })
  api.replanPreview.mockResolvedValue({ preview, version: 1 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('审查页：能否如期完成', () => {
  it('超期时默认展开；「重排看看」给出前后对比，不落库', async () => {
    render(<NextDraftReplanPanel draftId="d1" version={1} />)
    await screen.findByText(/晚约 2 个工作日/)
    const card = screen
      .getByText('加人：后端 +1')
      .closest('[data-feasibility-option]') as HTMLElement
    fireEvent.click(within(card).getByText('重排看看'))
    await screen.findByText(/2026-11-30 完工，截止日 2026-12-06 前完成/)
    expect(screen.getByText(/后端 1/)).toBeTruthy()
    expect(api.replanPreview).toHaveBeenCalledWith('d1', assessment.options[0]!.decision)
    expect(api.replanApply).not.toHaveBeenCalled()
  })

  it('确认调整：带版本号提交，成功后更新草案版本', async () => {
    const draft = {
      projectType: 'software',
      charter: {},
      tasks: [],
      wbs: [],
      dependencies: [],
      acceptanceCriteria: [],
      resourceHints: [],
      riskHints: [],
      milestoneHints: [],
      ganttPreview: {},
    }
    api.replanApply.mockResolvedValue({
      draftId: 'd1',
      version: 2,
      draft,
      meta: { decisions: [] },
      validation: { issues: [] },
    } as never)
    render(<NextDraftReplanPanel draftId="d1" version={1} />)
    await screen.findByText('加人：后端 +1')
    fireEvent.click(screen.getByText('重排看看'))
    fireEvent.click(await screen.findByText('确认调整（存成新版本）'))
    await screen.findByText(/已调整并存为第 2 版/)
    expect(api.replanApply).toHaveBeenCalledWith('d1', { decision: preview.decision, version: 1 })
    await waitFor(() => expect(useAiProjectDraftStore.getState().draftVersion).toBe(2))
  })

  it('协商对话按草案存在本标签页，刷新后还在', async () => {
    window.sessionStorage.setItem(
      'aiproj-replan-chat:d1',
      JSON.stringify([
        { role: 'user', text: '测试找外包加一个人' },
        { role: 'assistant', text: '加人后完工日没有提前' },
      ]),
    )
    render(<NextDraftReplanPanel draftId="d1" version={1} />)
    await screen.findByText('测试找外包加一个人')
    expect(screen.getByText('加人后完工日没有提前')).toBeTruthy()
    window.sessionStorage.removeItem('aiproj-replan-chat:d1')
  })

  it('已转正的草案不显示', () => {
    useAiProjectDraftStore.setState({ draftStatus: 'confirmed' })
    const { container } = render(<NextDraftReplanPanel draftId="d1" version={1} />)
    expect(container.innerHTML).toBe('')
  })
})
