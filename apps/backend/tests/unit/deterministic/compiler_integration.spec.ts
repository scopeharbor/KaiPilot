/**
 * Compiler Integration Test —— deterministic stage pipeline（task 10.4）。
 *
 * 验证：
 * - deterministic stage pipeline 成功完成
 * - graph blocking 时后续 stage 正确标记 blocked
 * - warning 需要人工确认时仍可继续
 * - ledger evidence 正确记录
 *
 * @aiproj/backend
 */

import { describe, expect, it } from 'vitest'
import { DeterministicOrchestrator } from '../../../app/services/compiler/deterministic/deterministic_orchestrator.js'
import { InMemoryRecorder } from '../../../app/services/compiler/deterministic/in_memory_recorder.js'

const testContext = {
  calendar: { calendarId: 'default', workingDays: [1, 2, 3, 4, 5], excludedDates: [] },
  projectStartDate: '2026-07-13',
  stageId: 'integration_test',
}

describe('Compiler Integration (deterministic pipeline)', () => {
  const orchestrator = new DeterministicOrchestrator()
  const recorder = new InMemoryRecorder()

  it('deterministic stage pipeline 成功', async () => {
    const result = await orchestrator.execute({
      graphInput: {
        taskDependencies: {
          A: { id: 'A', duration: 2, dependsOn: [] },
          B: { id: 'B', duration: 3, dependsOn: ['A'] },
        },
        dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 }],
      },
      tasks: {
        A: { id: 'A', duration: 2, dependsOn: [] },
        B: { id: 'B', duration: 3, dependsOn: ['A'] },
      },
      dependencies: [{ predecessorId: 'A', successorId: 'B', type: 'FS', lag: 0 }],
      context: testContext,
    })

    expect(result.blocked).toBe(false)
    expect(result.graphValidation?.passed).toBe(true)
    expect(result.schedule?.blocked).toBe(false)
    expect(result.criticalPath?.blocked).toBe(false)
    expect(result.hardValidation?.passed).toBe(true)
    expect(result.evidence.length).toBeGreaterThanOrEqual(4) // graph+schedule+cp+hv

    // Record evidence
    for (const evidence of result.evidence) {
      recorder.record(1, evidence)
    }
  })

  it('graph blocking 时后续 stage 标记 blocked', async () => {
    const result = await orchestrator.execute({
      graphInput: {
        taskDependencies: {
          A: { id: 'A', duration: 1, dependsOn: ['B'] },
          B: { id: 'B', duration: 1, dependsOn: ['A'] },
        },
        dependencies: [],
      },
      tasks: {
        A: { id: 'A', duration: 1, dependsOn: ['B'] },
        B: { id: 'B', duration: 1, dependsOn: ['A'] },
      },
      dependencies: [],
      context: testContext,
    })

    expect(result.graphValidation?.passed).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.blockingSummary.includes('GRAPH_CYCLE_DETECTED')).toBe(true)
    expect(result.hardValidation?.passed).toBe(false)
  })

  it('warning 仍可继续（不阻断）', async () => {
    const result = await orchestrator.execute({
      graphInput: {
        taskDependencies: {
          A: { id: 'A', duration: 1, dependsOn: [] },
        },
        dependencies: [],
      },
      tasks: {
        A: { id: 'A', duration: 1, dependsOn: [] },
      },
      dependencies: [],
      resourceInput: {
        capacities: {},
        assignments: { A: 'dev_1' },
        schedules: { A: { plannedStart: '2026-07-13', plannedEnd: '2026-07-13' } },
      },
      context: testContext,
    })

    expect(result.blocked).toBe(false)
    expect(result.hardValidation?.passed).toBe(true) // warnings don't block
    expect(
      result.hardValidation?.warnings.some((w) => w.ruleId === 'RESOURCE_OVERLOAD_CHECK'),
    ).toBeDefined()
  })

  it('ledger evidence 正确记录（通过 InMemoryRecorder）', async () => {
    const result = await orchestrator.execute({
      graphInput: {
        taskDependencies: {
          A: { id: 'A', duration: 1, dependsOn: [] },
        },
        dependencies: [],
      },
      tasks: {
        A: { id: 'A', duration: 1, dependsOn: [] },
      },
      dependencies: [],
      context: testContext,
    })

    for (const evidence of result.evidence) {
      recorder.record(99, evidence)
    }

    const records = recorder.getByRunId(99)
    expect(records.length).toBeGreaterThanOrEqual(4)

    // Verify evidence structure
    const scheduleEvidence = records.find((r) => r.evidence.stageId === 'integration_test')
    expect(scheduleEvidence).toBeDefined()
    expect(scheduleEvidence!.evidence.engineVersion).toBe('2.0.0')
    expect(scheduleEvidence!.evidence.inputSignature).toContain('sha256:')
    expect(scheduleEvidence!.evidence.validationResult).toBeDefined()
  })

  it('1000 任务 baseline 性能', async () => {
    // Generate 1000-task fixture
    const tasks: Record<string, any> = {}
    const deps: any[] = []

    for (let i = 0; i < 1000; i++) {
      const taskId = `task_${i}`
      const prevDep: string[] = i > 0 ? [`task_${i - 1}`] : []
      // Some cross dependencies
      if (i > 0 && i % 10 === 0) prevDep.push(`task_${Math.max(0, i - 5)}`)
      tasks[taskId] = { id: taskId, duration: 1 + (i % 3), dependsOn: prevDep }
      if (i > 0)
        deps.push({ predecessorId: `task_${i - 1}`, successorId: taskId, type: 'FS', lag: 0 })
    }

    const start = performance.now()
    const result = await orchestrator.execute({
      graphInput: { taskDependencies: tasks, dependencies: deps },
      tasks,
      dependencies: deps,
      context: testContext,
    })
    const elapsed = performance.now() - start

    console.log(`[perf] 1000 tasks full pipeline: ${elapsed.toFixed(2)}ms`)
    expect(result.blocked).toBe(false)
    expect(result.evidence.length).toBeGreaterThan(0)
    // Performance baseline: full pipeline < 30s
    expect(elapsed).toBeLessThan(30000)
  })
})
