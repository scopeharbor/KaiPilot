/**
 * v3-enterprise-dlp-engine — 企业级 DLP 测试夹具（前后端共享）。
 *
 * 提供 policy、scan input、match、decision、preview、event 和跨组织拒绝场景的构造器。
 */

import type {
  DlpRuleId,
  DlpAction,
  DlpScanInput,
  DlpMatchSummary,
  DlpDecisionSnapshot,
  DlpPreviewSignature,
  DlpEventEntry,
  DlpProjectOverride,
  DlpPolicySummary,
  DlpConfirmationRequest,
  DlpConfirmationResult,
  DlpEventType,
} from './enterprise-dlp-engine.js'
import {
  computePolicyHash,
  computeDecisionHash,
  computePreviewSignature,
  getRuleCatalog,
} from './enterprise-dlp-engine.js'

// ─── 构造器 ────────────────────────────────────────────────────────────────────────

export function buildSystemDefaultPolicy(overrides?: Partial<DlpPolicySummary>): DlpPolicySummary {
  const catalog = getRuleCatalog()
  const enabledRules = catalog.map((r) => r.ruleId)
  const ruleActions: Partial<Record<DlpRuleId, DlpAction>> = {}
  for (const r of catalog) {
    ruleActions[r.ruleId] = r.defaultAction
  }

  const base: DlpPolicySummary = {
    policyHash: '',
    policyVersion: 1,
    effectiveScope: 'system',
    enabledRuleCount: enabledRules.length,
    enabledRules,
    actionMatrix: ruleActions,
    warningCodes: [],
  }

  base.policyHash = computePolicyHash({
    enabledRules: base.enabledRules,
    ruleActions: base.actionMatrix,
    scope: 'system',
    organizationId: 0,
  })

  return { ...base, ...overrides }
}

export function buildOrganizationPolicy(overrides?: Partial<DlpPolicySummary>): DlpPolicySummary {
  const catalog = getRuleCatalog()
  const enabledRules = catalog.map((r) => r.ruleId)
  const ruleActions: Partial<Record<DlpRuleId, DlpAction>> = {}
  for (const r of catalog) {
    ruleActions[r.ruleId] = r.defaultAction
  }

  const base: DlpPolicySummary = {
    policyHash: '',
    policyVersion: 1,
    effectiveScope: 'organization',
    enabledRuleCount: enabledRules.length,
    enabledRules,
    actionMatrix: ruleActions,
    warningCodes: [],
  }

  base.policyHash = computePolicyHash({
    enabledRules: base.enabledRules,
    ruleActions: base.actionMatrix,
    scope: 'organization',
    organizationId: 1,
  })

  return { ...base, ...overrides }
}

export function buildProjectOverridePolicy(
  overrides?: Partial<DlpPolicySummary>,
): DlpPolicySummary {
  const catalog = getRuleCatalog()
  const enabledRules = catalog.filter((r) => r.isMandatory).map((r) => r.ruleId)
  const ruleActions: Partial<Record<DlpRuleId, DlpAction>> = {}
  for (const r of catalog) {
    ruleActions[r.ruleId] = r.defaultAction
  }

  const base: DlpPolicySummary = {
    policyHash: '',
    policyVersion: 1,
    effectiveScope: 'project',
    enabledRuleCount: enabledRules.length,
    enabledRules,
    actionMatrix: ruleActions,
    warningCodes: [],
  }

  base.policyHash = computePolicyHash({
    enabledRules: base.enabledRules,
    ruleActions: base.actionMatrix,
    scope: 'project',
    organizationId: 1,
  })

  return { ...base, ...overrides }
}

export function buildStrictPolicy(overrides?: Partial<DlpPolicySummary>): DlpPolicySummary {
  const catalog = getRuleCatalog()
  const enabledRules = catalog.map((r) => r.ruleId)
  const ruleActions: Partial<Record<DlpRuleId, DlpAction>> = {}
  for (const r of catalog) {
    ruleActions[r.ruleId] = 'block'
  }

  const base: DlpPolicySummary = {
    policyHash: '',
    policyVersion: 1,
    effectiveScope: 'organization',
    enabledRuleCount: enabledRules.length,
    enabledRules,
    actionMatrix: ruleActions,
    warningCodes: [],
  }

  base.policyHash = computePolicyHash({
    enabledRules: base.enabledRules,
    ruleActions: base.actionMatrix,
    scope: 'organization',
    organizationId: 1,
  })

  return { ...base, ...overrides }
}

export function buildScanInput(overrides?: Partial<DlpScanInput>): DlpScanInput {
  const defaults: DlpScanInput = {
    contentCategory: 'file_safe_text',
    declaredAction: 'download',
    sourceHash: 'a1b2c3d4',
    text: '这是测试文本内容 13800138000 和 110101199001011234',
    textLength: 41,
    fileSize: 1024,
    fileName: 'test.txt',
    mimeType: 'text/plain',
    itemCount: 1,
    metadata: {},
  }

  const merged = { ...defaults, ...overrides }
  merged.textLength = merged.text.length
  return merged
}

export function buildMatchSummary(overrides?: Partial<DlpMatchSummary>): DlpMatchSummary {
  return {
    ruleId: 'pii_phone',
    category: 'pii',
    severity: 'medium',
    count: 1,
    maskedSample: '138****8000',
    sampleHash: 'd4e5f6a7',
    reasonCode: 'PHONE_MATCH',
    confidence: 'high',
    ...overrides,
  }
}

export function buildDecisionsnapshot(
  overrides?: Partial<DlpDecisionSnapshot>,
): DlpDecisionSnapshot {
  const base: DlpDecisionSnapshot = {
    actorId: 1,
    organizationId: 1,
    projectId: null,
    action: 'download',
    sourceRef: 'file:test.txt',
    sourceHash: 'a1b2c3d4',
    policyHash: 'e5f6a7b8',
    policyVersion: 1,
    effectiveScope: 'organization',
    visibilityEvidence: 'allowed:file:view',
    matchSummary: [buildMatchSummary()],
    result: 'allow',
    requiredFollowUp: null,
    reasonCodes: ['NO_MATCH_CRITICAL'],
    decisionHash: '',
    expiresAt: null,
    createdAt: '2026-08-04T00:00:00.000Z',
  }

  base.decisionHash = computeDecisionHash({
    actorId: base.actorId,
    organizationId: base.organizationId,
    projectId: base.projectId,
    action: base.action,
    sourceHash: base.sourceHash,
    policyHash: base.policyHash,
    visibilityEvidence: base.visibilityEvidence,
  })

  return { ...base, ...overrides }
}

export function dlpBuildBlockDecision(
  overrides?: Partial<DlpDecisionSnapshot>,
): DlpDecisionSnapshot {
  return buildDecisionsnapshot({
    matchSummary: [
      buildMatchSummary({
        ruleId: 'credential_api_key',
        category: 'credential',
        severity: 'critical',
      }),
    ],
    result: 'block',
    requiredFollowUp: null,
    reasonCodes: ['CRITICAL_CREDENTIAL_MATCH', 'POLICY_BLOCK'],
    ...overrides,
  })
}

export function dlpBuildMaskDecision(
  overrides?: Partial<DlpDecisionSnapshot>,
): DlpDecisionSnapshot {
  return buildDecisionsnapshot({
    matchSummary: [buildMatchSummary({ ruleId: 'pii_id_card', category: 'pii', severity: 'high' })],
    result: 'mask',
    requiredFollowUp: 'mask',
    reasonCodes: ['PII_MATCH_HIGH', 'POLICY_MASK'],
    ...overrides,
  })
}

export function dlpBuildConfirmRequiredDecision(
  overrides?: Partial<DlpDecisionSnapshot>,
): DlpDecisionSnapshot {
  const expiresAt = new Date(Date.now() + 300_000).toISOString()
  return buildDecisionsnapshot({
    matchSummary: [
      buildMatchSummary({
        ruleId: 'high_risk_combination',
        category: 'high_risk_combination',
        severity: 'critical',
      }),
    ],
    result: 'warn_confirm',
    requiredFollowUp: 'warn_confirm',
    reasonCodes: ['HIGH_RISK_COMBINATION', 'POLICY_WARN_CONFIRM'],
    expiresAt,
    ...overrides,
  })
}

export function buildPreviewSignature(
  overrides?: Partial<DlpPreviewSignature>,
): DlpPreviewSignature {
  const decision = dlpBuildConfirmRequiredDecision()
  const expiresAt = new Date(Date.now() + 300_000).toISOString()
  const createdAt = new Date().toISOString()

  const base: DlpPreviewSignature = {
    signature: '',
    policyHash: decision.policyHash,
    sourceHash: decision.sourceHash,
    decisionHash: decision.decisionHash,
    matchSummary: decision.matchSummary,
    redactionSummary: '1 条高风险组合匹配，已脱敏',
    requiresConfirmation: true,
    expiresAt,
    createdAt,
  }

  base.signature = computePreviewSignature({
    decisionHash: base.decisionHash,
    expiresAt: base.expiresAt,
  })

  return { ...base, ...overrides }
}

export function buildConfirmationRequest(
  overrides?: Partial<DlpConfirmationRequest>,
): DlpConfirmationRequest {
  const preview = buildPreviewSignature()
  return {
    previewSignature: preview.signature,
    actorId: 1,
    organizationId: 1,
    projectId: null,
    policyHash: preview.policyHash,
    sourceHash: preview.sourceHash,
    action: 'download',
    ...overrides,
  }
}

export function buildConfirmedResult(
  overrides?: Partial<DlpConfirmationResult>,
): DlpConfirmationResult {
  return {
    status: 'confirmed',
    decisionHash: 'a1b2c3d4',
    reasonCodes: ['CONFIRMATION_ACCEPTED'],
    confirmedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildStaleConfirmationResult(
  overrides?: Partial<DlpConfirmationResult>,
): DlpConfirmationResult {
  return {
    status: 'stale',
    decisionHash: 'e5f6a7b8',
    reasonCodes: ['CONFIRMATION_STALE', 'POLICY_CHANGED'],
    confirmedAt: null,
    ...overrides,
  }
}

export function buildDlpEvent(overrides?: Partial<DlpEventEntry>): DlpEventEntry {
  return {
    id: 1,
    organizationId: 1,
    projectId: null,
    actorId: 1,
    eventType: 'decision_blocked',
    action: 'download',
    result: 'block',
    ruleIds: ['credential_api_key'],
    severityCounts: { critical: 1 },
    decisionHash: 'a1b2c3d4',
    policyHash: 'e5f6a7b8',
    sourceHash: 'd4e5f6a7',
    previewSignature: null,
    warningCodes: [],
    createdAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  }
}

export function buildCrossOrganizationPolicyRequest(
  overrides?: Partial<DlpPolicySummary>,
): DlpPolicySummary {
  return buildOrganizationPolicy({
    ...overrides,
    policyHash: computePolicyHash({
      enabledRules: getRuleCatalog().map((r) => r.ruleId),
      ruleActions: {},
      scope: 'organization',
      organizationId: 999,
    }),
  })
}

export function buildProjectOverride(overrides?: Partial<DlpProjectOverride>): DlpProjectOverride {
  const catalog = getRuleCatalog()
  const enabledRules = catalog.map((r) => r.ruleId)
  const ruleActions: Partial<Record<DlpRuleId, DlpAction>> = {}
  for (const r of catalog) {
    ruleActions[r.ruleId] = r.defaultAction
  }

  return {
    id: 1,
    organizationId: 1,
    projectId: 1,
    policyHash: computePolicyHash({
      enabledRules,
      ruleActions,
      scope: 'project',
      organizationId: 1,
    }),
    enabledRules,
    ruleActions,
    createdBy: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  }
}

export function buildUnsafeOverride(overrides?: Partial<DlpProjectOverride>): DlpProjectOverride {
  // 禁用了强制规则
  const nonMandatoryRules = getRuleCatalog()
    .filter((r) => !r.isMandatory)
    .map((r) => r.ruleId)
  const ruleActions: Partial<Record<DlpRuleId, DlpAction>> = {}
  for (const r of getRuleCatalog()) {
    if (r.isMandatory) {
      ruleActions[r.ruleId] = 'allow'
    } else {
      ruleActions[r.ruleId] = r.defaultAction
    }
  }

  return {
    id: 2,
    organizationId: 1,
    projectId: 1,
    policyHash: computePolicyHash({
      enabledRules: nonMandatoryRules,
      ruleActions,
      scope: 'project',
      organizationId: 1,
    }),
    enabledRules: nonMandatoryRules,
    ruleActions,
    createdBy: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  }
}

export function buildEmptyEventList(): DlpEventEntry[] {
  return []
}

export function buildEventList(count = 5): DlpEventEntry[] {
  const events: DlpEventEntry[] = []
  const eventTypes: DlpEventType[] = [
    'decision_blocked',
    'decision_masked',
    'decision_allowed',
    'decision_audit_only',
    'stale_block',
  ]
  for (let i = 0; i < count; i++) {
    events.push(
      buildDlpEvent({
        id: i + 1,
        eventType: eventTypes[i % eventTypes.length],
        createdAt: new Date(Date.now() - i * 60_000).toISOString(),
      }),
    )
  }
  return events
}
