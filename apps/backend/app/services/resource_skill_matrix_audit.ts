import { AuditEvent, type AuditEntry, type AuditEventType } from '#services/audit_service'
import { stableStringHash } from '@aiproj/types'

/**
 * 资源技能矩阵低敏审计载荷构造器（v3-resource-skill-matrix §3.12）。
 *
 * 红线：只记录组织、actor、查询形状、技能 key 哈希、来源计数、新鲜度哈希和时间戳；
 * 禁止写入 prompt、模型输出、token、secret、完整证据文本或跨组织数据。
 */

export const RESOURCE_SKILL_MATRIX_AUDIT_ALLOWED_METADATA_KEYS = [
  'queryShapeHash',
  'matrixWarningCount',
  'gapCount',
  'candidateCount',
  'advisoryCount',
  'sourceCount',
  'cacheHit',
  'cacheDegraded',
  'timestamp',
  'itemType',
  'skillKeyHash',
  'itemId',
  'denyReason',
] as const

export type ResourceSkillMatrixAuditMetadataKey =
  (typeof RESOURCE_SKILL_MATRIX_AUDIT_ALLOWED_METADATA_KEYS)[number]

export interface MatrixReadAuditInput {
  organizationId: number
  actorId: number
  queryShape: Record<string, unknown>
  matrixWarningCount: number
  gapCount: number
  candidateCount: number
  advisoryCount: number
  sourceCount: number
  cacheHit?: boolean
  cacheDegraded?: boolean
}

export interface MatrixDrillDownAuditInput {
  organizationId: number
  actorId: number
  itemType: string
  skillKey: string
  itemId: number
  queryShape: Record<string, unknown>
}

export interface MatrixDeniedAuditInput {
  organizationId: number
  actorId: number
  denyReason: string
}

/**
 * 构建低敏矩阵读审计 entry。
 */
export function buildMatrixReadAudit(input: MatrixReadAuditInput): AuditEntry {
  return {
    event: AuditEvent.RESOURCE_SKILL_MATRIX_READ as AuditEventType,
    organizationId: input.organizationId,
    userId: input.actorId,
    entityType: 'resource_skill_matrix',
    metadata: {
      queryShapeHash: stableStringHash(JSON.stringify(input.queryShape)),
      matrixWarningCount: input.matrixWarningCount,
      gapCount: input.gapCount,
      candidateCount: input.candidateCount,
      advisoryCount: input.advisoryCount,
      sourceCount: input.sourceCount,
      cacheHit: input.cacheHit ?? false,
      cacheDegraded: input.cacheDegraded ?? false,
      timestamp: new Date().toISOString(),
    },
  }
}

/**
 * 构建低敏下钻审计 entry。
 */
export function buildMatrixDrillDownAudit(input: MatrixDrillDownAuditInput): AuditEntry {
  return {
    event: AuditEvent.RESOURCE_SKILL_MATRIX_DRILL_DOWN as AuditEventType,
    organizationId: input.organizationId,
    userId: input.actorId,
    entityType: 'resource_skill_matrix',
    metadata: {
      itemType: input.itemType,
      skillKeyHash: stableStringHash(input.skillKey),
      itemId: input.itemId,
      queryShapeHash: stableStringHash(JSON.stringify(input.queryShape)),
      timestamp: new Date().toISOString(),
    },
  }
}

/**
 * 构建低敏拒绝审计 entry。
 */
export function buildMatrixDeniedAudit(input: MatrixDeniedAuditInput): AuditEntry {
  return {
    event: AuditEvent.RESOURCE_SKILL_MATRIX_PERMISSION_DENIED as AuditEventType,
    organizationId: input.organizationId,
    userId: input.actorId,
    entityType: 'resource_skill_matrix',
    metadata: {
      denyReason: input.denyReason,
      timestamp: new Date().toISOString(),
    },
  }
}
