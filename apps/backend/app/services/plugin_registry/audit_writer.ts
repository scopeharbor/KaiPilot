/**
 * v3-plugin-private-registry-lifecycle — AuditWriter（task 5.11–5.12）。
 *
 * 薄封装层：把私有目录事件写入现有可信审计能力。
 * 复用既有 audit 写入模式，新增 10 个事件类型。
 *
 * 红线：审计只含低敏引用 hash，不含包内容/manifest 全文/secret/token/远程 URL。
 */

import type { RegistryAuditEvent, RegistryCommandAction, RegistryReasonCode } from '@aiproj/types'
import { computeRegistrySourceHash } from '@aiproj/types'

// =============================================================================
// Event Types
// =============================================================================

export const PLUGIN_REGISTRY_AUDIT_EVENTS = [
  'plugin_registry_release_registered',
  'plugin_registry_release_submitted',
  'plugin_registry_release_approved',
  'plugin_registry_release_rejected',
  'plugin_registry_release_deprecated',
  'plugin_registry_release_withdrawn',
  'plugin_registry_release_restored',
  'plugin_registry_rollback_success',
  'plugin_registry_rollback_failure',
  'plugin_registry_rollback_degraded',
  'plugin_registry_permission_denied',
  'plugin_registry_maker_checker_violation',
  'plugin_registry_stale_preview',
  'plugin_registry_replay_detected',
  'plugin_registry_cross_org_attempt',
] as const

export type PluginRegistryAuditEvent = (typeof PLUGIN_REGISTRY_AUDIT_EVENTS)[number]

// =============================================================================
// Event Builder
// =============================================================================

/**
 * Build a low-sensitive audit event.
 * All IDs are hashed; no raw org/user/release IDs in the event.
 */
export function buildAuditEvent(params: {
  organizationId: string
  pluginIdentity: string
  version: string
  action: RegistryCommandAction | 'rollback'
  reasonCode: RegistryReasonCode
  actorRef: string
  correlationId: string
}): RegistryAuditEvent {
  return {
    orgRefHash: computeRegistrySourceHash(params.organizationId),
    pluginIdentityHash: computeRegistrySourceHash(params.pluginIdentity),
    version: params.version,
    action: params.action,
    reasonCode: params.reasonCode,
    actorRefHash: computeRegistrySourceHash(params.actorRef),
    correlationId: params.correlationId,
  }
}

/**
 * Determine the audit event type from action and result.
 */
export function auditEventType(
  action: RegistryCommandAction | 'rollback',
  success: boolean,
  degraded: boolean,
): PluginRegistryAuditEvent {
  if (action === 'rollback') {
    if (degraded) return 'plugin_registry_rollback_degraded'
    return success ? 'plugin_registry_rollback_success' : 'plugin_registry_rollback_failure'
  }

  const eventMap: Record<string, PluginRegistryAuditEvent> = {
    'create-release': 'plugin_registry_release_registered',
    'submit-for-review': 'plugin_registry_release_submitted',
    approve: 'plugin_registry_release_approved',
    reject: 'plugin_registry_release_rejected',
    deprecate: 'plugin_registry_release_deprecated',
    undeprecate: 'plugin_registry_release_restored',
    withdraw: 'plugin_registry_release_withdrawn',
    'restore-request': 'plugin_registry_release_restored',
  }

  return eventMap[action] ?? 'plugin_registry_release_registered'
}

/**
 * Build rejection/denial audit event.
 */
export function buildDenialAuditEvent(params: {
  organizationId: string
  pluginIdentity: string
  version: string
  reasonCode: RegistryReasonCode
  actorRef: string
  correlationId: string
}): { eventType: PluginRegistryAuditEvent; event: RegistryAuditEvent } {
  const event = buildAuditEvent({
    ...params,
    action: 'approve', // placeholder, denial events don't have a specific action
  })

  let eventType: PluginRegistryAuditEvent = 'plugin_registry_permission_denied'
  if (params.reasonCode === 'reason-maker-checker-violation') {
    eventType = 'plugin_registry_maker_checker_violation'
  } else if (params.reasonCode === 'reason-stale-preview') {
    eventType = 'plugin_registry_stale_preview'
  } else if (params.reasonCode === 'reason-replay-detected') {
    eventType = 'plugin_registry_replay_detected'
  } else if (params.reasonCode === 'reason-cross-org-attempt') {
    eventType = 'plugin_registry_cross_org_attempt'
  }

  return { eventType, event }
}

/**
 * Assert that an audit event does not contain forbidden content.
 * Used in tests to verify low-sensitivity compliance.
 */
export function assertAuditLowSensitive(event: RegistryAuditEvent): void {
  const serialized = JSON.stringify(event)
  const forbidden = [
    /secret/i,
    /token/i,
    /password/i,
    /api_key/i,
    /authorization/i,
    /bearer/i,
    /ghp_/,
    /sk_/,
    /:\/\/[^/]+/, // URLs
  ]
  for (const pattern of forbidden) {
    if (pattern.test(serialized)) {
      throw new Error(`Audit event contains forbidden pattern: ${pattern}`)
    }
  }
}
