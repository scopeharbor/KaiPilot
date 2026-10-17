/**
 * v3-prompt-version-registry —— 统一 AI 调用账本增加 prompt_version 列。
 *
 * 每条账本记录携带 prompt 名与版本，用于质量归因。
 * prompt_version 走 aiproj_ 本地扩展命名空间（OTel 未定义版本字段）。
 */
// BaseSchema 在 '@adonisjs/lucid/schema'，不在 '/orm'（那里是 BaseModel/column 等）。
// 写错子路径会让这条迁移在链接期 SyntaxError，整条迁移链断在这里、全库建不出来。
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class AddPromptVersionToLedgerTable extends BaseSchema {
  protected tableName = 'unified_ai_invocation_ledger'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // prompt_version：nullable，已有行默认 null（未注册）。
      // 与 prompt_name 列相邻，便于查询。
      table.string('prompt_version', 64).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('prompt_version')
    })
  }
}
