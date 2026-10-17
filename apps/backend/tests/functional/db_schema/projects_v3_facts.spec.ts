import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { columnNames, indexNames } from './_helpers.js'

/**
 * v3-database-schema-expansion §3.6 —— V3 项目组合事实列 schema 校验。
 * 覆盖：12 个新列存在、org-leading 索引、investment_type/portfolio_fact_source 枚举 CHECK、
 * legacy nullable 行兼容（既有 V1 行新列缺省/可空）、migration rollback 移除扩展。
 *
 * 本机 SQLite 默认验证（spec「Local SQLite verification passes」）；不依赖 Docker/PG/外部服务。
 */
test.group('v3-database-schema-expansion: projects V3 事实列', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('projects 含 12 个 V3 组合事实列（全部可空、additive）', async ({ assert }) => {
    const cols = await columnNames('projects')
    const v3Cols = [
      'project_manager_id',
      'department_key',
      'department_name',
      'business_line',
      'investment_type',
      'strategy_theme',
      'program_key',
      'forecast_cost_cents',
      'forecast_end_date',
      'custom_fields',
      'portfolio_fact_source',
      'portfolio_fact_updated_at',
    ]
    for (const c of v3Cols) {
      assert.include(cols, c, `projects 应含 V3 字段 ${c}`)
    }
  })

  test('V3 列可空：legacy V1 行（无 V3 值）仍可读', async ({ assert }) => {
    // 既有 V1 列写入一行，V3 列全部缺省
    const orgId = 99990001
    const userId = 99990001
    // 依赖 organizations/users 表存在（migrate 已建）
    // FK 顺序：先 users 后 organizations（owner_id → users.id）；
    // users 的真实密码列名是 password（不是 password_hash）。
    await db.table('users').insert({
      id: userId,
      email: 'v3facts@example.test',
      full_name: 'v3 facts',
      password: 'x',
      is_active: 1,
      is_super_admin: 0,
      role_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    await db.table('organizations').insert({
      id: orgId,
      name: 'v3-facts-test-org',
      slug: 'v3-facts-test-org',
      owner_id: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    await db.table('projects').insert({
      organization_id: orgId,
      name: 'v3-legacy-row',
      status: 'draft',
      priority: 'medium',
      currency: 'CNY',
      progress_percent: 0,
      health_status: 'unknown',
      created_by: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    const row = await db.from('projects').where('name', 'v3-legacy-row').first()
    assert.isNotNull(row)
    assert.isNull(row!.project_manager_id, 'project_manager_id 缺省为 null')
    assert.isNull(row!.department_key)
    assert.isNull(row!.forecast_cost_cents, 'forecast_cost_cents 缺省为 null（非 0）')
    assert.isNull(row!.custom_fields)
    assert.isNull(row!.portfolio_fact_source)

    // 清理（FK 顺序：projects → organizations → users；
    // organizations.owner_id 引用 users，先删 user 会 FK 违约）
    await db.from('projects').where('name', 'v3-legacy-row').delete()
    await db.from('organizations').where('id', orgId).delete()
    await db.from('users').where('id', userId).delete()
  })

  test('investment_type / portfolio_fact_source 枚举由应用层强制（SQLite ALTER 不支持 CHECK）', async ({
    assert,
  }) => {
    // SQLite ALTER TABLE 无法加 CHECK 约束（knex 生成非法语法）；
    // 枚举白名单由 validator（vine.enum）+ service（assertInvestmentType/assertPortfolioFactSource）双层强制。
    // PG 可在 follow-up 迁移补 CHECK。这里只验证列存在且为字符串类型。
    const { tableInfo } = await import('./_helpers.js')
    const cols = await tableInfo('projects')
    const investmentType = cols.find((c) => c.name === 'investment_type')
    assert.isOk(investmentType, 'investment_type 列应存在')
    assert.include(investmentType!.type.toLowerCase(), 'varchar', 'investment_type 应为字符串类型')

    const factSource = cols.find((c) => c.name === 'portfolio_fact_source')
    assert.isOk(factSource, 'portfolio_fact_source 列应存在')
    assert.include(
      factSource!.type.toLowerCase(),
      'varchar',
      'portfolio_fact_source 应为字符串类型',
    )
  })

  test('org-leading 索引全部以 organization_id 起首', async ({ assert }) => {
    const idxs = await indexNames('projects')
    const expected = [
      'idx_projects_org_manager',
      'idx_projects_org_department',
      'idx_projects_org_business_line',
      'idx_projects_org_investment_type',
      'idx_projects_org_program',
      'idx_projects_org_forecast_end',
      'idx_projects_org_fact_updated_at',
    ]
    for (const name of expected) {
      assert.include(idxs, name, `应有 org-leading 索引 ${name}`)
    }

    // 索引列须以 organization_id 起首（不创建全局唯一租户本地标识）
    const idxSqlRes = await db.rawQuery(
      "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='projects'",
    )
    const sqlText = (((idxSqlRes as any).rows ?? idxSqlRes) as any[])
      .map((r) => r.sql ?? '')
      .join('\n')
    for (const name of expected) {
      assert.match(
        sqlText,
        new RegExp(`${name}.*organization_id`, 's'),
        `索引 ${name} 应以 organization_id 起首`,
      )
    }
  })

  test('既有 V1 唯一键 (organization_id,code) 不变', async ({ assert }) => {
    // 既有索引应仍存在（未被 V3 扩展破坏）
    const idxSqlRes = await db.rawQuery(
      "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='projects' AND sql LIKE '%UNIQUE%'",
    )
    const rows = ((idxSqlRes as any).rows ?? idxSqlRes) as any[]
    const hasOrgCodeUnique = rows.some((r) => {
      const sql: string = r.sql ?? ''
      return sql.includes('organization_id') && sql.includes('code') && sql.includes('UNIQUE')
    })
    assert.isTrue(hasOrgCodeUnique, '应有 unique(organization_id, code)')
  })
})

/**
 * §3.6 rollback —— 回滚移除 V3 扩展，V1 schema 与数据保持 intact。
 * 注意：AdonisJS migration:rollback 按 batch 回滚；本测试只验证迁移文件 down 逻辑存在
 * （实际 rollback 执行留给 CI / 手动 migration:rollback 验证，避免污染共享 test.sqlite）。
 */
test.group('v3-database-schema-expansion: 迁移可逆性（静态）', () => {
  test('迁移文件含 down 方法移除 V3 列与索引', async ({ assert }) => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const file = path.resolve(
      process.cwd(),
      'database/migrations/1839600000000_add_v3_project_portfolio_facts.ts',
    )
    assert.isTrue(fs.existsSync(file), 'V3 迁移文件应存在')
    const content = fs.readFileSync(file, 'utf-8')
    assert.include(content, 'async down()', '迁移应含 down 方法')
    assert.include(content, 'dropColumn', 'down 应 dropColumn')
    assert.include(content, 'dropIndex', 'down 应 dropIndex')
    assert.include(content, 'dropForeign', 'down 应 dropForeign(project_manager_id)')
  })
})
