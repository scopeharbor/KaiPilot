// @aiproj/types — Copilot 通用问答模式契约测试
// v3-copilot-general-purpose-mode — 状态迁移必须显式、未知值拒绝、边界校验拒绝持久化

import { describe, it, expect } from 'vitest'
import {
  GENERAL_PURPOSE_MODE_STATES,
  GENERAL_PURPOSE_MODE_TRANSITIONS,
  isValidGeneralPurposeModeTransition,
  normalizeGeneralPurposeModeState,
  validateGeneralPurposeModeTransition,
  GENERAL_PURPOSE_CAPABILITIES,
  GENERAL_PURPOSE_CAPABILITY_LABELS,
  GENERAL_PURPOSE_BOUNDARY_RESULTS,
  GENERAL_PURPOSE_BOUNDARY_RESULT_LABELS,
  GENERAL_PURPOSE_QUOTA_STATUSES,
  GENERAL_PURPOSE_QUOTA_EXHAUSTION_REASONS,
  GENERAL_PURPOSE_QUOTA_EXHAUSTION_LABELS,
  GENERAL_PURPOSE_PROJECT_FACT_FORBIDDEN_PHRASES,
  GENERAL_PURPOSE_MEMORY_SCOPES,
  GENERAL_PURPOSE_AUDIT_EVENT_TYPES,
  isMemoryScopeAllowedInGeneralPurpose,
  findProjectFactForbiddenPhrase,
  isGeneralPurposeAnswerClean,
  buildKnowledgeLimitation,
  shouldDeclareTimelinessLimitation,
  evaluateGeneralPurposeBoundary,
  generateGeneralPurposeSessionId,
  generateGeneralPurposeMessageId,
} from '../src/copilot-general-purpose.js'

import {
  generalPurposeFixtureNormalQa,
  generalPurposeFixtureQuotaExhausted,
  generalPurposeFixturePermissionMissing,
  generalPurposeFixtureCapabilityDisabled,
  generalPurposeFixtureTimelinessIssue,
  generalPurposeFixtureSwitchCleanup,
} from '../src/copilot-general-purpose-fixtures.js'

// ===========================================================================
// 状态迁移（任务 2.9）
// ===========================================================================

describe('General Purpose Mode — 状态迁移', () => {
  it('合法迁移：entering → active', () => {
    expect(isValidGeneralPurposeModeTransition('entering', 'active')).toBe(true)
  })

  it('合法迁移：entering → exiting', () => {
    expect(isValidGeneralPurposeModeTransition('entering', 'exiting')).toBe(true)
  })

  it('合法迁移：active → exiting', () => {
    expect(isValidGeneralPurposeModeTransition('active', 'exiting')).toBe(true)
  })

  it('非法迁移：active → entering（不可回退）', () => {
    expect(isValidGeneralPurposeModeTransition('active', 'entering')).toBe(false)
  })

  it('非法迁移：exiting → active（退出后不可直接激活）', () => {
    expect(isValidGeneralPurposeModeTransition('exiting', 'active')).toBe(false)
  })

  it('未知状态值被拒绝', () => {
    expect(isValidGeneralPurposeModeTransition('unknown', 'active')).toBe(false)
    expect(isValidGeneralPurposeModeTransition('entering', 'unknown')).toBe(false)
    expect(isValidGeneralPurposeModeTransition(null, 'active')).toBe(false)
    expect(isValidGeneralPurposeModeTransition('entering', undefined)).toBe(false)
  })

  it('归一化函数：已知值返回正确状态', () => {
    expect(normalizeGeneralPurposeModeState('entering')).toBe('entering')
    expect(normalizeGeneralPurposeModeState('active')).toBe('active')
    expect(normalizeGeneralPurposeModeState('exiting')).toBe('exiting')
  })

  it('归一化函数：未知值返回 null', () => {
    expect(normalizeGeneralPurposeModeState('unknown')).toBeNull()
    expect(normalizeGeneralPurposeModeState(null)).toBeNull()
    expect(normalizeGeneralPurposeModeState(42)).toBeNull()
  })

  it('validateGeneralPurposeModeTransition：合法返回 valid', () => {
    const result = validateGeneralPurposeModeTransition('entering', 'active')
    expect(result.valid).toBe(true)
  })

  it('validateGeneralPurposeModeTransition：非法返回拒绝原因', () => {
    const result = validateGeneralPurposeModeTransition('active', 'entering')
    expect(result.valid).toBe(false)
    const failed = result as { valid: false; reason: string }
    expect(failed.reason).toContain('非法迁移')
    expect(failed.reason).toContain('显式用户动作')
  })
})

// ===========================================================================
// 能力集（任务 2.3）
// ===========================================================================

describe('General Purpose Mode — 能力集', () => {
  it('能力集覆盖 8 项', () => {
    expect(GENERAL_PURPOSE_CAPABILITIES).toHaveLength(8)
  })

  it('包含所有必要能力', () => {
    expect(GENERAL_PURPOSE_CAPABILITIES).toContain('rewrite')
    expect(GENERAL_PURPOSE_CAPABILITIES).toContain('polish')
    expect(GENERAL_PURPOSE_CAPABILITIES).toContain('summarize')
    expect(GENERAL_PURPOSE_CAPABILITIES).toContain('translate')
    expect(GENERAL_PURPOSE_CAPABILITIES).toContain('concept_explain')
    expect(GENERAL_PURPOSE_CAPABILITIES).toContain('table')
    expect(GENERAL_PURPOSE_CAPABILITIES).toContain('list')
    expect(GENERAL_PURPOSE_CAPABILITIES).toContain('diagram')
  })
})

// ===========================================================================
// 边界校验（任务 2.10）
// ===========================================================================

describe('General Purpose Mode — 边界校验拒绝持久化', () => {
  it('boundaryResults 不包含任何持久化类动作', () => {
    const decision = evaluateGeneralPurposeBoundary({
      hasPermission: true,
      isCapabilityEnabled: true,
      quotaStatus: 'sufficient',
      isTimeSensitive: false,
      isUncertain: false,
    })

    // 通用模式的 boundaryResults 只应包含隔离/禁止/过滤/配额类
    for (const result of decision.boundaryResults) {
      expect([
        'read_isolated',
        'write_forbidden',
        'memory_scope_filtered',
        'external_retrieval_blocked',
        'quota_sufficient',
        'quota_exhausted',
        'permission_missing',
        'capability_disabled',
      ]).toContain(result)
    }
  })

  it('write_forbidden 始终在边界结果中', () => {
    const decision = evaluateGeneralPurposeBoundary({
      hasPermission: true,
      isCapabilityEnabled: true,
      quotaStatus: 'sufficient',
      isTimeSensitive: false,
      isUncertain: false,
    })
    expect(decision.boundaryResults).toContain('write_forbidden')
  })

  it('read_isolated 始终在边界结果中', () => {
    const decision = evaluateGeneralPurposeBoundary({
      hasPermission: true,
      isCapabilityEnabled: true,
      quotaStatus: 'sufficient',
      isTimeSensitive: false,
      isUncertain: false,
    })
    expect(decision.boundaryResults).toContain('read_isolated')
  })

  it('isGeneralPurpose 恒为 true', () => {
    const decision = evaluateGeneralPurposeBoundary({
      hasPermission: true,
      isCapabilityEnabled: true,
      quotaStatus: 'sufficient',
      isTimeSensitive: false,
      isUncertain: false,
    })
    expect(decision.isGeneralPurpose).toBe(true)
  })
})

// ===========================================================================
// 记忆 scope（任务 2.10 / 3.7）
// ===========================================================================

describe('General Purpose Mode — 记忆 scope', () => {
  it('仅 user scope 被允许', () => {
    expect(isMemoryScopeAllowedInGeneralPurpose('user')).toBe(true)
  })

  it('project scope 被禁止', () => {
    expect(isMemoryScopeAllowedInGeneralPurpose('project')).toBe(false)
  })

  it('organization scope 被禁止', () => {
    expect(isMemoryScopeAllowedInGeneralPurpose('organization')).toBe(false)
  })

  it('未知 scope 被禁止', () => {
    expect(isMemoryScopeAllowedInGeneralPurpose('unknown')).toBe(false)
    expect(isMemoryScopeAllowedInGeneralPurpose(null)).toBe(false)
  })

  it('允许的 scope 列表仅含 user', () => {
    expect(GENERAL_PURPOSE_MEMORY_SCOPES).toEqual(['user'])
  })
})

// ===========================================================================
// 项目事实口吻禁止措辞（任务 2.6）
// ===========================================================================

describe('General Purpose Mode — 禁止措辞', () => {
  it('检测到禁止措辞时返回该措辞', () => {
    const result = findProjectFactForbiddenPhrase('根据您的项目排期，应该在下个月完成')
    expect(result).toBe('根据您的项目')
  })

  it('未检测到禁止措辞时返回 null', () => {
    const result = findProjectFactForbiddenPhrase('一般来说，敏捷项目推荐使用两周冲刺')
    expect(result).toBeNull()
  })

  it('isGeneralPurposeAnswerClean 正确判断', () => {
    expect(isGeneralPurposeAnswerClean('这是一般的建议')).toBe(true)
    expect(isGeneralPurposeAnswerClean('根据项目数据，你应该这样做')).toBe(false)
  })

  it('禁止措辞清单非空', () => {
    expect(GENERAL_PURPOSE_PROJECT_FACT_FORBIDDEN_PHRASES.length).toBeGreaterThan(0)
  })
})

// ===========================================================================
// 知识局限声明（任务 2.7）
// ===========================================================================

describe('General Purpose Mode — 知识局限', () => {
  it('时间敏感问题应声明时效性局限', () => {
    expect(shouldDeclareTimelinessLimitation('今天有什么新闻？')).toBe(true)
    expect(shouldDeclareTimelinessLimitation('2024年发生了什么？')).toBe(true)
    expect(shouldDeclareTimelinessLimitation('最近的趋势是什么？')).toBe(true)
  })

  it('非时间敏感问题不声明', () => {
    expect(shouldDeclareTimelinessLimitation('什么是敏捷开发？')).toBe(false)
    expect(shouldDeclareTimelinessLimitation('请帮我润色这段话')).toBe(false)
  })

  it('buildKnowledgeLimitation 正确构建', () => {
    const limitation = buildKnowledgeLimitation({ isTimeSensitive: true, isUncertain: true })
    expect(limitation.noLiveLookupStated).toBe(true)
    expect(limitation.timelinessDisclaimer).toBeDefined()
    expect(limitation.uncertaintyStated).toBe(true)
  })

  it('非时间敏感不触发声明', () => {
    const limitation = buildKnowledgeLimitation({ isTimeSensitive: false, isUncertain: false })
    expect(limitation.noLiveLookupStated).toBe(false)
    expect(limitation.timelinessDisclaimer).toBeUndefined()
    expect(limitation.uncertaintyStated).toBe(false)
  })
})

// ===========================================================================
// 配额判定（任务 2.5）
// ===========================================================================

describe('General Purpose Mode — 配额', () => {
  it('配额状态枚举覆盖 sufficient 和 exhausted', () => {
    expect(GENERAL_PURPOSE_QUOTA_STATUSES).toEqual(['sufficient', 'exhausted'])
  })

  it('耗尽降级原因枚举非空', () => {
    expect(GENERAL_PURPOSE_QUOTA_EXHAUSTION_REASONS.length).toBeGreaterThan(0)
  })

  it('配额耗尽时 decision 包含原因', () => {
    const decision = evaluateGeneralPurposeBoundary({
      hasPermission: true,
      isCapabilityEnabled: true,
      quotaStatus: 'exhausted',
      quotaExhaustionReason: 'daily_limit_reached',
      isTimeSensitive: false,
      isUncertain: false,
    })
    expect(decision.quotaStatus).toBe('exhausted')
    expect(decision.quotaExhaustionReason).toBe('daily_limit_reached')
  })
})

// ===========================================================================
// Fixtures 一致性（任务 2.8）
// ===========================================================================

describe('General Purpose Mode — Fixtures', () => {
  it('正常问答 fixture 结构完整', () => {
    const fixture = generalPurposeFixtureNormalQa()
    expect(fixture.state).toBe('active')
    expect(fixture.decision.isGeneralPurpose).toBe(true)
    expect(fixture.response.answer).toBeTruthy()
    expect(fixture.response.quotaStatus).toBe('sufficient')
  })

  it('配额耗尽 fixture 结构完整', () => {
    const fixture = generalPurposeFixtureQuotaExhausted()
    expect(fixture.decision.quotaStatus).toBe('exhausted')
    expect(fixture.response.quotaStatus).toBe('exhausted')
    expect(fixture.response.quotaExhaustionReason).toBe('daily_limit_reached')
  })

  it('无权限 fixture 结构完整', () => {
    const fixture = generalPurposeFixturePermissionMissing()
    expect(fixture.decision.boundaryResults).toContain('permission_missing')
  })

  it('组织已关闭 fixture 结构完整', () => {
    const fixture = generalPurposeFixtureCapabilityDisabled()
    expect(fixture.decision.boundaryResults).toContain('capability_disabled')
  })

  it('时效性问题 fixture 结构完整', () => {
    const fixture = generalPurposeFixtureTimelinessIssue()
    expect(fixture.decision.knowledgeLimitation.noLiveLookupStated).toBe(true)
    expect(fixture.response.knowledgeLimitation.timelinessDisclaimer).toBeDefined()
  })

  it('切换清理 fixture 结构完整', () => {
    const fixture = generalPurposeFixtureSwitchCleanup()
    expect(fixture.entering.previousProjectContext.projectId).toBeTruthy()
    expect(fixture.leaving.projectFactsAfterSwitch).toHaveLength(0)
  })
})

// ===========================================================================
// ID 生成器（任务 2.1）
// ===========================================================================

describe('General Purpose Mode — ID 生成', () => {
  it('会话 ID 以 gp- 开头', () => {
    const id = generateGeneralPurposeSessionId()
    expect(id).toMatch(/^gp-/)
  })

  it('消息 ID 以 gp-msg- 开头', () => {
    const id = generateGeneralPurposeMessageId('gp-session-001', 0)
    expect(id).toMatch(/^gp-msg-/)
  })

  it('同 session 同 index 生成相同消息 ID（确定性）', () => {
    const id1 = generateGeneralPurposeMessageId('gp-session-001', 0)
    const id2 = generateGeneralPurposeMessageId('gp-session-001', 0)
    expect(id1).toBe(id2)
  })
})

// ===========================================================================
// 审计事件类型（任务 8.5）
// ===========================================================================

describe('General Purpose Mode — 审计', () => {
  it('审计事件类型覆盖 6 类', () => {
    expect(GENERAL_PURPOSE_AUDIT_EVENT_TYPES).toHaveLength(6)
  })

  it('包含所有必要审计事件', () => {
    expect(GENERAL_PURPOSE_AUDIT_EVENT_TYPES).toContain('mode_entered')
    expect(GENERAL_PURPOSE_AUDIT_EVENT_TYPES).toContain('mode_exited')
    expect(GENERAL_PURPOSE_AUDIT_EVENT_TYPES).toContain('generation_completed')
    expect(GENERAL_PURPOSE_AUDIT_EVENT_TYPES).toContain('generation_failed')
    expect(GENERAL_PURPOSE_AUDIT_EVENT_TYPES).toContain('quota_exhausted')
    expect(GENERAL_PURPOSE_AUDIT_EVENT_TYPES).toContain('unauthorized_attempt')
  })
})

// ===========================================================================
// 边界校验结果（任务 2.4）
// ===========================================================================

describe('General Purpose Mode — 边界校验结果', () => {
  it('边界校验结果枚举覆盖 8 类', () => {
    expect(GENERAL_PURPOSE_BOUNDARY_RESULTS).toHaveLength(8)
  })

  it('包含所有隔离/禁止类', () => {
    expect(GENERAL_PURPOSE_BOUNDARY_RESULTS).toContain('read_isolated')
    expect(GENERAL_PURPOSE_BOUNDARY_RESULTS).toContain('write_forbidden')
    expect(GENERAL_PURPOSE_BOUNDARY_RESULTS).toContain('memory_scope_filtered')
    expect(GENERAL_PURPOSE_BOUNDARY_RESULTS).toContain('external_retrieval_blocked')
  })
})

// ===========================================================================
// 中文输出可读性与格式（task 5.8）
// ===========================================================================

/**
 * 简体中文标签断言：必须含中文正文，且除中文标点、数字与**保留技术术语**
 * （token / scope 等按项目语言约定保持原形）外不得夹带其它字符。
 * 不强制「纯中文」——那会把合法术语判成违规；也不强制含「：」——单段标签同样合法。
 */
function expectSimplifiedChineseLabel(label: string): void {
  expect(label.length).toBeGreaterThan(0)
  expect(label).toMatch(/[一-鿿]/)
  // 允许：中文、CJK 标点（　-〿）、全角标点如「：」（＀-￯）、术语用 ASCII
  expect(label).not.toMatch(/[^一-鿿　-〿＀-￯A-Za-z0-9 _.:%-]/)
}

describe('General Purpose Mode — 中文输出可读性', () => {
  it('能力标签全部为简体中文', () => {
    const labels = Object.values(GENERAL_PURPOSE_CAPABILITY_LABELS)
    for (const label of labels) {
      expect(label).toMatch(/^[\u4e00-\u9fff]+$/) // 纯中文字符
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('边界校验结果标签全部为简体中文', () => {
    const labels = Object.values(GENERAL_PURPOSE_BOUNDARY_RESULT_LABELS)
    for (const label of labels) {
      expectSimplifiedChineseLabel(label)
    }
  })

  it('配额耗尽原因标签全部为简体中文', () => {
    const labels = Object.values(GENERAL_PURPOSE_QUOTA_EXHAUSTION_LABELS)
    for (const label of labels) {
      expectSimplifiedChineseLabel(label)
    }
  })

  it('禁止措辞全部为简体中文', () => {
    for (const phrase of GENERAL_PURPOSE_PROJECT_FACT_FORBIDDEN_PHRASES) {
      expect(phrase).toMatch(/^[\u4e00-\u9fff]+$/)
    }
  })

  it('fixture 中文回答可读', () => {
    const normalFixture = generalPurposeFixtureNormalQa()
    expect(normalFixture.response.answer).toBeTruthy()
    expect(normalFixture.response.answer.length).toBeGreaterThan(0)

    const quotaFixture = generalPurposeFixtureQuotaExhausted()
    expect(quotaFixture.response.answer).toContain('配额')
    expect(quotaFixture.response.answer).toContain('通用问答')

    const timeFixture = generalPurposeFixtureTimelinessIssue()
    expect(timeFixture.response.answer).toContain('实时外部检索')
  })

  it('知识局限声明为简体中文', () => {
    const limitation = buildKnowledgeLimitation({ isTimeSensitive: true, isUncertain: false })
    expect(limitation.timelinessDisclaimer).toContain('模型知识')
    expect(limitation.timelinessDisclaimer).toContain('实时外部检索')
  })
})

// ===========================================================================
// 模型不可用降级表述（task 7.7）
// ===========================================================================

describe('General Purpose Mode — 模型不可用降级', () => {
  it('配额耗尽时返回明确不可用原因而非降低质量', () => {
    const fixture = generalPurposeFixtureQuotaExhausted()
    expect(fixture.response.quotaStatus).toBe('exhausted')
    expect(fixture.response.quotaExhaustionReason).toBe('daily_limit_reached')
    // 回答应包含不可用说明，而非一个质量降低的回答
    expect(fixture.response.answer).toContain('配额')
    expect(fixture.response.answer).toContain('上限')
  })

  it('无权限时表述为权限不足', () => {
    const fixture = generalPurposeFixturePermissionMissing()
    expect(fixture.decision.boundaryResults).toContain('permission_missing')
    // 无权限时不泄露更多信息（spec: revealing nothing beyond that fact）
  })

  it('组织关闭时表述为能力未启用', () => {
    const fixture = generalPurposeFixtureCapabilityDisabled()
    expect(fixture.decision.boundaryResults).toContain('capability_disabled')
    // 组织关闭时存在性不保密（spec: existence is not confidential）
  })
})
