// v3-copilot-clarification-and-assumptions 契约测试
// 任务 2.7 / 2.13 / 2.14 —— 置信度派生确定性、字段注册完整性、未知档位拒绝、确定性 hash 键序不变。
import { describe, it, expect } from 'vitest'
import {
  CLARIFICATION_TIERS,
  CLARIFICATION_TIER_SEMANTICS,
  CLARIFICATION_SOURCE_STRENGTHS,
  CLARIFICATION_CONFIDENCE_BY_SOURCE_STRENGTH,
  CLARIFICATION_IMPACT_SEVERITIES,
  COPILOT_CLARIFICATION_QUESTION_TYPES,
  SLOT_FILL_STATES,
  SLOT_FILL_TRANSITIONS,
  UNCERTAINTY_KINDS,
  CLARIFICATION_ROUND_EXITS,
  RELIES_ON_SUBSTITUTED_DEFAULT,
  isClarificationTier,
  isClarificationImpactSeverity,
  isClarificationQuestionType,
  isClarificationSourceStrength,
  isSlotFillState,
  isClarificationUncertaintyKind,
  isClarificationRoundExit,
  clarificationTierSemantics,
  deriveConfidenceFromSourceStrength,
  makeClarificationAssumption,
  makeClarificationAssumptionId,
  deriveRelianceMarker,
  sortClarificationQuestionsByImpact,
  validateClarificationFieldRegistry,
  canSlotTransition,
  reachedClarificationRoundBound,
  uncertaintyKindWording,
  genericCapabilityNotice,
  computeClarificationDeterminismKey,
  rejectClarificationSensitiveText,
  type RegisteredClarificationField,
  type ClarificationSlotState,
  type ClarificationSourceStrength,
} from '../src/copilot-clarification.js'
import {
  CLARIFICATION_FIXTURE_FIELDS,
  CLARIFICATION_FIXTURE_ASSUMPTION_RECORDS,
  CLARIFICATION_FIXTURE_ASSUMPTION_ENTRIES,
  CLARIFICATION_FIXTURE_CATALOG_VERSION,
  CLARIFICATION_FIXTURE_DETERMINISM_INPUT_A,
  CLARIFICATION_FIXTURE_DETERMINISM_INPUT_B,
} from '../src/copilot-clarification-fixtures.js'
import type { CopilotAssumptionEntry } from '../src/copilot-shared-contracts.js'

// ═══════════════════════════════════════════════════════════════
// 2.7 置信度由来源强度派生——相同来源强度产出相同置信度值
// ═══════════════════════════════════════════════════════════════

describe('Task 2.7 — Confidence derived from source strength', () => {
  it('deriveConfidenceFromSourceStrength 为确定性纯函数', () => {
    for (const strength of CLARIFICATION_SOURCE_STRENGTHS) {
      const a = deriveConfidenceFromSourceStrength(strength)
      const b = deriveConfidenceFromSourceStrength(strength)
      expect(a).toBe(b)
      expect(a).toBe(CLARIFICATION_CONFIDENCE_BY_SOURCE_STRENGTH[strength])
    }
  })

  it('五个来源强度各有一个明确的置信度值（0-100）', () => {
    for (const [strength, conf] of Object.entries(CLARIFICATION_CONFIDENCE_BY_SOURCE_STRENGTH)) {
      expect(conf).toBeGreaterThanOrEqual(0)
      expect(conf).toBeLessThanOrEqual(100)
      expect(typeof conf).toBe('number')
    }
  })

  it('相同来源强度两次调用产出相同置信度', () => {
    for (const strength of CLARIFICATION_SOURCE_STRENGTHS) {
      const calls = Array.from({ length: 10 }, () => deriveConfidenceFromSourceStrength(strength))
      const unique = new Set(calls)
      expect(unique.size).toBe(1)
    }
  })

  it('domain_standard 置信度最高，unsupported_guess 最低', () => {
    const high = deriveConfidenceFromSourceStrength('domain_standard')
    const low = deriveConfidenceFromSourceStrength('unsupported_guess')
    expect(high).toBeGreaterThan(low)
  })
})

// ═══════════════════════════════════════════════════════════════
// 2.13 字段注册完整性 / 未知档位拒绝 / 确定性 hash 键序变化
// ═══════════════════════════════════════════════════════════════

describe('Task 2.13 — Field registry validation', () => {
  it('合法字段通过校验', () => {
    const result = validateClarificationFieldRegistry(CLARIFICATION_FIXTURE_FIELDS)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('未知档位字段被拒绝', () => {
    const invalid: RegisteredClarificationField[] = [
      {
        fieldId: 'test-field',
        destination: 'test',
        tier: 'unknown_tier' as any,
        title: '测试',
        description: '测试描述',
        impactScope: [{ domain: 'test', severity: 'high' }],
        questionType: 'text',
        quickOptions: [],
      },
    ]
    const result = validateClarificationFieldRegistry(invalid)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes('档位未知'))).toBe(true)
  })

  it('缺少必填属性被拒绝', () => {
    const invalid: any[] = [
      {
        fieldId: '',
        destination: 'test',
        tier: 'critical',
        title: '',
        description: '',
        impactScope: [],
        questionType: 'text',
        quickOptions: [],
      },
    ]
    const result = validateClarificationFieldRegistry(invalid)
    expect(result.valid).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('重复 fieldId 被拒绝', () => {
    const dupe: RegisteredClarificationField[] = [
      {
        fieldId: 'same',
        destination: 'a',
        tier: 'critical',
        title: 'A',
        description: 'A',
        impactScope: [{ domain: 'd', severity: 'high' }],
        questionType: 'text',
        quickOptions: [],
      },
      {
        fieldId: 'same',
        destination: 'b',
        tier: 'optional',
        title: 'B',
        description: 'B',
        impactScope: [{ domain: 'd', severity: 'low' }],
        questionType: 'text',
        quickOptions: [],
      },
    ]
    const result = validateClarificationFieldRegistry(dupe)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes('重复'))).toBe(true)
  })

  it('空字段列表通过校验（无字段 = 无问题）', () => {
    const result = validateClarificationFieldRegistry([])
    expect(result.valid).toBe(true)
  })
})

describe('Task 2.13 — Deterministic hash under key reordering', () => {
  it('确定性键在输入键序变化下不变', () => {
    const keyA = computeClarificationDeterminismKey(CLARIFICATION_FIXTURE_DETERMINISM_INPUT_A)
    const keyB = computeClarificationDeterminismKey(CLARIFICATION_FIXTURE_DETERMINISM_INPUT_B)
    expect(keyA).toBe(keyB)
    expect(keyA.length).toBeGreaterThan(0)
  })

  it('不同输入产出不同确定性键', () => {
    const keyA = computeClarificationDeterminismKey(CLARIFICATION_FIXTURE_DETERMINISM_INPUT_A)
    const keyC = computeClarificationDeterminismKey({
      ...CLARIFICATION_FIXTURE_DETERMINISM_INPUT_A,
      normalizedInput: '不同的输入',
    })
    expect(keyA).not.toBe(keyC)
  })
})

// ═══════════════════════════════════════════════════════════════
// 假设条目构造器与稳定 ID
// ═══════════════════════════════════════════════════════════════

describe('Assumption entry construction', () => {
  it('makeClarificationAssumption 产出完整记录', () => {
    const record = CLARIFICATION_FIXTURE_ASSUMPTION_RECORDS[0]
    expect(record.entry.assumptionId).toMatch(/^cla_/)
    expect(record.entry.statement).toBeTruthy()
    expect(record.entry.source).toBe('default')
    expect(record.entry.needsConfirmation).toBe(true)
    expect(record.entry.usedDefault).toBe(true)
    expect(typeof record.entry.confidence).toBe('number')
    expect(record.fieldId).toBeTruthy()
    expect(record.sourceStrength).toBeTruthy()
    expect(record.substitutionReason).toBeTruthy()
  })

  it('稳定 ID 在相同输入下可复现', () => {
    const id1 = makeClarificationAssumptionId({
      fieldId: 'teamSize',
      statement: '测试',
      sourceStrength: 'catalog_median',
    })
    const id2 = makeClarificationAssumptionId({
      fieldId: 'teamSize',
      statement: '测试',
      sourceStrength: 'catalog_median',
    })
    expect(id1).toBe(id2)
  })

  it('不同输入产出不同稳定 ID', () => {
    const id1 = makeClarificationAssumptionId({
      fieldId: 'a',
      statement: '测试',
      sourceStrength: 'catalog_median',
    })
    const id2 = makeClarificationAssumptionId({
      fieldId: 'b',
      statement: '测试',
      sourceStrength: 'catalog_median',
    })
    expect(id1).not.toBe(id2)
  })

  it('置信度由来源强度派生（不自由取值）', () => {
    const record = makeClarificationAssumption({
      fieldId: 'test',
      statement: '测试假设',
      sourceStrength: 'domain_standard',
      substitutionReason: '测试',
    })
    expect(record.entry.confidence).toBe(deriveConfidenceFromSourceStrength('domain_standard'))
  })
})

// ═══════════════════════════════════════════════════════════════
// 依赖替代默认值标记
// ═══════════════════════════════════════════════════════════════

describe('Reliance marker', () => {
  it('有 usedDefault 条目时返回标记', () => {
    const entries: CopilotAssumptionEntry[] = [
      {
        assumptionId: '1',
        statement: 's',
        source: 'default',
        confidence: 80,
        usedDefault: true,
        needsConfirmation: true,
        editable: true,
      },
    ]
    expect(deriveRelianceMarker(entries)).toBe(RELIES_ON_SUBSTITUTED_DEFAULT)
  })

  it('无 usedDefault 条目时返回 null', () => {
    const entries: CopilotAssumptionEntry[] = [
      {
        assumptionId: '1',
        statement: 's',
        source: 'default',
        confidence: 80,
        usedDefault: false,
        needsConfirmation: false,
        editable: true,
      },
    ]
    expect(deriveRelianceMarker(entries)).toBeNull()
  })

  it('空列表返回 null', () => {
    expect(deriveRelianceMarker([])).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
// 排序
// ═══════════════════════════════════════════════════════════════

describe('Clarification question sorting', () => {
  it('高影响排在低影响之前', () => {
    const fields: RegisteredClarificationField[] = [
      {
        fieldId: 'low',
        destination: 'test',
        tier: 'optional',
        title: 'Low',
        description: 'd',
        impactScope: [{ domain: 'd', severity: 'low' }],
        questionType: 'text',
        quickOptions: [],
      },
      {
        fieldId: 'high',
        destination: 'test',
        tier: 'critical',
        title: 'High',
        description: 'd',
        impactScope: [{ domain: 'd', severity: 'high' }],
        questionType: 'text',
        quickOptions: [],
      },
      {
        fieldId: 'medium',
        destination: 'test',
        tier: 'recommended',
        title: 'Med',
        description: 'd',
        impactScope: [{ domain: 'd', severity: 'medium' }],
        questionType: 'text',
        quickOptions: [],
      },
    ]
    const sorted = sortClarificationQuestionsByImpact(fields)
    expect(sorted[0].fieldId).toBe('high')
    expect(sorted[1].fieldId).toBe('medium')
    expect(sorted[2].fieldId).toBe('low')
  })

  it('同 severity 按 tier 排序（critical 优先）', () => {
    const fields: RegisteredClarificationField[] = [
      {
        fieldId: 'opt',
        destination: 'test',
        tier: 'optional',
        title: 'Opt',
        description: 'd',
        impactScope: [{ domain: 'd', severity: 'high' }],
        questionType: 'text',
        quickOptions: [],
      },
      {
        fieldId: 'crit',
        destination: 'test',
        tier: 'critical',
        title: 'Crit',
        description: 'd',
        impactScope: [{ domain: 'd', severity: 'high' }],
        questionType: 'text',
        quickOptions: [],
      },
    ]
    const sorted = sortClarificationQuestionsByImpact(fields)
    expect(sorted[0].fieldId).toBe('crit')
    expect(sorted[1].fieldId).toBe('opt')
  })

  it('同 severity 同 tier 按 fieldId 字典序确定', () => {
    const fields: RegisteredClarificationField[] = [
      {
        fieldId: 'b',
        destination: 'test',
        tier: 'critical',
        title: 'B',
        description: 'd',
        impactScope: [{ domain: 'd', severity: 'high' }],
        questionType: 'text',
        quickOptions: [],
      },
      {
        fieldId: 'a',
        destination: 'test',
        tier: 'critical',
        title: 'A',
        description: 'd',
        impactScope: [{ domain: 'd', severity: 'high' }],
        questionType: 'text',
        quickOptions: [],
      },
    ]
    const sorted = sortClarificationQuestionsByImpact(fields)
    expect(sorted[0].fieldId).toBe('a')
    expect(sorted[1].fieldId).toBe('b')
  })
})

// ═══════════════════════════════════════════════════════════════
// 槽位状态机
// ═══════════════════════════════════════════════════════════════

describe('Slot fill state machine', () => {
  it('unasked 只能迁移到 asked_pending', () => {
    expect(canSlotTransition('unasked', 'asked_pending')).toBe(true)
    expect(canSlotTransition('unasked', 'answered')).toBe(false)
    expect(canSlotTransition('unasked', 'filled_with_default')).toBe(false)
    expect(canSlotTransition('unasked', 'skipped')).toBe(false)
    expect(canSlotTransition('unasked', 'blocked')).toBe(false)
  })

  it('asked_pending 可迁移到 answered / filled_with_default / skipped / blocked', () => {
    expect(canSlotTransition('asked_pending', 'answered')).toBe(true)
    expect(canSlotTransition('asked_pending', 'filled_with_default')).toBe(true)
    expect(canSlotTransition('asked_pending', 'skipped')).toBe(true)
    expect(canSlotTransition('asked_pending', 'blocked')).toBe(true)
    expect(canSlotTransition('asked_pending', 'unasked')).toBe(false)
  })

  it('answered 只能保持 answered（不重复询问）', () => {
    expect(canSlotTransition('answered', 'answered')).toBe(true)
    expect(canSlotTransition('answered', 'asked_pending')).toBe(false)
  })

  it('reachedClarificationRoundBound 正确判定', () => {
    expect(reachedClarificationRoundBound(3, 3)).toBe(true)
    expect(reachedClarificationRoundBound(2, 3)).toBe(false)
    expect(reachedClarificationRoundBound(4, 3)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// 不确定三分类与非泄露文案
// ═══════════════════════════════════════════════════════════════

describe('Uncertainty kinds and non-disclosure', () => {
  it('not_accessible_to_actor 只返回通用能力受限文案', () => {
    const wording = uncertaintyKindWording('not_accessible_to_actor')
    expect(wording).toBe(genericCapabilityNotice())
    expect(wording).not.toContain('不存在')
    expect(wording).not.toContain('未匹配')
  })

  it('nothing_exists 返回明确不存在文案', () => {
    const wording = uncertaintyKindWording('nothing_exists')
    expect(wording).toContain('不存在')
  })

  it('no_match 返回未匹配文案', () => {
    const wording = uncertaintyKindWording('no_match')
    expect(wording).toContain('未检索')
  })

  it('genericCapabilityNotice 返回固定文案', () => {
    const notice = genericCapabilityNotice()
    expect(notice.length).toBeGreaterThan(0)
    expect(typeof notice).toBe('string')
  })
})

// ═══════════════════════════════════════════════════════════════
// 低敏约束 / sanitizer
// ═══════════════════════════════════════════════════════════════

describe('Sanitizer — low sensitivity constraints', () => {
  it('正常文本通过', () => {
    const result = rejectClarificationSensitiveText('团队规模默认 4 人')
    expect(result.safe).toBe(true)
  })

  it('空字符串安全', () => {
    expect(rejectClarificationSensitiveText('').safe).toBe(true)
  })

  it('包含 Bearer token 被拒绝', () => {
    const result = rejectClarificationSensitiveText('Bearer abcdefghijklmnop')
    expect(result.safe).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('包含 API key 被拒绝', () => {
    const result = rejectClarificationSensitiveText('sk-abcdefghijklmnopqrstuvwxyz')
    expect(result.safe).toBe(false)
  })

  it('包含 Authorization 头被拒绝', () => {
    const result = rejectClarificationSensitiveText('Authorization: Basic dXNlcjpwYXNz')
    expect(result.safe).toBe(false)
  })

  it('非字符串输入被拒绝', () => {
    const result = rejectClarificationSensitiveText(123 as any)
    expect(result.safe).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
// 类型守卫
// ═══════════════════════════════════════════════════════════════

describe('Type guards', () => {
  it('isClarificationTier 正确判定', () => {
    expect(isClarificationTier('critical')).toBe(true)
    expect(isClarificationTier('optional')).toBe(true)
    expect(isClarificationTier('unknown')).toBe(false)
    expect(isClarificationTier(123)).toBe(false)
  })

  it('isClarificationSourceStrength 正确判定', () => {
    expect(isClarificationSourceStrength('domain_standard')).toBe(true)
    expect(isClarificationSourceStrength('unsupported_guess')).toBe(true)
    expect(isClarificationSourceStrength('unknown')).toBe(false)
  })

  it('isSlotFillState 正确判定', () => {
    expect(isSlotFillState('unasked')).toBe(true)
    expect(isSlotFillState('blocked')).toBe(true)
    expect(isSlotFillState('unknown')).toBe(false)
  })

  it('isClarificationRoundExit 正确判定', () => {
    expect(isClarificationRoundExit('proceed_with_defaults')).toBe(true)
    expect(isClarificationRoundExit('end_turn')).toBe(true)
    expect(isClarificationRoundExit('other')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
// Fixtures 一致性
// ═══════════════════════════════════════════════════════════════

describe('Fixtures consistency', () => {
  it('假设记录 entries 数组长度一致', () => {
    expect(CLARIFICATION_FIXTURE_ASSUMPTION_RECORDS.length).toBe(
      CLARIFICATION_FIXTURE_ASSUMPTION_ENTRIES.length,
    )
  })

  it('假设记录 entries 内容一致', () => {
    CLARIFICATION_FIXTURE_ASSUMPTION_RECORDS.forEach((record, i) => {
      expect(record.entry).toEqual(CLARIFICATION_FIXTURE_ASSUMPTION_ENTRIES[i])
    })
  })

  it('fixture catalog version 非空', () => {
    expect(CLARIFICATION_FIXTURE_CATALOG_VERSION.length).toBeGreaterThan(0)
  })
})
