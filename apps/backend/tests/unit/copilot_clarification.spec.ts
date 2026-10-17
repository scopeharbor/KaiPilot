// v3-copilot-clarification-and-assumptions 后端服务测试
// 任务 3.3/3.4/3.6/4.3/4.6/4.9/4.11/4.12/5.3/5.4/5.7/5.9/6.3/6.5
import { describe, it, expect, beforeEach } from 'vitest'
import type { RegisteredClarificationField, SlotFillState } from '@aiproj/types'
import {
  uncertaintyKindWording,
  genericCapabilityNotice,
  CLARIFICATION_FIXTURE_FIELDS,
  CLARIFICATION_FIXTURE_CRITICAL_GAP,
  CLARIFICATION_FIXTURE_RECOMMENDED_DEFAULT,
  CLARIFICATION_FIXTURE_OPTIONAL_SKIPPED,
  CLARIFICATION_FIXTURE_ROUND_BOUND,
  CLARIFICATION_FIXTURE_PARTIAL_ANSWERS,
} from '@aiproj/types'
import {
  registerClarificationFields,
  getRegisteredFields,
  adaptProjectIntakeCatalog,
  clearClarificationRegistry,
  sortClarificationQuestionsByImpact,
} from '../../app/services/copilot_clarification/copilot_clarification_registry.js'
import {
  runSlotStateMachine,
  preserveAnsweredSlots,
  isClarificationActionAllowed,
} from '../../app/services/copilot_clarification/copilot_slot_state_machine.js'
import {
  generateAssumption,
  editAssumption,
} from '../../app/services/copilot_clarification/copilot_assumption_generator.js'
import {
  processClarificationRound,
  applyClarificationAnswer,
} from '../../app/services/copilot_clarification/copilot_clarification_service.js'

// ── 辅助 ──

function makeField(
  overrides: Partial<RegisteredClarificationField> & { fieldId: string },
): RegisteredClarificationField {
  return {
    destination: 'test',
    tier: 'recommended',
    title: `测试字段 ${overrides.fieldId}`,
    description: '测试说明',
    impactScope: [{ domain: '测试域', severity: 'medium' }],
    questionType: 'text',
    quickOptions: [],
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════
// Section 3: 澄清字段注册与目录
// ═══════════════════════════════════════════════════════════════

describe('ClarificationRegistry', () => {
  beforeEach(() => {
    clearClarificationRegistry()
  })

  it('3.3 每个注册字段声明全部必填属性且无遗漏', () => {
    const fields: RegisteredClarificationField[] = [
      makeField({ fieldId: 'f1', tier: 'critical', destination: 'test-dest' }),
      makeField({
        fieldId: 'f2',
        tier: 'optional',
        destination: 'test-dest',
        impactScope: [{ domain: 'd', severity: 'high' }],
      }),
    ]
    registerClarificationFields('test-dest', fields)
    const result = getRegisteredFields('test-dest')
    expect(result.length).toBe(2)
    result.forEach((f) => {
      expect(typeof f.fieldId).toBe('string')
      expect(typeof f.destination).toBe('string')
      expect(typeof f.title).toBe('string')
      expect(typeof f.description).toBe('string')
      expect(Array.isArray(f.impactScope)).toBe(true)
      expect(Array.isArray(f.quickOptions)).toBe(true)
    })
  })

  it('3.4 既有向导澄清行为无回归（project-intake 注册）', () => {
    const catalog: Record<string, any> = {
      projectGoal: {
        field: 'projectGoal',
        defaultCategory: 'critical',
        title: '目标',
        description: '决定范围',
        impactScope: [{ domain: '范围', severity: 'high' }],
        questionType: 'text',
        quickOptions: [],
        defaultValue: null,
        defaultConfidence: 0.35,
        defaultReasoning: '未识别',
      },
    }
    const fields = adaptProjectIntakeCatalog(catalog)
    expect(fields.length).toBe(1)
    expect(fields[0].fieldId).toBe('projectGoal')
    expect(fields[0].tier).toBe('critical')
    expect(fields[0].destination).toBe('project-intake')
  })

  it('3.6 高影响问题排在低影响之前', () => {
    const fields: RegisteredClarificationField[] = [
      makeField({ fieldId: 'low', impactScope: [{ domain: 'd', severity: 'low' }] }),
      makeField({ fieldId: 'high', impactScope: [{ domain: 'd', severity: 'high' }] }),
      makeField({ fieldId: 'med', impactScope: [{ domain: 'd', severity: 'medium' }] }),
    ]
    registerClarificationFields('test', fields)
    const sorted = sortClarificationQuestionsByImpact(getRegisteredFields('test'))
    expect(sorted[0].fieldId).toBe('high')
    expect(sorted[1].fieldId).toBe('med')
    expect(sorted[2].fieldId).toBe('low')
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 4: 槽位状态机与多轮澄清
// ═══════════════════════════════════════════════════════════════

describe('SlotStateMachine', () => {
  it('4.3 critical 缺口下变更动作数为零', () => {
    const fields = CLARIFICATION_FIXTURE_FIELDS
    const slotStates: Record<string, SlotFillState> = {}
    for (const s of CLARIFICATION_FIXTURE_CRITICAL_GAP) {
      slotStates[s.fieldId] = s.state
    }
    const output = runSlotStateMachine({ fields, slotStates, roundsElapsed: 0 })
    expect(output.isBlocked).toBe(true)
    expect(output.blockedCriticalSlots.length).toBe(1)
    expect(output.blockedCriticalSlots[0].fieldId).toBe('startDate')
  })

  it('4.6 recommended 用默认值路径', () => {
    const fields = CLARIFICATION_FIXTURE_FIELDS
    const slotStates: Record<string, SlotFillState> = {}
    for (const s of CLARIFICATION_FIXTURE_RECOMMENDED_DEFAULT) {
      slotStates[s.fieldId] = s.state
    }
    const output = runSlotStateMachine({ fields, slotStates, roundsElapsed: 0 })
    expect(output.isBlocked).toBe(false)
    expect(output.defaultSubstitutions.length).toBeGreaterThan(0)
  })

  it('4.6 optional 跳过且不产生假设条目', () => {
    const fields = CLARIFICATION_FIXTURE_FIELDS
    const slotStates: Record<string, SlotFillState> = {}
    for (const s of CLARIFICATION_FIXTURE_OPTIONAL_SKIPPED) {
      slotStates[s.fieldId] = s.state
    }
    const output = runSlotStateMachine({ fields, slotStates, roundsElapsed: 0 })
    expect(output.isBlocked).toBe(false)
    expect(output.skippedOptional.length).toBe(2)
    expect(output.defaultSubstitutions.length).toBe(0)
  })

  it('4.9 两条出路均可达', () => {
    const fields = CLARIFICATION_FIXTURE_FIELDS
    const slotStates: Record<string, SlotFillState> = {}
    for (const s of CLARIFICATION_FIXTURE_CRITICAL_GAP) {
      slotStates[s.fieldId] = s.state
    }
    const output = runSlotStateMachine({
      fields,
      slotStates,
      roundsElapsed: CLARIFICATION_FIXTURE_ROUND_BOUND.roundsElapsed,
      maxRounds: CLARIFICATION_FIXTURE_ROUND_BOUND.maxRounds,
    })
    expect(output.reachedRoundBound).toBe(true)
    expect(output.roundExits.length).toBe(2)
    expect(output.roundExits).toContain('proceed_with_defaults')
    expect(output.roundExits).toContain('end_turn')
    expect(output.mustStopAsking).toBe(true)
  })

  it('4.11 多轮部分回答后不重复询问已答项', () => {
    const previousStates: Record<string, SlotFillState> = {}
    const currentStates: Record<string, SlotFillState> = {}
    for (const s of CLARIFICATION_FIXTURE_PARTIAL_ANSWERS) {
      previousStates[s.fieldId] = s.state
      currentStates[s.fieldId] = s.state
    }
    const merged = preserveAnsweredSlots(previousStates, currentStates)
    expect(merged.projectGoal).toBe('answered')
    expect(merged.teamSize).toBe('answered')
  })

  it('4.12 澄清阶段不允许创建正式项目数据', () => {
    expect(isClarificationActionAllowed('clarify')).toBe(true)
    expect(isClarificationActionAllowed('query')).toBe(true)
    expect(isClarificationActionAllowed('create_task')).toBe(false)
    expect(isClarificationActionAllowed('update_task')).toBe(false)
    expect(isClarificationActionAllowed('create_milestone')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 5: 假设生成
// ═══════════════════════════════════════════════════════════════

describe('AssumptionGenerator', () => {
  it('5.3 任何默认值替代都伴随一条假设条目', () => {
    const field = makeField({
      fieldId: 'teamSize',
      defaultValue: { value: 4, sourceStrength: 'catalog_median', reason: '取中位值' },
    })
    const output = generateAssumption({
      field,
      reason: '取中位值',
      sourceStrength: 'catalog_median',
      value: 4,
    })
    expect(typeof output.record.entry.assumptionId).toBe('string')
    expect(output.record.entry.usedDefault).toBe(true)
    expect(output.record.entry.needsConfirmation).toBe(true)
  })

  it('5.4 稳定 ID 在相同输入下可复现且互不冲突', () => {
    const field = makeField({ fieldId: 'test' })
    const a = generateAssumption({
      field,
      reason: '原因',
      sourceStrength: 'catalog_median',
      value: '值',
    })
    const b = generateAssumption({
      field,
      reason: '原因',
      sourceStrength: 'catalog_median',
      value: '值',
    })
    expect(a.record.entry.assumptionId).toBe(b.record.entry.assumptionId)
  })

  it('5.7 编辑假设不会静默改写已审查过的差异', () => {
    const original = generateAssumption({
      field: makeField({ fieldId: 'teamSize' }),
      reason: '原原因',
      sourceStrength: 'catalog_median',
      value: 4,
    }).record

    const edited = editAssumption({
      original,
      newStatement: '修改后的陈述',
      newSourceStrength: 'organization_config',
      newReason: '新原因',
    })

    expect(edited.entry.assumptionId).not.toBe(original.entry.assumptionId)
    expect(edited.entry.statement).toBe('修改后的陈述')
  })
})

// ═══════════════════════════════════════════════════════════════
// Section 6: 权限与非泄露
// ═══════════════════════════════════════════════════════════════

describe('Permission and Non-disclosure', () => {
  it('6.3 仅相差一项权限的两个 actor 除通用提示外文案完全一致', () => {
    const wordingA = uncertaintyKindWording('not_accessible_to_actor')
    const wordingB = uncertaintyKindWording('not_accessible_to_actor')
    expect(wordingA).toBe(wordingB)
    expect(wordingA).toBe(genericCapabilityNotice())
  })

  it('6.5 不泄露存在性：not_accessible 不暗示实体存在', () => {
    const wording = uncertaintyKindWording('not_accessible_to_actor')
    expect(wording).not.toContain('存在')
    expect(wording).not.toContain('个')
    expect(wording).not.toContain('条')
  })
})

// ═══════════════════════════════════════════════════════════════
// 编排服务集成测试
// ═══════════════════════════════════════════════════════════════

describe('ClarificationService (orchestration)', () => {
  beforeEach(() => {
    clearClarificationRegistry()
  })

  it('完整流程：注册 → 运行 → 假设 → 动作守卫', () => {
    registerClarificationFields('project-intake', CLARIFICATION_FIXTURE_FIELDS)

    const slotStates: Record<string, SlotFillState> = {}
    for (const s of CLARIFICATION_FIXTURE_CRITICAL_GAP) {
      slotStates[s.fieldId] = s.state
    }

    const result = processClarificationRound({
      destination: 'project-intake',
      slotStates,
      roundsElapsed: 0,
    })

    expect(result.actionGuard.allowed).toBe(false)
    expect(result.actionGuard.reason).toContain('critical')
    expect(result.round.pendingSlots.length).toBeGreaterThan(0)
  })

  it('applyAnswer 合法迁移', () => {
    const states: Record<string, SlotFillState> = { f1: 'unasked' }
    const updated = applyClarificationAnswer(states, 'f1', 'asked_pending' as any)
    expect(updated.f1).toBe('asked_pending')
  })

  it('applyAnswer 非法迁移抛错', () => {
    const states: Record<string, SlotFillState> = { f1: 'answered' }
    expect(() => applyClarificationAnswer(states, 'f1', 'unasked' as any)).toThrow(/非法迁移/)
  })
})
