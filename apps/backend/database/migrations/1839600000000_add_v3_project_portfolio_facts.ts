import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * V3 项目组合事实列扩展（v3-database-schema-expansion §3.1–3.3）。
 *
 * 在既有 `projects` 表上增加**可空、additive**的 V3 组合事实列，覆盖：
 * 项目经理、部门、业务线、投资类型、战略主题、项目群、预测成本、预测结束日、
 * 自定义字段、事实来源与新鲜度。既有 V1 列、状态机、优先级、日期语义、
 * `budget_cents`/`actual_cost_cents` 含义、软删除与组织归属**全部不变**。
 *
 * 设计裁决（design Decision 1/3/5/6）：
 * - 直接加列而非建 side table（事实属项目生命周期与安全边界，免 join/preload）。
 * - 部门/项目群为有界字符串，非外键（后续部门/项目群管理 change 再规范化）。
 * - 财务字段显式、可空、以分存储；不引入 ROI/收入/NPV/IRR/推断列。
 * - `custom_fields` 为有界 JSON 元数据，非逃生舱（契约层 validateBoundedProjectCustomFields 二次强制）。
 * - org-leading 索引仅加在匹配预期读路径的列；不创建全局唯一的租户本地标识。
 *
 * 方言兼容：
 * - SQLite：`ALTER TABLE ADD COLUMN` 支持可空列 + REFERENCES 子句（FK 仅在 PRAGMA foreign_keys=ON 时强制，
 *   AdonisJS/Lucid 默认不强制造 FK 约束，声明本身无害且 PG 上生效）。
 * - PostgreSQL：同迁移直接生效（FK + 索引 + check）。
 * - TODO-DEBT: DEBT-01 — `forecast_cost_cents` V1 以分整数存储规避 SQLite REAL 精度风险，V2 迁 PG 改 NUMERIC(15,2)；
 *   `custom_fields` V1 用 json，V2 迁 PG 改 jsonb + GIN 索引。
 *
 * 回滚：`down` 按加列逆序 dropColumn + dropIndex；因全部 additive 可空，旧运行时代码回滚后忽略缺失字段。
 */
export default class extends BaseSchema {
  protected tableName = 'projects'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // ── 项目经理（组织内活跃成员；create 默认创建者，update 校验成员归属）──
      // FK→users ON DELETE SET NULL（SQLite alterTable 不强造 FK，PG 生效；与既有 created_by/updated_by 一致语义）
      table.bigInteger('project_manager_id').unsigned().nullable()
      table.foreign('project_manager_id').references('id').inTable('users').onDelete('SET NULL')

      // ── 组织内分类键（有界字符串，非 FK；后续 change 规范化）──
      table.string('department_key', 64).nullable()
      table.string('department_name', 128).nullable()
      table.string('business_line', 128).nullable()

      // ── 投资类型（枚举：strategic/compliance/operations/innovation/other）──
      // SQLite ALTER TABLE 不支持 ADD CONSTRAINT/CHECK（knex 会生成非法语法）；
      // 枚举由 validator（vine.enum 白名单）+ service（assertInvestmentType）双层强制。
      // PG 可在后续 follow-up 迁移补 CHECK；本 change 不引入方言分歧。
      table.string('investment_type', 32).nullable()

      // ── 战略主题 / 项目群键 ──
      table.string('strategy_theme', 128).nullable()
      table.string('program_key', 64).nullable()

      // ── 预测财务（显式、可空、以分存储；未知为 null，不转 0）──
      // TODO-DEBT: DEBT-01 — V2 迁 PG 改 NUMERIC(15,2)。
      table.bigInteger('forecast_cost_cents').nullable()
      table.date('forecast_end_date').nullable()

      // ── 有界自定义字段 JSON（契约层 validateBoundedProjectCustomFields 二次强制）──
      // TODO-DEBT: DEBT-01 — V2 迁 PG 改 jsonb + GIN 索引。
      table.json('custom_fields').nullable()

      // ── 事实来源与新鲜度（低敏审计摘要）──
      // 枚举同 investment_type：由 validator + service 双层强制（SQLite ALTER 不支持 CHECK）。
      table.string('portfolio_fact_source', 32).nullable()
      table.timestamp('portfolio_fact_updated_at').nullable()

      // ── org-leading 索引（组合过滤/分组/新鲜度读路径）──
      // 全部以 organization_id 起首，不创建全局唯一的租户本地标识（design Decision 6）。
      table.index(['organization_id', 'project_manager_id'], 'idx_projects_org_manager')
      table.index(['organization_id', 'department_key'], 'idx_projects_org_department')
      table.index(['organization_id', 'business_line'], 'idx_projects_org_business_line')
      table.index(['organization_id', 'investment_type'], 'idx_projects_org_investment_type')
      table.index(['organization_id', 'program_key'], 'idx_projects_org_program')
      table.index(['organization_id', 'forecast_end_date'], 'idx_projects_org_forecast_end')
      table.index(
        ['organization_id', 'portfolio_fact_updated_at'],
        'idx_projects_org_fact_updated_at',
      )
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      // 先 drop 索引再 drop 列（SQLite 对 dropIndex 宽容，PG 要求顺序）
      table.dropIndex([], 'idx_projects_org_manager')
      table.dropIndex([], 'idx_projects_org_department')
      table.dropIndex([], 'idx_projects_org_business_line')
      table.dropIndex([], 'idx_projects_org_investment_type')
      table.dropIndex([], 'idx_projects_org_program')
      table.dropIndex([], 'idx_projects_org_forecast_end')
      table.dropIndex([], 'idx_projects_org_fact_updated_at')

      // drop 外键（PG）再 drop 列
      table.dropForeign('project_manager_id')

      table.dropColumn('project_manager_id')
      table.dropColumn('department_key')
      table.dropColumn('department_name')
      table.dropColumn('business_line')
      table.dropColumn('investment_type')
      table.dropColumn('strategy_theme')
      table.dropColumn('program_key')
      table.dropColumn('forecast_cost_cents')
      table.dropColumn('forecast_end_date')
      table.dropColumn('custom_fields')
      table.dropColumn('portfolio_fact_source')
      table.dropColumn('portfolio_fact_updated_at')
    })
  }
}
