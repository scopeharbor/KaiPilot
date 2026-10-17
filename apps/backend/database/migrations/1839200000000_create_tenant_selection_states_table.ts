import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * tenant_selection_states 表：服务端 active organization selection 快照
 *（v3-multitenant-tenant-identification §4.2）。
 *
 * spec「Tenant selection MUST support explicit organization switching」要求切换成功后
 * **服务端**持久化低敏 selection snapshot，而不是让前端本地保存 active org。
 *
 * 只存低敏字段：actor 引用、组织 ID、成员新鲜度 hash、scope hash、来源枚举与
 * selection epoch。绝不存原始 token、权限全集、组织名称或任何隐藏资源信息。
 *
 * `selection_epoch` 是切换后失效旧派生制品的依据（§4.3）：每次成功切换 +1，
 * 携带旧 epoch 的 preview/export/job/AI 句柄一律判 stale，即使用户切回原组织
 *（design Decision 3：切换不自动重放旧草稿/预览/导出/job/AI run）。
 */
export default class extends BaseSchema {
  protected tableName = 'tenant_selection_states'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // ── actor（每用户一行，唯一） ───────────────────────────────
      table.bigInteger('user_id').unsigned().notNullable().unique()

      // ── 当前 active organization（null = 尚未选择/已被移除） ─────
      table.bigInteger('organization_id').unsigned().nullable()

      // ── 低敏新鲜度与派生值 ─────────────────────────────────────
      table.string('membership_version_hash', 64).nullable()
      table.string('scope_hash', 64).nullable()

      // ── 选择来源与 scope mode（识别层枚举） ────────────────────
      table.string('selection_source', 32).notNullable().defaultTo('server_selection')
      table.string('scope_mode', 32).notNullable().defaultTo('tenant')

      // ── 失效纪元：每次成功切换递增 ─────────────────────────────
      table.integer('selection_epoch').unsigned().notNullable().defaultTo(1)

      // ── 时间戳 ────────────────────────────────────────────────
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // ── 索引 ──────────────────────────────────────────────────
      table.index(['user_id'], 'idx_tss_user')
      table.index(['organization_id'], 'idx_tss_org')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
