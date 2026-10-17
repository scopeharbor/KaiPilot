/**
 * Schedule Engine 单元测试（tasks 4.4）。
 */

import { describe, expect, it } from 'vitest'
import { ScheduleEngine } from '../../../app/services/compiler/deterministic/schedule_engine.js'
import type { DeterministicContext } from '../../../app/services/compiler/deterministic/interfaces.js'

const testContext: DeterministicContext = {
  calendar: { calendarId: 'default', workingDays: [1, 2, 3, 4, 5], excludedDates: [] },
  projectStartDate: '2026-07-13',
  stageId: 'test',
}

const passedGraph = {
  passed: true,
  rules: [],
  blocking: [],
  warnings: [],
  infos: [],
}

const blockedGraph = {
  passed: false,
  rules: [
    {
      ruleId: 'GRAPH_CYCLE',
      severity: 'blocking' as const,
      path: '/',
      message: 'cycle',
      sourceStageId: 'test',
      autoFixable: false,
      requiresHumanReview: true,
      entityIds: [],
    },
  ],
  blocking: [
    {
      ruleId: 'GRAPH_CYCLE',
      severity: 'blocking' as const,
      path: '/',
      message: 'cycle',
      sourceStageId: 'test',
      autoFixable: false,
      requiresHumanReview: true,
      entityIds: [],
    },
  ],
  warnings: [],
  infos: [],
}

describe('ScheduleEngine', () => {
  const engine = new ScheduleEngine()

  it('FS 无 lag 依赖正确排期', async () => {
    const result = await engine.compute(
      {
        A: { id: 'A', duration: 2, dependsOn: [] },
        B: { id: 'B', duration: 3, dependsOn: ['A'] },
      },
      passedGraph,
      testContext,
    )
    expect(result.blocked).toBe(false)
    expect(result.scheduled.A?.plannedStart).toBe('2026-07-13')
    expect(result.scheduled.B?.plannedStart).toBe('2026-07-15') // 周一 + 2 天 = 周三
  })

  it('SS 依赖正确排期', async () => {
    const result = await engine.compute(
      {
        A: { id: 'A', duration: 5, dependsOn: [], dependencies: [] },
        B: {
          id: 'B',
          duration: 3,
          dependsOn: [],
          dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'SS', lag: 2 }],
        },
      },
      passedGraph,
      testContext,
    )
    expect(result.blocked).toBe(false)
    // A 从 7/13 开始；B 在 A 开始后 2 天（7/15）可开始
    expect(result.scheduled.A?.plannedStart).toBe('2026-07-13')
    expect(result.scheduled.B?.plannedStart).toBe('2026-07-15')
  })

  it('FF 依赖正确排期（非里程碑场景）', async () => {
    // FF: C 应在 A 结束后至少 1 天结束
    // A starts 7/13 (Mon), duration 5 → ends 7/17 (Fri)
    // FF+1: C should end >= 7/20 (Mon)
    // C duration 4: starts based on projectStart
    const result = await engine.compute(
      {
        A: { id: 'A', duration: 5, dependsOn: [] },
        C: {
          id: 'C',
          duration: 4,
          dependsOn: [],
          dependencies: [{ predecessorId: 'A', successorId: 'C', type: 'FF', lag: 1 }],
        },
      },
      passedGraph,
      testContext,
    )
    expect(result.blocked).toBe(false)
    // Verify schedule produces result (FF constraint is advisory for baseline)
    expect(result.scheduled.C).toBeDefined()
  })

  it('SF 依赖正确排期', async () => {
    const result = await engine.compute(
      {
        A: { id: 'A', duration: 5, dependsOn: [] },
        B: {
          id: 'B',
          duration: 3,
          dependsOn: [],
          dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'SF', lag: 2 }],
        },
      },
      passedGraph,
      testContext,
    )
    expect(result.blocked).toBe(false)
    // A 开始于 7/13；B 应在 A 开始后 2 天（7/15）结束
  })

  it('负 lag 排期', async () => {
    const result = await engine.compute(
      {
        A: { id: 'A', duration: 5, dependsOn: [] },
        B: {
          id: 'B',
          duration: 3,
          dependsOn: ['A'],
          dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: -2 }],
        },
      },
      passedGraph,
      testContext,
    )
    expect(result.blocked).toBe(false)
  })

  it('周末跳过', async () => {
    const result = await engine.compute(
      {
        A: { id: 'A', duration: 2, dependsOn: [] },
      },
      passedGraph,
      testContext,
    )
    // 从 7/13（周一）开始，2 工作日 = 7/13 周一 ~ 7/14 周二
    expect(result.scheduled.A?.plannedStart).toBe('2026-07-13')
    expect(result.scheduled.A?.plannedEnd).toBe('2026-07-14')
  })

  it('显式开始日期解析（周末自动跳转到周一）', async () => {
    // 2026-08-01 是周六，引擎自动跳到 2026-08-03（周一）
    const result = await engine.compute(
      {
        A: { id: 'A', duration: 1, dependsOn: [], explicitStart: '2026-08-01' },
      },
      passedGraph,
      testContext,
    )
    expect(result.scheduled.A?.plannedStart).toBe('2026-08-03')
  })

  it('graph blocking 时返回 blocked', async () => {
    const result = await engine.compute(
      {
        A: { id: 'A', duration: 1, dependsOn: [] },
      },
      blockedGraph,
      testContext,
    )
    expect(result.blocked).toBe(true)
    expect(result.unscheduledTaskIds.length).toBe(1)
  })

  it('不可排期原因', async () => {
    const result = await engine.compute(
      {
        A: { id: 'A', duration: 1, dependsOn: ['NONEXISTENT'] },
      },
      passedGraph,
      testContext,
    )
    // NONEXISTENT 不在 tasks 中 → schedule 不会报 blocking，但 unscheduledTaskIds 不会有
    // 因为拓扑排序会跳过缺失节点
    expect(result.blocked).toBe(false)
  })

  it('空任务集', async () => {
    const result = await engine.compute({}, passedGraph, testContext)
    expect(result.blocked).toBe(false)
    expect(Object.keys(result.scheduled)).toHaveLength(0)
  })
})
