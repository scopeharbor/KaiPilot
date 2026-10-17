/**
 * v3-enterprise-audit-enhancement — 共享契约纯函数测试
 *
 * 覆盖：稳定签名/hash、禁止键检测、warning 聚合、保留策略归一化、
 * 类型守卫、scope 归一化、证据包摘要生成与异常分桶。
 */

import { describe, it, expect } from 'vitest'
import {
  fnv1aHash,
  computeStableSignature,
  computeRecordDigest,
  computeDigestOfDigests,
  normalizeTimestamp,
  detectForbiddenKeys,
  sortWarningsBySeverity,
  normalizeRetentionPolicy,
  aggregateWarnings,
  isEnterpriseAuditAction,
  isEnterpriseAuditPermission,
  isEvidencePackageStatus,
  isVerificationStatus,
  isAnomalyCategory,
  isRedactionWarningCode,
  isStaleSourceCode,
  isEvidenceWarningCode,
  isVerificationWarningCode,
  isRetentionWarningCode,
} from '../src/enterprise-audit-enhancement.js'
import {
  buildScopeFilter,
  buildScope,
  buildEvidencePackagePreview,
  buildEvidencePackageLedgerEntry,
  buildEvidencePackageLedgerEntryWithStatus,
  buildEvidencePackageManifest,
  buildVerificationResult,
  buildVerificationResultWithStatus,
  buildRetentionSummary,
  buildAnomalySummary,
  buildLargeRecordDigestSet,
  buildLargeAnomalySet,
  buildBoundedDigestSet,
  buildRedactedDigest,
} from '../src/enterprise-audit-enhancement-fixtures.js'

// ---------------------------------------------------------------------------
// fnv1aHash
// ---------------------------------------------------------------------------

describe('fnv1aHash', () => {
  it('空字符串返回确定值', () => {
    expect(fnv1aHash('')).toBe('811c9dc5')
  })

  it('相同输入产生相同 hash', () => {
    const a = fnv1aHash('hello world')
    const b = fnv1aHash('hello world')
    expect(a).toBe(b)
  })

  it('不同输入产生不同 hash', () => {
    const a = fnv1aHash('hello')
    const b = fnv1aHash('world')
    expect(a).not.toBe(b)
  })

  it('Unicode 输入稳定', () => {
    const a = fnv1aHash('审计日志测试')
    const b = fnv1aHash('审计日志测试')
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// computeStableSignature
// ---------------------------------------------------------------------------

describe('computeStableSignature', () => {
  it('键顺序不影响结果', () => {
    const a = computeStableSignature({ a: 1, b: 2 })
    const b = computeStableSignature({ b: 2, a: 1 })
    expect(a).toBe(b)
  })

  it('不同值产生不同签名', () => {
    const a = computeStableSignature({ a: 1 })
    const b = computeStableSignature({ a: 2 })
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// computeRecordDigest
// ---------------------------------------------------------------------------

describe('computeRecordDigest', () => {
  it('相同记录产生相同摘要', () => {
    const record = {
      id: 1,
      createdAt: '2026-07-15T10:00:00.000Z',
      action: 'create',
      event: 'TASK_CREATED',
      severity: 'info',
    }
    const a = computeRecordDigest(record)
    const b = computeRecordDigest(record)
    expect(a).toBe(b)
  })

  it('时间归一化忽略毫秒', () => {
    const a = computeRecordDigest({
      id: 1,
      createdAt: '2026-07-15T10:00:00.123Z',
      action: 'create',
      event: 'TASK_CREATED',
      severity: 'info',
    })
    const b = computeRecordDigest({
      id: 1,
      createdAt: '2026-07-15T10:00:00.999Z',
      action: 'create',
      event: 'TASK_CREATED',
      severity: 'info',
    })
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// computeDigestOfDigests
// ---------------------------------------------------------------------------

describe('computeDigestOfDigests', () => {
  it('相同摘要集合产生相同 digest', () => {
    const digests = ['abc', 'def', 'ghi']
    expect(computeDigestOfDigests(digests)).toBe(computeDigestOfDigests([...digests].reverse()))
  })
})

// ---------------------------------------------------------------------------
// normalizeTimestamp
// ---------------------------------------------------------------------------

describe('normalizeTimestamp', () => {
  it('保留前 19 字符', () => {
    expect(normalizeTimestamp('2026-07-15T10:00:00.123Z')).toBe('2026-07-15T10:00:00')
  })
})

// ---------------------------------------------------------------------------
// detectForbiddenKeys
// ---------------------------------------------------------------------------

describe('detectForbiddenKeys', () => {
  it('检测 Authorization', () => {
    const result = detectForbiddenKeys({ Authorization: 'Bearer xxx' })
    expect(result).toContain('Authorization')
  })

  it('检测 apiKey', () => {
    const result = detectForbiddenKeys({ apiKey: 'sk-123' })
    expect(result).toContain('apiKey')
  })

  it('检测 secret', () => {
    const result = detectForbiddenKeys({ secret: 'my-secret' })
    expect(result).toContain('secret')
  })

  it('检测 password', () => {
    const result = detectForbiddenKeys({ password: 'plain123' })
    expect(result).toContain('password')
  })

  it('检测 prompt', () => {
    const result = detectForbiddenKeys({ prompt: '请分析...' })
    expect(result).toContain('prompt')
  })

  it('检测 modelOutput', () => {
    const result = detectForbiddenKeys({ modelOutput: '{"result":"ok"}' })
    expect(result).toContain('modelOutput')
  })

  it('递归检测嵌套对象', () => {
    const result = detectForbiddenKeys({ nested: { apiKey: 'sk-456' } })
    expect(result).toContain('apiKey')
  })

  it('检测数组中的嵌套禁止键', () => {
    const result = detectForbiddenKeys([{ apiKey: 'key1' }, { secret: 's1' }])
    expect(result).toContain('apiKey')
    expect(result).toContain('secret')
  })

  it('无禁止键返回空数组', () => {
    const result = detectForbiddenKeys({ name: 'test', email: 'a@b.com' })
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// sortWarningsBySeverity
// ---------------------------------------------------------------------------

describe('sortWarningsBySeverity', () => {
  it('按 severity 降序排序', () => {
    const warnings = [
      { code: 'A', severity: 'info' },
      { code: 'B', severity: 'critical' },
      { code: 'C', severity: 'warning' },
    ]
    const sorted = sortWarningsBySeverity(warnings)
    expect(sorted[0].code).toBe('B')
    expect(sorted[1].code).toBe('C')
    expect(sorted[2].code).toBe('A')
  })
})

// ---------------------------------------------------------------------------
// normalizeRetentionPolicy
// ------------ ----------------------------------- -------

describe('normalizeRetentionPolicy', () => {
  it('未配置时使用默认值并返回 warning', () => {
    const result = normalizeRetentionPolicy({})
    expect(result.maxDays).toBe(365)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('NO_RETENTION_POLICY_CONFIGURED')
  })

  it('配置自定义保留天数', () => {
    const result = normalizeRetentionPolicy({ maxDays: 180 })
    expect(result.maxDays).toBe(180)
    expect(result.warnings).toHaveLength(0)
  })

  it('配置冻结时间', () => {
    const result = normalizeRetentionPolicy({ maxDays: 365, freezeUntil: '2027-01-01' })
    expect(result.freezeUntil).toBe('2027-01-01')
  })
})

// ---------------------------------------------------------------------------
// aggregateWarnings
// ---------------------------------------------------------------------------

describe('aggregateWarnings', () => {
  it('按 code 去重', () => {
    const result = aggregateWarnings([
      { code: 'LARGE_RESULT_SET', severity: 'warning' },
      { code: 'LARGE_RESULT_SET', severity: 'info' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('warning') // 保留更高 severity
  })

  it('不同 code 保留', () => {
    const result = aggregateWarnings([
      { code: 'A', severity: 'warning' },
      { code: 'B', severity: 'error' },
    ])
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// isEnterpriseAuditAction / 类型守卫
// ---------------------------------------------------------------------------

describe('类型守卫', () => {
  it('isEnterpriseAuditAction', () => {
    expect(isEnterpriseAuditAction('preview')).toBe(true)
    expect(isEnterpriseAuditAction('invalid')).toBe(false)
  })

  it('isEnterpriseAuditPermission', () => {
    expect(isEnterpriseAuditPermission('audit:enterprise:view')).toBe(true)
    expect(isEnterpriseAuditPermission('audit:log:view')).toBe(false)
  })

  it('isEvidencePackageStatus', () => {
    expect(isEvidencePackageStatus('confirmed')).toBe(true)
    expect(isEvidencePackageStatus('unknown')).toBe(false)
  })

  it('isVerificationStatus', () => {
    expect(isVerificationStatus('passed')).toBe(true)
    expect(isVerificationStatus('unknown')).toBe(false)
  })

  it('isAnomalyCategory', () => {
    expect(isAnomalyCategory('permission_denied_burst')).toBe(true)
    expect(isAnomalyCategory('unknown_category')).toBe(false)
  })

  it('isRedactionWarningCode', () => {
    expect(isRedactionWarningCode('REDACTED_SENSITIVE_FIELD')).toBe(true)
    expect(isRedactionWarningCode('UNKNOWN')).toBe(false)
  })

  it('isStaleSourceCode', () => {
    expect(isStaleSourceCode('STALE_SOURCE_SIGNATURE')).toBe(true)
    expect(isStaleSourceCode('UNKNOWN')).toBe(false)
  })

  it('isEvidenceWarningCode', () => {
    expect(isEvidenceWarningCode('LARGE_RESULT_SET')).toBe(true)
    expect(isEvidenceWarningCode('UNKNOWN')).toBe(false)
  })

  it('isVerificationWarningCode', () => {
    expect(isVerificationWarningCode('MISSING_REQUEST_CONTEXT')).toBe(true)
    expect(isVerificationWarningCode('UNKNOWN')).toBe(false)
  })

  it('isRetentionWarningCode', () => {
    expect(isRetentionWarningCode('NO_RETENTION_POLICY_CONFIGURED')).toBe(true)
    expect(isRetentionWarningCode('UNKNOWN')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Fixture 构造器
// ---------------------------------------------------------------------------

describe('buildScopeFilter', () => {
  it('返回默认值', () => {
    const filter = buildScopeFilter()
    expect(filter.organizationId).toBe(1)
    expect(filter.dateFrom).toBe('2026-07-01')
    expect(filter.dateTo).toBe('2026-07-31')
  })

  it('覆盖', () => {
    const filter = buildScopeFilter({ organizationId: 2 })
    expect(filter.organizationId).toBe(2)
  })
})

describe('buildScope', () => {
  it('自动计算 filterHash', () => {
    const scope = buildScope()
    expect(scope.filterHash).toBeTruthy()
  })
})

describe('buildEvidencePackagePreview', () => {
  it('返回有效预览', () => {
    const preview = buildEvidencePackagePreview()
    expect(preview.requiresConfirmation).toBe(true)
    expect(preview.sourceSignature).toBeTruthy()
    expect(preview.packageHash).toBeTruthy()
    expect(preview.estimatedRowCount).toBe(42)
  })
})

describe('buildEvidencePackageLedgerEntry', () => {
  it('返回有效 ledger 条目', () => {
    const entry = buildEvidencePackageLedgerEntry()
    expect(entry.status).toBe('confirmed')
    expect(entry.id).toBe(1)
  })

  it('withStatus 覆盖', () => {
    const entry = buildEvidencePackageLedgerEntryWithStatus('stale')
    expect(entry.status).toBe('stale')
  })
})

describe('buildEvidencePackageManifest', () => {
  it('返回有效 manifest', () => {
    const manifest = buildEvidencePackageManifest()
    expect(manifest.packageId).toBe(1)
    expect(manifest.recordDigests).toHaveLength(2)
  })
})

describe('buildVerificationResult', () => {
  it('返回有效校验结果', () => {
    const result = buildVerificationResult()
    expect(result.status).toBe('passed')
    expect(result.verifiedRowCount).toBe(42)
  })

  it('withStatus 覆盖', () => {
    const result = buildVerificationResultWithStatus('failed')
    expect(result.status).toBe('failed')
  })
})

describe('buildRetentionSummary', () => {
  it('返回有效保留摘要', () => {
    const summary = buildRetentionSummary()
    expect(summary.policy.maxDays).toBe(365)
    expect(summary.warnings).toHaveLength(1)
  })
})

describe('buildAnomalySummary', () => {
  it('返回有效异常摘要', () => {
    const summary = buildAnomalySummary()
    expect(summary.items).toHaveLength(1)
    expect(summary.totalCount).toBe(15)
  })
})

// ---------------------------------------------------------------------------
// 大范围 fixture
// ---------------------------------------------------------------------------

describe('buildLargeRecordDigestSet', () => {
  it('生成指定数量', () => {
    const digests = buildLargeRecordDigestSet(100)
    expect(digests).toHaveLength(100)
  })

  it('摘要唯一', () => {
    const digests = buildLargeRecordDigestSet(50)
    const unique = new Set(digests)
    expect(unique.size).toBe(50)
  })
})

describe('buildBoundedDigestSet', () => {
  it('不超过上限', () => {
    const digests = buildBoundedDigestSet(500)
    expect(digests).toHaveLength(100) // 上限 100
  })
})

describe('buildLargeAnomalySet', () => {
  it('构建指定类别的大集合', () => {
    const result = buildLargeAnomalySet('login_failure_burst', 5)
    expect(result.items).toHaveLength(5)
    expect(result.totalCount).toBe(5)
    expect(result.items[0].category).toBe('login_failure_burst')
  })
})
