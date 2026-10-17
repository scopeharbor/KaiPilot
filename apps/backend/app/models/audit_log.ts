import { AuditLogSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

/**
 * 审计日志模型（sec7 / sec11）。
 *
 * `metadata` / `changes` 为 JSON 列：迁移用 `table.json()`（SQLite TEXT / PG JSONB），
 * 但 Lucid 不自动序列化，故与 User.preferences 一致，用 prepare/consume 做对象 ↔ JSON 字符串 marshalling
 * （否则 better-sqlite3 绑定对象会报错）。
 */
const jsonColumn = () =>
  column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value: unknown) => value,
  })

export default class AuditLog extends AuditLogSchema {
  @jsonColumn()
  declare metadata: Record<string, unknown> | null

  @jsonColumn()
  declare changes: Record<string, unknown> | null

  async delete(): Promise<void> {
    throw new Error('audit_logs immutable: delete forbidden')
  }

  async save(): Promise<this> {
    if (this.$isPersisted) {
      throw new Error('audit_logs immutable: update forbidden')
    }
    return super.save()
  }
}
