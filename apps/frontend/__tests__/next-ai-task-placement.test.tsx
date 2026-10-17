/**
 * 看板「在此列新建任务」AI 补全卡（2026-09-28）：
 * 一句话 → AI 补全 → 核对修改 → 确认创建；拆分建议一键建多张并接上先后；AI 只建议不落库。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const api = vi.hoisted(() => ({
  create: vi.fn(),
  draft: vi.fn(),
  dependency: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('@/lib/api/tasks', () => ({ tasksApi: { create: api.create } }))
vi.mock('@/lib/api/dependencies', () => ({ dependenciesApi: { create: api.dependency } }))
vi.mock('@/lib/task-query-invalidation', () => ({ invalidateTaskQueries: api.invalidate }))
vi.mock('@/lib/ai-draft/live-output-client', () => ({
  newLiveOutputId: () => 'live-1',
  useLiveOutputLanes: () => ({ lanes: [], totalChars: 0 }),
}))
vi.mock('@/lib/api/task-ai-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/task-ai-draft')>()
  return { ...actual, taskAiDraftApi: { draft: api.draft } }
})

import { AiTaskPlacementCard } from '@/components/next/project-space/AiTaskPlacementCard'

const draft = {
  name: '开发订单导出 Excel 接口并自测',
  description: '食堂管理员要按月导出订单。',
  durationDays: 1,
  priority: 'medium',
  wbsNodeId: 7,
  wbsNodeName: '1.2 订单服务',
  roleHint: '后端',
  doneCriteria: ['1000 条导出 < 3 秒'],
  steps: ['确认导出字段', '实现导出接口', '自测'],
  split: [],
  note: null,
}

function renderCard(onClose = vi.fn()) {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <AiTaskPlacementCard projectId={6} columnId="pending" onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

async function describeAndAsk(text: string) {
  const input = screen.getByPlaceholderText(/Enter 交给 AI 补全/)
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(document.querySelector('[data-placement-preview]')).not.toBeNull())
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  api.create.mockImplementation(async (_pid: number, input: { name: string }) => ({
    id: Math.floor(Math.random() * 1000) + 1,
    name: input.name,
  }))
})

describe('AI 补全任务卡', () => {
  test('一句话交给 AI，预览可改，确认后才建任务；步骤写成可打勾清单', async () => {
    api.draft.mockResolvedValue(draft)
    const onClose = renderCard()
    await describeAndAsk('给食堂后台加订单导出 Excel')
    expect(api.draft).toHaveBeenCalledWith(
      6,
      expect.objectContaining({ description: '给食堂后台加订单导出 Excel' }),
    )
    expect(api.create).not.toHaveBeenCalled()
    expect(screen.getByText('归属 1.2 订单服务')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '开发订单导出接口' } })
    fireEvent.click(screen.getByRole('button', { name: /确认创建/ }))
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    const [, input] = api.create.mock.calls[0]!
    expect(input).toMatchObject({
      name: '开发订单导出接口',
      status: 'not_started',
      durationDays: 1,
      estimatedHours: 8,
      wbsNodeId: 7,
    })
    expect(input.description).toContain('- [ ] 实现导出接口')
    expect(input.customFields.execution.steps).toEqual(['确认导出字段', '实现导出接口', '自测'])
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  test('拆分建议：一键建多张卡，按顺序接上「完成 → 开始」依赖，各带完成标准', async () => {
    api.draft.mockResolvedValue({
      ...draft,
      split: [
        {
          name: '确认导出字段',
          durationDays: 0.5,
          doneCriteria: ['字段清单双方确认'],
          steps: ['对齐字段'],
        },
        {
          name: '实现导出接口',
          durationDays: 1,
          doneCriteria: ['接口自测通过'],
          steps: ['写接口'],
        },
        { name: '联调与自测', durationDays: 0.5, doneCriteria: [], steps: ['联调'] },
      ],
      note: '超过 2 天，拆成 3 张',
    })
    renderCard()
    await describeAndAsk('做订单导出')
    expect(screen.getByText('超过 2 天，拆成 3 张')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /拆成 3 张卡/ }))
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(api.dependency).toHaveBeenCalledTimes(2))
    expect(api.dependency.mock.calls[0]![2]).toMatchObject({ type: 'fs' })
    expect(api.create.mock.calls[0]![1]).toMatchObject({ estimatedHours: 4, durationDays: 1 })
    expect(api.create.mock.calls[0]![1].customFields.execution.doneCriteria).toEqual([
      '字段清单双方确认',
    ])
    expect(api.create.mock.calls[1]![1].customFields.execution.doneCriteria).toEqual([
      '接口自测通过',
    ])
  })

  test('互动调整：说「工期改半天」→ 带上一版草稿与意见再问 AI，结果替换预览并记下这句话', async () => {
    api.draft
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ ...draft, durationDays: 0.5, note: '工期改为半天' })
    renderCard()
    await describeAndAsk('给食堂后台加订单导出 Excel')
    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '手改过的名称' } })
    fireEvent.change(screen.getByLabelText('让 AI 修改这张卡'), { target: { value: '工期改半天' } })
    fireEvent.click(screen.getByRole('button', { name: /让 AI 改/ }))
    await waitFor(() => expect(api.draft).toHaveBeenCalledTimes(2))
    expect(api.draft.mock.calls[1]![1]).toMatchObject({
      instruction: '工期改半天',
      previous: expect.objectContaining({ name: '手改过的名称' }),
    })
    await screen.findByText('你：工期改半天')
    expect(screen.getByText('工期改为半天')).toBeInTheDocument()
    expect((document.querySelector('[data-placement-duration]') as HTMLSelectElement).value).toBe(
      '0.5',
    )
    expect(api.create).not.toHaveBeenCalled()
  })

  test('AI 失败：回到描述态并提示，可改用「不用 AI，直接建」', async () => {
    api.draft.mockRejectedValue({ message: 'AI 这次没能补全任务卡' })
    renderCard()
    const input = screen.getByPlaceholderText(/Enter 交给 AI 补全/)
    fireEvent.change(input, { target: { value: '整理测试用例 2 天' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('AI 这次没能补全任务卡')
    fireEvent.click(screen.getByRole('button', { name: '不用 AI，直接建' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
  })
})
