/**
 * Diff Service 单元测试（tasks 8.4）。
 */

import { describe, expect, it } from 'vitest'
import { PdmDiffService } from '../../../app/services/compiler/deterministic/diff_service.js'
import type { DeterministicContext } from '../../../app/services/compiler/deterministic/interfaces.js'

const testContext: DeterministicContext = {
  calendar: { calendarId: 'default', workingDays: [1, 2, 3, 4, 5], excludedDates: [] },
  projectStartDate: '2026-07-13',
  stageId: 'test_stage',
}

describe('PdmDiffService', () => {
  const service = new PdmDiffService()

  it('相同对象无 diff', async () => {
    const before = { name: 'project', tasks: [] }
    const after = { name: 'project', tasks: [] }
    const diff = await service.generate(before, after, testContext)
    expect(diff.totalChanges).toBe(0)
  })

  it('日期重算生成 update diff', async () => {
    const before = { tasks: { A: { id: 'A', plannedStart: '2026-07-10' } } }
    const after = { tasks: { A: { id: 'A', plannedStart: '2026-07-13' } } }
    const diff = await service.generate(before, after, testContext)
    expect(diff.totalChanges).toBeGreaterThan(0)
    expect(diff.items.some((i) => i.op === 'update' && i.path?.includes('plannedStart'))).toBe(true)
  })

  it('新增字段生成 add diff', async () => {
    const before = { tasks: {} }
    const after = { tasks: { A: { id: 'A', name: 'New Task' } } }
    const diff = await service.generate(before, after, testContext)
    expect(diff.totalChanges).toBeGreaterThan(0)
    expect(diff.items.some((i) => i.op === 'add')).toBe(true)
  })

  it('移除字段生成 remove diff', async () => {
    const before = { tasks: { A: { id: 'A', name: 'Old' } } }
    const after = { tasks: {} }
    const diff = await service.generate(before, after, testContext)
    expect(diff.totalChanges).toBeGreaterThan(0)
    expect(diff.items.some((i) => i.op === 'remove')).toBe(true)
  })

  it('数组 reorder 无业务 diff', async () => {
    const before = {
      tasks: [
        { id: 'A', name: 'Task A' },
        { id: 'B', name: 'Task B' },
        { id: 'C', name: 'Task C' },
      ],
    }
    const after = {
      tasks: [
        { id: 'C', name: 'Task C' },
        { id: 'A', name: 'Task A' },
        { id: 'B', name: 'Task B' },
      ],
    }
    const diff = await service.generate(before, after, testContext)
    expect(diff.totalChanges).toBe(0)
  })

  it('auto-fix diff 生成', async () => {
    const before = { computed: { schedule: { task_A: { plannedEnd: '2026-07-10' } } } }
    const after = { computed: { schedule: { task_A: { plannedEnd: '2026-07-15' } } } }
    const diff = await service.generate(before, after, testContext)
    expect(diff.totalChanges).toBeGreaterThan(0)
    expect(diff.sourceStageId).toBe('test_stage')
  })

  it('replay 一致性', async () => {
    const before = { name: 'project', tasks: { A: { id: 'A', duration: 2 } } }
    const after = {
      name: 'project',
      tasks: { A: { id: 'A', duration: 3 }, B: { id: 'B', duration: 1 } },
    }

    const diff = await service.generate(before, after, testContext)
    const replayed = await service.replay(before, diff)

    expect(replayed.match).toBe(true)
    // Verify replayed target matches
    const replayedStr = JSON.stringify(replayed.target)
    const afterStr = JSON.stringify(after)
    expect(replayedStr).toBe(afterStr)
  })
})
