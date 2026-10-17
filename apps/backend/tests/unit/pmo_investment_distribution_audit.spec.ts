import { test } from '@japa/runner'
import { EVENT_TO_ACTION } from '#services/audit_service'
import {
  PMO_INVESTMENT_AUDIT_ALLOWED_METADATA_KEYS,
  buildInvestmentDistributionDeniedAudit,
  buildInvestmentDistributionDrillDownAudit,
  buildInvestmentDistributionReadAudit,
  isLowSensitiveInvestmentAuditEntry,
} from '#services/pmo_investment_distribution_audit'
import type { PmoInvestmentDistributionMeta } from '@aiproj/types'

const meta: PmoInvestmentDistributionMeta = {
  calculatedAt: '2026-07-28T10:00:00.000Z',
  metricVersion: 'pmo-investment-distribution.v1',
  organizationId: 1,
  actorId: 7,
  visibleProjectCount: 12,
  basis: 'estimated_effort_hours',
  dimension: 'department',
  displayMode: 'donut',
  totalBasisValue: 480,
  sourceFreshness: [
    {
      source: 'task_requirement',
      lastUpdatedAt: '2026-07-28T09:00:00.000Z',
      isStale: true,
      staleThresholdMinutes: 60,
    },
  ],
  inputSignatureHash: 'a1b2c3d4',
}

const warnings = [
  { code: 'SOURCE_STALE' as const, message: '来源已过期', source: 'task_requirement' as const },
  {
    code: 'PERMISSION_REDACTED' as const,
    message: '受限',
    dimension: 'department' as const,
  },
  { code: 'SOURCE_STALE' as const, message: '来源已过期', source: 'project' as const },
]

const readInput = {
  organizationId: 1,
  actorId: 7,
  meta,
  warnings,
  bucketCount: 5,
  redactedBucketCount: 1,
  topN: 10,
  cacheHit: true,
}

test.group('PMO 投入分布低敏审计（§4.15/§4.16）', () => {
  test('读取审计只发出白名单低敏元数据', async ({ assert }) => {
    const entry = buildInvestmentDistributionReadAudit(readInput)

    assert.equal(entry.event, 'PMO_INVESTMENT_DISTRIBUTION_READ')
    assert.equal(entry.organizationId, 1)
    assert.equal(entry.userId, 7)
    assert.equal(entry.entityType, 'pmo_investment_distribution')
    assert.equal(EVENT_TO_ACTION[entry.event], 'read', '只读聚合必须映射到 read 动词')

    const metadata = entry.metadata as Record<string, unknown>
    assert.equal(metadata.metricVersion, 'pmo-investment-distribution.v1')
    assert.equal(metadata.basis, 'estimated_effort_hours')
    assert.equal(metadata.dimension, 'department')
    assert.equal(metadata.displayMode, 'donut')
    assert.equal(metadata.topN, 10)
    assert.equal(metadata.visibleProjectCount, 12)
    assert.equal(metadata.bucketCount, 5)
    assert.equal(metadata.redactedBucketCount, 1)
    assert.equal(metadata.inputSignatureHash, 'a1b2c3d4')
    assert.isTrue(metadata.cacheHit)
    assert.deepEqual(metadata.warningCodes, ['PERMISSION_REDACTED', 'SOURCE_STALE'])
    assert.deepEqual(metadata.sourceFreshness, [{ source: 'task_requirement', isStale: true }])

    for (const key of Object.keys(metadata)) {
      assert.include(PMO_INVESTMENT_AUDIT_ALLOWED_METADATA_KEYS as readonly string[], key)
    }
  })

  test('钻取审计只记录 bucket key 的 hash，不落受限桶标签', async ({ assert }) => {
    const entry = buildInvestmentDistributionDrillDownAudit({
      ...readInput,
      bucketKey: '战略研发部',
      itemCount: 3,
    })

    const metadata = entry.metadata as Record<string, unknown>
    assert.equal(entry.event, 'PMO_INVESTMENT_DISTRIBUTION_DRILL_DOWN')
    assert.equal(metadata.itemCount, 3)
    assert.isString(metadata.bucketKeyHash)
    assert.notInclude(JSON.stringify(entry), '战略研发部', '受限桶标签不得落库')
    assert.isUndefined(metadata.bucketKey)
  })

  test('权限拒绝审计不泄露组合规模或桶信息', async ({ assert }) => {
    const entry = buildInvestmentDistributionDeniedAudit({
      organizationId: 1,
      actorId: 99,
      basis: 'project_count',
      dimension: 'department',
      denyReason: 'portfolio_view_denied',
    })

    const metadata = entry.metadata as Record<string, unknown>
    assert.equal(entry.event, 'PMO_INVESTMENT_DISTRIBUTION_PERMISSION_DENIED')
    // 权限拒绝事件的 action 是 reject 不是 read：仓库里 31 个 *_PERMISSION_DENIED 都映射成
    // reject，只有 4 个历史遗留写成 read。这里按主流约定断言，不把观察动作与拒绝动作混为一谈。
    assert.equal(EVENT_TO_ACTION[entry.event], 'reject')
    assert.equal(entry.severity, 'warning')
    assert.equal(metadata.denyReason, 'portfolio_view_denied')
    assert.isUndefined(metadata.visibleProjectCount)
    assert.isUndefined(metadata.bucketCount)
    assert.isTrue(isLowSensitiveInvestmentAuditEntry(entry))
  })

  test('低敏自检对三类事件全部通过，且对已知违规样本失败（正向对照）', async ({ assert }) => {
    assert.isTrue(
      isLowSensitiveInvestmentAuditEntry(buildInvestmentDistributionReadAudit(readInput)),
    )
    assert.isTrue(
      isLowSensitiveInvestmentAuditEntry(
        buildInvestmentDistributionDrillDownAudit({
          ...readInput,
          bucketKey: 'platform',
          itemCount: 1,
        }),
      ),
    )

    // 正向对照 1：白名单外的键必须被拒绝
    const withExtraKey = buildInvestmentDistributionReadAudit(readInput)
    ;(withExtraKey.metadata as Record<string, unknown>).projectNames = ['Alpha']
    assert.isFalse(
      isLowSensitiveInvestmentAuditEntry(withExtraKey),
      '自检必须拒绝白名单外的 metadata 键',
    )

    // 正向对照 2：敏感词必须被拒绝
    const withSecret = buildInvestmentDistributionReadAudit(readInput)
    ;(withSecret.metadata as Record<string, unknown>).basis = 'Bearer sk-test-token'
    assert.isFalse(isLowSensitiveInvestmentAuditEntry(withSecret), '自检必须拒绝敏感凭据文本')
  })
})
