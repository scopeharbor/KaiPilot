// v3-ai-model-drift-observability —— 漂移观测共享契约单测。
// 覆盖：禁存约束（§2.4/2.5）、五态 fixtures（§2.6）、
// 检测维度（§3.1/3.2）、首次即事件（§3.3/3.4）、
// 零新增采集（§3.5/3.6）、确定性（§3.7/3.8）、
// 关联影响（§4.1–4.5）、窗口与样本（§4.6/4.7）、
// 缺失率（§5.1–5.4）、不自动响应（§6.1–6.4）、
// 组织隔离（§7.1/7.2）、RBAC（§7.3/7.4）、既有行为（§7.6）。
import { describe, it, expect } from 'vitest'
import {
  computeDriftDistribution,
  detectDriftEvents,
  correlateDriftImpact,
  computeDriftMissingRates,
  containsCausalAssertion,
  assertOrganizationIsolation,
  driftEventContainsSensitiveFields,
  runDriftDetection,
  DRIFT_DEFAULT_WINDOW_DAYS,
  DRIFT_MIN_SAMPLE_THRESHOLD,
  DRIFT_DETECTION_DEPENDENCIES,
  DRIFT_DETECTION_WRITES,
  DRIFT_EVENT_RETENTION_DAYS,
  DRIFT_QUERY_PERMISSIONS,
  DRIFT_CAUSATION_FORBIDDEN_PATTERNS,
  type DriftEvent,
  type DriftForbiddenFieldCategory,
} from './ai-model-drift-observability.js'
import {
  driftNoDriftFixtures,
  driftFirstDriftFixtures,
  driftMultipleDriftFixtures,
  driftMissingResponseModelFixtures,
  driftCrossConnectionFixtures,
  driftCrossOrganizationFixtures,
  driftCanaryFixtures,
  driftDeterministicFixtures,
  driftMissingRateFixtures,
  driftPartialTrafficRolloutFixtures,
  driftInsufficientSamplesFixtures,
  driftEventFixture,
  driftCorrelatedImpactFixture,
  DRIFT_FIXTURE_ORG,
  DRIFT_FIXTURE_CONN_A,
  DRIFT_FIXTURE_CONN_B,
} from './ai-model-drift-observability-fixtures.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §2.4/2.5 禁存约束
// ═══════════════════════════════════════════════════════════════════════════════

describe('禁存约束（task 2.4/2.5 / spec: Events MUST NOT store prompts, model outputs, tokens or secrets）', () => {
  it('漂移事件记录中不含敏感字段', () => {
    const event = driftEventFixture()
    const violations = driftEventContainsSensitiveFields(
      event as unknown as Record<string, unknown>,
    )
    expect(violations).toEqual([])
  })

  it('对每类禁止字段至少给一个负例样本', () => {
    const samples: Array<[DriftForbiddenFieldCategory, Record<string, unknown>]> = [
      ['prompt', { promptText: '帮我写一个项目计划' }],
      ['model_output', { completionText: '模型输出全文' }],
      ['token', { access_token: 'aaa' }],
      ['secret', { clientSecret: 'hunter2' }],
    ]
    for (const [category, sample] of samples) {
      const detected = driftEventContainsSensitiveFields(sample)
      expect(detected).toContain(category)
    }
  })

  it('事件 ID、模型标识、时间戳等低敏字段不受影响', () => {
    const event = driftEventFixture()
    const eventAsRecord = {
      eventId: event.eventId,
      organizationId: event.organizationId,
      connectionId: event.connectionId,
      requestModel: event.requestModel,
      newResponseModel: event.newResponseModel,
      previousResponseModel: event.previousResponseModel,
      firstOccurrenceAt: event.firstOccurrenceAt,
      createdAt: event.createdAt,
    }
    const violations = driftEventContainsSensitiveFields(eventAsRecord)
    expect(violations).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §2.6 五态 fixtures
// ═══════════════════════════════════════════════════════════════════════════════

describe('五态 fixtures（task 2.6）', () => {
  it('无漂移 fixture 只含一种 response_model', () => {
    const f = driftNoDriftFixtures()
    const models = new Set(f.map((a) => a.response_model))
    expect(models.size).toBe(1)
    expect(models.has('gpt-4-0613')).toBe(true)
  })

  it('首次漂移 fixture 含两种 response_model', () => {
    const f = driftFirstDriftFixtures()
    const models = new Set(f.map((a) => a.response_model))
    expect(models.size).toBe(2)
    expect(models.has('gpt-4-0613')).toBe(true)
    expect(models.has('gpt-4-1106')).toBe(true)
  })

  it('多次漂移 fixture 含三种 response_model', () => {
    const f = driftMultipleDriftFixtures()
    const models = new Set(f.map((a) => a.response_model))
    expect(models.size).toBe(3)
  })

  it('缺失 fixture 含 null 与 unknown 取值', () => {
    const f = driftMissingResponseModelFixtures()
    expect(f.some((a) => a.response_model === null)).toBe(true)
    expect(f.some((a) => a.response_model === 'unknown')).toBe(true)
  })

  it('跨连接 fixture 的两个连接有不同 response_model', () => {
    const f = driftCrossConnectionFixtures()
    const connA = f.filter((a) => a.aiproj_connection_id === DRIFT_FIXTURE_CONN_A)
    const connB = f.filter((a) => a.aiproj_connection_id === DRIFT_FIXTURE_CONN_B)
    expect(new Set(connA.map((a) => a.response_model)).size).toBe(1)
    expect(new Set(connB.map((a) => a.response_model)).size).toBe(1)
    expect(connA[0]!.response_model).not.toBe(connB[0]!.response_model)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3.1/3.2 检测维度
// ═══════════════════════════════════════════════════════════════════════════════

describe('按 (连接, request_model) 维度统计（task 3.1/3.2 / spec: Drift MUST be detected per connection and per requested model）', () => {
  it('分布按连接和请求模型分组', () => {
    const dist = computeDriftDistribution(driftFirstDriftFixtures())
    expect(dist.length).toBeGreaterThanOrEqual(1)
    expect(dist[0]!.connectionId).toBe(DRIFT_FIXTURE_CONN_A)
    expect(dist[0]!.requestModel).toBe('gpt-4')
    expect(dist[0]!.responseModelCounts['gpt-4-0613']).toBe(3)
    expect(dist[0]!.responseModelCounts['gpt-4-1106']).toBe(2)
  })

  it('跨连接的同名模型不产生假漂移（task 3.2 / spec: same model name on two connections is not drift）', () => {
    const dist = computeDriftDistribution(driftCrossConnectionFixtures())
    // 两个连接各有独立分布
    const connA = dist.find((d) => d.connectionId === DRIFT_FIXTURE_CONN_A)
    const connB = dist.find((d) => d.connectionId === DRIFT_FIXTURE_CONN_B)
    expect(connA).toBeDefined()
    expect(connB).toBeDefined()
    // 每个连接内部只有一种 response_model
    expect(Object.keys(connA!.responseModelCounts).length).toBe(1)
    expect(Object.keys(connB!.responseModelCounts).length).toBe(1)
    // 跨连接不混合
    expect(connA!.responseModelCounts['gpt-4-0613']).toBe(2)
    expect(connB!.responseModelCounts['gpt-4-1106']).toBe(2)
  })

  it('缺失被计入 missingCount', () => {
    const dist = computeDriftDistribution(driftMissingResponseModelFixtures())
    expect(dist[0]!.missingCount).toBe(2) // null + 'unknown'
    expect(dist[0]!.totalRecords).toBe(4)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3.3/3.4 首次即事件
// ═══════════════════════════════════════════════════════════════════════════════

describe('首次出现即产生事件（task 3.3/3.4 / spec: new value on first occurrence MUST produce event）', () => {
  it('无漂移时不产生事件', () => {
    const events = detectDriftEvents(driftNoDriftFixtures(), DRIFT_FIXTURE_ORG)
    expect(events.length).toBe(0)
  })

  it('首次漂移产生一个事件', () => {
    const events = detectDriftEvents(driftFirstDriftFixtures(), DRIFT_FIXTURE_ORG)
    expect(events.length).toBe(1)
    expect(events[0]!.newResponseModel).toBe('gpt-4-1106')
    expect(events[0]!.previousResponseModel).toBe('gpt-4-0613')
    expect(events[0]!.firstOccurrenceAt).toBe('2026-08-10T00:00:00.000Z')
  })

  it('多次漂移产生多个事件', () => {
    const events = detectDriftEvents(driftMultipleDriftFixtures(), DRIFT_FIXTURE_ORG)
    expect(events.length).toBe(2)
    // 第一个新值是 gpt-4-1106
    expect(events[0]!.newResponseModel).toBe('gpt-4-1106')
    expect(events[0]!.previousResponseModel).toBe('gpt-4-0613')
    // 第二个新值是 gpt-4o-2024-05-13
    expect(events[1]!.newResponseModel).toBe('gpt-4o-2024-05-13')
    expect(events[1]!.previousResponseModel).toBe('gpt-4-1106')
  })

  it('金丝雀式部分流量换版能被检出（task 3.4 / spec: partial-traffic rollout is detected）', () => {
    const events = detectDriftEvents(driftCanaryFixtures(), DRIFT_FIXTURE_ORG)
    expect(events.length).toBe(1)
    expect(events[0]!.newResponseModel).toBe('gpt-4-1106')
  })

  it('10% 金丝雀换版能被检出', () => {
    const events = detectDriftEvents(driftPartialTrafficRolloutFixtures(), DRIFT_FIXTURE_ORG)
    expect(events.length).toBe(1)
    expect(events[0]!.newResponseModel).toBe('gpt-4-1106')
  })

  it('事件状态先前取值和首次出现时间', () => {
    const events = detectDriftEvents(driftFirstDriftFixtures(), DRIFT_FIXTURE_ORG)
    expect(events[0]!.previousResponseModel).toBe('gpt-4-0613')
    expect(events[0]!.firstOccurrenceAt).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3.5/3.6 零新增采集
// ═══════════════════════════════════════════════════════════════════════════════

describe('零新增采集（task 3.5/3.6 / spec: MUST read ledger rather than collect its own data）', () => {
  it('漂移检测只读账本，无模型选型或降级依赖', () => {
    expect(DRIFT_DETECTION_DEPENDENCIES).toEqual(['unified_ai_invocation_ledger'])
  })

  it('漂移路径除事件记录外零域写', () => {
    expect(DRIFT_DETECTION_WRITES).toEqual(['drift_events'])
  })

  it('纯函数不依赖 Date.now()（确定性：传入 now 参数）', () => {
    const now = new Date('2026-08-15T00:00:00.000Z')
    const r1 = runDriftDetection(
      driftFirstDriftFixtures(),
      DRIFT_FIXTURE_ORG,
      DRIFT_DEFAULT_WINDOW_DAYS,
      now,
    )
    const r2 = runDriftDetection(
      driftFirstDriftFixtures(),
      DRIFT_FIXTURE_ORG,
      DRIFT_DEFAULT_WINDOW_DAYS,
      now,
    )
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §3.7/3.8 确定性
// ═══════════════════════════════════════════════════════════════════════════════

describe('检测确定性（task 3.7/3.8 / spec: same snapshot yields same events）', () => {
  it('同一账本快照产出同一事件集合', () => {
    const now = new Date('2026-08-15T00:00:00.000Z')
    const r1 = runDriftDetection(
      driftDeterministicFixtures(),
      DRIFT_FIXTURE_ORG,
      DRIFT_DEFAULT_WINDOW_DAYS,
      now,
    )
    const r2 = runDriftDetection(
      driftDeterministicFixtures(),
      DRIFT_FIXTURE_ORG,
      DRIFT_DEFAULT_WINDOW_DAYS,
      now,
    )
    expect(r1.events.length).toBe(r2.events.length)
    expect(JSON.stringify(r1.events)).toBe(JSON.stringify(r2.events))
    expect(JSON.stringify(r1.distribution)).toBe(JSON.stringify(r2.distribution))
    expect(JSON.stringify(r1.missingRates)).toBe(JSON.stringify(r2.missingRates))
  })

  it('确定性：检测两次结果完全等价', () => {
    const fixtures = driftMultipleDriftFixtures()
    const now = new Date('2026-08-15T00:00:00.000Z')
    const a = runDriftDetection(fixtures, DRIFT_FIXTURE_ORG, DRIFT_DEFAULT_WINDOW_DAYS, now)
    const b = runDriftDetection(fixtures, DRIFT_FIXTURE_ORG, DRIFT_DEFAULT_WINDOW_DAYS, now)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §4.1–4.5 关联影响
// ═══════════════════════════════════════════════════════════════════════════════

describe('关联影响（task 4.1–4.5 / spec: present differences without asserting causation）', () => {
  it('漂移事件关联质量/成本/延迟差异（§4.1–4.3）', () => {
    const result = runDriftDetection(driftFirstDriftFixtures(), DRIFT_FIXTURE_ORG)
    expect(result.events.length).toBe(1)
    const impact = result.events[0]!.correlatedImpact
    // 有关联影响结构
    expect(impact.quality).toBeDefined()
    expect(impact.cost).toBeDefined()
    expect(impact.latency).toBeDefined()
    expect(impact.windowDays).toBe(DRIFT_DEFAULT_WINDOW_DAYS)
  })

  it('只呈现差异、不做因果断言（§4.4）', () => {
    const result = runDriftDetection(driftFirstDriftFixtures(), DRIFT_FIXTURE_ORG)
    // 事件本身不包含因果性表述
    const eventJson = JSON.stringify(result.events)
    expect(containsCausalAssertion(eventJson)).toBe(false)
  })

  it('输出不含因果性表述（task 4.5 / spec: no causal statement）', () => {
    // 检查所有禁止的因果模式
    const causalPhrases = [
      '换版导致质量下降',
      '因为模型变更引起延迟增加',
      '由于版本更新造成成本上升',
      'caused by model change',
      'resulted in quality decrease',
      'due to version update',
      'led to cost increase',
    ]
    for (const phrase of causalPhrases) {
      expect(containsCausalAssertion(phrase)).toBe(true)
    }
    // 非因果表述不被误报
    const nonCausal = [
      '换版前后质量评分差异 -0.13',
      '成本从 0.005 变为 0.007',
      '延迟均值变化 150ms',
    ]
    for (const phrase of nonCausal) {
      expect(containsCausalAssertion(phrase)).toBe(false)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §4.6/4.7 关联窗口与样本不足
// ═══════════════════════════════════════════════════════════════════════════════

describe('关联窗口与样本不足（task 4.6/4.7 / spec: insufficient samples are labelled）', () => {
  it('关联窗口可配置，默认七天（§4.6）', () => {
    expect(DRIFT_DEFAULT_WINDOW_DAYS).toBe(7)
    const result = runDriftDetection(driftFirstDriftFixtures(), DRIFT_FIXTURE_ORG, 14)
    expect(result.events[0]!.correlatedImpact.windowDays).toBe(14)
  })

  it('窗口内样本不足时标注 sufficientSamples=false（§4.7）', () => {
    const result = runDriftDetection(driftInsufficientSamplesFixtures(), DRIFT_FIXTURE_ORG)
    expect(result.events.length).toBe(1)
    const impact = result.events[0]!.correlatedImpact
    // 样本不足：before=1, after=1（均 < 5）
    expect(impact.quality.sufficientSamples).toBe(false)
    expect(impact.cost.sufficientSamples).toBe(false)
    expect(impact.latency.sufficientSamples).toBe(false)
    expect(impact.quality.beforeSampleCount).toBeLessThan(DRIFT_MIN_SAMPLE_THRESHOLD)
    expect(impact.quality.afterSampleCount).toBeLessThan(DRIFT_MIN_SAMPLE_THRESHOLD)
  })

  it('样本不足时 delta 为 null 而非误导性差异', () => {
    const result = runDriftDetection(driftInsufficientSamplesFixtures(), DRIFT_FIXTURE_ORG)
    const impact = result.events[0]!.correlatedImpact
    expect(impact.quality.delta).toBeNull()
    expect(impact.cost.delta).toBeNull()
    expect(impact.latency.delta).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §5.1–5.4 缺失率
// ═══════════════════════════════════════════════════════════════════════════════

describe('缺失率（task 5.1–5.4 / spec: Missing MUST be distinguishable from no drift）', () => {
  it('缺失率按连接与 provider 统计（§5.1）', () => {
    const rates = computeDriftMissingRates(driftMissingRateFixtures())
    expect(rates.length).toBe(2)
    const openai = rates.find((r) => r.providerName === 'openai')
    const anthropic = rates.find((r) => r.providerName === 'anthropic')
    expect(openai).toBeDefined()
    expect(anthropic).toBeDefined()
    expect(openai!.missingRate).toBeCloseTo(0.4, 5) // 2/5 = 40%
    expect(anthropic!.missingRate).toBe(0)
  })

  it('缺失率可查（§5.2）', () => {
    const rates = computeDriftMissingRates(driftMissingRateFixtures())
    const openai = rates.find((r) => r.providerName === 'openai')
    expect(openai!.totalRecords).toBe(5)
    expect(openai!.missingCount).toBe(2)
    expect(typeof openai!.missingRate).toBe('number')
  })

  it('缺失与无漂移在输出中可区分（§5.3/5.4）', () => {
    const rates = computeDriftMissingRates(driftMissingRateFixtures())
    const openai = rates.find((r) => r.providerName === 'openai')
    const anthropic = rates.find((r) => r.providerName === 'anthropic')
    // openai 有缺失（40%），anthropic 无缺失
    expect(openai!.observable).toBe(true) // 部分可观测
    expect(openai!.missingCount).toBeGreaterThan(0)
    expect(anthropic!.missingCount).toBe(0)
    // 可观测性标记：缺失率 1 = 完全不可观测
    const allMissing = computeDriftMissingRates([
      { ...driftMissingRateFixtures()[0]!, response_model: null },
      { ...driftMissingRateFixtures()[1]!, response_model: null },
    ])
    expect(allMissing[0]!.observable).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.1–6.4 不自动响应
// ═══════════════════════════════════════════════════════════════════════════════

describe('不自动响应（task 6.1–6.4 / spec: Detected drift MUST NOT trigger any automatic response）', () => {
  it('检测到漂移不自动切换模型（§6.1）', () => {
    // 纯函数不调用任何模型选型模块
    expect(DRIFT_DETECTION_DEPENDENCIES).not.toContain('copilot-model-selection')
  })

  it('不自动降级、不自动告警（§6.2）', () => {
    expect(DRIFT_DETECTION_DEPENDENCIES).not.toContain('ai-slo-alerting')
    expect(DRIFT_DETECTION_DEPENDENCIES).not.toContain('degradation')
  })

  it('漂移检测路径无模型选型或降级依赖（§6.3 / spec: no model selection dependency）', () => {
    expect(DRIFT_DETECTION_DEPENDENCIES).toEqual(['unified_ai_invocation_ledger'])
  })

  it('漂移路径零域写（§6.4 / spec: no formal project data may change）', () => {
    expect(DRIFT_DETECTION_WRITES).toEqual(['drift_events'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.1–7.5 组织隔离与权限
// ═══════════════════════════════════════════════════════════════════════════════

describe('组织隔离与权限（task 7.1–7.5 / spec: MUST be organization isolated and permission governed）', () => {
  it('事件附加 organization_id（§7.1）', () => {
    const event = driftEventFixture()
    expect(event.organizationId).toBe(DRIFT_FIXTURE_ORG)
  })

  it('跨组织事件不可见（§7.2 / spec: cross-organization records MUST NOT be visible）', () => {
    const events = detectDriftEvents(driftCrossOrganizationFixtures(), DRIFT_FIXTURE_ORG)
    // 只看到本组织的事件
    for (const event of events) {
      expect(event.organizationId).toBe(DRIFT_FIXTURE_ORG)
    }
    // 另一个组织的记录不产生事件
    expect(events.every((e) => e.organizationId === DRIFT_FIXTURE_ORG)).toBe(true)
  })

  it('组织隔离校验（§7.1）', () => {
    const event = driftEventFixture({ organizationId: 101 })
    expect(assertOrganizationIsolation(event, 101)).toBe(true)
    expect(assertOrganizationIsolation(event, 999)).toBe(false)
  })

  it('查询需要 RBAC 权限（§7.3）', () => {
    expect(DRIFT_QUERY_PERMISSIONS).toContain('ai_drift_observability:read')
  })

  it('事件保留期声明（§7.5 / 归 v3-observability-data-retention）', () => {
    expect(DRIFT_EVENT_RETENTION_DAYS).toBe(90)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.6 统一账本与模型选型既有行为未被改变
// ═══════════════════════════════════════════════════════════════════════════════

describe('既有行为未被改变（task 7.6 / spec: reused capabilities keep their behavior）', () => {
  it('漂移模块只导入 unified-ai-invocation-ledger，不修改其类型', () => {
    // 本模块的导入类型兼容
    const attempt = {
      aiproj_organization_id: 1,
      aiproj_connection_id: 1,
      request_model: 'gpt-4',
      response_model: 'gpt-4-0613',
      provider_name: 'openai',
      status: 'succeeded',
      aiproj_estimated_cost: 0.001,
      duration_ms: 500,
      occurred_at: '2026-08-01T00:00:00.000Z',
      aiproj_attempt_number: 1,
    }
    // 漂移检测不修改原始数据
    const original = JSON.stringify(attempt)
    detectDriftEvents([attempt as never], 1)
    expect(JSON.stringify(attempt)).toBe(original)
  })
})
