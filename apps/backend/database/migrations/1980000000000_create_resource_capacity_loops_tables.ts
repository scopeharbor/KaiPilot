import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-resource-capacity-forecasting-closed-loop（任务 3.1）
 *
 * 新增闭环编排元数据表：loops / baseline snapshots / scenarios / simulation snapshots。
 * 红线：
 * - 只新增表与索引，不修改既有资源数据；
 * - 全部显式 organization_id 父链（CASCADE）；
 * - 快照为不可变追加（只有 created_at，没有 updated_at）；
 * - row_version 承担乐观锁；state 用 CHECK 封闭。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('resource_capacity_loops', (table) => {
      table.bigIncrements('id')

      // ── 组织父链 ──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // ── 归属与状态机 ──
      table
        .bigInteger('owner_user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table.string('title', 200).notNullable()
      table.string('state', 20).notNullable().defaultTo('draft')
      table.check(
        "state IN ('draft','simulated','selected','handed-off','observing','reviewed','closed','cancelled')",
      )

      // ── scope/window/granularity（封闭枚举 + 有界窗口）──
      table.string('granularity', 10).notNullable()
      table.check("granularity IN ('day','week','month')")
      table.string('window_start', 10).notNullable()
      table.string('window_end', 10).notNullable()

      // ── 乐观锁与 feature 版本 ──
      table.integer('row_version').notNullable().defaultTo(1)
      table.string('feature_version', 40).notNullable().defaultTo('resource-capacity-loop@1')

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // ── 索引 ──
      table.index(['organization_id', 'state'])
      table.index(['organization_id', 'owner_user_id'])
      table.index(['organization_id', 'created_at'])
    })

    this.schema.createTable('resource_capacity_baseline_snapshots', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('loop_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_loops')
        .onDelete('CASCADE')

      // ── schema 版本与 payload 上限在 Service 层校验（≤2 MiB）──
      table.string('schema_version', 40).notNullable()
      table.text('packet_json', 'longtext').notNullable()

      // ── digest / 指纹摘要（来源/权限/freshness）──
      table.string('baseline_digest', 64).notNullable()
      table.string('permission_fingerprint', 64).notNullable()
      table.string('source_signatures_hash', 64).notNullable()
      table.boolean('ready_for_simulation').notNullable().defaultTo(false)

      // ── superseded 追加链：历史不改写，只指向新版本 ──
      table.bigInteger('superseded_by_id').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()

      // ── 唯一性：同 loop 内相同内容 digest 幂等去重 ──
      table.unique(['organization_id', 'loop_id', 'baseline_digest'])
      table.index(['organization_id', 'loop_id', 'created_at'])
    })

    this.schema.createTable('resource_capacity_scenarios', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('loop_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_loops')
        .onDelete('CASCADE')
      table
        .bigInteger('baseline_snapshot_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_baseline_snapshots')
        .onDelete('RESTRICT')

      table.string('name', 120).notNullable()
      // overlay union 数组（封闭四类；数量 ≤20 在 Validator 层校验）
      table.text('overlays_json', 'longtext').notNullable().defaultTo('[]')
      table.integer('row_version').notNullable().defaultTo(1)
      table.boolean('active').notNullable().defaultTo(true)

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      table.unique(['organization_id', 'loop_id', 'name'])
      table.index(['organization_id', 'loop_id', 'active'])
    })

    this.schema.createTable('resource_capacity_simulation_snapshots', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('scenario_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_scenarios')
        .onDelete('CASCADE')
      table
        .bigInteger('loop_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_loops')
        .onDelete('CASCADE')

      table.string('engine_version', 40).notNullable()
      table.integer('scenario_revision').notNullable()
      table.text('rows_json', 'longtext').notNullable()
      table.string('gap_delta_hours', 24).notNullable().defaultTo('0')
      table.integer('contention_delta_count').notNullable().defaultTo(0)
      table.string('confidence_band', 10).notNullable().defaultTo('medium')
      table.check("confidence_band IN ('high','medium','low')")
      table.text('warnings_json', 'longtext').notNullable().defaultTo('[]')
      table.string('simulation_digest', 64).notNullable()
      table.string('stale_state', 16).notNullable().defaultTo('current')
      table.check("stale_state IN ('current','stale')")

      // 不可变快照：只有 created_at。
      table.timestamp('created_at', { useTz: true }).notNullable()

      // （unique/index 自动名 91/83 字节，PG 63-byte 截断后撞名 → 显式短名，
      //   v3-docker-compose-runtime-foundation 第七轮审计）
      table.unique(
        ['organization_id', 'scenario_id', 'simulation_digest'],
        'uq_rcss_org_scenario_digest',
      )
      table.index(['organization_id', 'scenario_id', 'created_at'], 'idx_rcss_org_scenario_created')
    })
  }

  async down() {
    this.schema.dropTable('resource_capacity_simulation_snapshots')
    this.schema.dropTable('resource_capacity_scenarios')
    this.schema.dropTable('resource_capacity_baseline_snapshots')
    this.schema.dropTable('resource_capacity_loops')
  }
}
