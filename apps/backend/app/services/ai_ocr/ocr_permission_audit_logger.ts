import type AuditService from '#services/audit_service'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  buildOcrPermissionAuditMetadata,
  type OcrAuthorizationDecisionSnapshot,
  type OcrPermissionAuditEvent,
} from '@aiproj/types'

/**
 * OCR 权限/审计 —— 低敏感审计元数据构建器（v3-ocr-permission-and-audit §3.6）。
 *
 * 所有审计事件只写哈希 / 引用 / 枚举码 / 计数 / 摘要，绝不写完整 OCR 文本、
 * 结构化值、搜索片段、provider 体、提示词、模型输出、密钥、授权头或绝对路径。
 * 由 `AuditService.log()` 落库（其内部 `sanitize` 二次兜底脱敏）。
 */
export interface OcrPermissionAuditMetadataInput {
  readonly event: OcrPermissionAuditEvent
  readonly snapshot: OcrAuthorizationDecisionSnapshot
  readonly countSummaries?: Readonly<Record<string, number>>
  readonly warningCodes?: readonly string[]
  readonly providerSummary?: { readonly provider: string; readonly model: string } | null
}

/** 由决策快照构造低敏感审计元数据（不含事件名，事件名由 AuditService.log 追加）。 */
export function buildOcrPermissionAuditMetadataFromSnapshot(
  input: OcrPermissionAuditMetadataInput,
): Record<string, unknown> {
  const s = input.snapshot
  return buildOcrPermissionAuditMetadata({
    event: input.event,
    action: s.action,
    result: s.result,
    sourceRefKind: s.sourceRef?.kind ?? null,
    sourceHash: s.sourceHash,
    artifactRefKind: s.artifactRef?.kind ?? null,
    artifactRefId: s.artifactRef?.id ?? null,
    contentHash: null,
    lifecycleState: s.lifecycleState,
    retentionState: s.retentionState,
    privacyHash: s.privacyHash,
    decisionHash: s.decisionHash,
    reasonCodes: s.reasonCodes,
    countSummaries: input.countSummaries,
    warningCodes: input.warningCodes,
    providerSummary: input.providerSummary,
  })
}

/**
 * 构造完整的 AuditEntry 载荷（供 AuditService.log 使用）。
 * 事件名映射：`OCR_PERMISSION_STATUS_READ` 等受 AuditService 的 EVENT_TO_ACTION 约束。
 */
export function buildOcrPermissionAuditEntry(input: {
  readonly event: string
  readonly snapshot: OcrAuthorizationDecisionSnapshot
  readonly countSummaries?: Readonly<Record<string, number>>
  readonly warningCodes?: readonly string[]
  readonly providerSummary?: { readonly provider: string; readonly model: string } | null
  readonly entityType?: string | null
  readonly entityId?: number | null
}): Parameters<AuditService['log']>[0] {
  const s = input.snapshot
  return {
    event: input.event as never,
    userId: s.actorRef.id,
    organizationId: s.organizationRef.id,
    projectId: s.projectRef.id,
    entityType: input.entityType ?? 'ocr',
    entityId: input.entityId ?? s.artifactRef?.id ?? null,
    metadata: buildOcrPermissionAuditMetadataFromSnapshot({
      event: input.event as never,
      snapshot: input.snapshot,
      countSummaries: input.countSummaries,
      warningCodes: input.warningCodes,
      providerSummary: input.providerSummary,
    }),
  }
}

/**
 * 边界拒绝事件映射（§4.8）：决策结果 → AuditEvent 常量。
 * 仅对「拒绝 / 陈旧 / 隐私阻止 / 保留滞留」这类边界决策写审计；
 * 常规放行/仅元数据读取不写（避免高分贝只读访问产生噪声保留面）。
 */
export function boundaryAuditEventForResult(
  result: OcrAuthorizationDecisionSnapshot['result'],
): string | null {
  switch (result) {
    case 'denied':
      return 'OCR_PERMISSION_DENIAL'
    case 'stale_blocked':
      return 'OCR_PERMISSION_STALE_BLOCK'
    case 'privacy_blocked':
      return 'OCR_PERMISSION_PRIVACY_BLOCK'
    case 'retention_blocked':
      return 'OCR_PERMISSION_RETENTION_HOLD'
    default:
      return null
  }
}

/**
 * 在 API 边界写一条低敏拒绝/陈旧/隐私/保留审计（§4.8）。
 * 不阻塞响应路径（log() 内部吞错）；同一边界决策只写一条。
 *
 * `client`：**在事务内调用时必须传**。`AuditService.log` 默认走独立连接，
 * 而 SQLite 的连接池只有一条——事务持有它时再去取第二条会直接把池耗尽，
 * 表现为整个用例 `Test timeout` / `KnexTimeoutError: pool is probably full`。
 */
export async function writeOcrBoundaryAudit(
  audit: AuditService,
  snapshot: OcrAuthorizationDecisionSnapshot,
  client?: TransactionClientContract,
): Promise<void> {
  const event = boundaryAuditEventForResult(snapshot.result)
  if (!event) return
  const entry = buildOcrPermissionAuditEntry({ event, snapshot })
  await audit.log(client ? { ...entry, client } : entry)
}
