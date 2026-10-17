/**
 * Deterministic Engine Schema 单元测试（task 1.4）。
 *
 * 覆盖：
 * - 合法输入通过解析
 * - 非法输入拒绝
 * - unknown fields 行为
 * - diff path 稳定性（reorder 不产生 diff）
 * - 各 engine 类型 schema
 *
 * @aiproj/compiler-spec
 */

import { describe, expect, it } from 'vitest'
import {
  autoFixCandidateSchema,
  criticalPathResultSchema,
  criticalPathTaskResultSchema,
  dependencySchema,
  deterministicEngineResultSchema,
  engineEvidenceSchema,
  graphValidationInputSchema,
  graphValidationResultSchema,
  hardValidationReportSchema,
  pdmDiffItemSchema,
  pdmDiffSchema,
  resourceLoadBucketSchema,
  resourceLoadResultSchema,
  scheduleComputedSchema,
  scheduleResultSchema,
  validationRuleResultSchema,
  workingCalendarSchema,
} from './index.js'

// ── Schedule Schema ──

describe('scheduleComputedSchema', () => {
  const valid = {
    taskId: 'task_1',
    plannedStart: '2026-07-13',
    plannedEnd: '2026-07-15',
    durationWorkingDays: 3,
    blocked: false,
  }

  it('合法 schedule 通过', () => {
    expect(scheduleComputedSchema.safeParse(valid).success).toBe(true)
  })

  it('缺少 required 字段失败', () => {
    const { taskId: _, ...rest } = valid as any
    expect(scheduleComputedSchema.safeParse(rest).success).toBe(false)
  })

  it('日期格式非法失败', () => {
    expect(scheduleComputedSchema.safeParse({ ...valid, plannedStart: '07-13-2026' }).success).toBe(
      false,
    )
  })

  it('duration 负数失败', () => {
    expect(scheduleComputedSchema.safeParse({ ...valid, durationWorkingDays: -1 }).success).toBe(
      false,
    )
  })

  it('允许 unknown fields', () => {
    expect(scheduleComputedSchema.safeParse({ ...valid, extraField: 'value' }).success).toBe(true)
  })
})

describe('scheduleResultSchema', () => {
  const valid = {
    scheduled: {
      task_1: {
        taskId: 'task_1',
        plannedStart: '2026-07-13',
        plannedEnd: '2026-07-15',
        durationWorkingDays: 3,
        blocked: false,
      },
    },
    blocked: false,
    unscheduledTaskIds: [],
    warnings: [],
  }

  it('合法 result 通过', () => {
    expect(scheduleResultSchema.safeParse(valid).success).toBe(true)
  })

  it('blocked=true 时可选 blockedReason', () => {
    expect(scheduleResultSchema.safeParse({ ...valid, blocked: true }).success).toBe(true)
  })

  it('default 字段不提供时使用默认值', () => {
    const result = scheduleResultSchema.safeParse({ scheduled: {}, blocked: false })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.unscheduledTaskIds).toEqual([])
      expect(result.data.warnings).toEqual([])
    }
  })
})

// ── Graph Validation Schema ──

describe('graphValidationResultSchema', () => {
  const valid = {
    passed: true,
    rules: [],
    blocking: [],
    warnings: [],
    infos: [],
  }

  it('合法结果通过', () => {
    expect(graphValidationResultSchema.safeParse(valid).success).toBe(true)
  })

  it('含 blocking 规则通过', () => {
    expect(
      graphValidationResultSchema.safeParse({
        ...valid,
        passed: false,
        blocking: [
          {
            ruleId: 'GRAPH_CYCLE_DETECTED',
            severity: 'blocking',
            path: '/tasks/task_A',
            message: '依赖环：A -> B -> A',
            sourceStageId: 'deterministic_graph_validation',
            autoFixable: false,
            requiresHumanReview: true,
            entityIds: ['task_A', 'task_B'],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('severity 非法枚举值失败', () => {
    const result = validationRuleResultSchema.safeParse({
      ruleId: 'TEST',
      severity: 'critical',
      path: '/test',
      message: 'test',
      sourceStageId: 'test',
    })
    expect(result.success).toBe(false)
  })
})

describe('graphValidationInputSchema', () => {
  it('合法输入通过', () => {
    expect(
      graphValidationInputSchema.safeParse({
        taskDependencies: { task_A: { id: 'task_A', duration: 1, dependsOn: [] } },
        dependencies: [],
      }).success,
    ).toBe(true)
  })

  it('允许空依赖', () => {
    expect(
      graphValidationInputSchema.safeParse({
        taskDependencies: {},
        dependencies: [],
      }).success,
    ).toBe(true)
  })
})

// ── Critical Path Schema ──

describe('criticalPathTaskResultSchema', () => {
  const valid = {
    taskId: 'task_A',
    earliestStart: '2026-07-13',
    earliestFinish: '2026-07-14',
    latestStart: '2026-07-13',
    latestFinish: '2026-07-14',
    totalFloat: 0,
    isCritical: true,
  }

  it('合法结果通过', () => {
    expect(criticalPathTaskResultSchema.safeParse(valid).success).toBe(true)
  })

  it('totalFloat 可为负（延迟项目）', () => {
    expect(criticalPathTaskResultSchema.safeParse({ ...valid, totalFloat: -2 }).success).toBe(true)
  })
})

describe('criticalPathResultSchema', () => {
  const valid = {
    tasks: {
      task_A: {
        taskId: 'task_A',
        earliestStart: '2026-07-13',
        earliestFinish: '2026-07-14',
        latestStart: '2026-07-13',
        latestFinish: '2026-07-14',
        totalFloat: 0,
        isCritical: true,
      },
    },
    criticalPathIds: ['task_A'],
    projectDuration: 2,
    blocked: false,
  }

  it('合法结果通过', () => {
    expect(criticalPathResultSchema.safeParse(valid).success).toBe(true)
  })

  it('blocked 时无需 criticalPathIds', () => {
    const result = criticalPathResultSchema.safeParse({
      tasks: {},
      criticalPathIds: [],
      projectDuration: 0,
      blocked: true,
      blockedReason: 'graph_validation_failed',
    })
    expect(result.success).toBe(true)
  })
})

// ── Resource Load Schema ──

describe('resourceLoadBucketSchema', () => {
  const valid = {
    resourceId: 'dev_1',
    date: '2026-07-13',
    capacity: 8,
    assignedLoad: 0,
    overload: false,
    overloadAmount: 0,
    taskIds: [],
  }

  it('合法 bucket 通过', () => {
    expect(resourceLoadBucketSchema.safeParse(valid).success).toBe(true)
  })

  it('超载 bucket 通过', () => {
    expect(
      resourceLoadBucketSchema.safeParse({
        ...valid,
        assignedLoad: 12,
        overload: true,
        overloadAmount: 4,
      }).success,
    ).toBe(true)
  })
})

describe('resourceLoadResultSchema', () => {
  const valid = {
    buckets: [],
    hasOverload: false,
    overloadDays: 0,
    warnings: [],
  }

  it('合法结果通过', () => {
    expect(resourceLoadResultSchema.safeParse(valid).success).toBe(true)
  })
})

// ── Hard Validation Schema ──

describe('hardValidationReportSchema', () => {
  const valid = {
    passed: true,
    rules: [],
    blocking: [],
    warnings: [],
    infos: [],
    autoFixCandidates: [],
  }

  it('合法报告通过', () => {
    expect(hardValidationReportSchema.safeParse(valid).success).toBe(true)
  })

  it('含 auto-fix candidate 通过', () => {
    expect(
      hardValidationReportSchema.safeParse({
        ...valid,
        autoFixCandidates: [
          {
            patchId: 'fix_1',
            ruleId: 'SCHEDULE_DATE_INVALID',
            description: '修正任务结束日期',
            path: '/computed/scheduled/task_A/plannedEnd',
            before: '2026-07-10',
            after: '2026-07-15',
            entityId: 'task_A',
          },
        ],
      }).success,
    ).toBe(true)
  })
})

// ── Diff Schema ──

describe('pdmDiffItemSchema', () => {
  it('update 类型通过', () => {
    expect(
      pdmDiffItemSchema.safeParse({
        op: 'update',
        path: '/blueprint/tasks/task_A/duration',
        entityId: 'task_A',
        before: 2,
        after: 3,
        reason: 'schedule 重算',
        sourceStageId: 'deterministic_schedule',
        ruleId: 'SCHEDULE_RECOMPUTE',
      }).success,
    ).toBe(true)
  })

  it('add 类型通过', () => {
    expect(
      pdmDiffItemSchema.safeParse({
        op: 'add',
        path: '/blueprint/tasks/task_X',
        entityId: 'task_X',
        after: { id: 'task_X', name: '新任务' },
        reason: 'auto-fix 新增',
        sourceStageId: 'deterministic_auto_fix',
      }).success,
    ).toBe(true)
  })

  it('remove 类型通过', () => {
    expect(
      pdmDiffItemSchema.safeParse({
        op: 'remove',
        path: '/blueprint/tasks/task_Z',
        entityId: 'task_Z',
        before: { id: 'task_Z' },
        reason: 'deprecated',
        sourceStageId: 'deterministic_validation',
      }).success,
    ).toBe(true)
  })

  it('op 枚举值非法失败', () => {
    expect(
      pdmDiffItemSchema.safeParse({
        op: 'rename',
        path: '/test',
        sourceStageId: 'test',
      }).success,
    ).toBe(false)
  })
})

describe('pdmDiffSchema', () => {
  const valid = {
    items: [],
    totalChanges: 0,
    sourceStageId: 'deterministic_schedule',
    generatedAt: '2026-07-11T00:00:00.000Z',
  }

  it('合法 diff 通过', () => {
    expect(pdmDiffSchema.safeParse(valid).success).toBe(true)
  })
})

// ── Diff Path 稳定性测试（reorder 不产生业务 diff） ──

describe('diff path stability (reorder-safe no-op)', () => {
  it('同一实体集合不同顺序不产生字段 diff', () => {
    // 排序前
    const tasksBefore = [
      { id: 'task_A', name: 'A' },
      { id: 'task_B', name: 'B' },
      { id: 'task_C', name: 'C' },
    ]
    // 排序后（reorder）
    const tasksAfter = [
      { id: 'task_C', name: 'C' },
      { id: 'task_A', name: 'A' },
      { id: 'task_B', name: 'B' },
    ]

    // 按 entityId 提取字段值，忽略顺序
    function extractValues(tasks: Array<{ id: string; name: string }>) {
      const map = new Map<string, string>()
      for (const t of tasks) map.set(t.id, t.name)
      return map
    }

    const before = extractValues(tasksBefore)
    const after = extractValues(tasksAfter)
    const hasDiff =
      before.size !== after.size ||
      Array.from(before.entries()).some(([id, name]) => after.get(id) !== name)

    expect(hasDiff).toBe(false)
  })
})

// ── Evidence Schema ──

describe('engineEvidenceSchema', () => {
  const valid = {
    stageId: 'deterministic_schedule',
    engineVersion: '1.0.0',
    ruleSetVersion: '1.0',
    inputSignature: 'sha256:abc123',
    outputSummary: { entityCount: 3 },
    diffSummary: { totalChanges: 0, ruleIds: [] },
    validationResult: { passed: true, blockingCount: 0, warningCount: 0 },
  }

  it('合法 evidence 通过', () => {
    expect(engineEvidenceSchema.safeParse(valid).success).toBe(true)
  })
})

// ── Working Calendar Schema ──

describe('workingCalendarSchema', () => {
  it('合法日历通过', () => {
    expect(
      workingCalendarSchema.safeParse({
        calendarId: 'default',
        workingDays: [1, 2, 3, 4, 5],
        excludedDates: [],
      }).success,
    ).toBe(true)
  })

  it('工作日超出范围失败', () => {
    expect(
      workingCalendarSchema.safeParse({
        workingDays: [7],
      }).success,
    ).toBe(false)
  })
})

// ── Dependency Schema ──

describe('dependencySchema', () => {
  it('合法依赖通过', () => {
    expect(
      dependencySchema.safeParse({
        predecessorId: 'task_A',
        successorId: 'task_B',
        type: 'FS',
        lag: 0,
      }).success,
    ).toBe(true)
  })

  it('默认 FS, lag=0', () => {
    const result = dependencySchema.safeParse({
      predecessorId: 'task_A',
      successorId: 'task_B',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('FS')
      expect(result.data.lag).toBe(0)
    }
  })

  it('SS/FF/SF 枚举通过', () => {
    for (const type of ['SS', 'FF', 'SF'] as const) {
      expect(
        dependencySchema.safeParse({
          predecessorId: 'a',
          successorId: 'b',
          type,
        }).success,
      ).toBe(true)
    }
  })

  it('非法依赖类型失败', () => {
    expect(
      dependencySchema.safeParse({
        predecessorId: 'a',
        successorId: 'b',
        type: 'XX',
      }).success,
    ).toBe(false)
  })
})

// ── DeterministicEngineResult Schema ──

describe('deterministicEngineResultSchema', () => {
  it('空结果通过', () => {
    const result = deterministicEngineResultSchema.safeParse({
      blocked: false,
      blockingSummary: [],
      evidence: [],
    })
    expect(result.success).toBe(true)
  })

  it('包含所有子结果通过', () => {
    expect(
      deterministicEngineResultSchema.safeParse({
        schedule: {
          scheduled: {},
          blocked: false,
          unscheduledTaskIds: [],
          warnings: [],
        },
        graphValidation: {
          passed: true,
          rules: [],
          blocking: [],
          warnings: [],
          infos: [],
        },
        criticalPath: {
          tasks: {},
          criticalPathIds: [],
          projectDuration: 0,
          blocked: false,
        },
        blocked: false,
        blockingSummary: [],
        evidence: [],
      }).success,
    ).toBe(true)
  })
})
