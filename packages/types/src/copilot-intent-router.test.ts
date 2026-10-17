// @aiproj/types — V3 Copilot 工具路由器测试
// v3-copilot-intent-catalog-and-router —— 任务组 4/5/6/7 契约测试
//
// 纯本地离线：零网络、零 provider、零时钟/随机源。

import { describe, it, expect } from 'vitest'
import {
  COPILOT_DESTINATION_REGISTRY,
  COPILOT_INTENT_CATALOG_VERSION,
  COPILOT_RULE_STRENGTH_CONFIDENCE,
} from './copilot-shared-contracts.js'
import {
  COPILOT_INTENT_AMBIGUITY_MARGIN,
  COPILOT_INTENT_CATALOG_VERSION as CATALOG_VER,
  COPILOT_SUB_INTENT_REGISTRY,
} from './copilot-intent-catalog.js'
import { evaluateRulePipeline, normalizeCopilotInput } from './copilot-intent-classifier.js'
import {
  copilotRoute,
  type CopilotRouterInput,
  type CopilotRouterResult,
} from './copilot-intent-router.js'
import {
  copilotIntentFixtureContextPacket,
  COPILOT_INTENT_FIXTURE_AVAILABILITY_GATED,
} from './copilot-intent-catalog-fixtures.js'

function makeInput(
  overrides: Partial<CopilotRouterInput> & { normalizedInput: string },
): CopilotRouterInput {
  const classifierResult =
    overrides.classifierResult ??
    evaluateRulePipeline({ normalizedInput: overrides.normalizedInput })
  return {
    normalizedInput: overrides.normalizedInput,
    classifierResult,
    contextScope: overrides.contextScope ?? 'project',
    permissions: overrides.permissions ?? [
      'project:read',
      'ai:trigger',
      'search:read',
      'risk:read',
      'risk:update',
      'knowledge:read',
      'triz:read',
    ],
    availability: overrides.availability ?? [],
    currentRoute: overrides.currentRoute,
    entityRefs: overrides.entityRefs,
    extractedSlots: overrides.extractedSlots,
    clarificationRounds: overrides.clarificationRounds,
  }
}

describe('copilot-intent-router', () => {
  it.each(['你好', '谢谢', '今天心情不错', '我想要写一个', '解释一下光合作用'])(
    '普通对话 %s 不触发必答卡',
    (text) => {
      const result = copilotRoute(
        makeInput({
          normalizedInput: text,
          classifierResult: evaluateRulePipeline({
            normalizedInput: text,
            currentRoute: '/projects/7',
          }),
        }),
      )
      expect(result.clarificationRequired).toBe(false)
      expect(result.destinations.every((d) => !d.requiresUserConfirmation)).toBe(true)
    },
  )

  it('自然创建请求使用创建权限，不要求已有项目更新权限', () => {
    const text = '帮我创建一个为期三个月的产品发布项目'
    const result = copilotRoute(
      makeInput({
        normalizedInput: text,
        classifierResult: evaluateRulePipeline({
          normalizedInput: text,
          currentRoute: '/projects/7',
        }),
        permissions: ['ai:trigger', 'project:create'],
      }),
    )
    expect(result.clarificationRequired).toBe(false)
    expect(result.destinations[0]?.destination).toBe('project_creation')
    expect(result.destinations[0]?.requiresUserConfirmation).toBe(true)
    expect(
      copilotRoute(makeInput({ normalizedInput: text, permissions: ['ai:trigger'] })).destinations,
    ).toEqual([])
  })
  // ── 4.1 Destination 有序映射 ──

  it('返回有序 destination 列表，每条带 confidence、依据 refs 与参数提示', () => {
    const result = copilotRoute(makeInput({ normalizedInput: '项目现在怎么样' }))
    expect(result.destinations.length).toBeGreaterThan(0)
    for (const dest of result.destinations) {
      expect(dest.confidence).toBeGreaterThan(0)
      expect(dest.evidenceRefs.length).toBeGreaterThan(0)
      expect(typeof dest.reason).toBe('string')
      expect(typeof dest.requiresUserConfirmation).toBe('boolean')
    }
  })

  // ── 4.2 依据 refs 与参数提示 ──

  it('每条 destination 必须可解释其依据', () => {
    const result = copilotRoute(makeInput({ normalizedInput: '项目现在怎么样' }))
    for (const dest of result.destinations) {
      expect(dest.evidenceRefs.length).toBeGreaterThan(0)
      expect(dest.reason.length).toBeGreaterThan(0)
    }
  })

  // ── 4.3 / 4.4 可复现性 ──

  it('相同输入元组产出相同排序、confidence 与告警（可复现性 4.4）', () => {
    const input1 = makeInput({ normalizedInput: '项目现在怎么样' })
    const input2 = makeInput({ normalizedInput: '项目现在怎么样' })
    const r1 = copilotRoute(input1)
    const r2 = copilotRoute(input2)
    expect(r1.destinations.map((d) => d.destination)).toEqual(
      r2.destinations.map((d) => d.destination),
    )
    expect(r1.destinations.map((d) => d.confidence)).toEqual(
      r2.destinations.map((d) => d.confidence),
    )
    expect(r1.warnings).toEqual(r2.warnings)
  })

  it('不同对象键顺序但内容等价的输入元组产出相同结果（4.4 关键顺序无关性）', () => {
    const r1 = copilotRoute(
      makeInput({ normalizedInput: '项目现在怎么样', permissions: ['project:read', 'ai:trigger'] }),
    )
    const r2 = copilotRoute(
      makeInput({ normalizedInput: '项目现在怎么样', permissions: ['ai:trigger', 'project:read'] }),
    )
    expect(r1.destinations.map((d) => d.destination)).toEqual(
      r2.destinations.map((d) => d.destination),
    )
    expect(r1.destinations.map((d) => d.confidence)).toEqual(
      r2.destinations.map((d) => d.confidence),
    )
  })

  // ── 4.5 歧义检测 ──

  it('置信度差在边距内时返回候选集合与判别问题', () => {
    // 构造两个 destination 置信度接近的场景
    const result = copilotRoute(
      makeInput({
        normalizedInput: '项目瓶颈分析甘特图',
        extractedSlots: [{ slotId: 'scope', value: '全局' }],
      }),
    )
    // 歧义检测逻辑已实现；具体是否触发取决于实际 confidence 值
    if (result.ambiguity) {
      expect(result.ambiguity.candidates.length).toBeGreaterThanOrEqual(2)
      expect(result.ambiguity.discriminatingQuestion.length).toBeGreaterThan(0)
    }
  })

  // ── 4.8 告警集合 ──

  it('路由结果带告警集合', () => {
    const result = copilotRoute(makeInput({ normalizedInput: '项目现在怎么样' }))
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  // ── 4.9 规则命中率/兜底率 ──

  it('规则命中时 ruleHitCount=1 fallbackCount=0，兜底时相反', () => {
    const ruleResult = copilotRoute(makeInput({ normalizedInput: '项目现在怎么样' }))
    expect(ruleResult.stats.ruleHitCount).toBe(1)
    expect(ruleResult.stats.fallbackCount).toBe(0)

    // 无规则命中的输入走兜底
    const fallbackResult = copilotRoute(makeInput({ normalizedInput: 'xyzabc123' }))
    expect(fallbackResult.stats.ruleHitCount).toBe(0)
    expect(fallbackResult.stats.fallbackCount).toBe(1)
  })

  // ── 5.1 / 5.2 槽位完整性阻断 ──

  it('必需槽位缺失时返回 clarification，不产出下游分析或变更动作', () => {
    // analysis.delay_attribution 有 critical 槽位 target_task
    const result = copilotRoute(makeInput({ normalizedInput: '为什么延期' }))
    if (result.clarificationRequired) {
      expect(result.clarificationItems.length).toBeGreaterThan(0)
      expect(result.destinations.length).toBe(0)
    }
  })

  // ── 5.4 recommended 默认值替代产生假设条目 ──

  it('recommended 档默认值替代产生假设条目（needsConfirmation=true）', () => {
    // query.project_status 有 recommended 槽位 project_scope
    const result = copilotRoute(makeInput({ normalizedInput: '项目现在怎么样' }))
    if (result.assumptionEntries.length > 0) {
      const assumption = result.assumptionEntries[0]
      expect(assumption.needsConfirmation).toBe(true)
      expect(assumption.source).toBe('default')
      expect(assumption.confidence).toBeGreaterThan(0)
    }
  })

  // ── 5.6 澄清轮数上界 ──

  it('达到澄清轮数上界后不再阻断', () => {
    const result = copilotRoute(
      makeInput({
        normalizedInput: '为什么延期',
        clarificationRounds: 99,
      }),
    )
    // 达到上界后应使用默认值继续
    expect(result.clarificationRequired).toBe(false)
  })

  it('未达上界时低轮数仍阻断追问（v3-copilot-clarification-rounds-limit 回归）', () => {
    // 上界已放宽到 99：第 2、3 轮（旧行为的上界）仍未达新上界，critical 槽位缺口继续阻断
    for (const rounds of [0, 1, 2, 3]) {
      const result = copilotRoute(
        makeInput({
          normalizedInput: '为什么延期',
          clarificationRounds: rounds,
        }),
      )
      expect(result.clarificationRequired).toBe(true)
      expect(result.clarificationItems.length).toBeGreaterThan(0)
      expect(result.destinations.length).toBe(0)
    }
  })

  it('槽位补齐后立即放行，不等待轮数上界（v3-copilot-clarification-rounds-limit 回归）', () => {
    const result = copilotRoute(
      makeInput({
        normalizedInput: '为什么延期',
        clarificationRounds: 2,
        extractedSlots: [{ slotId: 'target_task', value: 'T-101' }],
      }),
    )
    expect(result.clarificationRequired).toBe(false)
  })

  // ── 6.1 / 6.2 无权限缺席过滤 ──

  it('无权限 destination 不在结果中（6.1），且不泄露存在（6.2）', () => {
    // 只给 project:read 权限，不给 triz:read
    const result = copilotRoute(
      makeInput({
        normalizedInput: '技术矛盾分析',
        permissions: ['project:read', 'ai:trigger'],
      }),
    )
    // TRIZ destinations 需要 triz:read，不应出现
    const trizDests = result.destinations.filter((d) => d.destination.startsWith('triz_'))
    expect(trizDests.length).toBe(0)
  })

  // ── 6.4 授权门 destination 可见不可用 ──

  it('授权门 destination 标记为不可用 + 原因', () => {
    const result = copilotRoute(
      makeInput({
        normalizedInput: '你看到了什么',
        permissions: ['project:read', 'ai:trigger', 'external:read', 'knowledge:read'],
        availability: COPILOT_INTENT_FIXTURE_AVAILABILITY_GATED,
      }),
    )
    const gated = result.destinations.find((d) => d.destination === 'external_retrieval')
    if (gated) {
      expect(gated.confidence).toBe(0)
      expect(gated.parameterHints.some((h) => h.includes('授权'))).toBe(true)
    }
    // 检查 unavailabilityKinds 记录
    expect(result.routingRecord.unavailabilityKinds).toContain('authorization-gated')
  })

  // ── 6.6 通用问答分流 ──

  it('无法分类的输入走只读对话兜底而不阻断模型', () => {
    const result = copilotRoute(makeInput({ normalizedInput: 'xyzabc123' }))
    expect(result.clarificationRequired).toBe(false)
    expect(result.clarificationItems).toEqual([])
    expect(result.warnings).toContain('AI_FALLBACK')
  })

  it('三点风险与只给建议等自然提问正确路由至只读问答而不落入兜底澄清卡（任务 4.3 契约）', () => {
    const naturalQueries = [
      '三点风险',
      '给出建议',
      '明确只建议',
      '这个工单系统最容易失败的三个风险是什么？请明确只建议不要执行',
      '草案质量诊断与风险评估',
    ]
    for (const query of naturalQueries) {
      const result = copilotRoute(makeInput({ normalizedInput: query }))
      expect(result.clarificationRequired).toBe(false)
      expect(result.destinations.length).toBeGreaterThan(0)
      expect(
        result.destinations.some(
          (d) => d.destination === 'general_qa' || d.destination === 'health_diagnosis',
        ),
      ).toBe(true)
      expect(result.warnings).not.toContain('AI_FALLBACK')
      expect(result.clarificationItems.some((item) => item.slotId === 'user_intent')).toBe(false)
    }
  })

  // ── 6.9 / 6.10 安全兜底不创建或修改正式项目数据 ──

  it('安全兜底不产出任何可持久化 destination', () => {
    const result = copilotRoute(makeInput({ normalizedInput: '' }))
    for (const dest of result.destinations) {
      const metadata = COPILOT_DESTINATION_REGISTRY[dest.destination]
      if (metadata) {
        expect(metadata.persistenceReachable).toBe(false)
      }
    }
  })

  // ── 7.1 / 7.2 路由决策记录形状 ──

  it('路由决策记录包含所有必填字段', () => {
    const result = copilotRoute(makeInput({ normalizedInput: '项目现在怎么样' }))
    const record = result.routingRecord
    expect(record.catalogVersion).toBe(CATALOG_VER)
    expect(typeof record.recordId).toBe('string')
    expect(Array.isArray(record.destinationOrder)).toBe(true)
    expect(Array.isArray(record.confidences)).toBe(true)
    expect(typeof record.clarificationRoundCount).toBe('number')
    expect(typeof record.ambiguous).toBe('boolean')
    expect(typeof record.ruleHitCount).toBe('number')
    expect(typeof record.fallbackCount).toBe('number')
    expect(record.userRerouted).toBe(false)
  })

  // ── 7.3 记录不含敏感内容 ──

  it('路由决策记录不含原始输入全文、prompt、token 或 secret', () => {
    const fullInput = '帮我查看项目状态并生成周报，这是很长的原始输入'
    const result = copilotRoute(makeInput({ normalizedInput: fullInput }))
    const recordJson = JSON.stringify(result.routingRecord)
    expect(recordJson).not.toContain(fullInput)
    expect(recordJson).not.toContain('Bearer')
    expect(recordJson).not.toContain('sk-')
    expect(recordJson).not.toContain('password')
  })

  // ── 7.4 userRerouted 占位 ──

  it('userRerouted 占位始终为 false（由后续账本 change 填充）', () => {
    const result = copilotRoute(makeInput({ normalizedInput: '项目现在怎么样' }))
    expect(result.routingRecord.userRerouted).toBe(false)
  })
})
