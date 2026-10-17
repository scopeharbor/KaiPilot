/**
 * v3-plugin-permission-audit-and-observation — StrictAuditAppend（task 4.3-4.4）。
 *
 * Append-with-receipt：在业务事务内写审计日志并返回 receipt。
 * strict=true 时审计失败抛出异常（fail-closed），使外层事务回滚。
 * 不改变现有 AuditService.log() 的语义。
 *
 * 红线：
 * - 审计写入失败 + strict=true → 抛出异常，触发业务回滚
 * - 审计写入失败 + strict=false → 仅记日志，不阻塞业务
 * - receipt 仅含 auditLogId + createdAt，不含 payload 内容
 */
import AuditLog from '#models/audit_log'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type {
  PluginPermissionDecisionMode,
  PluginPermissionDecisionOperation,
  PluginPermissionDecisionOutcome,
  PluginPermissionReasonCode,
} from '@aiproj/types'
import {
  mapDecisionToAuditEvent,
  getAuditActionVerb,
  getAuditSeverity,
  PLUGIN_PERMISSION_DECISION_ENTITY_TYPE,
} from './audit_event_mapping.js'
import { sanitizeAuditPayload } from './audit_payload_builder.js'

// =============================================================================
// Receipt Types
// =============================================================================

/**
 * 审计回执：仅含 auditLogId + createdAt。
 * 用于 backfill 到决策账本。
 */
export interface AuditReceipt {
  /** audit_logs 行 id */
  auditLogId: number
  /** 审计日志创建时间 */
  createdAt: Date
}

/**
 * StrictAuditAppend 的参数。
 */
export interface StrictAuditAppendParams {
  /** 组织 id（server-owned scope，用于 audit_logs.organizationId） */
  organizationId: number
  /** 项目 id（可选） */
  projectId?: number | null
  /** 决策模式 */
  mode: PluginPermissionDecisionMode
  /** 操作 */
  operation: PluginPermissionDecisionOperation
  /** 结果 */
  outcome: PluginPermissionDecisionOutcome
  /** 拒绝原因码 */
  reasonCode?: PluginPermissionReasonCode
  /** Actor 用户 id */
  userId?: number | null
  /** 决策 id（entityId） */
  decisionId: string
  /** 插件 id（低敏 ref） */
  pluginRefHash?: string
  /** 请求 id */
  requestId?: string | null
  /** 事务客户端 */
  client?: TransactionClientContract
  /** strict 模式：审计失败时抛出异常 */
  strict?: boolean
}

// =============================================================================
// Core: appendWithReceipt
// =============================================================================

/**
 * 在业务事务内写审计日志并返回 receipt。
 *
 * strict=true（默认）：审计写入失败时抛出异常，使外层业务事务回滚（fail-closed）。
 * strict=false：审计写入失败仅记日志，不阻塞业务。
 *
 * @returns AuditReceipt — 审计日志 id + 创建时间
 */
export async function appendWithReceipt(params: StrictAuditAppendParams): Promise<AuditReceipt> {
  const {
    organizationId,
    projectId,
    mode,
    operation,
    outcome,
    reasonCode,
    userId,
    decisionId,
    requestId,
    client,
    strict = true,
  } = params

  // 1. 映射审计事件类型与 severity
  const eventType = mapDecisionToAuditEvent({ mode, operation, outcome, reasonCode })
  const severity = getAuditSeverity({ outcome, reasonCode })
  const action = getAuditActionVerb(operation)

  // 2. 构建低敏 payload
  const rawPayload: Record<string, unknown> = {
    decisionId,
    mode,
    operation,
    outcome,
    reasonCode,
  }
  const sanitizedPayload = sanitizeAuditPayload(rawPayload as any)

  // 3. 写入 audit_logs
  try {
    const createOptions = client ? { client } : undefined
    const created = await AuditLog.create(
      {
        action,
        severity,
        userId: userId ?? null,
        organizationId: organizationId ?? null,
        projectId: projectId ?? null,
        entityType: PLUGIN_PERMISSION_DECISION_ENTITY_TYPE,
        entityId: null, // decision id 是 string，entityId 是 number
        requestId: requestId ?? null,
        changes: null,
        metadata: {
          event: eventType,
          ...sanitizedPayload,
        },
      },
      createOptions,
    )

    return {
      auditLogId: created.id,
      createdAt: created.createdAt.toJSDate(),
    }
  } catch (error) {
    logger.error({ err: error, decisionId, eventType }, 'plugin_permission audit append failed')

    if (strict) {
      throw error
    }

    // non-strict: 返回一个降级 receipt（auditLogId=0 表示降级）
    return {
      auditLogId: 0,
      createdAt: new Date(),
    }
  }
}
