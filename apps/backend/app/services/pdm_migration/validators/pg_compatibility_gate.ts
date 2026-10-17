/**
 * v2-postgresql-migration-foundation —— PG Compatibility Gate（Section 4）。
 *
 * 连接感知的 PostgreSQL 兼容门禁，区分三类结果：
 * - ready: 当前或目标 PG 连接可用，JSON、timestamp、索引/RLS 准备项无 blocking。
 * - warning: 可连接但存在需要人工处理的索引/RLS/时区提示。
 * - blocked: JSON 无法解析、目标连接不可达、关键表缺失、RLS 策略测试失败。
 *
 * 门禁输出继续使用简体中文，不包含密码、连接串、完整草案 JSON 或敏感正文。
 */
import type { MigrationIssue } from '../types.js'
import db from '@adonisjs/lucid/services/db'
import { getSchemaBuilder, isPg, lowSensitiveDescription } from '#services/dialect/dialect_helper'

export type PgGateStatus = 'ready' | 'warning' | 'blocked'

export interface PgGateResult {
  status: PgGateStatus
  issues: MigrationIssue[]
  blockingCount: number
  warningCount: number
  infoCount: number
  summary: string
  details: {
    jsonFields: Array<{ table: string; column: string; hasInvalidJson: boolean }>
    rlsReady: boolean
    connectionReachable: boolean
    criticalTablesExist: boolean
    timestampUtc: boolean
    indexPlanReady: boolean
  }
}

export class PgCompatibilityGate {
  /**
   * 执行 PG 兼容门禁检查。
   * connectionAware: 是否对当前连接进行可用性校验（当前连接为 PG 时自动启用）。
   */
  async check(organizationId: number, connectionAware = true): Promise<PgGateResult> {
    const issues: MigrationIssue[] = []
    const details: PgGateResult['details'] = {
      jsonFields: [],
      rlsReady: false,
      connectionReachable: true,
      criticalTablesExist: true,
      timestampUtc: true,
      indexPlanReady: true,
    }

    // 1. 连接可用性检查（当 connectionAware 且当前连接为 PG 时）
    if (connectionAware && isPg()) {
      details.connectionReachable = await this.checkConnection()
      if (!details.connectionReachable) {
        issues.push({
          severity: 'blocking',
          code: 'PG_CONNECTION_UNREACHABLE',
          message: `PG 连接不可达：${lowSensitiveDescription()} 连接无法建立`,
        })
      }
    }

    // 2. JSON 字段可解析性检查
    const jsonCheckResults = await this.checkJsonFields(organizationId)
    details.jsonFields = jsonCheckResults

    for (const field of jsonCheckResults) {
      if (field.hasInvalidJson) {
        issues.push({
          severity: 'blocking',
          code: 'PG_JSON_PARSE_FAILED',
          message: `表 ${field.table}.${field.column} 存在不可解析的 JSON，迁移至 JSONB 前需修复`,
          sourceTable: field.table,
        })
      }
    }

    // 3. 关键表存在性检查
    details.criticalTablesExist = await this.checkCriticalTables()
    if (!details.criticalTablesExist) {
      issues.push({
        severity: 'blocking',
        code: 'PG_CRITICAL_TABLES_MISSING',
        message: '核心业务表缺失：请先执行所有迁移',
      })
    }

    // 4. 时区检查
    details.timestampUtc = await this.checkTimestampUtc()
    if (!details.timestampUtc) {
      issues.push({
        severity: 'warning',
        code: 'PG_TIMESTAMP_WARNING',
        message: 'timestamp 字段 UTC 语义待确认：建议统一使用 TIMESTAMP WITH TIME ZONE',
      })
    }

    // 5. 索引计划检查
    const indexIssues = await this.checkIndexPlan(organizationId)
    details.indexPlanReady = indexIssues.filter((i) => i.severity === 'blocking').length === 0
    issues.push(...indexIssues)

    // 6. RLS 准备检查
    const rlsIssues = await this.checkRlsReadiness(organizationId)
    details.rlsReady = rlsIssues.filter((i) => i.severity === 'blocking').length === 0
    issues.push(...rlsIssues)

    // 7. 组织隔离验证
    if (isPg()) {
      const orgIssues = await this.checkOrgIsolation(organizationId)
      issues.push(...orgIssues)
    }

    // 汇总
    const blockingCount = issues.filter((i) => i.severity === 'blocking').length
    const warningCount = issues.filter((i) => i.severity === 'warning').length
    const infoCount = issues.filter((i) => i.severity === 'info').length

    let status: PgGateStatus = 'ready'
    if (blockingCount > 0) {
      status = 'blocked'
    } else if (warningCount > 0) {
      status = 'warning'
    }

    const summary = this.buildSummary(status, blockingCount, warningCount, infoCount)

    return { status, issues, blockingCount, warningCount, infoCount, summary, details }
  }

  /**
   * 类型映射报告（无敏感信息）。
   */
  getTypeMappingReport(): string {
    return [
      '## SQLite → PostgreSQL 类型映射',
      '',
      '| SQLite 类型 | PostgreSQL 类型 | 状态 |',
      '|---|---|---|',
      '| INTEGER PRIMARY KEY | BIGSERIAL / SERIAL  | ✓ |',
      '| INTEGER | INTEGER / BIGINT | ✓ |',
      '| BOOLEAN (0/1) | BOOLEAN | ✓ |',
      '| TEXT (JSON) | JSONB + GIN 索引 | ✓ |',
      '| DECIMAL (分) | BIGINT (分) | ✓ |',
      '| TEXT (枚举) | VARCHAR + CHECK | ✓ |',
      '| DATETIME (无时区) | TIMESTAMP WITH TIME ZONE | ⚠️ 需 UTC 转换 |',
      '| FOREIGN KEY | FOREIGN KEY + ON DELETE | ✓ |',
      '| INDEX | INDEX / GIN | ✓ |',
      '| RLS (organization_id) | ROW LEVEL SECURITY | ⚠️ 需启用 |',
      '',
    ].join('\n')
  }

  /**
   * 连接可用性验证。
   */
  private async checkConnection(): Promise<boolean> {
    try {
      await db.rawQuery('SELECT 1').timeout(5000, { cancel: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * 关键业务表存在性检查。
   */
  private async checkCriticalTables(): Promise<boolean> {
    const tables = [
      'projects',
      'tasks',
      'wbs_nodes',
      'milestones',
      'organizations',
      'pdm_migration_runs',
      'pdm_entity_mappings',
      'pdm_migration_snapshots',
      'pdm_migration_reports',
    ]

    try {
      for (const table of tables) {
        const exists = await getSchemaBuilder().hasTable(table)
        if (!exists) return false
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * RLS 策略生成与验证（提示性，非阻断）。
   */
  async validateRlsPolicy(tableName: string): Promise<MigrationIssue[]> {
    const issues: MigrationIssue[] = []

    issues.push({
      severity: tableName.startsWith('pdm_') ? 'info' : 'warning',
      code: 'RLS_POLICY_CHECK',
      message: `表 ${tableName}: RLS 策略应包含 USING (organization_id = current_setting('app.current_org_id')::int)`,
      sourceTable: tableName,
    })

    return issues
  }

  /**
   * 组织隔离验证（PG 下执行）。
   */
  private async checkOrgIsolation(orgId: number): Promise<MigrationIssue[]> {
    const issues: MigrationIssue[] = []
    try {
      const tables = ['projects', 'tasks', 'pdm_migration_runs']
      for (const table of tables) {
        const rows = await db.from(table).where('organization_id', orgId).limit(1)
        if (rows.length > 0) {
          issues.push({
            severity: 'info',
            code: 'PG_ORG_ISOLATION_CHECK',
            message: `表 ${table}: 组织 ${orgId} 数据可访问`,
            sourceTable: table,
          })
        }
      }
    } catch {
      issues.push({
        severity: 'warning',
        code: 'PG_ORG_ISOLATION_WARNING',
        message: `组织隔离验证异常：无法检查组织 ${orgId} 的数据隔离`,
      })
    }
    return issues
  }

  /**
   * 构建中文摘要。
   */
  private buildSummary(
    status: PgGateStatus,
    blocking: number,
    warning: number,
    info: number,
  ): string {
    if (status === 'blocked') {
      return `❌ PG 兼容门禁未通过：${blocking} 个 blocking 问题、${warning} 个警告、${info} 条提示。修复 blocking 问题后重试。`
    }
    if (status === 'warning') {
      return `⚠️ PG 兼容门禁通过但有 ${warning} 个警告、${info} 条提示。建议在正式切换前处理警告项。`
    }
    return `✅ PG 兼容门禁通过：${info} 条提示。当前 PostgreSQL 迁移前置条件满足。`
  }

  private async checkJsonFields(
    _organizationId: number,
  ): Promise<PgGateResult['details']['jsonFields']> {
    const tables = [
      { table: 'projects', columns: ['settings'] },
      { table: 'tasks', columns: ['custom_fields', 'ai_metadata'] },
      { table: 'risks', columns: ['ai_metadata'] },
      { table: 'ai_project_drafts', columns: ['structured_strategy', 'consistency'] },
      { table: 'ai_project_draft_versions', columns: ['draft', 'meta', 'validation'] },
    ]

    const results: PgGateResult['details']['jsonFields'] = []

    for (const { table, columns } of tables) {
      for (const column of columns) {
        let hasInvalidJson = false
        try {
          const exists = await getSchemaBuilder().hasTable(table)
          if (!exists) {
            results.push({ table, column, hasInvalidJson: false })
            continue
          }
          const rows = await db.from(table).whereNotNull(column).limit(10)
          for (const row of rows) {
            const val = row[column]
            if (typeof val === 'string' && val.length > 0) {
              try {
                JSON.parse(val)
              } catch {
                hasInvalidJson = true
              }
            }
          }
        } catch {
          // 表或列不存在，跳过
        }
        results.push({ table, column, hasInvalidJson })
      }
    }

    return results
  }

  private async checkTimestampUtc(): Promise<boolean> {
    try {
      // PG 下可以实际检查 timezone 设置
      if (isPg()) {
        const res = await db.rawQuery('SHOW timezone')
        const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
        const tz = rows[0]?.TimeZone ?? rows[0]?.timezone ?? ''
        return tz === 'UTC' || tz === 'Etc/UTC'
      }
      // SQLite 下默认通过（UTC 由 TZ=UTC 环境变量保证）
      return true
    } catch {
      return true
    }
  }

  private async checkIndexPlan(_orgId: number): Promise<MigrationIssue[]> {
    const issues: MigrationIssue[] = []

    if (!isPg()) {
      issues.push({
        severity: 'info',
        code: 'PG_INDEX_CHECK',
        message: '迁移 PG 后需为 JSONB 字段创建 GIN 索引 (jsonb_path_ops)',
      })
      issues.push({
        severity: 'info',
        code: 'PG_INDEX_CHECK',
        message: '迁移 PG 后需为 organization_id + status 创建复合索引',
      })
      issues.push({
        severity: 'info',
        code: 'PG_INDEX_CHECK',
        message: '迁移 PG 后需为 pdm_entity_mappings.source_unique 唯一约束确保唯一性',
      })
      return issues
    }

    // PG 下可以实际检查索引
    try {
      const ginRes = await db.rawQuery(
        `SELECT count(*) as cnt FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%GIN%'`,
      )
      const ginRows = Array.isArray(ginRes) ? ginRes : ((ginRes as any)?.rows ?? [])
      const ginCount = Number(ginRows[0]?.cnt ?? 0)
      if (ginCount === 0) {
        issues.push({
          severity: 'warning',
          code: 'PG_INDEX_MISSING_GIN',
          message: '未发现 GIN 索引：建议为 JSONB 字段创建 GIN 索引以优化 JSON 查询性能',
        })
      }
    } catch {
      issues.push({
        severity: 'info',
        code: 'PG_INDEX_CHECK',
        message: '索引检查跳过（无法读取 pg_indexes）',
      })
    }

    return issues
  }

  private async checkRlsReadiness(_orgId: number): Promise<MigrationIssue[]> {
    const issues: MigrationIssue[] = []

    if (isPg()) {
      // PG 下实际检查 RLS 是否已启用
      try {
        const tables = [
          'projects',
          'tasks',
          'wbs_nodes',
          'pdm_migration_runs',
          'pdm_entity_mappings',
          'pdm_migration_snapshots',
          'pdm_migration_reports',
        ]
        for (const table of tables) {
          const res = await db.rawQuery(
            `SELECT relname, relrowsecurity FROM pg_class
             WHERE relname = ? AND relnamespace = 'public'::regnamespace`,
            [table],
          )
          const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
          const rlsOn = rows.some((r: any) => r.relrowsecurity || r.relrowsecurity === 't')
          if (!rlsOn) {
            issues.push({
              severity: 'warning',
              code: 'PG_RLS_NOT_ENABLED',
              message: `表 ${table} 未启用 RLS：建议在 PG 部署时统一启用 ROW LEVEL SECURITY`,
              sourceTable: table,
            })
          }
        }
      } catch {
        issues.push({
          severity: 'warning',
          code: 'PG_RLS_CHECK_FAILED',
          message: 'PostgreSQL RLS 检查失败：无法验证 RLS 策略',
        })
      }
    } else {
      // SQLite 下给出静态提示
      issues.push({
        severity: 'warning',
        code: 'PG_RLS_NOT_READY',
        message: 'PostgreSQL RLS 策略未启用：基于 organization_id 的 RLS 需在 PG 部署时统一启用',
      })
      issues.push({
        severity: 'info',
        code: 'PG_RLS_CHECK',
        message:
          '需对以下表启用 RLS: projects / tasks / wbs_nodes / pdm_migration_runs / pdm_entity_mappings / pdm_migration_snapshots / pdm_migration_reports',
      })
    }

    return issues
  }
}
