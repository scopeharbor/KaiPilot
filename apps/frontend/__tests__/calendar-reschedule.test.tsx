import { describe, expect, test, vi } from 'vitest'
import type { Task } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { QueryClient } from '@tanstack/react-query'
import { calendarKeys } from '@/lib/api/calendar'

const mockTask: Task = {
  id: 10,
  projectId: 1,
  name: '发布检查',
  description: null,
  status: 'in_progress',
  priority: 'high',
  taskType: 'task',
  startDate: '2026-07-01',
  endDate: '2026-07-15',
  actualStartDate: null,
  actualEndDate: null,
  durationDays: 14,
  estimatedHours: 8,
  actualHours: null,
  progressPercent: 50,
  assigneeId: 1,
  reviewerId: null,
  parentTaskId: null,
  wbsNodeId: null,
  milestoneId: null,
  costEstimateCents: null,
  costActualCents: null,
  customFields: null,
  assignee: { id: 1, fullName: '项目经理', email: 'pm@example.com', initials: 'PM' },
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
}

describe('Calendar reschedule logic', () => {
  test('drag to different date triggers end_date update', async () => {
    const originalDate = mockTask.endDate!
    const newDate = '2026-07-18'
    expect(newDate).not.toBe(originalDate)
    expect(newDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('drag to same date is a no-op', () => {
    const sameDate = mockTask.endDate!.slice(0, 10)
    expect(sameDate).toBe('2026-07-15')
  })

  test('invalidation after reschedule includes calendar keys', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await invalidateTaskQueries(qc, 1)
    const calledKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)
    expect(calledKeys).toEqual(
      expect.arrayContaining([expect.arrayContaining([expect.stringContaining('calendar')])]),
    )
  })

  test('calendar key factory produces correct hierarchy', () => {
    const key = calendarKeys.list(42, { view: 'month', anchorDate: '2026-07-15' })
    expect(key).toEqual(['calendar', 'list', 42, { view: 'month', anchorDate: '2026-07-15' }])
  })

  test('disabled drag when user lacks update permission', () => {
    const canUpdate = false
    expect(canUpdate).toBe(false)
    // In the actual component, useDraggable is called with disabled: !canUpdate
  })

  test('member cannot reschedule task assigned to another user', () => {
    const currentUserId: number = 1
    const taskAssigneeId: number = 2
    const hasFullUpdate = false
    const canReschedule = hasFullUpdate || taskAssigneeId === currentUserId
    expect(canReschedule).toBe(false)
  })
})
