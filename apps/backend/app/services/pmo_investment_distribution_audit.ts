import { AuditEvent, type AuditEntry, type AuditEventType } from '#services/audit_service'
import type { PmoInvestmentDistributionMeta, PmoInvestmentDistributionWarning } from '@aiproj/types'

/**
 * PMO 投入分布低敏审计载荷构造器（v3-pmo-investment-distribution §4.15）。
 *
 * 红线（design D6 / spec「Audit omits sensitive fields」）：只记录组织、actor、
 * 查询形状、维度、口径、展示模式、指标键与 hash 引用；**禁止**写入完整证据文本、
 * prompt、模型输出、token、API key、Authorization、成员明细、项目名称、
 * 受限桶标签或跨组织数据。
 */

/** 允许出现在审计 metadata 中的键白名单——新增字段必须显式加入并补测试。 */
export const PMO_INVESTMENT_AUDIT_ALLOWED_METADATA_KEYS = [
  'metricVersion',
  'basis',
  'dimension',
  'displayMode',
  'topN',
  'visibleProjectCount',
  'bucketCount',
  'redactedBucketCount',
  'warningCodes',
  'inputSignatureHash',
  'sourceFreshness',
  'cacheHit',
  'bucketKeyHash',
  'itemCount',
  'denyReason',
] as const

export type PmoInvestmentAuditMetadataKey =
  (typeof PMO_INVESTMENT_AUDIT_ALLOWED_METADATA_KEYS)[number]

export interface InvestmentAuditReadInput {
  organizationId: number
  actorId: number
  meta: PmoInvestmentDistributionMeta
  warnings: readonly PmoInvestmentDistributionWarning[]
  bucketCount: number
  redactedBucketCount: number
  topN: number
  cacheHit?: boolean
}

export interface InvestmentAuditDrillDownInput extends InvestmentAuditReadInput {
  bucketKey: string
  itemCount: number
}

export interface InvestmentAuditDeniedInput {
  organizationId: number
  actorId: number
  basis?: string
  dimension?: string
  denyReason: string
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function baseMetadata(input: InvestmentAuditReadInput): Record<string, unknown> {
  return {
    metricVersion: input.meta.metricVersion,
    basis: input.meta.basis,
    dimension: input.meta.dimension,
    displayMode: input.meta.displayMode,
    topN: input.topN,
    visibleProjectCount: input.meta.visibleProjectCount,
    bucketCount: input.bucketCount,
    redactedBucketCount: input.redactedBucketCount,
    warningCodes: [...new Set(input.warnings.map((warning) => warning.code))].sort(),
    inputSignatureHash: input.meta.inputSignatureHash ?? null,
    sourceFreshness: input.meta.sourceFreshness.map((freshness) => ({
      source: freshness.source,
      isStale: freshness.isStale,
    })),
    cacheHit: input.cacheHit ?? false,
  }
}

export function buildInvestmentDistributionReadAudit(input: InvestmentAuditReadInput): AuditEntry {
  return {
    event: AuditEvent.PMO_INVESTMENT_DISTRIBUTION_READ as AuditEventType,
    organizationId: input.organizationId,
    userId: input.actorId,
    entityType: 'pmo_investment_distribution',
    metadata: baseMetadata(input),
  }
}

export function buildInvestmentDistributionDrillDownAudit(
  input: InvestmentAuditDrillDownInput,
): AuditEntry {
  return {
    event: AuditEvent.PMO_INVESTMENT_DISTRIBUTION_DRILL_DOWN as AuditEventType,
    organizationId: input.organizationId,
    userId: input.actorId,
    entityType: 'pmo_investment_distribution',
    metadata: {
      ...baseMetadata(input),
      // 只留 bucket key 的 hash，避免受限部门/负责人标签落库
      bucketKeyHash: stableHash(`${input.meta.dimension}:${input.bucketKey}`),
      itemCount: input.itemCount,
    },
  }
}

export function buildInvestmentDistributionDeniedAudit(
  input: InvestmentAuditDeniedInput,
): AuditEntry {
  return {
    event: AuditEvent.PMO_INVESTMENT_DISTRIBUTION_PERMISSION_DENIED as AuditEventType,
    organizationId: input.organizationId,
    userId: input.actorId,
    entityType: 'pmo_investment_distribution',
    severity: 'warning',
    metadata: {
      basis: input.basis ?? null,
      dimension: input.dimension ?? null,
      denyReason: input.denyReason,
    },
  }
}

/**
 * 低敏自检：metadata 只允许白名单键，且序列化后不得出现敏感词。
 * 供 §4.16 审计测试与运行时防回归使用。
 */
export function isLowSensitiveInvestmentAuditEntry(entry: AuditEntry): boolean {
  const metadata = entry.metadata ?? {}
  const allowed = new Set<string>(PMO_INVESTMENT_AUDIT_ALLOWED_METADATA_KEYS)
  for (const key of Object.keys(metadata)) {
    if (!allowed.has(key)) return false
  }

  const payload = JSON.stringify(entry).toLowerCase()
  const forbidden = [
    'prompt',
    'completion',
    'model_output',
    'authorization',
    'bearer ',
    'token',
    'api_key',
    'apikey',
    'secret',
    'password',
    'evidencetext',
    'membername',
    'projectname',
  ]
  return !forbidden.some((term) => payload.includes(term))
}
