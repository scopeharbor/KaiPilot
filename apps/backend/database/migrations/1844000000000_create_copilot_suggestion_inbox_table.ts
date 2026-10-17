import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * copilot_suggestion_inbox 表：五来源 AI 建议收件箱
 * （v3-copilot-suggestion-inbox §3.1）。
 *
 * 只存状态与去重元数据，**不存建议正文**。
 * 内容按引用回源读取，权限沿用来源自身模型。
 *
 * 字段：
 * - organization_id：组织隔离（必填）
 * - project_id：项目隔离
 * - state：五态生命周期（unread/read/adopted/dismissed/expired）
 * - problem_kind：问题种类（去重键基础）
 * - severity：严重度
 * - dedupe_key：去重键 JSON（problem_kind + declared_key）
 * - source_refs_json：来源引用 JSON 数组（多来源合并时有多个）
 * - expiry_reason：过期原因（state=expired 时必填）
 * - expiry_detail：过期详情说明
 * - read_at：查看时间
 * - actioned_at：用户动作时间
 */
export default class extends BaseSchema {
  protected tableName = 'copilot_suggestion_inbox'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织隔离（必填）
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 项目隔离
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 五态生命周期
      table.string('state', 24).notNullable().defaultTo('unread')
      table.check("state IN ('unread','read','adopted','dismissed','expired')")

      // 问题种类（去重键基础）
      table.string('problem_kind', 48).notNullable()

      // 严重度
      table.string('severity', 16).notNullable().defaultTo('medium')
      table.check("severity IN ('critical','high','medium','low','info')")

      // 去重键 JSON（{ problemKind, declaredKey }——仅两个字符串标量字段）
      // PG 用 jsonb：本列参与 uq_csi_dedupe 唯一约束（btree），PG json 类型无默认
      // btree operator class（真实 GCP fresh PG exit 1：data type json has no default
      // operator class for access method "btree"）；jsonb 自带默认 btree/hash opclass。
      // 语义等价：键仅 problemKind/declaredKey 两个字符串字段——无数组/数字/嵌套，
      // jsonb 规范化（键序/数字）不影响相等性；jsonb 结构相等 ⟺ 两字段字符串相等
      // ⟺ serializeInboxDedupeKey 规范串相等（服务端去重恒用规范串，见
      // packages/types copilot-suggestion-inbox.ts「用于 map key 或 DB 唯一约束」）。
      // SQLite：knex 将 jsonb 映射为 json（sqlite-columncompiler: jsonb='json'），
      // SQLite DDL 与既有行为逐字节一致；模型 prepare/consume 契约不变。
      table.jsonb('dedupe_key_json').notNullable()

      // 来源引用 JSON 数组（InboxSourceRef[]，多来源合并时有多个）
      // 同上：本列参与 idx_csi_org_proj_source 索引，PG 需要 jsonb 才具 btree 可索引性；
      // 该列仅为可解释 payload（无查询按内容过滤），SQLite 由 knex 映射回 json，行为不变。
      table.jsonb('source_refs_json').notNullable()

      // 过期原因（state=expired 时必填）
      table.string('expiry_reason', 48).nullable()
      table.check(
        "expiry_reason IS NULL OR expiry_reason IN ('schedule_changed','resource_changed','risk_changed','scope_changed','data_refreshed','other_changed')",
      )

      // 过期详情说明
      table.string('expiry_detail', 512).nullable()

      // 查看时间（state=read 时有值）
      table.timestamp('read_at').nullable()

      // 用户动作时间（state=adopted/dismissed 时有值）
      table.timestamp('actioned_at').nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // ── 索引 ──
      // 组织隔离 + 项目 + 状态（主查询路径）
      table.index(['organization_id', 'project_id', 'state'], 'idx_csi_org_proj_state')
      // 组织 + 严重度 + 创建时间（排序路径）
      table.index(['organization_id', 'severity', 'created_at'], 'idx_csi_org_severity_time')
      // 去重键唯一约束（同组织 + 同项目 + 同去重键 = 唯一）
      table.unique(['organization_id', 'project_id', 'dedupe_key_json'], 'uq_csi_dedupe')
      // 来源引用索引（按来源查询）
      table.index(['organization_id', 'project_id', 'source_refs_json'], 'idx_csi_org_proj_source')
      // 未读计数查询
      table.index(
        ['organization_id', 'project_id', 'state', 'created_at'],
        'idx_csi_org_proj_state_time',
      )
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
