/**
 * v3-plugin-scoped-storage —— plugin_storage_entries 表（任务 2.1）。
 *
 * entry 承载 canonical JSON 文档（design D2）：normalized key、schemaVersion、
 * byteSize（canonical 序列化字节数）、单调递增 revision（CAS 并发控制，D3）。
 * 唯一性：(namespace_id, key)。namespace 删除时条目级联删除（仅清理确认路径可达）。
 * SQLite 兼容 + PG 兼容。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_storage_entries', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('namespace_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('plugin_storage_namespaces')
        .onDelete('CASCADE')

      // normalized key（小写，[a-z0-9][a-z0-9._-]{0,199}）
      table.string('key', 200).notNullable()

      // canonical JSON document（写入前经共享契约 validateStorageValueDocument 校验）
      table.json('value').notNullable()

      // entry 内容 digest（fnv1a32 域分离，低敏审计与清理聚合用）
      table.string('canonical_digest', 64).notNullable().defaultTo('')

      // canonical 序列化 UTF-8 字节数（配额 delta 计算基准）
      table.integer('byte_size').notNullable().defaultTo(0)

      // 乐观并发 revision：新建=1，每次成功 put +1
      table.integer('revision').notNullable().defaultTo(1)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['namespace_id', 'key'])
      table.index(['namespace_id'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_storage_entries')
  }
}
