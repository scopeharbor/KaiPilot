import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { CalendarQuickCreate } from '@/components/next/lenses/calendar/CalendarQuickCreate'

const mocks = vi.hoisted(() => ({ create: vi.fn(), suggest: vi.fn(), check: vi.fn() }))
vi.mock('@/hooks/use-mobile-workspace', () => ({ useMobileWorkspace: () => true }))
vi.mock('@/lib/api/calendar-quick-create', () => ({
  calendarQuickCreateApi: { suggest: mocks.suggest, check: mocks.check },
}))
vi.mock('@/lib/api/tasks', () => ({ tasksApi: { create: mocks.create } }))
vi.mock('@/lib/task-query-invalidation', () => ({ invalidateTaskQueries: vi.fn() }))

test('手机不用 Tab 也能明确采纳建议，采纳不写入，点击创建才保存', async () => {
  mocks.suggest.mockResolvedValue({
    source: 'ai',
    note: null,
    options: { members: [], workPackages: [] },
    tasks: [
      {
        name: '手机建议任务',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
        durationDays: 2,
        assigneeId: null,
        wbsNodeId: null,
        priority: 'high',
        conflicts: [],
        aiFields: ['name', 'dates', 'priority'],
      },
    ],
  })
  mocks.check.mockResolvedValue({ conflicts: [] })
  mocks.create.mockImplementation((_projectId, payload) => Promise.resolve({ id: 101, ...payload }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CalendarQuickCreate
        projectId={7}
        startDate="2026-10-05"
        endDate={null}
        anchor={null}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: '采纳灰字建议' }))
  expect(screen.getByLabelText('任务名')).toHaveValue('手机建议任务')
  expect(screen.getByLabelText('截止日期')).toHaveValue('2026-10-06')
  expect(screen.getByLabelText('优先级')).toHaveValue('high')
  expect(mocks.create).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /^建立$/ }))
  await waitFor(() =>
    expect(mocks.create).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        name: '手机建议任务',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
        priority: 'high',
        customFields: expect.objectContaining({
          aiFields: expect.arrayContaining(['name', 'dates', 'priority']),
        }),
      }),
    ),
  )
})
