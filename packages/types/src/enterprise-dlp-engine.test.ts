/**
 * v3-enterprise-dlp-engine — 企业级 DLP 共享契约测试。
 *
 * 覆盖：稳定 hash、未知 action 拒绝、强制规则守卫、脱敏、扫描边界、无依赖导入。
 */

import { describe, expect, it } from 'vitest'
import {
  // 类型守卫
  isDlpAction,
  isDlpRuleId,
  isDlpWarningCode,
  isDlpDeclaredAction,
  isDlpEventType,
  isDlpConfirmationStatus,
  isDlpDecisionResult,
  isDlpRedactionMode,
  isDlpContentCategory,
  isDlpPolicyScope,
  isDlpSeverity,
  isDlpRuleCategory,

  // 纯函数
  fnv1aHash,
  computeStableSignature,
  computePolicyHash,
  computeDecisionHash,
  computePreviewSignature,
  computeSourceHash,
  isValidDlpAction,
  isKnownAction,
  findViolatedMandatoryRules,
  findWeakenedMandatoryRules,
  isPasswordFieldName,
  isForbiddenKey,
  maskIdCard,
  maskPhone,
  maskBankCard,
  maskEmail,
  maskCredential,
  maskPasswordField,
  redactByMode,
  buildScanInput,
  validateScanBounds,
  validateBatchBounds,
  resolvePolicy,
  buildRuleCatalogEntry,
  buildDlpEventEntry,
  getDefaultRuleDefinition,
  getRuleCatalog,
  requiresConfirmation,
  isHighRiskAction,

  // 常量
  DLP_RULE_IDS,
  DLP_MANDATORY_RULES,
  DLP_ACTIONS,
  DLP_WARNING_CODES,
  DLP_EVENT_TYPES,
  DLP_CONFIRMATION_STATUSES,
  DLP_DECLARED_ACTIONS,
  DLP_MAX_SCAN_TEXT_LENGTH,
  DLP_MAX_BATCH_SIZE,

  // 类型
  type DlpRuleDefinition,
  type DlpAction,
  type DlpRuleId,
} from './enterprise-dlp-engine.js'
import {
  buildSystemDefaultPolicy,
  buildOrganizationPolicy,
  buildProjectOverridePolicy,
  buildStrictPolicy,
  buildScanInput as buildDlpScanInput,
  buildMatchSummary,
  buildDecisionsnapshot,
  dlpBuildBlockDecision,
  dlpBuildMaskDecision,
  dlpBuildConfirmRequiredDecision,
  buildPreviewSignature,
  buildConfirmationRequest,
  buildConfirmedResult,
  buildStaleConfirmationResult,
  buildDlpEvent,
  buildCrossOrganizationPolicyRequest,
  buildProjectOverride,
  buildUnsafeOverride,
  buildEmptyEventList,
  buildEventList,
} from './enterprise-dlp-engine-fixtures.js'

describe('DLP 共享契约 — 稳定 hash', () => {
  it('fnv1aHash 产生确定性结果', () => {
    expect(fnv1aHash('test')).toBe(fnv1aHash('test'))
    expect(fnv1aHash('test')).not.toBe(fnv1aHash('Test'))
  })

  it('computeStableSignature 忽略键顺序', () => {
    const a = computeStableSignature({ b: 2, a: 1 })
    const b = computeStableSignature({ a: 1, b: 2 })
    expect(a).toBe(b)
  })

  it('computePolicyHash 相同策略相同 hash', () => {
    const hash1 = computePolicyHash({
      enabledRules: ['pii_phone', 'credential_api_key'],
      ruleActions: { pii_phone: 'mask', credential_api_key: 'block' },
      scope: 'organization',
      organizationId: 1,
    })
    const hash2 = computePolicyHash({
      enabledRules: ['credential_api_key', 'pii_phone'],
      ruleActions: { credential_api_key: 'block', pii_phone: 'mask' },
      scope: 'organization',
      organizationId: 1,
    })
    expect(hash1).toBe(hash2)
  })

  it('computePolicyHash 不同范围不同 hash', () => {
    const hash1 = computePolicyHash({
      enabledRules: ['pii_phone'],
      ruleActions: { pii_phone: 'mask' },
      scope: 'organization',
      organizationId: 1,
    })
    const hash2 = computePolicyHash({
      enabledRules: ['pii_phone'],
      ruleActions: { pii_phone: 'mask' },
      scope: 'system',
      organizationId: 1,
    })
    expect(hash1).not.toBe(hash2)
  })

  it('computeDecisionHash 产生确定性 hash', () => {
    const hash1 = computeDecisionHash({
      actorId: 1,
      organizationId: 1,
      projectId: null,
      action: 'download',
      sourceHash: 'abc',
      policyHash: 'def',
      visibilityEvidence: 'allowed:file:view',
    })
    const hash2 = computeDecisionHash({
      actorId: 1,
      organizationId: 1,
      projectId: null,
      action: 'download',
      sourceHash: 'abc',
      policyHash: 'def',
      visibilityEvidence: 'allowed:file:view',
    })
    expect(hash1).toBe(hash2)
  })
})

describe('DLP 共享契约 — 未知 action 拒绝', () => {
  it('isValidDlpAction 拒绝未知值', () => {
    expect(isValidDlpAction('unknown_action')).toBe(false)
    expect(isValidDlpAction('block')).toBe(true)
    expect(isValidDlpAction('mask')).toBe(true)
  })

  it('isKnownAction 拒绝未知声明动作', () => {
    expect(isKnownAction('unknown_action')).toBe(false)
    expect(isKnownAction('download')).toBe(true)
    expect(isKnownAction('upload')).toBe(true)
  })

  it('类型守卫拒绝非法值', () => {
    expect(isDlpRuleId('invalid_rule')).toBe(false)
    expect(isDlpRuleId('pii_phone')).toBe(true)
    expect(isDlpAction('invalid_action')).toBe(false)
    expect(isDlpAction('block')).toBe(true)
    expect(isDlpWarningCode('INVALID_CODE')).toBe(false)
    expect(isDlpWarningCode('DLP_UNAVAILABLE')).toBe(true)
    expect(isDlpDeclaredAction('fly')).toBe(false)
    expect(isDlpDeclaredAction('download')).toBe(true)
    expect(isDlpEventType('nonexistent')).toBe(false)
    expect(isDlpEventType('policy_update')).toBe(true)
    expect(isDlpConfirmationStatus('unknown')).toBe(false)
    expect(isDlpConfirmationStatus('confirmed')).toBe(true)
    expect(isDlpDecisionResult('unknown')).toBe(false)
    expect(isDlpDecisionResult('block')).toBe(true)
    expect(isDlpRedactionMode('full')).toBe(false)
    expect(isDlpRedactionMode('full_mask')).toBe(true)
    expect(isDlpContentCategory('pdf')).toBe(false)
    expect(isDlpContentCategory('file_safe_text')).toBe(true)
    expect(isDlpPolicyScope('global')).toBe(false)
    expect(isDlpPolicyScope('organization')).toBe(true)
    expect(isDlpSeverity('extreme')).toBe(false)
    expect(isDlpSeverity('critical')).toBe(true)
    expect(isDlpRuleCategory('secret')).toBe(false)
    expect(isDlpRuleCategory('pii')).toBe(true)
  })
})

describe('DLP 共享契约 — 强制规则守卫', () => {
  it('findViolatedMandatoryRules 检测缺失的强制规则', () => {
    const violated = findViolatedMandatoryRules(['pii_phone', 'pii_email'])
    expect(violated).toContain('credential_api_key')
    expect(violated).toContain('credential_token')
    expect(violated).toContain('credential_password_field')
    expect(violated).toContain('credential_authorization_header')
  })

  it('findViolatedMandatoryRules 全部启用时返回空', () => {
    const violated = findViolatedMandatoryRules([...DLP_MANDATORY_RULES])
    expect(violated).toHaveLength(0)
  })

  it('findWeakenedMandatoryRules 检测非 block 动作', () => {
    const weakened = findWeakenedMandatoryRules([...DLP_MANDATORY_RULES], {
      credential_api_key: 'allow',
      credential_token: 'block',
    } as Partial<Record<DlpRuleId, DlpAction>>)
    expect(weakened).toContain('credential_api_key')
    expect(weakened).not.toContain('credential_token')
  })
})

describe('DLP 共享契约 — 脱敏', () => {
  it('maskIdCard 保留前6后4', () => {
    expect(maskIdCard('110101199001011234')).toBe('110101****1234')
  })

  it('maskPhone 保留前3后4', () => {
    expect(maskPhone('13800138000')).toBe('138****8000')
  })

  it('maskBankCard 保留前4后4', () => {
    expect(maskBankCard('6222021234561234')).toBe('6222****1234')
  })

  it('maskEmail 保留前2+域名', () => {
    const masked = maskEmail('testuser@example.com')
    expect(masked).toContain('@example.com')
    expect(masked).toContain('***')
    expect(masked.startsWith('te')).toBe(true)
  })

  it('maskCredential 保留前4后4', () => {
    expect(maskCredential('sk-abcdefgh12345678')).toBe('sk-a****5678')
  })

  it('maskPasswordField 返回全掩码', () => {
    expect(maskPasswordField()).toBe('********')
  })

  it('redactByMode 按模式处理', () => {
    expect(redactByMode('testvalue', 'full_mask')).toBe('********')
    expect(redactByMode('testvalue', 'hash_only')).toBe(fnv1aHash('testvalue'))
    expect(redactByMode('testvalue', 'no_redaction')).toBe('testvalue')
    expect(redactByMode('testvalue', 'mask_prefix')).toBe('****alue')
    expect(redactByMode('testvalue', 'mask_suffix')).toBe('test****')
  })

  it('isPasswordFieldName 大小写不敏感', () => {
    expect(isPasswordFieldName('password')).toBe(true)
    expect(isPasswordFieldName('Password')).toBe(true)
    expect(isPasswordFieldName('PASSWORD')).toBe(true)
    expect(isPasswordFieldName('normalField')).toBe(false)
  })

  it('isForbiddenKey 大小写不敏感', () => {
    expect(isForbiddenKey('apiKey')).toBe(true)
    expect(isForbiddenKey('apikey')).toBe(true)
    expect(isForbiddenKey('safeKey')).toBe(false)
  })
})

describe('DLP 共享契约 — 扫描边界', () => {
  it('validateScanBounds 检测超长文本', () => {
    const input = buildDlpScanInput({
      text: 'x'.repeat(DLP_MAX_SCAN_TEXT_LENGTH + 1),
      textLength: DLP_MAX_SCAN_TEXT_LENGTH + 1,
    })
    const warnings = validateScanBounds(input)
    expect(warnings).toContain('SCAN_INPUT_TOO_LARGE')
  })

  it('validateScanBounds 正常输入无警告', () => {
    const input = buildDlpScanInput({ text: 'short text' })
    const warnings = validateScanBounds(input)
    expect(warnings).toHaveLength(0)
  })

  it('validateBatchBounds 检测超限批量', () => {
    const warnings = validateBatchBounds(DLP_MAX_BATCH_SIZE + 1)
    expect(warnings).toContain('SCAN_BATCH_LIMIT_EXCEEDED')
  })

  it('validateBatchBounds 正常批量无警告', () => {
    const warnings = validateBatchBounds(10)
    expect(warnings).toHaveLength(0)
  })

  it('buildScanInput 自动计算长度', () => {
    const input = buildDlpScanInput({ text: 'test content' })
    expect(input.textLength).toBe(12)
    expect(input.itemCount).toBe(1)
  })
})

describe('DLP 共享契约 — 策略解析', () => {
  it('resolvePolicy 合并系统默认+组织+项目', () => {
    const result = resolvePolicy({
      systemDefaultEnabledRules: ['pii_phone', 'pii_email', 'credential_api_key'],
      systemDefaultRuleActions: {
        pii_phone: 'mask',
        pii_email: 'mask',
        credential_api_key: 'block',
      },
      organizationEnabledRules: null,
      organizationRuleActions: null,
      projectOverrideEnabledRules: null,
      projectOverrideRuleActions: null,
      organizationId: 1,
      scope: 'system',
    })
    expect(result.enabledRules).toContain('credential_api_key')
    expect(result.enabledRules).toContain('pii_phone')
    expect(result.policyHash).toBeTruthy()
  })

  it('resolvePolicy 强制规则不可被禁用', () => {
    const result = resolvePolicy({
      systemDefaultEnabledRules: [],
      systemDefaultRuleActions: {},
      organizationEnabledRules: [],
      organizationRuleActions: {},
      projectOverrideEnabledRules: [],
      projectOverrideRuleActions: {},
      organizationId: 1,
      scope: 'organization',
    })
    for (const rule of DLP_MANDATORY_RULES) {
      expect(result.enabledRules).toContain(rule)
      expect(result.actionMatrix[rule]).toBe('block')
    }
  })

  it('resolvePolicy 项目覆盖保留强制规则', () => {
    const result = resolvePolicy({
      systemDefaultEnabledRules: ['pii_phone'],
      systemDefaultRuleActions: { pii_phone: 'mask' },
      organizationEnabledRules: ['pii_phone', 'pii_email'],
      organizationRuleActions: { pii_phone: 'mask', pii_email: 'mask' },
      projectOverrideEnabledRules: ['pii_phone'],
      projectOverrideRuleActions: { pii_phone: 'mask' },
      organizationId: 1,
      scope: 'project',
    })
    for (const rule of DLP_MANDATORY_RULES) {
      expect(result.enabledRules).toContain(rule)
    }
  })
})

describe('DLP 共享契约 — 规则目录', () => {
  it('getRuleCatalog 返回全部规则', () => {
    const catalog = getRuleCatalog()
    expect(catalog).toHaveLength(DLP_RULE_IDS.length)
  })

  it('getDefaultRuleDefinition 返回正确定义', () => {
    const rule = getDefaultRuleDefinition('credential_api_key')
    expect(rule.severity).toBe('critical')
    expect(rule.isMandatory).toBe(true)
    expect(rule.defaultAction).toBe('block')
  })

  it('requiresConfirmation 判断正确', () => {
    expect(requiresConfirmation('warn_confirm')).toBe(true)
    expect(requiresConfirmation('mask_confirm')).toBe(true)
    expect(requiresConfirmation('block')).toBe(false)
    expect(requiresConfirmation('allow')).toBe(false)
  })

  it('isHighRiskAction 判断正确', () => {
    expect(isHighRiskAction('bulk_export')).toBe(true)
    expect(isHighRiskAction('bulk_download')).toBe(true)
    expect(isHighRiskAction('ai_context_assembly')).toBe(true)
    expect(isHighRiskAction('download')).toBe(false)
  })
})

describe('DLP 共享契约 — 事件构造', () => {
  it('buildDlpEventEntry 只含低敏字段', () => {
    const event = buildDlpEventEntry({
      organizationId: 1,
      projectId: null,
      actorId: 1,
      eventType: 'decision_blocked',
      action: 'download',
      result: 'block',
      ruleIds: ['credential_api_key'],
      severityCounts: { critical: 1 },
      decisionHash: 'abc',
      policyHash: 'def',
      sourceHash: 'ghi',
      previewSignature: null,
      warningCodes: [],
    })
    expect(event.organizationId).toBe(1)
    expect(event.ruleIds).toEqual(['credential_api_key'])
    expect(event.severityCounts).toEqual({ critical: 1 })
    expect(event.warningCodes).toEqual([])
  })
})

describe('DLP 共享契约 — 无依赖导入', () => {
  it('导入不依赖 AdonisJS、React 或外部服务', () => {
    // 纯函数模块，应该在导入时不会抛出运行时错误
    expect(typeof fnv1aHash).toBe('function')
    expect(typeof computeStableSignature).toBe('function')
    expect(typeof isDlpAction).toBe('function')
    expect(Array.isArray(DLP_RULE_IDS)).toBe(true)
    expect(Array.isArray(DLP_ACTIONS)).toBe(true)
    expect(Array.isArray(DLP_WARNING_CODES)).toBe(true)
    expect(Array.isArray(DLP_EVENT_TYPES)).toBe(true)
    expect(Array.isArray(DLP_CONFIRMATION_STATUSES)).toBe(true)
    expect(Array.isArray(DLP_DECLARED_ACTIONS)).toBe(true)
  })
})

describe('DLP 共享契约 — Fixtures', () => {
  it('buildSystemDefaultPolicy 构造系统默认策略', () => {
    const policy = buildSystemDefaultPolicy()
    expect(policy.effectiveScope).toBe('system')
    expect(policy.enabledRuleCount).toBeGreaterThan(0)
    expect(policy.policyHash).toBeTruthy()
  })

  it('buildOrganizationPolicy 构造组织策略', () => {
    const policy = buildOrganizationPolicy()
    expect(policy.effectiveScope).toBe('organization')
    expect(policy.policyHash).toBeTruthy()
  })

  it('buildProjectOverridePolicy 构造项目覆盖', () => {
    const policy = buildProjectOverridePolicy()
    expect(policy.effectiveScope).toBe('project')
  })

  it('buildStrictPolicy 全部 block', () => {
    const policy = buildStrictPolicy()
    for (const action of Object.values(policy.actionMatrix)) {
      expect(action).toBe('block')
    }
  })

  it('buildDecisionsnapshot 产生有效决策', () => {
    const decision = buildDecisionsnapshot()
    expect(decision.decisionHash).toBeTruthy()
    expect(decision.result).toBe('allow')
  })

  it('buildBlockDecision 阻断决策', () => {
    const decision = dlpBuildBlockDecision()
    expect(decision.result).toBe('block')
    expect(decision.reasonCodes).toContain('CRITICAL_CREDENTIAL_MATCH')
  })

  it('buildMaskDecision 脱敏决策', () => {
    const decision = dlpBuildMaskDecision()
    expect(decision.result).toBe('mask')
  })

  it('buildConfirmRequiredDecision 需要确认', () => {
    const decision = dlpBuildConfirmRequiredDecision()
    expect(decision.result).toBe('warn_confirm')
    expect(decision.requiredFollowUp).toBe('warn_confirm')
  })

  it('buildPreviewSignature 产生有效签名', () => {
    const preview = buildPreviewSignature()
    expect(preview.signature).toBeTruthy()
    expect(preview.requiresConfirmation).toBe(true)
  })

  it('buildConfirmationRequest 构造确认请求', () => {
    const request = buildConfirmationRequest()
    expect(request.previewSignature).toBeTruthy()
    expect(request.actorId).toBe(1)
  })

  it('buildConfirmedResult vs stale', () => {
    const confirmed = buildConfirmedResult()
    expect(confirmed.status).toBe('confirmed')
    const stale = buildStaleConfirmationResult()
    expect(stale.status).toBe('stale')
  })

  it('buildDlpEvent 构造低敏事件', () => {
    const event = buildDlpEvent()
    expect(event.ruleIds).toHaveLength(1)
    expect(event.severityCounts).toEqual({ critical: 1 })
  })

  it('buildCrossOrganizationPolicyRequest 跨组织', () => {
    const req = buildCrossOrganizationPolicyRequest()
    expect(req.policyHash).toBeTruthy()
  })

  it('buildProjectOverride 构造覆盖', () => {
    const override = buildProjectOverride()
    expect(override.projectId).toBe(1)
    expect(override.policyHash).toBeTruthy()
  })

  it('buildUnsafeOverride 禁用强制规则', () => {
    const unsafe = buildUnsafeOverride()
    const mandatoryInOverride = unsafe.enabledRules.filter((r) => DLP_MANDATORY_RULES.includes(r))
    expect(mandatoryInOverride).toHaveLength(0)
  })

  it('buildEventList 构造事件列表', () => {
    const events = buildEventList(3)
    expect(events).toHaveLength(3)
    expect(events[0].eventType).toBeTruthy()
  })

  it('buildEmptyEventList 空列表', () => {
    expect(buildEmptyEventList()).toHaveLength(0)
  })
})
