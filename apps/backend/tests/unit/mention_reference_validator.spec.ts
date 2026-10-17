/**
 * v3-copilot-mentions-and-slash-commands —— 服务端提及引用复核测试。
 *
 * 验证：
 * - 格式合法性校验
 * - 组织隔离校验
 * - 伪造引用被拒绝（任务 5.6）
 * - 孤儿引用被清除（任务 5.2）
 * - 提及不扩大上下文层合格范围（任务 5.7）
 * - 批量校验的 allGranted 聚合
 */

import { describe, it, expect } from 'vitest'
import {
  validateSingleMentionRef,
  validateMentionRefs,
  pruneOrphanRefs,
  doesMentionWidenContextEligibility,
} from '../../app/services/copilot_action/mention_reference_validator.js'
import type { MentionReference } from '@aiproj/types'

const VALID_REF: MentionReference = {
  entityType: 'task',
  entityId: 1042,
  label: '首页设计（T-1042）',
  organizationId: 1,
  projectId: 100,
}

const CROSS_ORG_REF: MentionReference = {
  entityType: 'task',
  entityId: 2000,
  label: '其他组织的任务',
  organizationId: 999, // 不同组织
}

describe('validateSingleMentionRef', () => {
  it('accepts valid reference with matching organization', () => {
    const result = validateSingleMentionRef(VALID_REF, 1)
    expect(result.granted).toBe(true)
  })

  it('rejects reference with mismatched organization', () => {
    const result = validateSingleMentionRef(CROSS_ORG_REF, 1)
    expect(result.granted).toBe(false)
    expect(result.reason).toBe('organization-mismatch')
  })

  it('rejects structurally invalid forged references', () => {
    // 格式校验拒绝缺少必填字段的伪造引用
    const forged = { entityType: 'task', entityId: 999 } // 缺少 label 和 organizationId
    const result = validateSingleMentionRef(forged, 1)
    expect(result.granted).toBe(false)
    expect(result.reason).toBe('invalid-reference-format')
  })

  it('rejects references with wrong entity type', () => {
    const forged = { entityType: 'admin', entityId: 1, label: 'x', organizationId: 1 }
    const result = validateSingleMentionRef(forged, 1)
    expect(result.granted).toBe(false)
  })

  it('rejects null and undefined', () => {
    expect(validateSingleMentionRef(null, 1).granted).toBe(false)
    expect(validateSingleMentionRef(undefined, 1).granted).toBe(false)
  })

  it('rejects references with invalid entity type', () => {
    const bad = { entityType: 'invalid_type', entityId: 1, label: 'x', organizationId: 1 }
    const result = validateSingleMentionRef(bad, 1)
    expect(result.granted).toBe(false)
  })

  it('rejects references with non-number entityId', () => {
    const bad = { entityType: 'task', entityId: 'not-a-number', label: 'x', organizationId: 1 }
    const result = validateSingleMentionRef(bad, 1)
    expect(result.granted).toBe(false)
  })
})

describe('validateMentionRefs', () => {
  it('all valid references pass', () => {
    const result = validateMentionRefs([VALID_REF], 1)
    expect(result.allGranted).toBe(true)
    expect(result.rejectedCount).toBe(0)
    expect(result.checks).toHaveLength(1)
  })

  it('mixed valid and invalid references report correctly', () => {
    const bad = { entityType: 'task', entityId: 1 } // 缺少 label 和 organizationId
    const result = validateMentionRefs([VALID_REF, CROSS_ORG_REF, bad], 1)
    expect(result.allGranted).toBe(false)
    expect(result.rejectedCount).toBe(2) // cross-org + bad format
    expect(result.checks).toHaveLength(3)
  })

  it('empty list is valid', () => {
    const result = validateMentionRefs([], 1)
    expect(result.allGranted).toBe(true)
    expect(result.rejectedCount).toBe(0)
  })
})

describe('pruneOrphanRefs', () => {
  it('keeps references whose label appears in text', () => {
    const text = '帮我分析一下 @首页设计（T-1042） 这个任务'
    const result = pruneOrphanRefs(text, [VALID_REF])
    expect(result).toHaveLength(1)
    expect(result[0].entityId).toBe(1042)
  })

  it('removes references whose label does not appear in text', () => {
    const text = '帮我分析一下这个项目' // 没有提及文本
    const result = pruneOrphanRefs(text, [VALID_REF])
    expect(result).toHaveLength(0)
  })

  it('handles multiple references with partial orphaning', () => {
    const ref2: MentionReference = {
      entityType: 'milestone',
      entityId: 500,
      label: '里程碑 Alpha',
      organizationId: 1,
    }
    const text = '分析 @首页设计（T-1042）' // 只有 ref1 的标签
    const result = pruneOrphanRefs(text, [VALID_REF, ref2])
    expect(result).toHaveLength(1)
    expect(result[0].entityId).toBe(1042)
  })

  it('empty text removes all references', () => {
    const result = pruneOrphanRefs('', [VALID_REF])
    expect(result).toHaveLength(0)
  })
})

describe('doesMentionWidenContextEligibility', () => {
  it('always returns false — mentions do not widen context', () => {
    // spec Requirement 9 Scenario 2
    expect(doesMentionWidenContextEligibility()).toBe(false)
  })
})
