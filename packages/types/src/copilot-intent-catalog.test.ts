// @aiproj/types — V3 Copilot 意图目录测试
// v3-copilot-intent-catalog-and-router —— 任务组 2 契约：目录完整性（2.10）/
// 共享注册表一致性（2.11）/ 变更类唯一可达可持久化 destination（2.12）/
// 歧义边距与版本常量（2.9）/ 命令注册表可用性适配（6.11/6.12）/ 记录低敏校验（7.x）。
//
// 纯本地离线：零网络、零 provider、零时钟/随机源。

import { describe, it, expect } from 'vitest'
import { COPILOT_DESTINATION_REGISTRY, COPILOT_INTENT_CLASSES } from './copilot-shared-contracts.js'
import {
  COPILOT_INTENT_AMBIGUITY_MARGIN,
  COPILOT_INTENT_CATALOG_VERSION,
  COPILOT_INTENT_MAX_CLARIFICATION_ROUNDS,
  COPILOT_INTENT_MAX_INPUT_LENGTH,
  COPILOT_INTENT_PERSISTENCE_CAPABLE_CLASSES,
  COPILOT_INTENT_SUMMARY_MAX_LENGTH,
  COPILOT_RULE_PIPELINE_ORDER,
  COPILOT_RULE_STRENGTH_CONFIDENCE,
  COPILOT_SUB_INTENT_REGISTRY,
  COPILOT_SLOT_TIERS,
  containsSensitiveRoutingPayload,
  copilotSubIntentById,
  copilotSubIntentsByClass,
  deriveAvailabilityFromCommandDeclarations,
  validateCopilotIntentCatalog,
} from './copilot-intent-catalog.js'
import {
  COPILOT_INTENT_FIXTURE_COMMAND_DECLARATIONS,
  COPILOT_INTENT_FIXTURE_INVALID_ENTRY_PERSISTENCE,
  COPILOT_INTENT_FIXTURE_INVALID_ENTRY_UNKNOWN_DESTINATION,
  COPILOT_INTENT_FIXTURE_ROUTING_RECORD,
} from './copilot-intent-catalog-fixtures.js'

describe('copilot-intent-catalog', () => {
  it('目录完整性：每条子意图必有分类、槽位声明、至少一个候选 destination 与权限声明（2.10）', () => {
    const result = validateCopilotIntentCatalog()
    expect(result.valid).toBe(true)
    if (!result.valid) {
      expect(result.issues).toEqual([])
    }
    expect(COPILOT_SUB_INTENT_REGISTRY.length).toBeGreaterThanOrEqual(30)

    for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
      expect(COPILOT_INTENT_CLASSES).toContain(entry.intentClass)
      expect(entry.requiredSlots.length + entry.optionalSlots.length).toBeGreaterThan(0)
      expect(entry.candidateDestinations.length).toBeGreaterThan(0)
      expect(entry.requiredPermissions.length).toBeGreaterThan(0)
      expect(entry.ruleDeclarations.length).toBeGreaterThan(0)
      expect(entry.examplePhrasings.length).toBeGreaterThan(0)
      expect(entry.catalogVersion).toBe(COPILOT_INTENT_CATALOG_VERSION)
    }
  })

  it('六类顶层意图均有子意图注册，且只读类（query/analysis/meta）不含可持久化 destination（2.10/2.12）', () => {
    for (const intentClass of COPILOT_INTENT_CLASSES) {
      expect(copilotSubIntentsByClass(intentClass).length).toBeGreaterThan(0)
    }
    for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
      if (COPILOT_INTENT_PERSISTENCE_CAPABLE_CLASSES.includes(entry.intentClass)) continue
      for (const destination of entry.candidateDestinations) {
        expect(COPILOT_DESTINATION_REGISTRY[destination].persistenceReachable).toBe(false)
      }
    }
  })

  it('每条候选 destination 都存在于共享 destination 注册表中（2.11）', () => {
    for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
      for (const destination of entry.candidateDestinations) {
        expect(COPILOT_DESTINATION_REGISTRY[destination]).toBeDefined()
      }
    }
  })

  it('未知 destination 与只读类挂可持久化 destination 的注册被目录校验拒绝（2.11/2.12 负向）', () => {
    const persistenceViolation = validateCopilotIntentCatalog([
      ...COPILOT_SUB_INTENT_REGISTRY,
      COPILOT_INTENT_FIXTURE_INVALID_ENTRY_PERSISTENCE,
    ])
    expect(persistenceViolation.valid).toBe(false)
    expect(
      persistenceViolation.issues.some((issue) => issue.includes('query.invalid_persistence')),
    ).toBe(true)

    const unknownViolation = validateCopilotIntentCatalog([
      ...COPILOT_SUB_INTENT_REGISTRY,
      COPILOT_INTENT_FIXTURE_INVALID_ENTRY_UNKNOWN_DESTINATION,
    ])
    expect(unknownViolation.valid).toBe(false)
    expect(unknownViolation.issues.some((issue) => issue.includes('not_a_destination'))).toBe(true)
  })

  it('可导致持久化的 destination 只能从可持久化分类子意图到达（2.12 正/负向）', () => {
    // 正向：所有注册条目的可持久化 destination 所属分类都在派生集合内
    for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
      const hasPersistence = entry.candidateDestinations.some(
        (destination) => COPILOT_DESTINATION_REGISTRY[destination].persistenceReachable,
      )
      if (hasPersistence) {
        expect(COPILOT_INTENT_PERSISTENCE_CAPABLE_CLASSES).toContain(entry.intentClass)
      }
    }
    // 共享契约的可持久化分类集合非空且与类规则一致
    expect(COPILOT_INTENT_PERSISTENCE_CAPABLE_CLASSES.length).toBeGreaterThan(0)
  })

  it('目录版本号与歧义边距为声明常量（2.9）', () => {
    expect(COPILOT_INTENT_CATALOG_VERSION).toBe('1.0.0')
    expect(typeof COPILOT_INTENT_AMBIGUITY_MARGIN).toBe('number')
    expect(COPILOT_INTENT_AMBIGUITY_MARGIN).toBeGreaterThan(0)
    expect(COPILOT_INTENT_MAX_INPUT_LENGTH).toBeGreaterThan(0)
    expect(COPILOT_INTENT_MAX_CLARIFICATION_ROUNDS).toBeGreaterThan(0)
    expect(COPILOT_INTENT_SUMMARY_MAX_LENGTH).toBeGreaterThan(0)
  })

  it('规则管线优先级顺序与置信度映射为确定性常量，相同强度产出相同置信度（3.3/3.4 契约侧）', () => {
    expect(COPILOT_RULE_PIPELINE_ORDER).toEqual([
      'slash_command',
      'explicit_destination',
      'entity_reference',
      'route_context',
      'structured_slot',
      'keyword_pattern',
    ])
    const confidences = Object.values(COPILOT_RULE_STRENGTH_CONFIDENCE)
    expect(new Set(confidences).size).toBe(confidences.length)
    for (const value of confidences) {
      expect(value).toBeGreaterThan(0)
      expect(value).toBeLessThanOrEqual(100)
    }
  })

  it('槽位档位三档与 ai_intent 三档语义一致（critical/recommended/optional）', () => {
    expect(COPILOT_SLOT_TIERS).toEqual(['critical', 'recommended', 'optional'])
    // critical 槽位不得声明默认值（目录校验已含，此处直接抽查）
    for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
      for (const slot of entry.requiredSlots) {
        expect(slot.defaultValue).toBeUndefined()
      }
    }
  })

  it('lookup helpers 确定性返回（2.10 辅助）', () => {
    expect(copilotSubIntentById('query.project_status')?.label).toBe('项目现状')
    expect(copilotSubIntentById('no.such.intent')).toBeUndefined()
    expect(copilotSubIntentsByClass('mutation').length).toBe(6)
  })

  it('命令注册表可用性适配：未启用→not-enabled、授权门→authorization-gated、上下文不可用/无权限→缺席（6.11/6.12）', () => {
    const permissions = ['project:read', 'project:update', 'ai:trigger', 'external:read']
    const availability = deriveAvailabilityFromCommandDeclarations(
      COPILOT_INTENT_FIXTURE_COMMAND_DECLARATIONS,
      permissions,
    )
    expect(availability).toEqual([
      { destination: 'draft_layer', kind: 'not-enabled', hint: '该能力未启用，可在设置中开启' },
      {
        destination: 'external_retrieval',
        kind: 'authorization-gated',
        hint: '需要用户授权后才能使用该能力',
      },
    ])
    // advanced_search：whenResult=false → 缺席；weekly_monthly_report：启用且授权 → 可用（缺席即可用）
    expect(availability.some((a) => a.destination === 'advanced_search')).toBe(false)
    expect(availability.some((a) => a.destination === 'weekly_monthly_report')).toBe(false)
  })

  it('命令注册表可用性适配：缺少权限的声明缺席（非泄露，6.11）', () => {
    const availability = deriveAvailabilityFromCommandDeclarations(
      COPILOT_INTENT_FIXTURE_COMMAND_DECLARATIONS,
      ['project:read'],
    )
    // draft_layer 缺 ai:trigger、external_retrieval 缺 external:read → 均缺席
    expect(availability).toEqual([])
  })

  it('路由决策记录低敏校验：不含原始输入/secret/token 样本（7.3 契约侧）', () => {
    expect(
      containsSensitiveRoutingPayload(COPILOT_INTENT_FIXTURE_ROUTING_RECORD, [
        '项目现在怎么样，帮我看看这个项目的完整原始输入全文',
        'sk-secret-fixture-0001',
        'Bearer abcdef',
      ]),
    ).toBe(false)

    const leakyRecord = {
      ...COPILOT_INTENT_FIXTURE_ROUTING_RECORD,
      intentSummary: '原始输入全文:项目现在怎么样，帮我看看这个项目的完整原始输入全文',
    }
    expect(
      containsSensitiveRoutingPayload(leakyRecord, [
        '项目现在怎么样，帮我看看这个项目的完整原始输入全文',
      ]),
    ).toBe(true)
  })

  it('意图目录规则完整性与版本号一致性（任务 1.2 契约）', () => {
    // 1. 版本号一致性：每个注册子意图版本恒等于 COPILOT_INTENT_CATALOG_VERSION
    for (const entry of COPILOT_SUB_INTENT_REGISTRY) {
      expect(entry.catalogVersion).toBe(COPILOT_INTENT_CATALOG_VERSION)
      expect(entry.subIntentId.length).toBeGreaterThan(0)
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.ruleDeclarations.length).toBeGreaterThan(0)
    }

    // 2. 覆盖自然中文变体关键词与示例句式（三点风险 / 明确只建议 / 给出建议 / 最容易失败）
    const generalExplanation = copilotSubIntentById('instruction.general_explanation')
    expect(generalExplanation).toBeDefined()
    const generalKeywords = generalExplanation!.ruleDeclarations.flatMap((r) => r.keywords ?? [])
    expect(generalKeywords).toContain('三点风险')
    expect(generalKeywords).toContain('明确只建议')
    expect(generalKeywords).toContain('给出建议')
    expect(generalKeywords).toContain('最容易失败')
    expect(generalKeywords).toContain('潜在风险')
    expect(generalKeywords).toContain('实施难点')
    expect(generalKeywords).toContain('注意事项')

    const draftQuality = copilotSubIntentById('analysis.draft_quality')
    expect(draftQuality).toBeDefined()
    const draftKeywords = draftQuality!.ruleDeclarations.flatMap((r) => r.keywords ?? [])
    expect(draftKeywords).toContain('比较需求与草案')
    expect(draftKeywords).toContain('草案质量')
    expect(draftKeywords).toContain('草案风险')
    expect(draftKeywords).toContain('草案诊断')
    expect(draftKeywords).toContain('质量诊断')
  })
})
