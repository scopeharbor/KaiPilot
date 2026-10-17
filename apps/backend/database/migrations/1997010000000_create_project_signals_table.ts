import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-triz-contradiction-copilot W3 任务 3.1 —— `project_signals` 被动雷达信号表（design D5）。
 *
 * 一行 = 一条「项目 + 信号类型 + 观测窗」的雷达信号（同一三元组只允许一行，重复检测命中既有行并更新读数）。
 * 字段族：
 * - 归属：`organization_id` / `project_id`（全部查询强制双列过滤，跨组织统一 404）；
 * - 分层：`signal_type` / `confidence_tier` / `tier_reasons`(JSON 四条件命中情况) / `severity`；
 * - 读数：`evidence`(JSON 低敏：指标名、当前值、阈值、基期、覆盖周期数、实体 ID)；
 * - 幂等：`idempotency_key`(确定性摘要) + `observation_window`；
 * - 生命周期：`expires_at` / `status` / `previous_status` / `status_changed_by` / `status_changed_at`
 *   / `adopted_analysis_id` → `triz_copilot_analyses.id`（可空，采纳后双向可追溯）；
 * - 审计与软删：`created_by` / `deleted_at` / 时间戳。
 *
 * **RL-12（观测禁存全文）**：本表 MUST NOT 存 PM 陈述原文、prompt 或模型输出全文；
 * 证据只落数值、枚举码与实体 ID（`evidence` 为有界 JSON，实体 ID 数组另有条数上限）。
 * **D9 三条硬边界**：无 S 曲线/进化法则类信号（`signal_type` CHECK 闭集即护栏）；
 * 不消费打卡/考勤/独立工时日志；证据为团队/项目聚合口径（无个人维度字段）。
 * **RL-06 副作用边界**：检测链路零业务表写入，本表是雷达唯一的自有写入面。
 *
 * 方言兼容：无 `.after()`；约束与索引显式命名（≤ PostgreSQL 63 字节）；
 * JSON 列不参与 btree 唯一 / 索引（PG `json` 无默认 opclass）。
 */
export default class extends BaseSchema {
  protected tableName = 'project_signals'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // ── 分层 ──────────────────────────────────────────────────────────
      // 信号类型闭集：即 D9 ① 的护栏（不存在 S 曲线 / 进化法则阶段类取值）。
      table.string('signal_type', 32).notNullable()
      table.check(
        "signal_type IN ('progress_deviation','risk_surge','resource_overload','milestone_slip')",
      )

      table.string('confidence_tier', 8).notNullable().defaultTo('low')
      table.check("confidence_tier IN ('low','high')")

      /** 四条件命中情况（design D8：显著幅度 / 连续周期 / 字段完整 / 复合证据）。 */
      table.json('tier_reasons').notNullable()

      table.string('severity', 12).notNullable().defaultTo('warning')
      table.check("severity IN ('info','warning','critical')")

      /** 低敏证据（指标名 / 当前值 / 阈值 / 基期 / 覆盖周期数 / 实体 ID），无长文本。 */
      table.json('evidence').notNullable()

      // ── 幂等与观测窗 ──────────────────────────────────────────────────
      /** 确定性去重摘要（项目 + 类型 + 观测窗 + 关键实体集合摘要，SHA-256 十六进制）。 */
      table.string('idempotency_key', 64).notNullable()

      /** 观测窗（`YYYY-MM-DD..YYYY-MM-DD`，闭区间；可排序、可复算、非随机）。 */
      table.string('observation_window', 32).notNullable()

      table.timestamp('expires_at').notNullable()

      // ── 状态机：open → dismissed / adopted / expired ────────────────────
      table.string('status', 12).notNullable().defaultTo('open')
      table.check("status IN ('open','dismissed','adopted','expired')")

      table.string('previous_status', 12).nullable()
      table.check(
        "previous_status IS NULL OR previous_status IN ('open','dismissed','adopted','expired')",
      )

      table
        .bigInteger('status_changed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('status_changed_at').nullable()

      /** 采纳后的分析记录（W2a 表）；删除分析记录只置空关联，不删信号。 */
      table
        .bigInteger('adopted_analysis_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('triz_copilot_analyses')
        .onDelete('SET NULL')

      // ── 审计与软删 ────────────────────────────────────────────────────
      /** 检测发起人；系统触发（计划任务）时为 null。 */
      table
        .bigInteger('created_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 库层唯一约束：同一「项目 + 类型 + 观测窗」只允许一行（任务 3.1 验收）。
      table.unique(
        ['project_id', 'signal_type', 'observation_window'],
        'uq_project_signals_project_type_window',
      )

      table.index(
        ['organization_id', 'project_id', 'status'],
        'idx_project_signals_org_project_status',
      )
      table.index(
        ['organization_id', 'project_id', 'confidence_tier'],
        'idx_project_signals_org_project_tier',
      )
      table.index(['idempotency_key'], 'idx_project_signals_idempotency')
      table.index(['expires_at'], 'idx_project_signals_expires_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
