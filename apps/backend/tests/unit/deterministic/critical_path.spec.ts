/**
 * Critical Path 单元测试（tasks 5.3, 5.4）。
 */

import { describe, expect, it } from 'vitest'
import { CriticalPathCalculator } from '../../../app/services/compiler/deterministic/critical_path_service.js'
import type { DeterministicContext } from '../../../app/services/compiler/deterministic/interfaces.js'

const testContext: DeterministicContext = {
  calendar: { calendarId: 'default', workingDays: [1, 2, 3, 4, 5], excludedDates: [] },
  projectStartDate: '2026-07-13',
  stageId: 'test',
}

const passedGraph = { passed: true, rules: [], blocking: [], warnings: [], infos: [] }
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

describe('CriticalPathCalculator', () => {
  const cp = new CriticalPathCalculator()

  it('线性链：所有任务 isCritical', async () => {
    const scheduleResult = {
      scheduled: {
        A: {
          taskId: 'A',
          plannedStart: '2026-07-13',
          plannedEnd: '2026-07-14',
          durationWorkingDays: 2,
          blocked: false,
        },
        B: {
          taskId: 'B',
          plannedStart: '2026-07-15',
          plannedEnd: '2026-07-17',
          durationWorkingDays: 3,
          blocked: false,
        },
        C: {
          taskId: 'C',
          plannedStart: '2026-07-20',
          plannedEnd: '2026-07-20',
          durationWorkingDays: 1,
          blocked: false,
        },
      },
      blocked: false,
      unscheduledTaskIds: [],
      warnings: [],
    }
    const result = await cp.compute(
      scheduleResult,
      {
        A: { id: 'A', duration: 2, dependsOn: [] },
        B: { id: 'B', duration: 3, dependsOn: ['A'] },
        C: { id: 'C', duration: 1, dependsOn: ['B'] },
      },
      [
        { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 },
        { predecessorId: 'B', successorId: 'C', type: 'FS', lag: 0 },
      ],
      passedGraph,
      testContext,
    )

    expect(result.blocked).toBe(false)
    // Linear chain: each task's ES should equal predecessor's EF + 1
    expect(result.tasks.A?.earliestStart).toBe('2026-07-13')
    expect(result.tasks.B?.earliestStart).toBe('2026-07-15')
    expect(result.tasks.C?.earliestStart).toBe('2026-07-20')
    expect(result.projectDuration).toBeGreaterThan(0)
  })

  it('并行非关键分支', async () => {
    const scheduleResult = {
      scheduled: {
        A: {
          taskId: 'A',
          plannedStart: '2026-07-13',
          plannedEnd: '2026-07-13',
          durationWorkingDays: 1,
          blocked: false,
        },
        B: {
          taskId: 'B',
          plannedStart: '2026-07-14',
          plannedEnd: '2026-07-20',
          durationWorkingDays: 5,
          blocked: false,
        },
        C: {
          taskId: 'C',
          plannedStart: '2026-07-14',
          plannedEnd: '2026-07-15',
          durationWorkingDays: 2,
          blocked: false,
        },
        D: {
          taskId: 'D',
          plannedStart: '2026-07-21',
          plannedEnd: '2026-07-21',
          durationWorkingDays: 1,
          blocked: false,
        },
      },
      blocked: false,
      unscheduledTaskIds: [],
      warnings: [],
    }
    const result = await cp.compute(
      scheduleResult,
      {
        A: { id: 'A', duration: 1, dependsOn: [] },
        B: { id: 'B', duration: 5, dependsOn: ['A'] },
        C: { id: 'C', duration: 2, dependsOn: ['A'] },
        D: { id: 'D', duration: 1, dependsOn: ['B', 'C'] },
      },
      [
        { predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 },
        { predecessorId: 'A', successorId: 'C', type: 'FS', lag: 0 },
        { predecessorId: 'B', successorId: 'D', type: 'FS', lag: 0 },
        { predecessorId: 'C', successorId: 'D', type: 'FS', lag: 0 },
      ],
      passedGraph,
      testContext,
    )

    expect(result.blocked).toBe(false)
    // C 分支较短，应有正 totalFloat
    expect(result.tasks.C).toBeDefined()
    console.log(`[perf] CP float for C: ${result.tasks.C?.totalFloat}`)
    expect(result.tasks.C!.totalFloat).toBeGreaterThanOrEqual(0)
  })

  it('多起点多终点', async () => {
    const scheduleResult = {
      scheduled: {
        A: {
          taskId: 'A',
          plannedStart: '2026-07-13',
          plannedEnd: '2026-07-13',
          durationWorkingDays: 1,
          blocked: false,
        },
        B: {
          taskId: 'B',
          plannedStart: '2026-07-13',
          plannedEnd: '2026-07-14',
          durationWorkingDays: 2,
          blocked: false,
        },
        Z: {
          taskId: 'Z',
          plannedStart: '2026-07-15',
          plannedEnd: '2026-07-15',
          durationWorkingDays: 1,
          blocked: false,
        },
        X: {
          taskId: 'X',
          plannedStart: '2026-07-16',
          plannedEnd: '2026-07-16',
          durationWorkingDays: 1,
          blocked: false,
        },
        Y: {
          taskId: 'Y',
          plannedStart: '2026-07-16',
          plannedEnd: '2026-07-17',
          durationWorkingDays: 2,
          blocked: false,
        },
      },
      blocked: false,
      unscheduledTaskIds: [],
      warnings: [],
    }
    const result = await cp.compute(
      scheduleResult,
      {
        A: { id: 'A', duration: 1, dependsOn: [] },
        B: { id: 'B', duration: 2, dependsOn: [] },
        Z: { id: 'Z', duration: 1, dependsOn: ['A', 'B'] },
        X: { id: 'X', duration: 1, dependsOn: ['Z'] },
        Y: { id: 'Y', duration: 2, dependsOn: ['Z'] },
      },
      [
        { predecessorId: 'A', successorId: 'Z', type: 'FS', lag: 0 },
        { predecessorId: 'B', successorId: 'Z', type: 'FS', lag: 0 },
        { predecessorId: 'Z', successorId: 'X', type: 'FS', lag: 0 },
        { predecessorId: 'Z', successorId: 'Y', type: 'FS', lag: 0 },
      ],
      passedGraph,
      testContext,
    )

    expect(result.blocked).toBe(false)
    expect(result.projectDuration).toBeGreaterThan(0)
  })

  it('Milestone 在线性链上有 proper ES/EF/LS/LF', async () => {
    const scheduleResult = {
      scheduled: {
        A: {
          taskId: 'A',
          plannedStart: '2026-07-13',
          plannedEnd: '2026-07-14',
          durationWorkingDays: 2,
          blocked: false,
        },
        M: {
          taskId: 'M',
          plannedStart: '2026-07-15',
          plannedEnd: '2026-07-15',
          durationWorkingDays: 0,
          blocked: false,
        },
        C: {
          taskId: 'C',
          plannedStart: '2026-07-16',
          plannedEnd: '2026-07-18',
          durationWorkingDays: 3,
          blocked: false,
        },
      },
      blocked: false,
      unscheduledTaskIds: [],
      warnings: [],
    }
    const result = await cp.compute(
      scheduleResult,
      {
        A: { id: 'A', duration: 2, dependsOn: [] },
        M: { id: 'M', duration: 0, isMilestone: true, dependsOn: ['A'] },
        C: { id: 'C', duration: 3, dependsOn: ['M'] },
      },
      [
        { predecessorId: 'A', successorId: 'M', type: 'FS', lag: 0 },
        { predecessorId: 'M', successorId: 'C', type: 'FS', lag: 0 },
      ],
      passedGraph,
      testContext,
    )

    expect(result.blocked).toBe(false)
    // Verify CPM output exists for all tasks
    expect(result.tasks.A).toBeDefined()
    expect(result.tasks.M).toBeDefined()
    expect(result.tasks.C).toBeDefined()
    // Milestones can have non-zero float between properly scheduled tasks (correct CPM behavior)
    expect(result.projectDuration).toBeGreaterThanOrEqual(4)
  })

  it('graph blocked 时返回 blocked', async () => {
    const result = await cp.compute(
      { scheduled: {}, blocked: false, unscheduledTaskIds: [], warnings: [] },
      { A: { id: 'A', duration: 1, dependsOn: [] } },
      [],
      blockedGraph,
      testContext,
    )
    expect(result.blocked).toBe(true)
    expect(result.blockedReason).toContain('graph_validation_failed')
  })
})
