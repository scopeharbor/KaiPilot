import { describe, expect, it } from 'vitest'
import {
  deriveGanttPreview,
  longestChainWorkdays,
  longestPathTaskIds,
  salvageScheduleOutput,
} from '#services/ai_draft/schedule_salvage'

const marker = { confidence: 0.8, source: 'inferred', reason: '按排期', needsConfirmation: true }
const field = (value: unknown) => ({ value, marker })

function task(id: string, days: number, start: string, end: string) {
  return {
    id,
    durationDays: field(days),
    startDate: field(start),
    endDate: field(end),
  }
}

function dep(from: string, to: string) {
  return {
    id: `${from}-${to}`,
    predecessorId: from,
    successorId: to,
    type: 'FS',
    lagDays: field(0),
  }
}

/** a(5) → b(10) → d(3)；a(5) → c(2) → d(3)：关键路径 a-b-d（18 天）。 */
const tasks = [
  task('a', 5, '2026-10-12', '2026-10-16'),
  task('b', 10, '2026-10-19', '2026-10-30'),
  task('c', 2, '2026-10-19', '2026-10-20'),
  task('d', 3, '2026-11-02', '2026-11-04'),
]
const deps = [dep('a', 'b'), dep('a', 'c'), dep('b', 'd'), dep('c', 'd')]

describe('longestPathTaskIds', () => {
  it('按工期取依赖网最长路径，而非全部任务的拓扑序', () => {
    expect(longestPathTaskIds(tasks, deps)).toEqual(['a', 'b', 'd'])
  })

  it('有环时返回空数组', () => {
    expect(longestPathTaskIds(tasks, [...deps, dep('d', 'a')])).toEqual([])
  })
})

describe('deriveGanttPreview', () => {
  it('起止取任务最早开始 / 最晚结束，总工期按日历天含首尾，阶段数取一级 WBS', () => {
    const preview = deriveGanttPreview(tasks, deps, [
      { id: 'w1', parentId: null },
      { id: 'w2', parentId: null },
    ]) as {
      startDate: { value: string }
      endDate: { value: string }
      totalDurationDays: { value: number }
      criticalPathTaskIds: string[]
      phaseCount: number
    }
    expect(preview.startDate.value).toBe('2026-10-12')
    expect(preview.endDate.value).toBe('2026-11-04')
    expect(preview.totalDurationDays.value).toBe(24)
    expect(preview.criticalPathTaskIds).toEqual(['a', 'b', 'd'])
    expect(preview.phaseCount).toBe(2)
  })
})

describe('salvageScheduleOutput', () => {
  const aggregate = { tasks, wbs: [{ id: 'w1', parentId: null }] }

  it('依赖逐条完整、仅末尾缺括号（甘特预览丢失）时抢救并推导甘特', () => {
    const raw = `{"dependencies":[${deps.map((item) => JSON.stringify(item)).join(',')}`
    const salvaged = salvageScheduleOutput(raw, aggregate)
    expect(salvaged?.dependencies).toHaveLength(4)
    expect((salvaged?.ganttPreview.criticalPathTaskIds as string[]) ?? []).toEqual(['a', 'b', 'd'])
  })

  it('依赖写到一半（真实截断）不抢救，交给重试', () => {
    const raw = `{"dependencies":[${JSON.stringify(deps[0])},{"id":"x","predecessorId":"b`
    expect(salvageScheduleOutput(raw, aggregate)).toBeNull()
  })
})

describe('longestChainWorkdays', () => {
  it('最长链工期 = 链上任务工期之和（a5 → b10 → d3 = 18）', () => {
    expect(longestChainWorkdays(tasks, deps)).toEqual({ workdays: 18, taskIds: ['a', 'b', 'd'] })
  })

  it('去掉 b 的串联后最长链变短', () => {
    const parallel = [dep('a', 'c'), dep('c', 'd')]
    expect(longestChainWorkdays(tasks, parallel)?.workdays).toBe(10)
  })

  it('有环返回 null', () => {
    expect(longestChainWorkdays(tasks, [...deps, dep('d', 'a')])).toBeNull()
  })
})
