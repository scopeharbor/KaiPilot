import { describe, expect, it } from 'vitest'
import { createWorkingCalendar, parseIsoDate } from '#services/gantt_working_calendar'
import { scheduleForStatus, syncStepsForStatus } from '#services/task_status_sync'

const calendar = createWorkingCalendar(null)
const withSteps = (stepsDone: boolean[]) => ({
  customFields: { execution: { steps: ['写方案', '评审', '发布'], stepsDone }, source: 'x' },
  description: '说明\n\n**执行步骤**：\n- [ ] 写方案\n- [ ] 评审\n- [ ] 发布',
})

describe('状态联动：执行步骤', () => {
  it('转已完成：全部勾上，说明里的勾选框同步', () => {
    const result = syncStepsForStatus(withSteps([true, false, false]), 'in_progress', 'completed')!
    expect((result.customFields!.execution as { stepsDone: boolean[] }).stepsDone).toEqual([
      true,
      true,
      true,
    ])
    expect(result.description).toContain('- [x] 发布')
    expect(result.customFields!.source).toBe('x')
  })

  it('退回待处理：勾选全部清掉', () => {
    const result = syncStepsForStatus(withSteps([true, true, false]), 'in_progress', 'not_started')!
    expect((result.customFields!.execution as { stepsDone: boolean[] }).stepsDone).toEqual([
      false,
      false,
      false,
    ])
    expect(result.progressPercent).toBe(0)
  })

  it('已完成重新打开：取消最后一步，进度按比例', () => {
    const result = syncStepsForStatus(withSteps([true, true, true]), 'completed', 'in_progress')!
    expect((result.customFields!.execution as { stepsDone: boolean[] }).stepsDone).toEqual([
      true,
      true,
      false,
    ])
    expect(result.progressPercent).toBe(67)
  })

  it('没有步骤 / 开工：不改', () => {
    expect(
      syncStepsForStatus({ customFields: null, description: null }, 'in_progress', 'completed'),
    ).toBeNull()
    expect(syncStepsForStatus(withSteps([false, false, false]), 'not_started', 'in_progress')).toBe(
      null,
    )
  })
})

describe('状态联动：排期（默认周一至周五）', () => {
  const task = {
    startDate: '2026-10-12',
    endDate: '2026-10-14',
    durationDays: 3,
    taskType: 'task',
  }

  it('晚开工：整条顺延到今天开工，工期不变，需要顺延后续', () => {
    const result = scheduleForStatus(
      task,
      'not_started',
      'in_progress',
      parseIsoDate('2026-10-15'),
      calendar,
    )!
    expect(result).toMatchObject({
      startDate: '2026-10-15',
      endDate: '2026-10-19',
      durationDays: 3,
      pushedLater: true,
      reason: 'late_start',
    })
  })

  it('按时或提前开工：不改排期', () => {
    expect(
      scheduleForStatus(task, 'not_started', 'in_progress', parseIsoDate('2026-10-09'), calendar),
    ).toBeNull()
  })

  it('晚完成：结束日延到今天（周末按上一个工作日）', () => {
    const result = scheduleForStatus(
      task,
      'in_progress',
      'completed',
      parseIsoDate('2026-10-17'),
      calendar,
    )!
    expect(result).toMatchObject({
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      durationDays: 5,
      pushedLater: true,
      reason: 'late_finish',
    })
  })

  it('提前完成：结束日缩到今天；比计划开始还早则整条挪到今天', () => {
    expect(
      scheduleForStatus(task, 'in_progress', 'completed', parseIsoDate('2026-10-13'), calendar),
    ).toMatchObject({ endDate: '2026-10-13', durationDays: 2, pushedLater: false })
    expect(
      scheduleForStatus(task, 'in_progress', 'completed', parseIsoDate('2026-09-29'), calendar),
    ).toMatchObject({ startDate: '2026-09-29', endDate: '2026-09-29', durationDays: 1 })
  })

  it('重新打开时已过计划结束日：结束日延到今天', () => {
    expect(
      scheduleForStatus(task, 'completed', 'in_progress', parseIsoDate('2026-10-20'), calendar),
    ).toMatchObject({ endDate: '2026-10-20', pushedLater: true, reason: 'reopened_overdue' })
  })

  it('没有日期 / 退回待处理：不改', () => {
    expect(
      scheduleForStatus(
        { ...task, startDate: null },
        'in_progress',
        'completed',
        parseIsoDate('2026-10-20'),
        calendar,
      ),
    ).toBeNull()
    expect(
      scheduleForStatus(task, 'in_progress', 'not_started', parseIsoDate('2026-10-20'), calendar),
    ).toBeNull()
  })
})
