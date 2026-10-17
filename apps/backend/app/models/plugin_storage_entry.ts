/**
 * v3-plugin-scoped-storage —— PluginStorageEntry Model（任务 2.1）。
 *
 * entry = namespace 内一个 canonical JSON 文档（design D2）：
 * - key 已在服务层规范化（小写、有界），(namespace_id, key) 唯一；
 * - revision 单调递增，写入必须携带 expectedRevision 做 CAS（spec Requirement 3）；
 * - byteSize 为 canonical 序列化 UTF-8 字节数，是配额 delta 的计算基准；
 * - 删除仅能经 namespace 清理路径（级联）或单条 delete 服务方法。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/** JSON 字段序列化器：处理 better-sqlite3 的对象绑定问题（与 AuditLog 一致）。 */
const jsonColumn = () =>
  column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) => {
      if (value === null || value === undefined) return null
      if (typeof value === 'string') {
        try {
          return JSON.parse(value)
        } catch {
          return null
        }
      }
      return value
    },
    serialize: (value: unknown) => value,
  })

export default class PluginStorageEntry extends BaseModel {
  public static table = 'plugin_storage_entries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare namespaceId: number

  /** normalized key（小写、有界；服务层保证）。 */
  @column()
  declare key: string

  @jsonColumn()
  declare value: unknown

  @column()
  declare canonicalDigest: string

  @column()
  declare byteSize: number

  @column()
  declare revision: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /**
   * Scope: 按 namespace 过滤（跨 namespace 访问的唯一合法入口）。
   */
  static forNamespace(namespaceId: number) {
    return this.query().where('namespace_id', namespaceId)
  }
}
