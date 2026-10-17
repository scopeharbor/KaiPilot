import { describe, expect, test } from 'vitest'
import { kanbanTaskSignature } from '@/components/next/project-space/WorkspaceKanbanBoard'
import type { Task } from '@/lib/api/tasks'

const base = {
  id: 226,
  status: 'not_started',
  kanbanRank: 'a0',
  updatedAt: '2026-10-04T10:00:00Z',
  assigneeId: null,
  assignee: null,
  name: '兑换页面开发',
  priority: 'medium',
  startDate: '2026-10-28',
  endDate: '2026-10-29',
  progressPercent: 0,
} as unknown as Task

describe('看板同步签名', () => {
  test('负责人 / 名称 / 日期 / 优先级 / 进度变了签名都要变（否则看板不刷新、要按 F5）', () => {
    const before = kanbanTaskSignature(base)
    for (const patch of [
      { assigneeId: 17, assignee: { fullName: '测试管理员' } },
      { name: '兑换页面开发（改）' },
      { endDate: '2026-10-30' },
      { priority: 'high' },
      { progressPercent: 50 },
      { updatedAt: '2026-10-04T10:05:00Z' },
    ]) {
      expect(kanbanTaskSignature({ ...base, ...patch } as Task)).not.toBe(before)
    }
    expect(kanbanTaskSignature({ ...base } as Task)).toBe(before)
  })
})
