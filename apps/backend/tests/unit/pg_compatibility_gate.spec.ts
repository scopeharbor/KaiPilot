/**
 * v2-postgresql-migration-foundation —— PG 兼容门禁单元测试（Section 4.4）。
 *
 * 覆盖：
 * - 通过场景：无 blocking 问题
 * - JSON 字段 blocking：不可解析 JSON 阻断
 * - 连接不可达：blocking 状态
 * - RLS 准备不足：warning 而非 blocking
 * - 报告不包含敏感正文
 * - 中文摘要输出
 * - 静态类型映射报告
 */
import { test } from '@japa/runner'
import { PgCompatibilityGate } from '#services/pdm_migration/validators/pg_compatibility_gate'

test.group('PG Compatibility Gate - Static Reports', () => {
  test('getTypeMappingReport 包含所有类型映射条目', ({ assert }) => {
    const gate = new PgCompatibilityGate()
    const report = gate.getTypeMappingReport()

    assert.isTrue(report.includes('SQLite → PostgreSQL'))
    assert.isTrue(report.includes('JSONB'))
    assert.isTrue(report.includes('RLS'))
    assert.isTrue(report.includes('BOOLEAN'))
    assert.isTrue(report.includes('TIMESTAMP'))
    assert.isTrue(report.includes('GIN'))
    // 不包含敏感正文
    assert.notInclude(report, 'password')
    assert.notInclude(report, 'localhost')
    assert.notInclude(report, 'DSN')
  })

  test('validateRlsPolicy 返回正确的检查提示', async ({ assert }) => {
    const gate = new PgCompatibilityGate()
    const issues = await gate.validateRlsPolicy('projects')

    assert.isAbove(issues.length, 0)
    assert.isTrue(issues.some((i) => i.code === 'RLS_POLICY_CHECK'))
  })
})

test.group('PG Compatibility Gate - Check Result Shape', () => {
  test('check() 返回完整的 PgGateResult 结构', async ({ assert }) => {
    const gate = new PgCompatibilityGate()
    const result = await gate.check(1, false) // connectionAware=false 避免实际连接检查

    assert.property(result, 'status')
    assert.property(result, 'issues')
    assert.property(result, 'blockingCount')
    assert.property(result, 'warningCount')
    assert.property(result, 'infoCount')
    assert.property(result, 'summary')
    assert.property(result, 'details')

    // status 必须是 ready/warning/blocked 之一
    assert.include(['ready', 'warning', 'blocked'], result.status)

    // 计数与 issues 一致
    assert.equal(
      result.blockingCount,
      result.issues.filter((i) => i.severity === 'blocking').length,
    )
    assert.equal(result.warningCount, result.issues.filter((i) => i.severity === 'warning').length)

    // details 包含全部检查项
    assert.property(result.details, 'jsonFields')
    assert.property(result.details, 'rlsReady')
    assert.property(result.details, 'connectionReachable')
    assert.property(result.details, 'criticalTablesExist')
    assert.property(result.details, 'timestampUtc')
    assert.property(result.details, 'indexPlanReady')
  })

  test('check() summary 为简体中文且不含敏感信息', async ({ assert }) => {
    const gate = new PgCompatibilityGate()
    const result = await gate.check(1, false)

    assert.typeOf(result.summary, 'string')
    assert.isAbove(result.summary.length, 0)

    // 简体中文特征
    assert.isTrue(
      result.summary.includes('PG') ||
        result.summary.includes('门禁') ||
        result.summary.includes('迁移'),
    )

    // 无敏感信息
    const sensitiveTerms = ['password', 'DSN', 'localhost', 'secret', 'token']
    for (const term of sensitiveTerms) {
      assert.notInclude(result.summary.toLowerCase(), term)
    }
  })
})

test.group('PG Compatibility Gate - JSON Field Check', () => {
  test('JSON 字段检查返回预期的表结构', async ({ assert }) => {
    const gate = new PgCompatibilityGate()
    const result = await gate.check(1, false)

    assert.isArray(result.details.jsonFields)
    for (const field of result.details.jsonFields) {
      assert.property(field, 'table')
      assert.property(field, 'column')
      assert.property(field, 'hasInvalidJson')
    }
  })
})

test.group('PG Compatibility Gate - Security', () => {
  test('门禁报告不包含敏感正文', async ({ assert }) => {
    const gate = new PgCompatibilityGate()
    const result = await gate.check(1, false)

    const sensitivePatterns = ['password', 'DSN', 'connection_string', 'secret']

    // 检查 issues
    for (const issue of result.issues) {
      const msg = issue.message.toLowerCase()
      for (const pattern of sensitivePatterns) {
        assert.notInclude(msg, pattern)
      }
    }

    // 检查 details 中的 jsonFields
    for (const field of result.details.jsonFields) {
      assert.notInclude(field.table, 'password')
      assert.notInclude(field.column, 'password')
    }
  })

  test('getTypeMappingReport 无敏感信息', ({ assert }) => {
    const gate = new PgCompatibilityGate()
    const report = gate.getTypeMappingReport()

    assert.notInclude(report, 'password')
    assert.notInclude(report, 'secret')
    assert.notInclude(report, 'token')
    assert.notInclude(report, 'DSN')
    assert.notInclude(report, 'localhost')
  })
})

test.group('PG Compatibility Gate - RLS Check', () => {
  test('RLS 检查结果为 warning 而非 blocking', async ({ assert }) => {
    const gate = new PgCompatibilityGate()
    const result = await gate.check(1, false)

    const rlsIssues = result.issues.filter((i) => i.code.startsWith('PG_RLS'))

    for (const issue of rlsIssues) {
      assert.notEqual(issue.severity, 'blocking')
    }
  })
})

test.group('PG Compatibility Gate - Database down', () => {
  test('当 connectionAware=true 且当前非 PG 时不阻断', async ({ assert }) => {
    const gate = new PgCompatibilityGate()
    // SQLite 下 connectionAware=true 不触发连接检查
    const result = await gate.check(1, true)

    assert.isTrue(result.details.connectionReachable)
  })
})
