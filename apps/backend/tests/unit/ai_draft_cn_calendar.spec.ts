import { describe, expect, it } from 'vitest'
import {
  buildDraftCalendar,
  calendarPromptFacts,
  isProductionChangeTask,
} from '#services/ai_draft/cn_calendar'
import { isWorkingDay, parseIsoDate } from '#services/gantt_working_calendar'
import { planDraftResources } from '#services/ai_draft/resource_plan'

const RAW_INPUT =
  '某城商行计划于 2026 年 10 月 12 日启动项目，目标 2027 年 4 月中旬完成生产切换。' +
  '迁移采用双轨并行、灰度切流，不停机；年底结算高峰（12 月中旬至 1 月上旬）与春节期间冻结生产变更。'

const CAL = buildDraftCalendar({
  startDate: '2026-10-12',
  endDate: '2027-04-15',
  rawInput: RAW_INPUT,
})
const working = (date: string) => isWorkingDay(CAL.calendar, parseIsoDate(date))

const marker = { confidence: 0.8, source: 'inferred', reason: '按排期', needsConfirmation: true }
const field = <T>(value: T) => ({ value, marker: { ...marker } })
function task(id: string, name: string, role: string, start: string, end: string, days: number) {
  return {
    id,
    wbsNodeId: 'wbs-1',
    name: field(name),
    description: field(''),
    status: 'todo',
    durationDays: field(days),
    startDate: field(start),
    endDate: field(end),
    assigneeHint: field(role),
  }
}

describe('buildDraftCalendar', () => {
  it('2026 年用国务院公布数据（含调休上班），2027 年未公布按农历估算', () => {
    expect(CAL.officialYears).toContain(2026)
    expect(CAL.estimatedYears).toContain(2027)
    expect(working('2026-10-09')).toBe(true)
    expect(working('2026-10-10')).toBe(true) // 国庆调休上班（周六）
    expect(working('2027-01-01')).toBe(false) // 元旦（估算）
    expect(working('2027-02-06')).toBe(false) // 2027 春节正月初一（农历推算）
    expect(working('2027-02-08')).toBe(false)
    expect(working('2027-02-15')).toBe(true)
  })

  it('解析封网窗口：年底结算高峰跨年区间 + 春节期间（前后各 2 天缓冲）', () => {
    const labels = CAL.freezeWindows.map((window) => `${window.start}~${window.end}`)
    expect(labels).toContain('2026-12-11~2027-01-10')
    const spring = CAL.freezeWindows.find((window) => window.label.includes('春节'))
    expect(spring!.start <= '2027-02-05').toBe(true)
    expect(spring!.end >= '2027-02-12').toBe(true)
  })

  it('没有冻结句时不产生封网窗口', () => {
    const plain = buildDraftCalendar({
      startDate: '2026-10-12',
      endDate: '2027-04-15',
      rawInput: '12 月中旬完成第一阶段验收。',
    })
    expect(plain.freezeWindows).toEqual([])
  })

  it('给模型的日历摘要列出放假区间、调休上班日与封网窗口，估算年份注明以国务院为准', () => {
    const facts = calendarPromptFacts(CAL, '2026-10-12', '2027-04-15')
    expect(
      facts.holidays.some((line) => line.startsWith('春节：2027-02') && line.includes('估算')),
    ).toBe(true)
    expect(facts.changeFreezeWindows.length).toBeGreaterThanOrEqual(2)
  })
})

describe('isProductionChangeTask', () => {
  it('投产 / 切流 / 割接算生产变更；演练、方案、测试不算', () => {
    expect(isProductionChangeTask('支付路由灰度切流（10%→50%）')).toBe(true)
    expect(isProductionChangeTask('清算对账服务生产投产')).toBe(true)
    expect(isProductionChangeTask('投产切换演练')).toBe(false)
    expect(isProductionChangeTask('编写上线切换与回滚预案')).toBe(false)
  })
})

describe('资源平衡 + 工作日历', () => {
  const base = {
    charter: { startDate: field('2026-10-12'), endDate: field('2027-04-15') },
    wbs: [],
    riskHints: [],
    milestoneHints: [],
    resourceHints: [],
    dependencies: [],
  }

  it('投产任务落在封网期时顺延到封网结束后的首个工作日', () => {
    const draft = {
      ...base,
      tasks: [task('task-1', '账户服务生产投产', '运维', '2026-12-14', '2026-12-16', 3)],
    }
    const plan = planDraftResources(draft, [], CAL.calendar, CAL.freezeWindows)
    const start = (plan.tasks[0] as { startDate: { value: string } }).startDate.value
    expect(start > '2027-01-10').toBe(true)
    expect(working(start)).toBe(true)
  })

  it('跨春节的开发任务：工期按工作日计，完成日越过长假顺延', () => {
    const draft = {
      ...base,
      tasks: [task('task-1', '清算对账服务开发', '后端开发', '2027-02-01', '2027-02-10', 8)],
    }
    const plan = planDraftResources(draft, [], CAL.calendar, CAL.freezeWindows)
    const end = (plan.tasks[0] as { endDate: { value: string } }).endDate.value
    expect(end > '2027-02-14').toBe(true)
    expect(working(end)).toBe(true)
  })
})
