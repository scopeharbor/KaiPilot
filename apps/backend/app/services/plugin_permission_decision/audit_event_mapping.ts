/**
 * v3-plugin-permission-audit-and-observation — Audit Event Mapping（task 4.1-4.2）。
 *
 * 将 PluginPermissionDecisionMode + operation + outcome 映射到审计事件类型。
 * 复用既有的 action 动词和 entity_type=plugin_permission_decision。
 *
 * 红线：事件映射只产生低敏引用，不产生自由文本。
 */
import type {
  PluginPermissionDecisionMode,
  PluginPermissionDecisionOperation,
  PluginPermissionDecisionOutcome,
  PluginPermissionReasonCode,
} from '@aiproj/types'

// =============================================================================
// Event Types（与 spec 一致的 4 类事件）
// =============================================================================

export const PLUGIN_PERMISSION_AUDIT_EVENTS = [
  'plugin_permission_allowed',
  'plugin_permission_denied',
  'plugin_permission_replay_detected',
  'plugin_permission_audit_unavailable',
] as const

export type PluginPermissionAuditEvent = (typeof PLUGIN_PERMISSION_AUDIT_EVENTS)[number]

// =============================================================================
// Action Verb Mapping（复用既有的合法 action 动词）
// =============================================================================

/**
 * 映射 decision operation 到审计 action 动词。
 * 使用既有的合法 action 动词集合，不引入新的动词。
 */
const OPERATION_TO_ACTION: Record<PluginPermissionDecisionOperation, string> = {
  'register-install': 'create',
  enable: 'update',
  disable: 'update',
  upgrade: 'update',
  uninstall: 'delete',
  'resolve-query': 'read',
  execute: 'apply',
  'command-proposal': 'create',
  'ui-slot': 'read',
  'skill-adapter': 'apply',
  'compiler-contribution': 'create',
}

/**
 * 映射 decision outcome + reason → 审计事件类型。
 *
 * - allowed → `plugin_permission_allowed`
 * - denied + replay/tamper → `plugin_permission_replay_detected`
 * - denied + audit-unavailable → `plugin_permission_audit_unavailable`
 * - 其他 denied → `plugin_permission_denied`
 */
export function mapDecisionToAuditEvent(params: {
  mode: PluginPermissionDecisionMode
  operation: PluginPermissionDecisionOperation
  outcome: PluginPermissionDecisionOutcome
  reasonCode?: PluginPermissionReasonCode
}): PluginPermissionAuditEvent {
  const { outcome, reasonCode } = params

  if (outcome === 'allowed') {
    return 'plugin_permission_allowed'
  }

  // denied 二次分类
  if (reasonCode === 'replay-detected' || reasonCode === 'tamper-detected') {
    return 'plugin_permission_replay_detected'
  }

  if (reasonCode === 'audit-unavailable') {
    return 'plugin_permission_audit_unavailable'
  }

  return 'plugin_permission_denied'
}

/**
 * 获取 operation 对应的审计 action 动词。
 */
export function getAuditActionVerb(operation: PluginPermissionDecisionOperation): string {
  return OPERATION_TO_ACTION[operation] ?? 'read'
}

/**
 * 审计 entity type 常量。
 */
export const PLUGIN_PERMISSION_DECISION_ENTITY_TYPE = 'plugin_permission_decision' as const

/**
 * 审计 severity 映射。
 *
 * - allowed → info
 * - 安全相关拒绝（authority-spoofing / tamper / replay / cross-tenant / grant-escalation）→ critical
 * - 一般拒绝 → warning
 * - audit-unavailable → error
 */
export function getAuditSeverity(params: {
  outcome: PluginPermissionDecisionOutcome
  reasonCode?: PluginPermissionReasonCode
}): 'info' | 'warning' | 'error' | 'critical' {
  const { outcome, reasonCode } = params

  if (outcome === 'allowed') return 'info'

  if (reasonCode === 'audit-unavailable') return 'error'

  if (
    reasonCode === 'authority-spoofing' ||
    reasonCode === 'tamper-detected' ||
    reasonCode === 'replay-detected' ||
    reasonCode === 'cross-tenant-denied' ||
    reasonCode === 'grant-escalation'
  ) {
    return 'critical'
  }

  return 'warning'
}

/**
 * RBAC 权限映射：将模式+操作映射到 RBAC 权限标识。
 * host-administration 走 RBAC；plugin-runtime 通过 grant 授权，不走 RBAC。
 */
export function resolveRequiredRbacPermission(
  mode: PluginPermissionDecisionMode,
  operation: PluginPermissionDecisionOperation,
): string | null {
  if (mode === 'host-administration') {
    switch (operation) {
      case 'register-install':
      case 'enable':
      case 'disable':
      case 'upgrade':
      case 'uninstall':
        return 'plugin_registry:manage'
      case 'resolve-query':
        return 'plugin_registry:view'
      default:
        return 'plugin_registry:manage'
    }
  }

  // plugin-runtime: 运行时操作通过 grant 授权，不走 RBAC
  return null
}
