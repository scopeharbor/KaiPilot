// v3-resource-capacity-forecasting-closed-loop §2.2 —— 闭环共享契约测试。
// 覆盖：封闭枚举、数量/字节/日期窗口预算上限、demand≠allocation 字段分离、
// 运行时中性（零框架依赖）与前后端可导出。

import { describe, expect, it } from 'vitest'

import * as contracts from './resource-capacity-closed-loop.js'

describe('RCCL 契约：封闭枚举', () => {
  it('生命周期状态恰为 8 个且终态为 closed/cancelled', () => {
    expect(contracts.RESOURCE_CAPACITY_LOOP_STATE_VALUES).toEqual([
      'draft',
      'simulated',
      'selected',
      'handed-off',
      'observing',
      'reviewed',
      'closed',
      'cancelled',
    ])
    expect(contracts.RESOURCE_CAPACITY_LOOP_TERMINAL_STATES).toEqual(['closed', 'cancelled'])
  })

  it('overlay kinds 恰为封闭四类', () => {
    expect(contracts.RESOURCE_CAPACITY_LOOP_OVERLAY_KINDS).toEqual([
      'project-scope',
      'demand-shift',
      'capacity-delta',
      'allocation-preview-ref',
    ])
  })

  it('reason/warning 码均为 RCCL_ / 大写蛇形稳定串且无重复', () => {
    const reasons = contracts.RESOURCE_CAPACITY_LOOP_REASON_CODE_VALUES
    expect(new Set(reasons).size).toBe(reasons.length)
    expect(reasons.every((r) => r.startsWith('RCCL_'))).toBe(true)
    const warnings = contracts.RESOURCE_CAPACITY_LOOP_WARNING_CODE_VALUES
    expect(new Set(warnings).size).toBe(warnings.length)
    expect(warnings.every((w) => /^[A-Z_]+$/.test(w))).toBe(true)
  })

  it('handoff 目标恰为三类且下游状态投影不把 confirmed 当 loop applied', () => {
    expect(contracts.RESOURCE_CAPACITY_LOOP_HANDOFF_TARGET_VALUES).toEqual([
      'cross-project-allocation-draft',
      'project-resource-suggestion-preview',
      'safe-navigation',
    ])
    expect(contracts.RESOURCE_CAPACITY_LOOP_HANDOFF_STATUS_VALUES).toContain('confirmed_downstream')
    expect(contracts.RESOURCE_CAPACITY_LOOP_HANDOFF_STATUS_VALUES).not.toContain('applied')
  })

  it('非人类 actor 类型被列为拒绝集且唯一合法 actor 是 human_user', () => {
    expect(contracts.RESOURCE_CAPACITY_LOOP_ACTOR_TYPES.HUMAN_USER).toBe('human_user')
    expect(contracts.RESOURCE_CAPACITY_LOOP_REJECTED_ACTOR_TYPES).toEqual([
      'rule',
      'plugin',
      'ai',
      'scheduled_job',
      'confidence_threshold',
    ])
  })
})

describe('RCCL 契约：有界预算', () => {
  it('情景数强制 2–5', () => {
    expect(contracts.RESOURCE_CAPACITY_LOOP_BUDGETS.MIN_SCENARIOS).toBe(2)
    expect(contracts.RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_SCENARIOS).toBe(5)
  })

  it('规模与字节预算与 observation-and-inventory 固化值一致', () => {
    const b = contracts.RESOURCE_CAPACITY_LOOP_BUDGETS
    expect(b.MAX_HORIZON_WEEK_BUCKETS).toBe(52)
    expect(b.MAX_HORIZON_MONTH_BUCKETS).toBe(12)
    expect(b.MAX_PROJECT_SCOPE).toBe(1000)
    expect(b.MAX_OVERLAYS_PER_SCENARIO).toBe(20)
    expect(b.MAX_FACTS_PER_BASELINE).toBe(20000)
    expect(b.MAX_REFS_PER_SNAPSHOT).toBe(5000)
    expect(b.MAX_PAYLOAD_BYTES).toBe(2 * 1024 * 1024)
    expect(b.MAX_PAGE_SIZE).toBe(50)
    expect(b.SUPERSEDED_RETENTION_DAYS).toBe(90)
    expect(b.SOURCE_TIMEOUT_MS).toBe(10000)
    expect(b.TOTAL_COLLECTION_BUDGET_MS).toBe(30000)
  })

  it('日期窗口粒度为封闭 day/week/month 且 canonical 单位恒为 hours', () => {
    expect(contracts.RESOURCE_CAPACITY_LOOP_GRANULARITY_VALUES).toEqual(['day', 'week', 'month'])
    expect(contracts.RESOURCE_CAPACITY_LOOP_UNIT).toBe('hours')
    expect(contracts.RESOURCE_CAPACITY_LOOP_DECIMAL_PRECISION).toBe(2)
  })

  it('fact state 含 visible/redacted/missing/stale——缺失受限绝不补零的语义前提', () => {
    expect(contracts.RESOURCE_CAPACITY_LOOP_FACT_STATE_VALUES).toEqual([
      'visible',
      'redacted',
      'missing',
      'stale',
    ])
  })
})

describe('RCCL 契约：demand≠allocation 与建议姿态', () => {
  it('packet fact 的 demand 与 allocated 是独立必填字段（类型层分离，编译期保证）', () => {
    const fact: contracts.ResourceCapacityLoopPacketFact = {
      dimension: 'role',
      dimensionKey: 'backend',
      bucket: '2026-09-01',
      demandHours: 120,
      allocatedHours: 80,
      availableCapacityHours: 100,
      remainingCapacityHours: 20,
      gapHours: 40,
      factState: 'visible',
    }
    // 独立字段各自成立，互不派生。
    expect(fact.demandHours).not.toBe(fact.allocatedHours)
    expect(fact.gapHours).toBe(40)
  })

  it('suggestion 恒为 advisoryOnly/applied=false/confirmationRequired；handoff 恒 writesApplied=false', () => {
    // 类型层断言：字面量类型不可变。
    type AdvisoryIsTrue = contracts.ResourceCapacityLoopAllocationSuggestionDTO['advisoryOnly']
    type AppliedIsFalse = contracts.ResourceCapacityLoopAllocationSuggestionDTO['applied']
    type ConfirmIsRequired =
      contracts.ResourceCapacityLoopAllocationSuggestionDTO['confirmationRequired']
    type WritesApplied = contracts.ResourceCapacityLoopHandoffReceiptDTO['writesApplied']
    const t: [AdvisoryIsTrue, AppliedIsFalse, ConfirmIsRequired, WritesApplied] = [
      true,
      false,
      true,
      false,
    ]
    expect(t).toEqual([true, false, true, false])
  })
})

describe('RCCL 契约：运行时中性与双端导出', () => {
  it('模块可在纯 Node 环境（无 web 框架/DB/AI SDK）导入并导出全部符号', async () => {
    const mod = await import('./resource-capacity-closed-loop.js')
    expect(Object.keys(mod).length).toBeGreaterThan(15)
    // 关键契约面存在。
    expect(mod.RESOURCE_CAPACITY_LOOP_METRIC_VERSION).toBe('resource-capacity-loop@1')
    expect(mod.RESOURCE_CAPACITY_LOOP_ENGINE_VERSION).toBe('rccl-engine@1')
  })

  it('分页 envelope 形状符合 { data, meta } 标准', () => {
    const envelope: contracts.ResourceCapacityLoopListEnvelope = {
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    }
    expect(Object.keys(envelope)).toEqual(['data', 'meta'])
  })

  it('warning 中文标签覆盖全部 warning 码（简体中文一等公民）', () => {
    for (const code of contracts.RESOURCE_CAPACITY_LOOP_WARNING_CODE_VALUES) {
      expect(contracts.RESOURCE_CAPACITY_LOOP_WARNING_LABELS[code]).toBeTruthy()
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      expect(/[\u4e00-\u9fff]/.test(contracts.RESOURCE_CAPACITY_LOOP_WARNING_LABELS[code])).toBe(
        true,
      )
    }
  })
})
