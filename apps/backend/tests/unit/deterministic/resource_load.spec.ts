/**
 * Resource Load 单元测试（tasks 6.4）。
 */

import { describe, expect, it } from 'vitest'
import { ResourceLoadCalculator } from '../../../app/services/compiler/deterministic/resource_load_service.js'
import type { DeterministicContext } from '../../../app/services/compiler/deterministic/interfaces.js'

const testContext: DeterministicContext = {
  calendar: { calendarId: 'default', workingDays: [1, 2, 3, 4, 5], excludedDates: [] },
  projectStartDate: '2026-07-13',
  stageId: 'test',
}

const passedGraph = { passed: true, rules: [], blocking: [], warnings: [], infos: [] }

describe('ResourceLoadCalculator', () => {
  const calculator = new ResourceLoadCalculator()

  it('正常负载不超载', async () => {
    const result = await calculator.compute(
      {
        capacities: { dev_1: 8 },
        assignments: { task_A: 'dev_1', task_B: 'dev_1' },
        schedules: {
          task_A: { plannedStart: '2026-07-13', plannedEnd: '2026-07-14' },
          task_B: { plannedStart: '2026-07-15', plannedEnd: '2026-07-16' },
        },
      },
      passedGraph,
      testContext,
    )
    expect(result.hasOverload).toBe(false)
  })

  it('超载检测', async () => {
    const result = await calculator.compute(
      {
        capacities: { dev_1: 8 },
        assignments: { task_A: 'dev_1', task_B: 'dev_1', task_C: 'dev_1' },
        schedules: {
          task_A: { plannedStart: '2026-07-13', plannedEnd: '2026-07-14' },
          task_B: { plannedStart: '2026-07-13', plannedEnd: '2026-07-14' },
          task_C: { plannedStart: '2026-07-13', plannedEnd: '2026-07-13' },
        },
      },
      passedGraph,
      testContext,
    )
    expect(result.hasOverload).toBe(true)
    expect(result.overloadDays).toBeGreaterThan(0)
  })

  it('缺失 capacity 时返回 warning', async () => {
    const result = await calculator.compute(
      {
        capacities: {},
        assignments: { task_A: 'dev_1' },
        schedules: {
          task_A: { plannedStart: '2026-07-13', plannedEnd: '2026-07-13' },
        },
      },
      passedGraph,
      testContext,
    )
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]?.ruleId).toBe('RESOURCE_CAPACITY_MISSING')
  })

  it('多任务同日桶', async () => {
    const result = await calculator.compute(
      {
        capacities: { dev_1: 16 },
        assignments: { task_A: 'dev_1', task_B: 'dev_1' },
        schedules: {
          task_A: { plannedStart: '2026-07-13', plannedEnd: '2026-07-13' },
          task_B: { plannedStart: '2026-07-13', plannedEnd: '2026-07-13' },
        },
      },
      passedGraph,
      testContext,
    )
    const bucket = result.buckets.find((b) => b.date === '2026-07-13')
    expect(bucket).toBeDefined()
    expect(bucket!.assignedLoad).toBe(16)
    expect(bucket!.taskIds).toContain('task_A')
    expect(bucket!.taskIds).toContain('task_B')
  })

  it('空 assignments 返回空 buckets', async () => {
    const result = await calculator.compute(
      {
        capacities: { dev_1: 8 },
        assignments: {},
        schedules: {},
      },
      passedGraph,
      testContext,
    )
    expect(result.buckets).toHaveLength(0)
    expect(result.hasOverload).toBe(false)
  })
})
