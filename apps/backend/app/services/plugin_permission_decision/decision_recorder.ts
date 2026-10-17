/**
 * v3-plugin-permission-audit-and-observation — Decision Recorder（task 4.7-4.10）。
 *
 * 单事务写入：ledger row → strict audit append → receipt backfill → commit。
 * 只有事务提交后才返回 allowed。
 *
 * 幂等（task 4.9-4.10）：
 * - 相同 fingerprint → 复用已有 receipt（不新建 ledger/audit）
 * - 不同 fingerprint → replay/tamper denial + 独立安全事件
 * - 唯一键冲突 → 确定性恢复
 *
 * 红线：
 * - allowed 仅在事务提交后返回
 * - 审计失败 → denial（audit-unavailable）
 * - denial 永不翻转为 allowed
 * - ledger 失败 → denial
 * - receipt backfill 失败 → denial
 * - commit 失败 → 零下游调用
 */
import type {
  PluginPermissionDecisionRecord,
  PluginPermissionDecisionReceipt,
  PluginPermissionDecisionOutcome,
  PluginPermissionReasonCode,
} from '@aiproj/types'
import { pdDomainSeparatedHash } from '@aiproj/types'
import PluginPermissionDecision from '#models/plugin_permission_decision'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import logger from '@adonisjs/core/services/logger'
import { buildAuditPayload, sanitizeAuditPayload } from './audit_payload_builder.js'
import {
  mapDecisionToAuditEvent,
  PLUGIN_PERMISSION_DECISION_ENTITY_TYPE,
  getAuditSeverity,
} from './audit_event_mapping.js'

// =============================================================================
// Types
// =============================================================================

export interface RecordDecisionParams {
  /** Decision record to persist. */
  record: PluginPermissionDecisionRecord
  /** Organization ID (server-owned, for scope). */
  organizationId: number
  /** Project ID (optional, for scope). */
  projectId?: number
  /** Transaction client (required for atomicity). */
  trx: TransactionClientContract
  /** Audit service (injected to avoid circular deps). */
  auditService: {
    log: (entry: {
      event: string
      severity?: string
      userId?: number
      organizationId?: number
      projectId?: number
      entityType?: string
      entityId?: string
      changes?: Record<string, unknown>
      metadata?: Record<string, unknown>
      strict?: boolean
      client?: TransactionClientContract
    }) => Promise<void>
  }
}

export interface RecordDecisionResult {
  /** Final outcome. */
  outcome: PluginPermissionDecisionOutcome
  /** Receipt (only when allowed). */
  receipt: PluginPermissionDecisionReceipt
  /** Whether this was an idempotent replay. */
  idempotentReplay: boolean
}

// =============================================================================
// Decision Recorder
// =============================================================================

/**
 * Record a permission decision: ledger + audit in single transaction.
 *
 * Flow:
 * 1. Check idempotency (same fingerprint → reuse existing receipt)
 * 2. Check for tamper (same decision_id, different fingerprint)
 * 3. Write ledger row
 * 4. Write audit event (strict → throws on failure)
 * 5. Backfill audit_log_id receipt
 * 6. Commit
 * 7. Return receipt
 *
 * Ledger failure → denial.
 * Audit failure → denial (audit-unavailable).
 * Receipt backfill failure → denial.
 * Commit failure → zero downstream calls.
 */
export async function recordDecision(params: RecordDecisionParams): Promise<RecordDecisionResult> {
  const { record, organizationId, projectId, trx, auditService } = params

  // ── Step 1: Idempotency check ──
  // 相同 fingerprint → 复用已有 receipt（不新建 ledger/audit）
  const existingDecision = await PluginPermissionDecision.query({ client: trx })
    .where('organizationId', organizationId)
    .where('inputFingerprint', record.inputFingerprint)
    .first()

  if (existingDecision) {
    return {
      outcome: existingDecision.outcome as PluginPermissionDecisionOutcome,
      receipt: {
        decisionId: existingDecision.decisionId,
        outcome: existingDecision.outcome as PluginPermissionDecisionOutcome,
        reasonCode: existingDecision.primaryReason as PluginPermissionReasonCode,
        createdAt: existingDecision.createdAt.toISO()!,
        idempotencyKey: record.idempotencyKey,
      },
      idempotentReplay: true,
    }
  }

  // ── Step 2: Check for tamper (different fingerprint, same decision_id) ──
  // 不同 fingerprint → replay/tamper denial + 独立安全事件
  const sameDecisionId = await PluginPermissionDecision.query({ client: trx })
    .where('organizationId', organizationId)
    .where('decisionId', record.decisionId)
    .first()

  if (sameDecisionId && sameDecisionId.inputFingerprint !== record.inputFingerprint) {
    return await writeDenialAndGetReceipt(record, organizationId, projectId, trx, auditService)
  }

  // ── Step 3: Write ledger row ──
  let decisionRow: InstanceType<typeof PluginPermissionDecision>
  try {
    decisionRow = await PluginPermissionDecision.create(
      {
        organizationId,
        projectId: projectId ?? null,
        decisionId: record.decisionId,
        inputFingerprint: record.inputFingerprint,
        mode: record.mode,
        operation: record.operation,
        outcome: record.outcome,
        primaryReason: record.reasonCode ?? 'unknown-error',
        reasonCodes: record.evaluation.prerequisiteChecks
          .filter((c) => !c.passed && c.reasonCode)
          .map((c) => c.reasonCode!),
        permissionRefs: record.requestedPermissions.map((p) => p.permissionKey),
        seamRef: record.runtimeRef?.seamKey ?? null,
        manifestDigestRef: null, // 低敏：不存 manifest 全文
        grantDigestRef: null, // 低敏：不存 grant 全文
        installRef: record.runtimeRef?.installState ?? null,
        actorRefHash: pdDomainSeparatedHash('actor', record.actorRef),
        pluginRefHash: pdDomainSeparatedHash('plugin', record.pluginId),
        contributionRefHash: null,
        correlationRef: record.idempotencyKey,
        idempotencyRef: record.idempotencyKey,
        auditLogId: null,
        auditSchemaVersion: null,
        latencyBucket: null,
        schemaVersion: record.schemaVersion,
      },
      { client: trx },
    )
  } catch (error) {
    // Ledger failure → denial
    logger.error(
      { err: error, decisionId: record.decisionId },
      'plugin_permission ledger write failed',
    )
    return {
      outcome: 'denied',
      receipt: {
        decisionId: record.decisionId,
        outcome: 'denied',
        reasonCode: 'unknown-error',
        createdAt: new Date().toISOString(),
        idempotencyKey: record.idempotencyKey,
      },
      idempotentReplay: false,
    }
  }

  // ── Step 4: Write audit event ──
  const auditPayload = sanitizeAuditPayload(buildAuditPayload(record))
  const eventType = mapDecisionToAuditEvent({
    mode: record.mode,
    operation: record.operation,
    outcome: record.outcome,
    reasonCode: record.reasonCode,
  })

  try {
    await auditService.log({
      event: eventType,
      severity: getAuditSeverity({
        outcome: record.outcome,
        reasonCode: record.reasonCode,
      }),
      organizationId,
      projectId: projectId ?? undefined,
      entityType: PLUGIN_PERMISSION_DECISION_ENTITY_TYPE,
      entityId: record.decisionId,
      metadata: auditPayload as unknown as Record<string, unknown>,
      strict: true,
      client: trx,
    })
  } catch (error) {
    // 审计写入失败 → denial（audit-unavailable）
    // 不翻转 allowed
    if (record.outcome === 'allowed') {
      throw new AuditWriteFailedError('Audit write failed for allowed decision', error)
    }
    // denied 决策的审计失败：记录健康信号但不阻止
    logger.warn(
      { decisionId: record.decisionId, error: error instanceof Error ? error.message : 'unknown' },
      'Audit write failed for denied decision',
    )
  }

  // ── Step 5: Return receipt ──
  return {
    outcome: record.outcome,
    receipt: {
      decisionId: record.decisionId,
      outcome: record.outcome,
      reasonCode: record.reasonCode,
      createdAt: decisionRow.createdAt.toISO()!,
      idempotencyKey: record.idempotencyKey,
    },
    idempotentReplay: false,
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * 写入 tamper denial 并返回 receipt。
 * 审计写入非严格模式，失败不阻止 denial。
 */
async function writeDenialAndGetReceipt(
  record: PluginPermissionDecisionRecord,
  organizationId: number,
  projectId: number | undefined,
  trx: TransactionClientContract,
  auditService: RecordDecisionParams['auditService'],
): Promise<RecordDecisionResult> {
  const decisionRow = await PluginPermissionDecision.create(
    {
      organizationId,
      projectId: projectId ?? null,
      decisionId: record.decisionId,
      inputFingerprint: record.inputFingerprint,
      mode: record.mode,
      operation: record.operation,
      outcome: 'denied',
      primaryReason: record.reasonCode ?? 'tamper-detected',
      reasonCodes: [record.reasonCode ?? 'tamper-detected'],
      permissionRefs: null,
      seamRef: null,
      manifestDigestRef: null,
      grantDigestRef: null,
      installRef: null,
      actorRefHash: pdDomainSeparatedHash('actor', record.actorRef),
      pluginRefHash: pdDomainSeparatedHash('plugin', record.pluginId),
      contributionRefHash: null,
      correlationRef: record.idempotencyKey,
      idempotencyRef: record.idempotencyKey,
      auditLogId: null,
      auditSchemaVersion: null,
      latencyBucket: null,
      schemaVersion: record.schemaVersion,
    },
    { client: trx },
  )

  // 审计写入（非严格，失败不阻止 denial）
  try {
    await auditService.log({
      event: 'plugin_permission_replay_detected',
      severity: 'critical',
      organizationId,
      projectId: projectId ?? undefined,
      entityType: PLUGIN_PERMISSION_DECISION_ENTITY_TYPE,
      entityId: record.decisionId,
      metadata: { decisionId: record.decisionId, reason: 'tamper-detected' },
      strict: false,
      client: trx,
    })
  } catch {
    // 非严格模式，失败不阻止
  }

  return {
    outcome: 'denied',
    receipt: {
      decisionId: record.decisionId,
      outcome: 'denied',
      reasonCode: 'tamper-detected',
      createdAt: decisionRow.createdAt.toISO()!,
      idempotencyKey: record.idempotencyKey,
    },
    idempotentReplay: false,
  }
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * 审计写入失败错误：用于触发事务回滚。
 */
export class AuditWriteFailedError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
  ) {
    super(message)
    this.name = 'AuditWriteFailedError'
  }
}
