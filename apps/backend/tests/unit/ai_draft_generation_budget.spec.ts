import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDraftGenerationBudget } from '#services/ai_draft/generation_budget'
import { DraftGenerationRunner } from '#services/ai_draft/draft_generation_runner'

const ENV_KEYS = [
  'AI_DRAFT_TIME_BUDGET_SCALE',
  'AI_DRAFT_REQUEST_TIMEOUT_MS',
  'AI_DRAFT_OUTPUT_BUDGET_SCALE',
] as const

describe('resolveDraftGenerationBudget', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
    vi.useRealTimers()
  })

  it('未配置时使用五倍的时间与输出预算', () => {
    const budget = resolveDraftGenerationBudget()
    expect(budget.scale).toBe(5)
    expect(budget.maxGenerationWallMs).toBe(125 * 60_000)
    expect(budget.reservedFinalReviewBudgetMs).toBe(30 * 60_000)
    expect(budget.requestTimeoutMs).toBe(40 * 60_000)
    expect(budget.stageTimeLimitsMs).toEqual({
      charter_scope: 10 * 60_000,
      wbs_tasks: 40 * 60_000,
      schedule_dependencies: 25 * 60_000,
      resources_risks_acceptance: 25 * 60_000,
      reconcile_review: 40 * 60_000,
    })
    expect(budget.outputScale).toBe(5)
    expect(budget.maxTotalResponseChars).toBe(5_000_000)
    expect(budget.stageCharLimits).toEqual({
      charter_scope: 200_000,
      wbs_tasks: 1_250_000,
      schedule_dependencies: 600_000,
      resources_risks_acceptance: 600_000,
      reconcile_review: 2_000_000,
    })
  })

  it('输出倍率只放大字符上限，与时间倍率互不影响，并夹到 1–5', () => {
    process.env.AI_DRAFT_OUTPUT_BUDGET_SCALE = '2'
    const budget = resolveDraftGenerationBudget()
    expect(budget.outputScale).toBe(2)
    expect(budget.stageCharLimits.wbs_tasks).toBe(500_000)
    expect(budget.maxTotalResponseChars).toBe(2_000_000)
    expect(budget.scale).toBe(5)
    expect(budget.stageTimeLimitsMs.wbs_tasks).toBe(40 * 60_000)

    process.env.AI_DRAFT_OUTPUT_BUDGET_SCALE = '9'
    expect(resolveDraftGenerationBudget().outputScale).toBe(5)
  })

  it('倍率同比放大全程、各阶段、最终复核预留与单次请求超时', () => {
    process.env.AI_DRAFT_TIME_BUDGET_SCALE = '2'
    const budget = resolveDraftGenerationBudget()
    expect(budget.scale).toBe(2)
    expect(budget.maxGenerationWallMs).toBe(50 * 60_000)
    expect(budget.reservedFinalReviewBudgetMs).toBe(12 * 60_000)
    expect(budget.requestTimeoutMs).toBe(16 * 60_000)
    expect(budget.stageTimeLimitsMs.wbs_tasks).toBe(16 * 60_000)
  })

  it('倍率越界或非法时夹到 1–10', () => {
    process.env.AI_DRAFT_TIME_BUDGET_SCALE = '0.2'
    expect(resolveDraftGenerationBudget().scale).toBe(1)
    process.env.AI_DRAFT_TIME_BUDGET_SCALE = '50'
    expect(resolveDraftGenerationBudget().scale).toBe(10)
    process.env.AI_DRAFT_TIME_BUDGET_SCALE = 'abc'
    expect(resolveDraftGenerationBudget().scale).toBe(5)
  })

  it('请求超时绝对值优先于倍率，并夹到 30 秒–60 分钟', () => {
    process.env.AI_DRAFT_TIME_BUDGET_SCALE = '3'
    process.env.AI_DRAFT_REQUEST_TIMEOUT_MS = '300000'
    expect(resolveDraftGenerationBudget().requestTimeoutMs).toBe(300_000)
    process.env.AI_DRAFT_REQUEST_TIMEOUT_MS = '1000'
    expect(resolveDraftGenerationBudget().requestTimeoutMs).toBe(30_000)
    process.env.AI_DRAFT_REQUEST_TIMEOUT_MS = String(2 * 60 * 60_000)
    expect(resolveDraftGenerationBudget().requestTimeoutMs).toBe(60 * 60_000)
  })

  it('runner TTL 覆盖全程预算 + 2 分钟余量，不会在生成中途被清理', () => {
    vi.useFakeTimers()
    const runner = new DraftGenerationRunner({ heartbeatIntervalMs: 60_000 })
    expect(runner.register('draft-default', {} as never, 1)).toBe(true)

    // 默认五倍全程预算为 125 分钟，runner 会再保留 2 分钟余量。
    vi.advanceTimersByTime(126 * 60_000)
    expect(runner.activeCount).toBe(1)

    vi.advanceTimersByTime(1 * 60_000)
    expect(runner.activeCount).toBe(0)
    runner.reset()
  })

  it('放宽时间倍率后 runner TTL 同步延长', () => {
    vi.useFakeTimers()
    process.env.AI_DRAFT_TIME_BUDGET_SCALE = '2'
    const runner = new DraftGenerationRunner({ heartbeatIntervalMs: 60_000 })
    expect(runner.register('draft-budget', {} as never, 1)).toBe(true)
    vi.advanceTimersByTime(51 * 60_000)
    expect(runner.activeCount).toBe(1)
    vi.advanceTimersByTime(1 * 60_000)
    expect(runner.activeCount).toBe(0)
    runner.reset()
  })
})
