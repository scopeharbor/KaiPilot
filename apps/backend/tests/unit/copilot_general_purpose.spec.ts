/**
 * v3-copilot-general-purpose-mode —— 后端模式服务与边界守卫测试
 *
 * 覆盖：
 * - 模式判定（permission/capability/quota）
 * - 读隔离（零项目查询）
 * - 写禁守卫（零写入路径）
 * - 记忆 scope 过滤
 * - 上下文清理
 * - 低敏审计
 * - 配额判定
 * - 禁止措辞校验
 */

import { describe, it, expect } from 'vitest'
import {
  evaluateGeneralPurposeMode,
  evaluateQuota,
  isMemoryScopeAllowedInMode,
  filterMemoryForGeneralPurpose,
  shouldExtractProjectMemoryFromGeneralConversation,
  isActionAllowedInGeneralPurposeMode,
  validateAnswerWording,
  buildContextForGeneralPurposeEntry,
  assertGeneralAnswersNotCarriedAsProjectFacts,
  buildAuditEntry,
  GENERAL_PURPOSE_DEFAULT_QUOTA_LIMITS,
} from '../../app/services/copilot_general_purpose/copilot_general_purpose_mode_service.js'

import {
  assertGlobalScopeReadIsolation,
  isSourceEligibleInGlobalScope,
  isDependencyAllowedInGeneralPurposeMode,
  isActionTypeAllowedInGeneralPurpose,
  verifyProjectContextCleared,
  verifyGeneralClaimsNotCarried,
} from '../../app/services/copilot_general_purpose/copilot_general_purpose_boundary_guard.js'

// ===========================================================================
// 模式判定
// ===========================================================================

describe('General Purpose Mode Service — 模式判定', () => {
  const baseInput = {
    userId: 1,
    organizationId: 100,
    message: '什么是敏捷开发？',
    hasAiTriggerPermission: true,
    isCapabilityEnabled: true,
  }

  it('正常条件：answerable=true', () => {
    const result = evaluateGeneralPurposeMode(baseInput)
    expect(result.answerable).toBe(true)
    expect(result.isGeneralPurpose).toBe(true)
  })

  it('无权限：answerable=false, reason=权限不足', () => {
    const result = evaluateGeneralPurposeMode({
      ...baseInput,
      hasAiTriggerPermission: false,
    })
    expect(result.answerable).toBe(false)
    expect(result.unavailabilityReason).toContain('权限')
    expect(result.boundaryResults).toContain('permission_missing')
  })

  it('组织关闭：answerable=false, reason=能力未启用', () => {
    const result = evaluateGeneralPurposeMode({
      ...baseInput,
      isCapabilityEnabled: false,
    })
    expect(result.answerable).toBe(false)
    expect(result.boundaryResults).toContain('capability_disabled')
  })

  it('配额耗尽：answerable=false, reason 包含 quota', () => {
    const result = evaluateGeneralPurposeMode({
      ...baseInput,
      quotaInput: {
        userId: 1,
        organizationId: 100,
        dailyUsageCount: 100,
        dailyLimit: 100,
        dailyTokenUsage: 0,
        tokenDailyLimit: 50_000,
      },
    })
    expect(result.answerable).toBe(false)
    expect(result.quotaStatus).toBe('exhausted')
    expect(result.boundaryResults).toContain('quota_exhausted')
  })
})

// ===========================================================================
// 配额判定
// ===========================================================================

describe('General Purpose Mode Service — 配额', () => {
  it('未超限：sufficient', () => {
    const result = evaluateQuota({
      userId: 1,
      organizationId: 100,
      dailyUsageCount: 50,
      dailyLimit: 100,
      dailyTokenUsage: 10_000,
      tokenDailyLimit: 50_000,
    })
    expect(result.status).toBe('sufficient')
  })

  it('日次数超限：exhausted + daily_limit_reached', () => {
    const result = evaluateQuota({
      userId: 1,
      organizationId: 100,
      dailyUsageCount: 100,
      dailyLimit: 100,
      dailyTokenUsage: 0,
      tokenDailyLimit: 50_000,
    })
    expect(result.status).toBe('exhausted')
    expect(result.reason).toBe('daily_limit_reached')
  })

  it('日 token 超限：exhausted + token_limit_reached', () => {
    const result = evaluateQuota({
      userId: 1,
      organizationId: 100,
      dailyUsageCount: 0,
      dailyLimit: 100,
      dailyTokenUsage: 50_000,
      tokenDailyLimit: 50_000,
    })
    expect(result.status).toBe('exhausted')
    expect(result.reason).toBe('token_limit_reached')
  })

  it('默认配额上界 fallback 存在', () => {
    expect(GENERAL_PURPOSE_DEFAULT_QUOTA_LIMITS.dailyRequestLimit).toBe(100)
    expect(GENERAL_PURPOSE_DEFAULT_QUOTA_LIMITS.dailyTokenLimit).toBe(50_000)
  })
})

// ===========================================================================
// 读隔离
// ===========================================================================

describe('General Purpose Boundary Guard — 读隔离', () => {
  it('assertGlobalScopeReadIsolation 返回 projectQueryIssued=false', () => {
    const result = assertGlobalScopeReadIsolation()
    expect(result.projectQueryIssued).toBe(false)
    expect(result.projectSourcesEligible).toBe(false)
    expect(result.scope).toBe('global')
  })

  it('项目域来源不合格', () => {
    expect(isSourceEligibleInGlobalScope('project_facts')).toBe(false)
    expect(isSourceEligibleInGlobalScope('task')).toBe(false)
    expect(isSourceEligibleInGlobalScope('wbs_node')).toBe(false)
    expect(isSourceEligibleInGlobalScope('risk')).toBe(false)
    expect(isSourceEligibleInGlobalScope('milestone')).toBe(false)
  })

  it('非项目域来源合格', () => {
    expect(isSourceEligibleInGlobalScope('general_knowledge')).toBe(true)
    expect(isSourceEligibleInGlobalScope('help_article')).toBe(true)
    expect(isSourceEligibleInGlobalScope('skill_summary')).toBe(true)
  })
})

// ===========================================================================
// 写禁守卫
// ===========================================================================

describe('General Purpose Boundary Guard — 写禁', () => {
  it('领域仓储依赖不被允许', () => {
    expect(isDependencyAllowedInGeneralPurposeMode('TaskRepository')).toBe(false)
    expect(isDependencyAllowedInGeneralPurposeMode('ProjectModel')).toBe(false)
  })

  it('draft_layer 依赖不被允许', () => {
    expect(isDependencyAllowedInGeneralPurposeMode('draft_layer')).toBe(false)
  })

  it('纯类型/只读依赖被允许', () => {
    expect(isDependencyAllowedInGeneralPurposeMode('AuditService')).toBe(true)
    expect(isDependencyAllowedInGeneralPurposeMode('RbacService')).toBe(true)
  })

  it('动作类型：preview/review-entry/handoff-candidate 被禁止', () => {
    expect(isActionTypeAllowedInGeneralPurpose('preview')).toBe(false)
    expect(isActionTypeAllowedInGeneralPurpose('review-entry')).toBe(false)
    expect(isActionTypeAllowedInGeneralPurpose('handoff-candidate')).toBe(false)
  })

  it('动作类型：navigation/explanation/clarification 被允许', () => {
    expect(isActionTypeAllowedInGeneralPurpose('navigation')).toBe(true)
    expect(isActionTypeAllowedInGeneralPurpose('explanation')).toBe(true)
    expect(isActionTypeAllowedInGeneralPurpose('clarification')).toBe(true)
  })
})

// ===========================================================================
// 记忆 scope
// ===========================================================================

describe('General Purpose Mode — 记忆 scope', () => {
  it('仅 user scope 被允许', () => {
    expect(isMemoryScopeAllowedInMode('user')).toBe(true)
    expect(isMemoryScopeAllowedInMode('project')).toBe(false)
    expect(isMemoryScopeAllowedInMode('organization')).toBe(false)
  })

  it('filterMemoryForGeneralPurpose 移除项目与组织条目', () => {
    const candidates = [
      { scope: 'user', content: '偏好1' },
      { scope: 'project', content: '项目记忆' },
      { scope: 'organization', content: '组织记忆' },
      { scope: 'user', content: '偏好2' },
    ]
    const filtered = filterMemoryForGeneralPurpose(candidates)
    expect(filtered).toHaveLength(2)
    expect(filtered.every((c) => c.scope === 'user')).toBe(true)
  })

  it('通用会话不产生项目记忆', () => {
    expect(shouldExtractProjectMemoryFromGeneralConversation()).toBe(false)
  })
})

// ===========================================================================
// 动作守卫
// ===========================================================================

describe('General Purpose Mode — 动作守卫', () => {
  it('preview 在通用模式下不可用', () => {
    expect(isActionAllowedInGeneralPurposeMode('preview')).toBe(false)
  })

  it('navigation 在通用模式下可用', () => {
    expect(isActionAllowedInGeneralPurposeMode('navigation')).toBe(true)
  })
})

// ===========================================================================
// 上下文清理
// ===========================================================================

describe('General Purpose Mode — 上下文清理', () => {
  it('buildContextForGeneralPurposeEntry 确保项目上下文已清理', () => {
    const ctx = buildContextForGeneralPurposeEntry()
    expect(ctx.scope).toBe('global')
    expect(ctx.projectContextCleared).toBe(true)
    expect(ctx.attributionCleared).toBe(true)
  })

  it('assertGeneralAnswersNotCarriedAsProjectFacts 返回确认', () => {
    const result = assertGeneralAnswersNotCarriedAsProjectFacts()
    expect(result.generalAnswersExcluded).toBe(true)
  })

  it('verifyProjectContextCleared：空上下文已清理', () => {
    const result = verifyProjectContextCleared({})
    expect(result.cleared).toBe(true)
    expect(result.remainingKeys).toHaveLength(0)
  })

  it('verifyProjectContextCleared：含项目 key 未清理', () => {
    const result = verifyProjectContextCleared({ projectId: '123', name: 'test' })
    expect(result.cleared).toBe(false)
    expect(result.remainingKeys).toContain('projectId')
  })

  it('verifyGeneralClaimsNotCarried：无重叠有效', () => {
    const result = verifyGeneralClaimsNotCarried(
      ['敏捷和瀑布的区别', '一般建议'],
      ['项目排期', '任务分配'],
    )
    expect(result.valid).toBe(true)
    expect(result.overlapCount).toBe(0)
  })
})

// ===========================================================================
// 禁止措辞
// ===========================================================================

describe('General Purpose Mode — 禁止措辞', () => {
  it('validateAnswerWording 通过清洁回答', () => {
    expect(validateAnswerWording('这是一般性的建议')).toBeNull()
  })

  it('validateAnswerWording 检测禁止措辞', () => {
    const result = validateAnswerWording('根据您的项目数据，你应该这样做')
    expect(result).toBe('根据您的项目')
  })
})

// ===========================================================================
// 低敏审计
// ===========================================================================

describe('General Purpose Mode — 低敏审计', () => {
  it('buildAuditEntry 不包含 prompt 全文', () => {
    const entry = buildAuditEntry('mode_entered', 1, 100, { capability: 'rewrite' })
    expect(entry.eventType).toBe('mode_entered')
    expect(entry.userId).toBe(1)
    expect(entry.metadata._note).toContain('low-sensitivity')
    expect(entry.metadata.prompt).toBeUndefined()
    expect(entry.metadata.output).toBeUndefined()
  })

  it('buildAuditEntry 包含时间戳', () => {
    const entry = buildAuditEntry('generation_completed', 1, 100)
    expect(entry.timestamp).toBeTruthy()
  })
})

// ===========================================================================
// 成本归属（任务 6.2/6.3/6.5）
// ===========================================================================

describe('General Purpose Mode — 成本归属', () => {
  it('通用模式调用不携带项目归属（task 6.2）：decision 无 projectId', () => {
    const result = evaluateGeneralPurposeMode({
      userId: 1,
      organizationId: 100,
      message: '测试',
      hasAiTriggerPermission: true,
      isCapabilityEnabled: true,
    })
    // 通用模式的 boundaryResults 不包含任何项目相关字段
    expect(result.boundaryResults).toContain('read_isolated')
    expect(result.boundaryResults).toContain('write_forbidden')
    // 通用模式 decision 不携带 projectId 或项目归属
    expect('projectId' in result).toBe(false)
  })

  it('通用模式配额独立于项目预算（task 6.5）：不挪用项目 budget', () => {
    // 通用模式配额由 GENERAL_PURPOSE_DEFAULT_QUOTA_LIMITS 控制
    // 项目预算由 v3-unified-ai-budget-and-quota 控制，两者独立
    const result = evaluateGeneralPurposeMode({
      userId: 1,
      organizationId: 100,
      message: '测试',
      hasAiTriggerPermission: true,
      isCapabilityEnabled: true,
      quotaInput: {
        userId: 1,
        organizationId: 100,
        dailyUsageCount: 0,
        dailyLimit: 100,
        dailyTokenUsage: 0,
        tokenDailyLimit: 50_000,
      },
    })
    expect(result.quotaStatus).toBe('sufficient')
    // 通用模式不引用任何项目 budget 字段
    expect(result.boundaryResults).not.toContain('project_budget_exceeded')
  })

  it('组织级成本聚合可分离：通用模式有独立 capability/surface 标记', () => {
    const result = evaluateGeneralPurposeMode({
      userId: 1,
      organizationId: 100,
      message: '测试',
      hasAiTriggerPermission: true,
      isCapabilityEnabled: true,
    })
    // 通用模式的 decision 结构中无项目 attribution
    // 成本归属通过 capability='general_qa' 和 surface='copilot' 在账本层记录
    expect(result.isGeneralPurpose).toBe(true)
  })
})

// ===========================================================================
// 配额耗尽降级（任务 6.7）
// ===========================================================================

describe('General Purpose Mode — 配额耗尽降级', () => {
  it('耗尽后明确不可用而非降低质量（task 6.7）', () => {
    const result = evaluateGeneralPurposeMode({
      userId: 1,
      organizationId: 100,
      message: '测试',
      hasAiTriggerPermission: true,
      isCapabilityEnabled: true,
      quotaInput: {
        userId: 1,
        organizationId: 100,
        dailyUsageCount: 100,
        dailyLimit: 100,
        dailyTokenUsage: 0,
        tokenDailyLimit: 50_000,
      },
    })
    expect(result.answerable).toBe(false)
    expect(result.quotaStatus).toBe('exhausted')
    // 不是返回 degraded 质量的回答，而是明确不可用
    expect(result.unavailabilityReason).toBeDefined()
    expect(result.unavailabilityReason).toContain('配额')
  })
})
