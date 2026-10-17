/**
 * v3-copilot-comment-thread-agent —— 为 comments 表新增 author_type 列。
 *
 * author_type: 'user'（默认，真人）| 'agent'（Copilot）。
 * 不新建表：复用既有 comments 表，新增一列区分作者类型。
 *
 * 方言兼容：不使用 `.after()`（SQLite 不支持列定位），列顺序由建表顺序决定。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class AddAuthorTypeToComments extends BaseSchema {
  protected tableName = 'comments'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('author_type', 10).notNullable().defaultTo('user')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('author_type')
    })
  }
}
