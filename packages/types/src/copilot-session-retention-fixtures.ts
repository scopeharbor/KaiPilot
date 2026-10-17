/**
 * Copilot Session Retention — 测试夹具构建器
 *
 * 提供保留策略、删除记录、墓碑与状态响应的确定性夹具。
 * 默认测试不调用真实 Copilot API。
 */

import {
  computeCopilotSessionRetentionPolicyHash,
  computeCopilotSessionTombstoneHash,
  type CopilotSessionRetentionDeletionRecord,
  type CopilotSessionRetentionReadSummary,
  type CopilotSessionRetentionPolicy,
  type CopilotSessionRetentionStatusResponse,
  type CopilotSessionRetentionTombstone,
} from './copilot-session-retention.js'

const FIXED_NOW = '2026-08-02T00:00:00.000Z'

// ─── 策略 ──────────────────────────────────────────────────────────────────

export function buildCopilotSessionRetentionPolicy(
  overrides: Partial<CopilotSessionRetentionPolicy> = {},
): CopilotSessionRetentionPolicy {
  const scope = overrides.scope ?? 'project'
  const organizationId = overrides.organizationId ?? 1
  const projectId = overrides.projectId === undefined ? 10 : overrides.projectId
  const retentionDays = overrides.retentionDays ?? 90
  const enabled = overrides.enabled ?? true
  return {
    scope,
    organizationId,
    projectId,
    retentionDays,
    enabled,
    policyHash: computeCopilotSessionRetentionPolicyHash({
      scope,
      organizationId,
      projectId,
      retentionDays,
      enabled,
    }),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  }
}

export function buildOrganizationCopilotSessionRetentionPolicy(
  overrides: Partial<CopilotSessionRetentionPolicy> = {},
): CopilotSessionRetentionPolicy {
  return buildCopilotSessionRetentionPolicy({
    scope: 'organization',
    projectId: null,
    ...overrides,
  })
}

export function buildDisabledCopilotSessionRetentionPolicy(
  overrides: Partial<CopilotSessionRetentionPolicy> = {},
): CopilotSessionRetentionPolicy {
  return buildCopilotSessionRetentionPolicy({
    enabled: false,
    ...overrides,
  })
}

// ─── 删除记录 ──────────────────────────────────────────────────────────────

export function buildCopilotSessionRetentionDeletionRecord(
  overrides: Partial<CopilotSessionRetentionDeletionRecord> = {},
): CopilotSessionRetentionDeletionRecord {
  const policy = buildCopilotSessionRetentionPolicy()
  return {
    deletionId: 4001,
    organizationId: 1,
    projectId: 10,
    sessionId: 'session-abc-123',
    sessionDbId: 501,
    triggerReason: 'retention_expired',
    deletedAt: FIXED_NOW,
    messageCount: 25,
    tombstoneId: 7001,
    policyHash: policy.policyHash,
    ...overrides,
  }
}

export function buildUserRequestedDeletionRecord(
  overrides: Partial<CopilotSessionRetentionDeletionRecord> = {},
): CopilotSessionRetentionDeletionRecord {
  return buildCopilotSessionRetentionDeletionRecord({
    triggerReason: 'user_requested',
    ...overrides,
  })
}

export function buildOrganizationRequestedDeletionRecord(
  overrides: Partial<CopilotSessionRetentionDeletionRecord> = {},
): CopilotSessionRetentionDeletionRecord {
  return buildCopilotSessionRetentionDeletionRecord({
    triggerReason: 'organization_requested',
    ...overrides,
  })
}

// ─── 墓碑 ──────────────────────────────────────────────────────────────────

export function buildCopilotSessionRetentionTombstone(
  overrides: Partial<CopilotSessionRetentionTombstone> = {},
): CopilotSessionRetentionTombstone {
  const policy = buildCopilotSessionRetentionPolicy()
  const originalSessionId = overrides.originalSessionId ?? 'session-abc-123'
  const deletedAtIso = overrides.createdAt ?? FIXED_NOW
  return {
    tombstoneId: 7001,
    organizationId: 1,
    projectId: 10,
    originalSessionId,
    tombstoneHash: computeCopilotSessionTombstoneHash({
      originalSessionId,
      deletionReason: 'retention_expired',
      policyHash: policy.policyHash,
      deletedAtIso,
    }),
    messageCount: 25,
    policyHash: policy.policyHash,
    createdAt: FIXED_NOW,
    ...overrides,
  }
}

export function buildOrganizationCopilotSessionRetentionTombstone(
  overrides: Partial<CopilotSessionRetentionTombstone> = {},
): CopilotSessionRetentionTombstone {
  return buildCopilotSessionRetentionTombstone({
    projectId: null,
    ...overrides,
  })
}

// ─── 状态响应 ──────────────────────────────────────────────────────────────

export function buildCopilotSessionRetentionStatusResponse(
  overrides: Partial<CopilotSessionRetentionStatusResponse> = {},
): CopilotSessionRetentionStatusResponse {
  return {
    organizationId: 1,
    projectId: 10,
    totalSessions: 150,
    expiringSoonCount: 12,
    deletedCount: 5,
    policyConfigured: true,
    retentionDays: 90,
    ...overrides,
  }
}

export function buildUnconfiguredCopilotSessionRetentionStatusResponse(
  overrides: Partial<CopilotSessionRetentionStatusResponse> = {},
): CopilotSessionRetentionStatusResponse {
  return buildCopilotSessionRetentionStatusResponse({
    policyConfigured: false,
    retentionDays: null,
    ...overrides,
  })
}

// ─── 读取摘要 ──────────────────────────────────────────────────────────────

export function buildCopilotSessionRetentionReadSummary(
  overrides: Partial<CopilotSessionRetentionReadSummary> = {},
): CopilotSessionRetentionReadSummary {
  return {
    sessionId: 'session-abc-123',
    sessionDbId: 501,
    title: '测试会话标题',
    createdAt: FIXED_NOW,
    retentionExpiresAt: '2026-11-01T00:00:00.000Z',
    remainingDays: 91,
    policyConfigured: true,
    ...overrides,
  }
}

export function buildNoPolicyCopilotSessionRetentionReadSummary(
  overrides: Partial<CopilotSessionRetentionReadSummary> = {},
): CopilotSessionRetentionReadSummary {
  return buildCopilotSessionRetentionReadSummary({
    policyConfigured: false,
    retentionExpiresAt: null,
    remainingDays: null,
    ...overrides,
  })
}
