import { AuditEvent, type AuditEntry, type AuditEventType } from '#services/audit_service'
import { stableStringHash } from '@aiproj/types'
import { RESOURCE_GAP_ANALYSIS_METRIC_VERSION } from '@aiproj/types'

/**
 * 资源缺口分析低敏审计载荷构造器（v3-resource-gap-analysis §7.1-7.3）。
 *
 * 红线：
 *   - 只记录 organizationId、actorId、query shape、redaction、freshness、metricVersion。
 *   - 禁止写入 PII、原始 evidence 文本、prompt、模型输出、token、secret。
 *   - drill-down 标注 target 能力（resource-contention-detection / resource-demand-forecasting / resource-registry-and-allocation）与授权判定。
 *   - 无写入路径断言无高敏事件。
 */

export const RESOURCE_GAP_AUDIT_ALLOWED_METADATA_KEYS = [
  'queryType',
  'queryShapeHash',
  'metricVersion',
  'redacted',
  'warningCodes',
  'gapCount',
  'severityDistribution',
  'dimension',
  'sourceCapability',
  'authorized',
  'denyReason',
  'timestamp',
] as const

export type ResourceGapAuditMetadataKey = (typeof RESOURCE_GAP_AUDIT_ALLOWED_METADATA_KEYS)[number]

export interface GapReadAuditInput {
  organizationId: number
  actorId: number
  queryType: string
  queryShape: Record<string, unknown>
  redacted: boolean
  warningCodes: string[]
  gapCount?: number
  severityDistribution?: Record<string, number>
}

export interface GapDrillDownAuditInput {
  organizationId: number
  actorId: number
  gapId: string
  sourceCapability: string
  authorized: boolean
  queryShape: Record<string, unknown>
}

export interface GapDeniedAuditInput {
  organizationId: number
  actorId: number
  denyReason: string
}

/**
 * 构建低敏缺口分析读审计 entry（§7.1）。
 */
export function buildGapReadAudit(input: GapReadAuditInput): AuditEntry {
  const metadata: Record<string, unknown> = {
    queryType: input.queryType,
    queryShapeHash: stableStringHash(JSON.stringify(input.queryShape)),
    metricVersion: RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
    redacted: input.redacted,
    warningCodes: input.warningCodes,
    timestamp: new Date().toISOString(),
  }

  if (input.gapCount !== undefined) {
    metadata.gapCount = input.gapCount
  }
  if (input.severityDistribution) {
    metadata.severityDistribution = input.severityDistribution
  }

  return {
    event: AuditEvent.RESOURCE_GAP_READ as AuditEventType,
    organizationId: input.organizationId,
    userId: input.actorId,
    entityType: 'resource_gap_analysis',
    metadata,
  }
}

/**
 * 构建低敏缺口下钻审计 entry（§7.2）。
 * 标注 target 能力与授权判定。
 */
export function buildGapDrillDownAudit(input: GapDrillDownAuditInput): AuditEntry {
  return {
    event: AuditEvent.RESOURCE_GAP_DRILL_DOWN as AuditEventType,
    organizationId: input.organizationId,
    userId: input.actorId,
    entityType: 'resource_gap_analysis',
    metadata: {
      gapIdHash: stableStringHash(input.gapId),
      sourceCapability: input.sourceCapability,
      authorized: input.authorized,
      queryShapeHash: stableStringHash(JSON.stringify(input.queryShape)),
      timestamp: new Date().toISOString(),
    },
  }
}

/**
 * 构建低敏拒绝审计 entry。
 */
export function buildGapDeniedAudit(input: GapDeniedAuditInput): AuditEntry {
  return {
    event: AuditEvent.RESOURCE_GAP_PERMISSION_DENIED as AuditEventType,
    organizationId: input.organizationId,
    userId: input.actorId,
    entityType: 'resource_gap_analysis',
    metadata: {
      denyReason: input.denyReason,
      timestamp: new Date().toISOString(),
    },
  }
}
