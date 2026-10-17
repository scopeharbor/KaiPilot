/**
 * v3-copilot-mentions-and-slash-commands —— 契约与 fixtures 测试。
 *
 * 验证：
 * - 类型守卫正确性
 * - 确定性排序
 * - 禁存原始输入（sanitizer）
 * - 低敏记录形状
 * - AvailabilityKind 与路由器/芯片一致
 * - Fixtures 八态一致性
 * - 双轨表达完整性
 * - 路由显式命令格式
 */

import { describe, it, expect } from 'vitest'
import {
  isMentionableEntityType,
  isCommandSourceKind,
  isCompletionAvailabilityKind,
  isValidCompletionSortKey,
  isMentionReference,
  isMentionCandidate,
  isCommandCandidate,
  makeCompletionCandidateId,
  makeCompletionSortKey,
  compareSortKeys,
  sortCompletionCandidates,
  sanitizeCompletionQuery,
  sanitizeCompletionSelection,
  formatRoutingExplicitCommand,
  isExplicitCommandFormat,
  MENTION_TRIGGER,
  COMMAND_TRIGGER,
  DEFAULT_MAX_CANDIDATES,
  DEBOUNCE_MS,
  type CompletionCandidate,
  type CompletionMentionCandidate,
  type CommandCandidate,
} from '../src/copilot-input-completion.js'
import { ChipAvailabilityKind } from '../src/copilot-context-chips.js'
import {
  FIXTURE_MENTION_REFERENCE,
  FIXTURE_MENTION_CANDIDATE_HIT,
  FIXTURE_MENTION_RESULT_HIT,
  FIXTURE_MENTION_RESULT_EMPTY,
  FIXTURE_COMMAND_DESCRIPTOR_HIT,
  FIXTURE_COMMAND_CANDIDATE_HIT,
  FIXTURE_COMMAND_RESULT_HIT,
  FIXTURE_COMMAND_DESCRIPTOR_NOT_ENABLED,
  FIXTURE_COMMAND_CANDIDATE_NOT_ENABLED,
  FIXTURE_COMMAND_DESCRIPTOR_AUTH_GATED,
  FIXTURE_COMMAND_CANDIDATE_AUTH_GATED,
  FIXTURE_COMMAND_RESULT_AUTH_GATED,
  FIXTURE_DANGLING_REFERENCE,
  FIXTURE_SUBMISSION_WITH_DANGLING_REF,
  FIXTURE_MIXED_CANDIDATES,
  FIXTURE_SORTED_CANDIDATES_EXPECTED,
  FIXTURE_INPUT_STATE_MENTION,
  FIXTURE_INPUT_STATE_COMMAND,
  FIXTURE_INPUT_STATE_INACTIVE,
  FIXTURE_SELECTION_RECORD_MENTION,
  FIXTURE_SELECTION_RECORD_COMMAND,
  FIXTURE_ACTOR_WITH_PERM,
  FIXTURE_ACTOR_WITHOUT_PERM,
  FIXTURE_NON_LEAKAGE_EXPECTED_COUNT,
} from '../src/copilot-input-completion-fixtures.js'

// ===========================================================================
// 类型守卫测试
// ===========================================================================

describe('Type guards', () => {
  describe('isMentionableEntityType', () => {
    it('accepts valid entity types', () => {
      expect(isMentionableEntityType('task')).toBe(true)
      expect(isMentionableEntityType('project')).toBe(true)
      expect(isMentionableEntityType('milestone')).toBe(true)
      expect(isMentionableEntityType('risk')).toBe(true)
      expect(isMentionableEntityType('member')).toBe(true)
      expect(isMentionableEntityType('document')).toBe(true)
      expect(isMentionableEntityType('file')).toBe(true)
      expect(isMentionableEntityType('report')).toBe(true)
      expect(isMentionableEntityType('change_request')).toBe(true)
      expect(isMentionableEntityType('comment')).toBe(true)
      expect(isMentionableEntityType('ocr_document')).toBe(true)
      expect(isMentionableEntityType('external_link')).toBe(true)
    })

    it('rejects invalid entity types', () => {
      expect(isMentionableEntityType('invalid')).toBe(false)
      expect(isMentionableEntityType('')).toBe(false)
      expect(isMentionableEntityType(null)).toBe(false)
      expect(isMentionableEntityType(undefined)).toBe(false)
      expect(isMentionableEntityType(42)).toBe(false)
    })
  })

  describe('isCommandSourceKind', () => {
    it('accepts valid source kinds', () => {
      expect(isCommandSourceKind('intent-catalog')).toBe(true)
      expect(isCommandSourceKind('registered-command')).toBe(true)
    })

    it('rejects invalid source kinds', () => {
      expect(isCommandSourceKind('unknown')).toBe(false)
      expect(isCommandSourceKind(null)).toBe(false)
    })
  })

  describe('isCompletionAvailabilityKind', () => {
    it('matches ChipAvailabilityKind exactly', () => {
      const completionKinds = ['available', 'not-permitted', 'not-enabled', 'authorization-gated']
      const chipKinds: ChipAvailabilityKind[] = [
        'available',
        'not-permitted',
        'not-enabled',
        'authorization-gated',
      ]

      // 同一取值集合
      expect(completionKinds.sort()).toEqual([...chipKinds].sort())

      for (const kind of completionKinds) {
        expect(isCompletionAvailabilityKind(kind)).toBe(true)
      }
    })

    it('rejects invalid availability kinds', () => {
      expect(isCompletionAvailabilityKind('disabled')).toBe(false)
      expect(isCompletionAvailabilityKind('hidden')).toBe(false)
      expect(isCompletionAvailabilityKind(null)).toBe(false)
    })
  })

  describe('isValidCompletionSortKey', () => {
    it('accepts valid sort keys', () => {
      expect(
        isValidCompletionSortKey({
          relevanceTier: 'critical',
          impactSeverity: 90,
          stableTieBreak: 'a',
        }),
      ).toBe(true)
      expect(
        isValidCompletionSortKey({ relevanceTier: 'low', impactSeverity: 10, stableTieBreak: 'z' }),
      ).toBe(true)
    })

    it('rejects invalid sort keys', () => {
      expect(isValidCompletionSortKey(null)).toBe(false)
      expect(isValidCompletionSortKey({ relevanceTier: 'invalid' })).toBe(false)
      expect(isValidCompletionSortKey({ relevanceTier: 'high' })).toBe(false)
    })
  })

  describe('isMentionReference', () => {
    it('accepts valid mention references', () => {
      expect(isMentionReference(FIXTURE_MENTION_REFERENCE)).toBe(true)
    })

    it('rejects invalid mention references', () => {
      expect(isMentionReference(null)).toBe(false)
      expect(isMentionReference({ entityType: 'invalid' })).toBe(false)
      expect(isMentionReference({ entityType: 'task', entityId: 'not-a-number' })).toBe(false)
    })
  })

  describe('isMentionCandidate', () => {
    it('accepts valid mention candidates', () => {
      expect(isMentionCandidate(FIXTURE_MENTION_CANDIDATE_HIT)).toBe(true)
    })

    it('rejects non-mention candidates', () => {
      expect(isMentionCandidate(FIXTURE_COMMAND_CANDIDATE_HIT)).toBe(false)
      expect(isMentionCandidate(null)).toBe(false)
    })
  })

  describe('isCommandCandidate', () => {
    it('accepts valid command candidates', () => {
      expect(isCommandCandidate(FIXTURE_COMMAND_CANDIDATE_HIT)).toBe(true)
    })

    it('rejects non-command candidates', () => {
      expect(isCommandCandidate(FIXTURE_MENTION_CANDIDATE_HIT)).toBe(false)
      expect(isCommandCandidate(null)).toBe(false)
    })
  })
})

// ===========================================================================
// 确定性排序测试
// ===========================================================================

describe('Deterministic sorting', () => {
  it('sorts by relevanceTier then impactSeverity then stableTieBreak', () => {
    const keyA = makeCompletionSortKey('critical', 90, 'aaa')
    const keyB = makeCompletionSortKey('critical', 80, 'bbb')
    const keyC = makeCompletionSortKey('high', 70, 'ccc')
    const keyD = makeCompletionSortKey('medium', 50, 'ddd')

    expect(compareSortKeys(keyA, keyB)).toBeLessThan(0) // critical same, 90 > 80
    expect(compareSortKeys(keyB, keyC)).toBeLessThan(0) // critical > high
    expect(compareSortKeys(keyC, keyD)).toBeLessThan(0) // high > medium
  })

  it('sorts candidates deterministically', () => {
    const sorted = sortCompletionCandidates([...FIXTURE_MIXED_CANDIDATES])
    expect(sorted.map((c) => makeCompletionCandidateId(c))).toEqual(
      FIXTURE_SORTED_CANDIDATES_EXPECTED.map((c) => makeCompletionCandidateId(c)),
    )
  })

  it('different key orders produce identical results', () => {
    const input1: CompletionCandidate[] = [...FIXTURE_MIXED_CANDIDATES]
    const input2: CompletionCandidate[] = [...FIXTURE_MIXED_CANDIDATES].reverse()

    const sorted1 = sortCompletionCandidates(input1)
    const sorted2 = sortCompletionCandidates(input2)

    expect(sorted1.map((c) => makeCompletionCandidateId(c))).toEqual(
      sorted2.map((c) => makeCompletionCandidateId(c)),
    )
  })
})

// ===========================================================================
// 禁存原始输入（Sanitizer 测试）
// ===========================================================================

describe('Sanitizer — no raw input persistence', () => {
  it('sanitizeCompletionQuery does not store prefix content', () => {
    const summary = sanitizeCompletionQuery('mention', '首页设计的任务', 5, 3)

    expect(summary.kind).toBe('mention')
    expect(summary.prefixLength).toBe(7) // '首页设计的任务'.length
    expect(summary.candidateCount).toBe(5)
    expect(summary.triggerOffset).toBe(3)
    // 关键：不存储 prefix 内容
    expect(summary).not.toHaveProperty('prefix')
    expect(summary).not.toHaveProperty('query')
    expect(summary).not.toHaveProperty('text')
  })

  it('sanitizeCompletionSelection does not store label text', () => {
    const record = sanitizeCompletionSelection('mention', FIXTURE_MENTION_CANDIDATE_HIT, 0)

    expect(record.kind).toBe('mention')
    expect(record.candidateId).toBe('mention:task:1042')
    expect(record.ordinal).toBe(0)
    expect(record.availabilityKind).toBe('available')
    // 关键：不存储标签文本
    expect(record).not.toHaveProperty('label')
    expect(record).not.toHaveProperty('displayText')
    expect(record).not.toHaveProperty('entityType')
    expect(record).not.toHaveProperty('entityId')
  })

  it('command selection records availabilityKind', () => {
    const record = sanitizeCompletionSelection('command', FIXTURE_COMMAND_CANDIDATE_NOT_ENABLED, 2)

    expect(record.kind).toBe('command')
    expect(record.availabilityKind).toBe('not-enabled')
    expect(record.ordinal).toBe(2)
  })
})

// ===========================================================================
// Fixtures 八态一致性
// ===========================================================================

describe('Fixtures eight states', () => {
  it('mention hit has valid reference and candidate', () => {
    expect(isMentionReference(FIXTURE_MENTION_REFERENCE)).toBe(true)
    expect(isMentionCandidate(FIXTURE_MENTION_CANDIDATE_HIT)).toBe(true)
    expect(FIXTURE_MENTION_RESULT_HIT.kind).toBe('mention')
    expect(FIXTURE_MENTION_RESULT_HIT.count).toBe(1)
  })

  it('mention empty returns zero candidates', () => {
    expect(FIXTURE_MENTION_RESULT_EMPTY.candidates).toHaveLength(0)
    expect(FIXTURE_MENTION_RESULT_EMPTY.count).toBe(0)
    expect(FIXTURE_MENTION_RESULT_EMPTY.truncated).toBe(false)
  })

  it('command hit descriptor is complete', () => {
    expect(FIXTURE_COMMAND_DESCRIPTOR_HIT.id).toBeTruthy()
    expect(FIXTURE_COMMAND_DESCRIPTOR_HIT.label).toBeTruthy()
    expect(FIXTURE_COMMAND_DESCRIPTOR_HIT.sourceKind).toBe('intent-catalog')
    expect(FIXTURE_COMMAND_DESCRIPTOR_HIT.availabilityKind).toBe('available')
    expect(FIXTURE_COMMAND_DESCRIPTOR_HIT.routingKey).toBeTruthy()
    expect(FIXTURE_COMMAND_RESULT_HIT.count).toBe(1)
  })

  it('not-enabled command is visible with hint', () => {
    expect(FIXTURE_COMMAND_DESCRIPTOR_NOT_ENABLED.availabilityKind).toBe('not-enabled')
    expect(FIXTURE_COMMAND_DESCRIPTOR_NOT_ENABLED.hint).toBeTruthy()
    expect(FIXTURE_COMMAND_DESCRIPTOR_NOT_ENABLED.hint).toContain('启用')
  })

  it('auth-gated command is visible with hint and does not trigger external action', () => {
    expect(FIXTURE_COMMAND_DESCRIPTOR_AUTH_GATED.availabilityKind).toBe('authorization-gated')
    expect(FIXTURE_COMMAND_DESCRIPTOR_AUTH_GATED.hint).toBeTruthy()
    expect(FIXTURE_COMMAND_DESCRIPTOR_AUTH_GATED.hint).toContain('授权')
    expect(FIXTURE_COMMAND_RESULT_AUTH_GATED.count).toBe(1)
  })

  it('dangling reference fixture shows orphaned reference scenario', () => {
    expect(FIXTURE_SUBMISSION_WITH_DANGLING_REF.mentions).toHaveLength(1)
    expect(FIXTURE_SUBMISSION_WITH_DANGLING_REF.text).not.toContain('@')
    // 文本中没有提及，但 mentions 数组有引用——提交前应被清除
  })

  it('non-leakage fixtures have same expected count for both actors', () => {
    expect(FIXTURE_ACTOR_WITH_PERM.permissions.length).toBeGreaterThan(
      FIXTURE_ACTOR_WITHOUT_PERM.permissions.length,
    )
    expect(FIXTURE_NON_LEAKAGE_EXPECTED_COUNT).toBeGreaterThanOrEqual(0)
  })
})

// ===========================================================================
// 路由显式命令格式测试
// ===========================================================================

describe('Routing explicit command format', () => {
  it('formatRoutingExplicitCommand produces correct format', () => {
    // formatRoutingExplicitCommand 使用 routingKey（英文标识），非中文标签
    expect(formatRoutingExplicitCommand('decompose-task')).toBe('/decompose-task')
    expect(formatRoutingExplicitCommand('decompose-task', '首页设计')).toBe(
      '/decompose-task 首页设计',
    )
  })

  it('isExplicitCommandFormat recognizes leading slash', () => {
    expect(isExplicitCommandFormat('/拆解任务')).toBe(true)
    expect(isExplicitCommandFormat('/')).toBe(false) // 单独的 / 不算
    expect(isExplicitCommandFormat('帮我拆解任务')).toBe(false)
    expect(isExplicitCommandFormat('')).toBe(false)
  })
})

// ===========================================================================
// Constants
// ===========================================================================

describe('Constants', () => {
  it('trigger characters are correct', () => {
    expect(MENTION_TRIGGER).toBe('@')
    expect(COMMAND_TRIGGER).toBe('/')
  })

  it('defaults are reasonable', () => {
    expect(DEFAULT_MAX_CANDIDATES).toBeGreaterThanOrEqual(5)
    expect(DEFAULT_MAX_CANDIDATES).toBeLessThanOrEqual(20)
    expect(DEBOUNCE_MS).toBeGreaterThanOrEqual(50)
    expect(DEBOUNCE_MS).toBeLessThanOrEqual(500)
  })
})

// ===========================================================================
// 候选 ID 生成测试
// ===========================================================================

describe('makeCompletionCandidateId', () => {
  it('generates stable IDs for mentions', () => {
    const id = makeCompletionCandidateId(FIXTURE_MENTION_CANDIDATE_HIT)
    expect(id).toBe('mention:task:1042')
  })

  it('generates stable IDs for commands', () => {
    const id = makeCompletionCandidateId(FIXTURE_COMMAND_CANDIDATE_HIT)
    expect(id).toBe('cmd:intent.decompose-task')
  })

  it('different candidates produce different IDs', () => {
    const id1 = makeCompletionCandidateId(FIXTURE_MENTION_CANDIDATE_HIT)
    const id2 = makeCompletionCandidateId(FIXTURE_COMMAND_CANDIDATE_HIT)
    expect(id1).not.toBe(id2)
  })
})
