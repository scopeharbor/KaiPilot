// @aiproj/types — 企业合规准备度：demo profile / control seed / fixtures。
// 纯数据构造辅助，前后端共享。fixture 覆盖 evaluator、provider、organization isolation、
// preview/confirm、redaction 测试所需的形状。
//
// 所有内置 profile/control 均为 demo/configurable metadata，绝不宣称满足真实认证。

import {
  crComputeProfileHash,
  crComputeControlHash,
  crComputeSourceHash,
  crComputeEvidenceHash,
  crComputePreviewSignature,
  crComputeSourceSignature,
  crComputePackageHash,
  type ComplianceProfile,
  type ComplianceControl,
  type ComplianceEvidenceRef,
  type ComplianceException,
  type ComplianceProviderHealthSummary,
  type CompliancePackageFilter,
  type CompliancePackagePreview,
  type CompliancePackageLedgerEntry,
  type ComplianceControlDomain,
} from './enterprise-compliance-readiness.js'

// ──────────────────────────────────────────────
// 1. demo profile / control domains
// ──────────────────────────────────────────────

/** 内置中性控制域（避免暗示真实认证映射） */
export const COMPLIANCE_DEMO_DOMAINS: readonly ComplianceControlDomain[] = [
  { domainId: 'access_control', title: '访问控制', isDemo: true },
  { domainId: 'audit_logging', title: '审计日志', isDemo: true },
  { domainId: 'data_protection', title: '数据保护', isDemo: true },
  { domainId: 'export_control', title: '导出控制', isDemo: true },
  { domainId: 'ai_usage', title: 'AI 使用', isDemo: true },
] as const

export const COMPLIANCE_DEMO_PROFILE_ID = 'cp_demo_security_baseline_v1'

/**
 * 内置 demo profile。
 * notCertification 恒为 true，并附中文非认证声明。
 */
export function buildDemoProfile(overrides?: Partial<ComplianceProfile>): ComplianceProfile {
  const base = {
    id: COMPLIANCE_DEMO_PROFILE_ID,
    organizationId: 1,
    name: '通用安全控制基线（演示）',
    description: '内置演示 profile，用于合规准备度控制映射工作流。不构成任何认证结论。',
    version: 1,
    scope: 'organizational',
    status: 'active' as const,
    profileHash: '',
    domains: [...COMPLIANCE_DEMO_DOMAINS],
    notCertification: true,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
  base.profileHash = crComputeProfileHash({
    organizationId: base.organizationId,
    profileId: base.id,
    version: base.version,
    scope: base.scope,
  })
  return base
}

// ──────────────────────────────────────────────
// 2. demo controls
// ──────────────────────────────────────────────

/**
 * 内置 demo controls（覆盖各风险/成熟度/适用性组合）。
 * evidenceRequirements 引用 providerId。
 */
export function buildDemoControls(profileId = COMPLIANCE_DEMO_PROFILE_ID): ComplianceControl[] {
  const defs: Omit<ComplianceControl, 'id' | 'controlHash' | 'status'>[] = [
    {
      profileId,
      controlId: 'access_control_rbac',
      domain: 'access_control',
      title: 'RBAC 最小权限',
      description: '组织级 RBAC 注册与最小权限分配',
      owner: null,
      riskLevel: 'high',
      maturity: 'managed',
      applicability: 'applicable',
      reviewCadenceDays: 90,
      evidenceRequirements: ['rbac'],
      notApplicableReason: null,
    },
    {
      profileId,
      controlId: 'audit_log_integrity',
      domain: 'audit_logging',
      title: '审计日志完整性',
      description: '审计事件可追溯性与完整性摘要',
      owner: null,
      riskLevel: 'high',
      maturity: 'defined',
      applicability: 'applicable',
      reviewCadenceDays: 90,
      evidenceRequirements: ['audit'],
      notApplicableReason: null,
    },
    {
      profileId,
      controlId: 'data_protection_dlp',
      domain: 'data_protection',
      title: 'DLP 敏感内容保护',
      description: '组织级 DLP 策略与检测能力',
      owner: null,
      riskLevel: 'critical',
      maturity: 'managed',
      applicability: 'applicable',
      reviewCadenceDays: 60,
      evidenceRequirements: ['dlp'],
      notApplicableReason: null,
    },
    {
      profileId,
      controlId: 'data_protection_kms',
      domain: 'data_protection',
      title: 'KMS 密钥管理',
      description: '组织级密钥管理与加密底座',
      owner: null,
      riskLevel: 'critical',
      maturity: 'defined',
      applicability: 'applicable',
      reviewCadenceDays: 60,
      evidenceRequirements: ['kms'],
      notApplicableReason: null,
    },
    {
      profileId,
      controlId: 'export_control_watermark',
      domain: 'export_control',
      title: '导出水印追溯',
      description: '报表/文件导出水印能力',
      owner: null,
      riskLevel: 'medium',
      maturity: 'ad_hoc',
      applicability: 'applicable',
      reviewCadenceDays: 120,
      evidenceRequirements: ['watermark'],
      notApplicableReason: null,
    },
    {
      profileId,
      controlId: 'ai_usage_governance',
      domain: 'ai_usage',
      title: 'AI 网关配置',
      description: 'AI 网关配置摘要与使用边界',
      owner: null,
      riskLevel: 'medium',
      maturity: 'defined',
      applicability: 'applicable',
      reviewCadenceDays: 120,
      evidenceRequirements: ['ai'],
      notApplicableReason: null,
    },
    {
      profileId,
      controlId: 'access_control_ocr_privacy',
      domain: 'access_control',
      title: 'OCR 隐私与权限审计',
      description: 'OCR 处理的隐私与权限审计控件',
      owner: null,
      riskLevel: 'high',
      maturity: 'defined',
      applicability: 'not_applicable',
      reviewCadenceDays: 90,
      evidenceRequirements: ['ocr'],
      notApplicableReason: '组织未启用 OCR 文档处理',
    },
  ]

  return defs.map((d, i) => {
    const controlId = d.controlId
    const controlHash = crComputeControlHash({
      profileId,
      controlId,
      maturity: d.maturity as ComplianceControl['maturity'],
      riskLevel: d.riskLevel as ComplianceControl['riskLevel'],
      applicability: d.applicability as ComplianceControl['applicability'],
    })
    return {
      ...d,
      id: `${profileId}:${controlId}:${i}`,
      status: 'partial' as const,
      controlHash,
      owner: d.owner,
    }
  })
}

// ──────────────────────────────────────────────
// 3. evidence 构造
// ──────────────────────────────────────────────

export interface BuildEvidenceParams {
  controlId: string
  sourceType: string
  providerId?: string
  status?: ComplianceEvidenceRef['status']
  capturedAt?: string
  expiresAt?: string | null
  summary?: string
  freshnessSeconds?: number
  redactionWarnings?: ComplianceEvidenceRef['redactionWarnings']
  sourceId?: string
  organizationId?: number
}

/** 构造单个低敏 evidence ref。 */
export function buildEvidenceRef(p: BuildEvidenceParams): ComplianceEvidenceRef {
  const organizationId = p.organizationId ?? 1
  const providerId = p.providerId ?? p.sourceType
  const capturedAt = p.capturedAt ?? '2026-01-01T00:00:00.000Z'
  const summary = p.summary ?? `${p.sourceType} 证据摘要（低敏）`
  const id = crComputeEvidenceHash({
    organizationId,
    sourceType: p.sourceType,
    providerId,
    capturedAt,
    summary,
  })
  return {
    id,
    organizationId,
    controlId: p.controlId,
    sourceType: p.sourceType,
    sourceId: p.sourceId ?? `${p.sourceType}:${id}`,
    sourceHash: crComputeSourceHash(p.sourceType, providerId, p.sourceId ?? id),
    providerId,
    status: p.status ?? 'fresh',
    capturedAt,
    expiresAt: p.expiresAt ?? null,
    summary,
    redactionWarnings: p.redactionWarnings ?? [],
    freshnessSeconds: p.freshnessSeconds ?? 3600,
  }
}

/** 构造一组覆盖多个 sourceType 的 fresh evidence（用于 ready 案例）。 */
export function buildFreshEvidenceFor(
  controlId: string,
  sourceTypes: string[],
): ComplianceEvidenceRef[] {
  return sourceTypes.map((st, i) =>
    buildEvidenceRef({
      controlId,
      sourceType: st,
      capturedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      freshnessSeconds: 3600,
      status: 'fresh',
    }),
  )
}

// ──────────────────────────────────────────────
// 4. exceptions 构造
// ──────────────────────────────────────────────

export function buildException(overrides?: Partial<ComplianceException>): ComplianceException {
  return {
    id: 'cx_test_1',
    organizationId: 1,
    controlId: 'control_1',
    reason: '测试用例外',
    acceptedRisk: '低风险，可接受',
    owner: 'test-owner',
    dueDate: '2026-12-31T00:00:00.000Z',
    status: 'open',
    reviewHistoryHash: '',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

// ──────────────────────────────────────────────
// 5. provider health 构造
// ──────────────────────────────────────────────

/** 构造一组默认 provider health（全 live）。命名 cr 前缀避免与 enterprise-encryption-fixtures 的 buildProviderHealth 在 barrel export 冲突（任务 2.6）。 */
export function crBuildProviderHealth(
  overrides?: Record<string, Partial<ComplianceProviderHealthSummary>>,
): Record<string, ComplianceProviderHealthSummary> {
  const defaults: Record<string, ComplianceProviderHealthSummary> = {
    audit: {
      providerId: 'audit',
      health: 'live',
      reason: null,
      supportsLiveEvidence: true,
      lastCapturedAt: '2026-01-01T00:00:00.000Z',
    },
    rbac: {
      providerId: 'rbac',
      health: 'live',
      reason: null,
      supportsLiveEvidence: true,
      lastCapturedAt: '2026-01-01T00:00:00.000Z',
    },
    dlp: {
      providerId: 'dlp',
      health: 'live',
      reason: null,
      supportsLiveEvidence: true,
      lastCapturedAt: '2026-01-01T00:00:00.000Z',
    },
    kms: {
      providerId: 'kms',
      health: 'live',
      reason: null,
      supportsLiveEvidence: true,
      lastCapturedAt: '2026-01-01T00:00:00.000Z',
    },
    watermark: {
      providerId: 'watermark',
      health: 'live',
      reason: null,
      supportsLiveEvidence: true,
      lastCapturedAt: '2026-01-01T00:00:00.000Z',
    },
    ocr: {
      providerId: 'ocr',
      health: 'live',
      reason: null,
      supportsLiveEvidence: true,
      lastCapturedAt: '2026-01-01T00:00:00.000Z',
    },
    ai: {
      providerId: 'ai',
      health: 'live',
      reason: null,
      supportsLiveEvidence: true,
      lastCapturedAt: '2026-01-01T00:00:00.000Z',
    },
    report: {
      providerId: 'report',
      health: 'live',
      reason: null,
      supportsLiveEvidence: true,
      lastCapturedAt: '2026-01-01T00:00:00.000Z',
    },
    file: {
      providerId: 'file',
      health: 'live',
      reason: null,
      supportsLiveEvidence: true,
      lastCapturedAt: '2026-01-01T00:00:00.000Z',
    },
  }
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      const existing = defaults[k]
      if (!existing) continue
      defaults[k] = { ...existing, ...v } as ComplianceProviderHealthSummary
    }
  }
  return defaults
}

// ──────────────────────────────────────────────
// 6. package preview / ledger 构造
// ──────────────────────────────────────────────

export function buildPackageFilter(
  overrides?: Partial<CompliancePackageFilter>,
): CompliancePackageFilter {
  return {
    profileId: 1,
    controlIds: [1, 2],
    from: null,
    to: null,
    ...overrides,
  }
}

/**
 * 构造一个 preview 结果（仅用于测试签名/结构）。不落 ledger。
 */
export function buildPackagePreview(
  overrides?: Partial<CompliancePackagePreview>,
): CompliancePackagePreview {
  const filter = buildPackageFilter()
  const profile = buildDemoProfile()
  const profileHash = profile.profileHash
  const controlHash = crComputeControlHash({
    profileId: profile.id,
    controlId: String(filter.controlIds.sort()[0] ?? 1),
    maturity: 'managed',
    riskLevel: 'high',
    applicability: 'applicable',
  })
  const sourceSignature = crComputeSourceSignature({
    profileHash,
    controlHashes: filter.controlIds.map((c) =>
      crComputeControlHash({
        profileId: profile.id,
        controlId: String(c),
        maturity: 'managed',
        riskLevel: 'high',
        applicability: 'applicable',
      }),
    ),
    providerHealth: { audit: 'live', rbac: 'live' },
    // 固定捕获时刻保证 preview/ledger 签名一致可重算
    capturedAt: '2026-01-01T00:00:00.000Z',
  })
  const previewSignature = crComputePreviewSignature({
    organizationId: profile.organizationId,
    controlIds: filter.controlIds.map(String),
    from: filter.from,
    to: filter.to,
    sourceSignature,
  })
  const packageHash = crComputePackageHash({
    previewSignature,
    controlCount: filter.controlIds.length,
    evidenceCount: 10,
    from: filter.from,
    to: filter.to,
    warningCodes: ['not_certification'],
  })
  return {
    packageId: 'pkg_demo_1',
    organizationId: profile.organizationId,
    filter,
    selectedControlCount: filter.controlIds.length,
    evidenceCount: 10,
    stateDistribution: { ready: 1, partial: 1, missing: 0, not_applicable: 0, blocked: 0 },
    redactedManifestSummary: {
      profileName: profile.name,
      profileScope: profile.scope,
      domainTitles: ['访问控制', '审计日志'],
      controlSummary: { ready: 1, partial: 1, missing: 0, not_applicable: 0, blocked: 0 },
      evidenceRefIds: ['ev_1', 'ev_2'],
      providerIds: ['audit', 'rbac'],
      timeWindow: { from: null, to: null },
    },
    sourceSignature,
    profileHash,
    controlHash,
    packageHash,
    warningCodes: ['not_certification'],
    requiresConfirmation: true,
    previewSignature,
    previewExpiresAt: '2026-01-01T00:05:00.000Z',
    notCertification: true,
    disclaimer: '本证据包仅用于合规准备度的自审与采购前控制映射，不构成任何合规认证或法律结论。',
    ...overrides,
  }
}

/** 构造一个已确认的 package ledger entry。 */
export function buildPackageLedgerEntry(
  overrides?: Partial<CompliancePackageLedgerEntry>,
): CompliancePackageLedgerEntry {
  const preview = buildPackagePreview()
  return {
    id: 'ldg_demo_1',
    packageId: preview.packageId,
    organizationId: preview.organizationId,
    profileHash: preview.profileHash,
    sourceSignature: preview.sourceSignature,
    packageHash: preview.packageHash,
    controlCount: preview.selectedControlCount,
    evidenceCount: preview.evidenceCount,
    status: 'confirmed',
    warningCodes: ['not_certification'],
    actorId: 1,
    createdAt: '2026-01-01T00:05:00.000Z',
    previewSignature: preview.previewSignature,
    ...overrides,
  }
}
