/**
 * Hard Validator & Auto-fix 单元测试（tasks 7.4）。
 */

import { describe, expect, it } from 'vitest'
import { HardValidator } from '../../../app/services/compiler/deterministic/hard_validator.js'
import type { DeterministicContext } from '../../../app/services/compiler/deterministic/interfaces.js'

const testContext: DeterministicContext = {
  calendar: { calendarId: 'default', workingDays: [1, 2, 3, 4, 5], excludedDates: [] },
  projectStartDate: '2026-07-13',
  stageId: 'test',
}

describe('HardValidator', () => {
  const validator = new HardValidator()

  it('空结果无 blocking 通过', async () => {
    const result = await validator.validate(
      {
        schedule: { scheduled: {}, blocked: false, unscheduledTaskIds: [], warnings: [] },
        graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
        criticalPath: { tasks: {}, criticalPathIds: [], projectDuration: 0, blocked: false },
        blocked: false,
        blockingSummary: [],
        evidence: [],
      },
      testContext,
    )
    expect(result.passed).toBe(true)
    expect(result.blocking).toHaveLength(0)
  })

  it('graph blocking 阻断 hard validation', async () => {
    const result = await validator.validate(
      {
        graphValidation: {
          passed: false,
          rules: [
            {
              ruleId: 'GRAPH_CYCLE',
              severity: 'blocking',
              path: '/',
              message: 'cycle',
              sourceStageId: 'deterministic_graph_validation',
              autoFixable: false,
              requiresHumanReview: true,
              entityIds: ['A', 'B'],
            },
          ],
          blocking: [
            {
              ruleId: 'GRAPH_CYCLE',
              severity: 'blocking',
              path: '/',
              message: 'cycle',
              sourceStageId: 'deterministic_graph_validation',
              autoFixable: false,
              requiresHumanReview: true,
              entityIds: ['A', 'B'],
            },
          ],
          warnings: [],
          infos: [],
        },
        schedule: { scheduled: {}, blocked: false, unscheduledTaskIds: [], warnings: [] },
        criticalPath: { tasks: {}, criticalPathIds: [], projectDuration: 0, blocked: false },
        blocked: false,
        blockingSummary: [],
        evidence: [],
      },
      testContext,
    )
    expect(result.passed).toBe(false)
    expect(result.blocking.some((r) => r.ruleId === 'GRAPH_BLOCKING_CHECK')).toBe(true)
  })

  it('schedule blocking 产生 blocking', async () => {
    const result = await validator.validate(
      {
        graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
        schedule: { scheduled: {}, blocked: true, unscheduledTaskIds: ['A'], warnings: ['test'] },
        criticalPath: { tasks: {}, criticalPathIds: [], projectDuration: 0, blocked: false },
        blocked: true,
        blockingSummary: ['SCHEDULE_BLOCKED'],
        evidence: [],
      },
      testContext,
    )
    expect(result.passed).toBe(false)
    expect(result.blocking.some((r) => r.ruleId === 'SCHEDULE_BLOCKING_CHECK')).toBe(true)
  })

  it('warning 不阻断需要人工确认', async () => {
    const result = await validator.validate(
      {
        graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
        schedule: {
          scheduled: {
            A: {
              taskId: 'A',
              plannedStart: '2026-07-13',
              plannedEnd: '2026-07-15',
              durationWorkingDays: 3,
              blocked: false,
            },
          },
          blocked: false,
          unscheduledTaskIds: [],
          warnings: [],
        },
        criticalPath: {
          tasks: {
            A: {
              taskId: 'A',
              earliestStart: '2026-07-13',
              earliestFinish: '2026-07-15',
              latestStart: '2026-07-13',
              latestFinish: '2026-07-15',
              totalFloat: 0,
              isCritical: true,
            },
          },
          criticalPathIds: ['A'],
          projectDuration: 3,
          blocked: false,
        },
        resourceLoad: { buckets: [], hasOverload: true, overloadDays: 2, warnings: [] },
        blocked: false,
        blockingSummary: [],
        evidence: [],
      },
      testContext,
    )
    // RESOURCE_OVERLOAD_CHECK 是 warning，不阻断
    expect(result.passed).toBe(true)
    expect(result.warnings.some((r) => r.ruleId === 'RESOURCE_OVERLOAD_CHECK')).toBe(true)
  })

  it('info 不阻断流程', async () => {
    const result = await validator.validate(
      {
        graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
        schedule: { scheduled: {}, blocked: false, unscheduledTaskIds: [], warnings: [] },
        criticalPath: { tasks: {}, criticalPathIds: [], projectDuration: 0, blocked: false },
        resourceLoad: { buckets: [], hasOverload: true, overloadDays: 1, warnings: [] },
        blocked: false,
        blockingSummary: [],
        evidence: [],
      },
      testContext,
    )
    // RESOURCE_LEVELING_NOT_SUPPORTED 是 info
    expect(result.infos.some((r) => r.ruleId === 'RESOURCE_LEVELING_NOT_SUPPORTED')).toBe(true)
  })

  it('auto-fix 后重校验（模拟 autoFixCandidates）', async () => {
    const result = await validator.validate(
      {
        graphValidation: { passed: true, rules: [], blocking: [], warnings: [], infos: [] },
        schedule: { scheduled: {}, blocked: false, unscheduledTaskIds: [], warnings: [] },
        criticalPath: { tasks: {}, criticalPathIds: [], projectDuration: 0, blocked: false },
        hardValidation: {
          passed: false,
          rules: [],
          blocking: [],
          warnings: [],
          infos: [],
          autoFixCandidates: [
            {
              patchId: 'fix_1',
              ruleId: 'SCHEDULE_DATE_INVALID',
              description: '修正日期',
              path: '/computed/schedule',
              before: {},
              after: {},
            },
          ],
        },
        blocked: false,
        blockingSummary: [],
        evidence: [],
      },
      testContext,
    )
    expect(result.warnings.some((r) => r.ruleId === 'AUTO_FIX_REQUIRES_REVALIDATION')).toBe(true)
  })
})
